import { describe, expect, it } from 'vitest'
import { dist2 } from '../math'
import {
  createMissions,
  missionCueModel,
  missionGauge,
  missionMarkers,
  missionText,
  MISSIONS,
  startMission,
  stepMissions,
  guardPoint,
  isOpen,
  NEXT_JOB_LABEL,
  tailPoint,
  unlockedBy,
  type MissionStep,
  type MissionView,
} from '../missions'
import type { GtoEvent, MissionState } from '../types'
import { DT, world } from './helpers'

/** 見回りのいる手順を持つミッション（手順 1 が見回りつきの goto） */
const GUARDED = 'tail-the-reseller'
const view: MissionView = { t: 0, x: 0, z: 0, inVehicle: false, wantedLevel: 0 }
const ev = (type: GtoEvent['type'], value?: number): GtoEvent => ({ type, x: 0, z: 0, value })
const def = (id: string) => {
  const d = MISSIONS.find((m) => m.id === id)
  if (!d) throw new Error(id)
  return d
}
const stepOf = <K extends MissionStep['kind']>(id: string, index: number, kind: K) => {
  const s = def(id).steps[index]
  if (s.kind !== kind) throw new Error(`${id}#${index}`)
  return s as Extract<MissionStep, { kind: K }>
}
/** 同じ様子のまま seconds 秒進める。途中で起きたことを集める */
function hold(m: MissionState, v: MissionView, seconds: number, dt = DT) {
  const seen: GtoEvent[] = []
  let t = v.t
  let reward = 0
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt
    const r = stepMissions(m, { ...v, t }, [], dt)
    m = r.mission
    reward += r.reward
    seen.push(...r.events)
  }
  return { mission: m, seen, t, reward }
}

describe('gto missions: 中身', () => {
  it('5本以上あり、運ぶ・奪う・逃げる・時間内・尾行がそろっている', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(5)
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length)
    const steps = MISSIONS.flatMap((m) => m.steps)
    expect(steps.some((s) => s.kind === 'goto' && s.fragile)).toBe(true)
    expect(steps.some((s) => s.kind === 'steal')).toBe(true)
    expect(steps.some((s) => s.kind === 'escape')).toBe(true)
    expect(steps.some((s) => s.timeLimit != null)).toBe(true)
    expect(steps.some((s) => s.kind === 'tail')).toBe(true)
    // 1本ごとに、手順の組み合わせが違う
    expect(new Set(MISSIONS.map((m) => m.steps.map((s) => (s.kind === 'goto' && s.fragile ? 'carry' : s.kind) + (s.timeLimit ? 'T' : '')).join('>'))).size).toBe(MISSIONS.length)
    for (const m of MISSIONS) {
      expect(m.reward, m.id).toBeGreaterThan(0)
      expect(m.brief.length, m.id).toBeGreaterThan(10)
      expect(m.giver.length, m.id).toBeGreaterThan(2)
    }
  })

  it('開始地点・目的地・尾行の道筋は、歩ける場所にある', () => {
    for (const m of MISSIONS) {
      expect(world.insideBuilding(m.start.x, m.start.z), m.id).toBe(false)
      for (const s of m.steps) {
        if (s.kind === 'goto') {
          expect(world.insideBuilding(s.x, s.z), m.id).toBe(false)
          expect(world.nearestRoad(s.x, s.z, s.vehicle === true, 30)?.dist, m.id).toBeLessThan(s.radius)
        }
        if (s.kind === 'tail') {
          const total = tailPoint(s, 1e6).s
          expect(total, m.id).toBeGreaterThan(80)
          for (let d = 0; d <= total; d += 2) {
            const p = tailPoint(s, s.delay + d / s.speed)
            expect(world.insideBuilding(p.x, p.z), `${m.id} ${Math.round(p.x)},${Math.round(p.z)}`).toBe(false)
          }
          // 尾行の出だしは、依頼人の場所から見失わない距離にある
          expect(Math.sqrt(dist2(m.start.x, m.start.z, s.path[0], s.path[1])), m.id).toBeLessThan(s.far - 10)
        }
      }
    }
  })
})

describe('gto missions: 進み方', () => {
  it('開始すると導入の演出が出て、依頼人の台詞と最初の目的が読める', () => {
    const d = MISSIONS[0]
    const r = stepMissions(createMissions(), { ...view, t: 10, x: d.start.x, z: d.start.z }, [], DT)
    expect(r.events[0].type).toBe('missionStart')
    const cue = missionCueModel(r.mission, 10.5)
    expect(cue?.kind).toBe('intro')
    expect(cue?.title).toBe(d.title)
    expect(cue?.speaker).toBe(d.giver)
    expect(cue?.line).toBe(d.brief)
    expect(cue?.objective).toBe(d.steps[0].text)
    expect(missionCueModel(r.mission, 30)).toBeNull()
  })

  it('車に乗ったままでは始まらない', () => {
    const d = MISSIONS[0]
    const r = stepMissions(createMissions(), { ...view, x: d.start.x, z: d.start.z, inVehicle: true }, [], DT)
    expect(r.mission.active).toBeNull()
  })

  it('手順が変わると、次の台詞と目的の演出に切り替わる', () => {
    const d = def('first-fit')
    const r = stepMissions(startMission(createMissions(), d.id, 0), { ...view, t: 3 }, [ev('steal')], DT)
    expect(r.events.map((e) => e.type)).toEqual(['missionStep'])
    const cue = missionCueModel(r.mission, 3.2)
    expect(cue?.kind).toBe('step')
    expect(cue?.line).toBe(d.steps[1].say)
    expect(cue?.objective).toBe(d.steps[1].text)
  })

  it('奪う: 数えたぶんがゲージに出て、そろうと次へ進む', () => {
    const id = 'center-gai-sweep'
    const s = stepOf(id, 0, 'steal')
    let m = startMission(createMissions(), id, 0)
    m = stepMissions(m, view, [ev('steal')], DT).mission
    expect(missionGauge(m)).toMatchObject({ text: `1/${s.count}` })
    const r = stepMissions(m, view, Array.from({ length: s.count - 1 }, () => ev('steal')), DT)
    expect(r.mission.active?.step).toBe(1)
    expect(def(id).steps[1].kind).toBe('escape')
  })

  it('逃げる: 手配が残っているあいだは終わらず、消えると進む', () => {
    const id = 'center-gai-sweep'
    const m = startMission(createMissions(), id, 0, 1)
    const chased = hold(m, { ...view, wantedLevel: 2 }, 5)
    expect(chased.mission.active?.step).toBe(1)
    const clear = hold(chased.mission, { ...view, t: chased.t, wantedLevel: 0 }, 2)
    expect(clear.mission.active?.step).toBe(2)
  })

  it('時間内: 残り時間が減り、次の地点で足され、切れると失敗する', () => {
    const id = 'morning-assembly'
    const a = stepOf(id, 0, 'goto')
    const b = stepOf(id, 1, 'goto')
    let m = startMission(createMissions(), id, 0)
    expect(m.active?.timeLeft).toBe(a.timeLimit)
    const waited = hold(m, view, 10)
    expect(waited.mission.active?.timeLeft).toBeCloseTo((a.timeLimit ?? 0) - 10, 1)
    m = stepMissions(waited.mission, { ...view, t: waited.t, x: a.x, z: a.z }, [], DT).mission
    expect(m.active?.step).toBe(1)
    expect(m.active?.timeLeft).toBeCloseTo((a.timeLimit ?? 0) - 10 + (b.addTime ?? 0), 1)
    const late = hold(m, { ...view, t: waited.t }, 200, 0.5)
    expect(late.seen.some((e) => e.type === 'missionFail')).toBe(true)
    expect(late.mission.active).toBeNull()
    const cue = missionCueModel(late.mission, late.mission.cue?.at ?? 0)
    expect(cue?.kind).toBe('failed')
    expect(cue?.detail).toBe('時間切れ')
  })

  it('時間内: 早く着くと、残り時間ぶんの上乗せが付く', () => {
    const d = def('morning-assembly')
    let m = startMission(createMissions(), d.id, 0)
    let reward = 0
    for (const s of d.steps) {
      // 乗る段と、車で着く段は、車に乗って通す
      const at = s.kind === 'goto' ? { x: s.x, z: s.z, inVehicle: s.vehicle === true } : { inVehicle: true }
      const r = stepMissions(m, { ...view, t: 1, ...at }, [], DT)
      m = r.mission
      reward += r.reward
    }
    expect(m.done).toEqual([d.id])
    expect(reward).toBeGreaterThan(d.reward)
    const cue = missionCueModel(m, 1.5)
    expect(cue).toMatchObject({ kind: 'passed', reward: d.reward })
    expect(cue?.bonus).toBe(reward - d.reward)
  })

  it('運ぶ: 車に乗っていないと届かず、ぶつけるとしわが増え、増えすぎると失敗する', () => {
    const id = 'miyamasu-laundry'
    const index = def(id).steps.findIndex((s) => s.kind === 'goto' && s.fragile)
    const s = stepOf(id, index, 'goto')
    const m = startMission(createMissions(), id, 0, index)
    expect(stepMissions(m, { ...view, x: s.x, z: s.z }, [], DT).mission.active?.step).toBe(index)
    const bumped = stepMissions(m, { ...view, inVehicle: true }, [ev('crash', 4)], DT).mission
    expect(missionGauge(bumped)?.value).toBeCloseTo(1 / (s.fragile ?? 1), 5)
    const clean = stepMissions(m, { ...view, inVehicle: true, x: s.x, z: s.z }, [], DT)
    const dirty = stepMissions(bumped, { ...view, inVehicle: true, x: s.x, z: s.z }, [], DT)
    expect(clean.reward).toBeGreaterThan(dirty.reward)
    expect(dirty.reward).toBe(def(id).reward)
    let r = stepMissions(m, { ...view, inVehicle: true }, Array.from({ length: s.fragile ?? 1 }, () => ev('crash', 4)), DT)
    expect(r.events.some((e) => e.type === 'missionFail')).toBe(true)
    r = stepMissions(m, view, [ev('busted')], DT)
    expect(r.mission.active).toBeNull()
    expect(r.mission.done).toEqual([])
  })

  it('尾行: 相手は道筋を歩き、目印が付いていく', () => {
    const id = 'tail-the-reseller'
    const s = stepOf(id, 0, 'tail')
    const m = startMission(createMissions(), id, 0)
    const p0 = tailPoint(s, 0)
    expect([p0.x, p0.z]).toEqual([s.path[0], s.path[1]])
    const p1 = tailPoint(s, s.delay + 10)
    expect(p1.s).toBeCloseTo(s.speed * 10, 3)
    const moved = hold(m, { ...view, x: p0.x + 20, z: p0.z }, s.delay + 10)
    const mark = missionMarkers(moved.mission)[0]
    expect(mark).toMatchObject({ kind: 'goal', look: 'person' })
    expect(Math.hypot(mark.x - p1.x, mark.z - p1.z)).toBeLessThan(0.5)
  })

  it('尾行: 近づきすぎると気づかれ、離れすぎると見失って失敗する', () => {
    const id = 'tail-the-reseller'
    const s = stepOf(id, 0, 'tail')
    const m = startMission(createMissions(), id, 0)
    const p0 = tailPoint(s, 0)
    const close = hold(m, { ...view, x: p0.x + 1, z: p0.z }, 1)
    expect(missionGauge(close.mission)?.value).toBeGreaterThan(0.1)
    const spotted = hold(m, { ...view, x: p0.x + 1, z: p0.z }, 8)
    expect(spotted.mission.active).toBeNull()
    expect(missionCueModel(spotted.mission, spotted.mission.cue?.at ?? 0)?.detail).toBe('気づかれた')
    const lost = hold(m, { ...view, x: p0.x + s.far + 200, z: p0.z }, 20)
    expect(lost.mission.active).toBeNull()
    expect(missionCueModel(lost.mission, lost.mission.cue?.at ?? 0)?.detail).toBe('見失った')
  })

  it('尾行: ほどよい距離で最後まで付いていくと次へ進む', () => {
    const id = 'tail-the-reseller'
    const s = stepOf(id, 0, 'tail')
    let m = startMission(createMissions(), id, 0)
    let t = 0
    const band = (s.near + s.far) / 2
    for (let i = 0; i < 400 / 0.25 && m.active?.step === 0; i++) {
      t += 0.25
      const p = tailPoint(s, m.active.stepTime)
      m = stepMissions(m, { ...view, t, x: p.x + band * 0.7, z: p.z + band * 0.7 }, [], 0.25).mission
    }
    expect(m.active?.step).toBe(1)
  })

  it('失敗した直後は、同じ場所に立っていてもすぐには始まり直さない', () => {
    const d = def('first-fit')
    const failed = stepMissions(startMission(createMissions(), d.id, 0), { ...view, t: 5 }, [ev('busted')], DT).mission
    const at = { ...view, x: d.start.x, z: d.start.z }
    expect(stepMissions(failed, { ...at, t: 6 }, [], DT).mission.active).toBeNull()
    expect(stepMissions(failed, { ...at, t: 20 }, [], DT).mission.active?.id).toBe(d.id)
  })

  it('目印: 待機中は依頼人が立つ開始地点、進行中は目的地だけ', () => {
    const idle = missionMarkers(createMissions())
    expect(idle).toHaveLength(MISSIONS.filter((d) => !d.after).length)
    expect(idle.every((m) => m.kind === 'start' && m.look === 'person')).toBe(true)
    const going = missionMarkers(startMission(createMissions(), GUARDED, 0, 1))
    expect(going.filter((m) => !m.threat)).toHaveLength(1)
    expect(going[0].kind).toBe('goal')
    expect(missionText(startMission(createMissions(), GUARDED, 0, 1), 0).objective).toBe(def(GUARDED).steps[1].text)
  })

  it('状態を書き換えない', () => {
    const m = startMission(createMissions(), 'center-gai-sweep', 0)
    const frozen = JSON.stringify(m)
    stepMissions(m, view, [ev('steal')], DT)
    expect(JSON.stringify(m)).toBe(frozen)
  })

  // ---- 条件つきの手順（やってはいけないこと・失うもの） ----

  it('どのミッションにも、失うものがある手順が1つはある（制限時間・見回り・しわ・尾行・手配）', () => {
    for (const d of MISSIONS) {
      const pressured = d.steps.some(
        (s) => s.timeLimit != null || s.kind === 'tail' || (s.kind === 'goto' && (s.guards != null || s.fragile != null || s.noHeat === true)),
      )
      expect(pressured, d.id).toBe(true)
    }
  })

  it('見回り: 輪の中にいると疑いが上がり、満ちると失敗する。目的の文に条件が書いてある', () => {
    const s = stepOf(GUARDED, 1, 'goto')
    expect(s.guards?.length).toBeGreaterThan(0)
    expect(s.text).toContain('赤い輪')
    const g = s.guards![0]
    const p = guardPoint(g, 0)
    const m = startMission(createMissions(), GUARDED, 0, 1)
    const half = hold(m, { ...view, x: p.x, z: p.z }, 1.2)
    const gauge = missionGauge(half.mission)
    expect(gauge?.kind).toBe('alert')
    expect(gauge?.value).toBeGreaterThan(0.2)
    expect(gauge?.hint).not.toBe('')
    // 立ち止まっている見回りなら、そのまま居続けると失敗
    const still = { ...g, path: [p.x, p.z] }
    expect(guardPoint(still, 99)).toMatchObject({ x: p.x, z: p.z })
    const far = hold(m, { ...view, x: p.x + 500, z: p.z }, 30)
    expect(far.mission.active?.meter ?? 0).toBe(0)
    expect(missionGauge(far.mission)?.hint).toBe('')
  })

  it('見回り: 輪の中に居続けると「見抜かれた」で失敗する', () => {
    const s = stepOf(GUARDED, 1, 'goto')
    let m = startMission(createMissions(), GUARDED, 0, 1)
    let failed = ''
    for (let i = 0; i < 20 / DT && m.active; i++) {
      const p = guardPoint(s.guards![0], m.active.stepTime)
      const r = stepMissions(m, { ...view, t: i * DT, x: p.x + 1, z: p.z }, [], DT)
      m = r.mission
      if (r.events.some((e) => e.type === 'missionFail')) failed = m.cue?.detail ?? ''
    }
    expect(failed).toBe('見回りに見抜かれた')
  })

  it('見回り: 輪を出ると疑いはゆっくり下がる', () => {
    const s = stepOf(GUARDED, 1, 'goto')
    const p = guardPoint(s.guards![0], 0)
    const m = startMission(createMissions(), GUARDED, 0, 1)
    const inside = hold(m, { ...view, x: p.x, z: p.z }, 1)
    const peak = inside.mission.active?.meter ?? 0
    const out = hold(inside.mission, { ...view, t: 1, x: p.x + 500, z: p.z }, 2)
    const after = out.mission.active?.meter ?? 0
    expect(after).toBeLessThan(peak)
    expect(after).toBeGreaterThan(0)
  })

  it('見回りは道筋を行ったり来たりする。目印は目的地が先頭で、見回りは threat つきの人', () => {
    const g = { path: [0, 0, 10, 0], speed: 2, radius: 5 }
    expect(guardPoint(g, 2.5).x).toBeCloseTo(5)
    expect(guardPoint(g, 7.5).x).toBeCloseTo(5)
    expect(guardPoint(g, 10).x).toBeCloseTo(0)
    const marks = missionMarkers(startMission(createMissions(), GUARDED, 0, 1))
    expect(marks[0].kind).toBe('goal')
    const threats = marks.filter((m) => m.threat)
    expect(threats.length).toBe(stepOf(GUARDED, 1, 'goto').guards!.length)
    expect(threats.every((m) => m.look === 'person')).toBe(true)
  })

  it('見回りの立つ場所は歩ける所で、目的地の輪とは重ならない', () => {
    for (const d of MISSIONS) {
      for (const s of d.steps) {
        if (s.kind !== 'goto' || !s.guards) continue
        expect(s.fragile).toBeUndefined()
        for (const g of s.guards) {
          for (let i = 0; i < g.path.length; i += 2) {
            const fixed = world.resolveCircle(g.path[i], g.path[i + 1], 0.4)
            expect(Math.hypot(fixed.x - g.path[i], fixed.z - g.path[i + 1]), `${d.id} guard`).toBeLessThan(0.5)
            expect(Math.sqrt(dist2(g.path[i], g.path[i + 1], s.x, s.z))).toBeGreaterThan(g.radius + 1)
          }
        }
      }
    }
  })

  it('受け渡し: 手配を付けたまま居ると「警察を連れてきた」で失敗する', () => {
    const s = stepOf('center-gai-sweep', 2, 'goto')
    expect(s.noHeat).toBe(true)
    const m = startMission(createMissions(), 'center-gai-sweep', 0, 2)
    const calm = hold(m, { ...view, wantedLevel: 0 }, 10)
    expect(calm.mission.active).not.toBeNull()
    const hot = hold(m, { ...view, wantedLevel: 1 }, 10)
    expect(hot.mission.active).toBeNull()
    expect(hot.mission.cue?.detail).toBe('警察を連れてきてしまった')
  })
})

describe('gto missions: 行為が変わる段と、次の依頼', () => {
  it('どのミッションも、途中でやることの種類が2回以上変わる（歩く・奪う・乗る・車で走る・尾ける・逃げる）', () => {
    const act = (s: MissionStep) => (s.kind === 'goto' ? (s.vehicle ? 'drive' : 'walk') : s.kind)
    for (const d of MISSIONS) {
      const acts = d.steps.map(act)
      const changes = acts.filter((a, i) => i > 0 && a !== acts[i - 1]).length
      expect(changes, d.id).toBeGreaterThanOrEqual(2)
      // 手順ごとに目標の文が違う
      expect(new Set(d.steps.map((s) => s.text)).size, d.id).toBe(d.steps.length)
    }
  })

  it('最初の1本: 奪う → 車をつかまえる → 車で届ける、の順に目標と目印が切り替わる', () => {
    const d = def('first-fit')
    expect(d.steps.map((s) => s.kind)).toEqual(['steal', 'vehicle', 'goto'])
    let m = startMission(createMissions(), d.id, 0)
    expect(missionMarkers(m)).toHaveLength(0)
    m = stepMissions(m, { ...view, t: 1 }, [ev('steal')], DT).mission
    expect(m.active?.step).toBe(1)
    // 乗る段: 手近な車に印が付く（停まっている車を優先。警察と自分の車は選ばない）
    const scene = {
      x: 0,
      z: 0,
      vehicles: [
        { x: 3, z: 0, driver: 'police' },
        { x: 12, z: 0, driver: 'traffic' },
        { x: 0, z: 15, driver: 'none' },
      ],
    }
    const car = missionMarkers(m, scene)
    expect(car).toHaveLength(1)
    expect(car[0]).toMatchObject({ kind: 'goal', x: 0, z: 15 })
    expect(missionMarkers(m, { ...scene, vehicles: [{ x: 500, z: 0, driver: 'none' }] })).toHaveLength(0)
    // 乗ると、目標が届け先に替わり、残り時間が付く
    const r = stepMissions(m, { ...view, t: 2, inVehicle: true }, [], DT)
    expect(r.events.map((e) => e.type)).toEqual(['missionStep'])
    expect(r.mission.active?.step).toBe(2)
    expect(r.mission.active?.timeLeft).toBeGreaterThan(0)
    const goal = missionMarkers(r.mission, scene)[0]
    const last = stepOf(d.id, 2, 'goto')
    expect(goal).toMatchObject({ kind: 'goal', x: last.x, z: last.z })
    // 歩いて着いても終わらない。車で着くと達成
    const at = { ...view, t: 3, x: last.x, z: last.z }
    expect(stepMissions(r.mission, at, [], DT).mission.active).not.toBeNull()
    const won = stepMissions(r.mission, { ...at, inVehicle: true }, [], DT)
    expect(won.events.map((e) => e.type)).toEqual(['missionDone'])
  })

  it('降りて手渡す段: 車に乗ったままでは終わらず、降りると達成する。受け取る人が立っている', () => {
    const d = def('slope-delivery')
    const index = d.steps.findIndex((s) => s.kind === 'goto' && s.onFoot)
    expect(index).toBe(d.steps.length - 1)
    const s = stepOf(d.id, index, 'goto')
    const m = startMission(createMissions(), d.id, 0, index)
    expect(missionMarkers(m)[0]).toMatchObject({ kind: 'goal', look: 'person', x: s.x, z: s.z })
    const at = { ...view, t: 1, x: s.x + 3, z: s.z }
    expect(stepMissions(m, { ...at, inVehicle: true }, [], DT).mission.active?.step).toBe(index)
    expect(stepMissions(m, at, [], DT).events.map((e) => e.type)).toEqual(['missionDone'])
  })

  it('依頼は順に開く: 最初は1本だけ。達成すると次が開き、札に知らせが付き、札が消えたあとも一言が残る', () => {
    const fresh = createMissions()
    expect(MISSIONS.filter((d) => isOpen(fresh, d)).map((d) => d.id)).toEqual(['first-fit'])
    for (const d of MISSIONS) {
      if (d.after) expect(MISSIONS.some((o) => o.id === d.after), d.id).toBe(true)
      expect(d.hook.length, d.id).toBeGreaterThan(8)
    }
    // 開いていない依頼は、開始地点に立っても始まらない
    const locked = def('slope-delivery')
    expect(stepMissions(fresh, { ...view, x: locked.start.x, z: locked.start.z }, [], DT).mission.active).toBeNull()

    const last = stepOf('first-fit', 2, 'goto')
    const m = startMission(createMissions(), 'first-fit', 0, 2)
    const won = stepMissions(m, { ...view, t: 5, x: last.x, z: last.z, inVehicle: true }, [], DT).mission
    const opened = unlockedBy('first-fit')
    expect(opened.length).toBeGreaterThan(0)
    expect(opened.every((d) => isOpen(won, d))).toBe(true)
    expect(missionMarkers(won).map((k) => k.ref).sort()).toEqual(opened.map((d) => d.id).sort())
    const cue = missionCueModel(won, 6)
    expect(cue?.kind).toBe('passed')
    expect(cue?.speaker).toBe(NEXT_JOB_LABEL)
    expect(cue?.line).toBe(opened[0].hook)
    // 札が消えたあと
    expect(missionCueModel(won, 5 + 6)).toBeNull()
    expect(missionText(won, 5 + 6).banner).toBe(opened[0].hook)
    expect(missionText(won, 5 + 30).banner).toBe('')
    // 歩いて次の依頼人の所へ行くと始まる
    const nextStart = opened[0].start
    expect(stepMissions(won, { ...view, t: 20, x: nextStart.x, z: nextStart.z }, [], DT).mission.active?.id).toBe(opened[0].id)
  })

  it('全部の依頼が、順にたどれば開く', () => {
    let m = createMissions()
    for (let guard = 0; guard < MISSIONS.length; guard++) {
      const open = MISSIONS.filter((d) => isOpen(m, d))
      m = { ...m, done: [...m.done, ...open.map((d) => d.id)] }
    }
    expect([...m.done].sort()).toEqual(MISSIONS.map((d) => d.id).sort())
  })
})
