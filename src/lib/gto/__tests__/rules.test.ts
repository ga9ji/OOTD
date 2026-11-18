import { describe, expect, it } from 'vitest'
import { createMissions, missionMarkers, missionText, MISSIONS, startMission, stepMissions } from '../missions'
import { createOutfit, findStealTarget, stealOutfit, wearFromWardrobe } from '../outfit'
import { createPlayer } from '../onFoot'
import { createWanted, policeControl, policeWanted, stepWanted, WANTED_TUNING } from '../wanted'
import { createVehicle } from '../vehicle'
import type { GtoEvent, PedState } from '../types'
import { DT, world } from './helpers'

const ped = (over: Partial<PedState> = {}): PedState => ({
  id: 9, x: 0, y: 0, z: -1.5, heading: 0, speed: 1, outfitKey: 'b', mood: 'walk', timer: 0, route: null, stride: 0, ...over,
})
const ev = (type: GtoEvent['type'], value?: number): GtoEvent => ({ type, x: 0, z: 0, value })
const calm = { policeDist: Infinity, seen: false, playerSpeed: 5, x: 0, z: 0, changedOutfit: false }

describe('gto outfit: 服の強奪と着替え', () => {
  it('目の前の通行人だけを狙える', () => {
    const p = createPlayer(0, 0, 0, world)
    expect(findStealTarget(p, [ped()], 'a')?.id).toBe(9)
    expect(findStealTarget(p, [ped({ z: 1.5 })], 'a')).toBeNull() // 背後
    expect(findStealTarget(p, [ped({ z: -6 })], 'a')).toBeNull() // 遠い
    expect(findStealTarget(p, [ped({ outfitKey: 'a' })], 'a')).toBeNull() // 同じ服
  })

  it('奪うと服が入れ替わり、ワードローブに残る', () => {
    const r = stealOutfit(createOutfit('a'), ped(), 12)
    expect(r.outfit.wearing).toBe('b')
    expect(r.outfit.wardrobe).toEqual(['b', 'a'])
    expect(r.outfit.changedAt).toBe(12)
    expect(r.ped.outfitKey).toBe('a')
    expect(r.ped.mood).toBe('stunned')
    expect(wearFromWardrobe(r.outfit, 'a', 20).wearing).toBe('a')
    expect(wearFromWardrobe(r.outfit, 'zzz', 20)).toBe(r.outfit)
  })
})

describe('gto wanted: 手配と追跡', () => {
  it('悪さを重ねると手配度が上がる', () => {
    let w = createWanted()
    const r1 = stepWanted(w, [ev('steal')], calm, DT)
    expect(r1.wanted.level).toBe(1)
    expect(r1.events.map((e) => e.type)).toContain('wantedUp')
    w = r1.wanted
    for (let i = 0; i < 3; i++) w = stepWanted(w, [ev('carjack')], calm, DT).wanted
    expect(w.level).toBeGreaterThanOrEqual(3)
    expect(policeWanted(w.level)).toBe(w.level)
  })

  it('軽くぶつけただけでは手配されない', () => {
    expect(stepWanted(createWanted(), [ev('crash', 3)], calm, DT).wanted.heat).toBe(0)
    expect(stepWanted(createWanted(), [ev('crash', 9)], calm, DT).wanted.heat).toBeGreaterThan(0)
  })

  it('見失われると冷めて消え、見られているあいだは冷めない', () => {
    const hot = { ...createWanted(), heat: 20, level: 1 }
    let hidden = hot
    let seen = hot
    let cleared = false
    for (let i = 0; i < 60 * 12; i++) {
      const r = stepWanted(hidden, [], calm, DT)
      hidden = r.wanted
      cleared = cleared || r.events.some((e) => e.type === 'wantedClear')
      seen = stepWanted(seen, [], { ...calm, seen: true, policeDist: 30 }, DT).wanted
    }
    expect(hidden.level).toBe(0)
    expect(cleared).toBe(true)
    expect(seen.heat).toBe(20)
  })

  it('見られていないときに着替えると、一気に冷める', () => {
    const hot = { ...createWanted(), heat: 100, level: 3 }
    expect(stepWanted(hot, [], { ...calm, changedOutfit: true }, DT).wanted.heat).toBeLessThan(40)
    expect(stepWanted(hot, [], { ...calm, changedOutfit: true, seen: true }, DT).wanted.heat).toBe(100)
  })

  it('警察のそばで止まっていると捕まる', () => {
    let w = { ...createWanted(), heat: 50, level: 2 }
    let busted = false
    for (let i = 0; i < 60 * 3 && !busted; i++) {
      const r = stepWanted(w, [], { ...calm, seen: true, policeDist: 3, playerSpeed: 0 }, DT)
      w = r.wanted
      busted = r.events.some((e) => e.type === 'busted')
    }
    expect(busted).toBe(true)
    expect(w.level).toBe(0)
    expect(WANTED_TUNING.bustTime).toBeGreaterThan(1)
  })

  it('追う車は主人公のほうへハンドルを切る', () => {
    const v = { ...createVehicle(1, 'police', 0, 0, 0, world), speed: 10 }
    expect(policeControl(v, { x: 40, z: -40 }, world).steer).toBeGreaterThan(0)
    expect(policeControl(v, { x: -40, z: -40 }, world).steer).toBeLessThan(0)
    expect(policeControl(v, { x: 0, z: -60 }, world).throttle).toBe(1)
  })
})

describe('gto missions: ミッション', () => {
  const view = { t: 0, x: 0, z: 0, inVehicle: false, wantedLevel: 0 }

  it('すべてのミッションの地点は、歩いて行ける場所にある', () => {
    for (const m of MISSIONS) {
      expect(world.insideBuilding(m.start.x, m.start.z), m.id).toBe(false)
      for (const s of m.steps) {
        if (s.kind !== 'goto') continue
        expect(world.insideBuilding(s.x, s.z), m.id).toBe(false)
        expect(world.nearestRoad(s.x, s.z, s.vehicle === true, 30)?.dist, m.id).toBeLessThan(s.radius)
      }
    }
  })

  it('開始地点を踏むと始まり、目印が目的地に切り替わる', () => {
    const m0 = createMissions()
    // 最初から開いている依頼だけに目印が立つ（ほかは前の依頼を達成すると開く）
    expect(missionMarkers(m0)).toHaveLength(MISSIONS.filter((d) => !d.after).length)
    const first = MISSIONS[0]
    const r = stepMissions(m0, { ...view, x: first.start.x, z: first.start.z }, [], DT)
    expect(r.mission.active?.id).toBe(first.id)
    expect(r.events[0].type).toBe('missionStart')
    expect(missionText(r.mission, 0).objective).toBe(first.steps[0].text)
    expect(missionText(r.mission, 0).banner).toContain(first.giver)
  })

  it('手順を順にこなすと達成して報酬が入る', () => {
    const first = MISSIONS[0]
    let m = startMission(createMissions(), first.id, 0)
    // 手順ごとに、求められていること（奪う・乗る・着く・手配なし）を満たして1歩進める
    let reward = 0
    first.steps.forEach((step, i) => {
      expect(m.active?.step).toBe(i)
      const at = step.kind === 'goto' ? { x: step.x, z: step.z, inVehicle: step.vehicle === true } : { inVehicle: step.kind === 'vehicle' }
      const happened = step.kind === 'steal' ? Array.from({ length: step.count }, () => ev('steal')) : []
      // 「逃げる」は入ってから少し待つ
      if (step.kind === 'escape') m = stepMissions(m, { ...view, t: i }, [], 2).mission
      const r = stepMissions(m, { ...view, t: i + 1, ...at }, happened, DT)
      if (step.kind === 'goto') expect(missionMarkers(m)[0].kind).toBe('goal')
      m = r.mission
      reward += r.reward
    })
    expect(reward).toBeGreaterThanOrEqual(first.reward)
    expect(m.done).toEqual([first.id])
    expect(m.active).toBeNull()
    // 達成した依頼の目印は消え、それで開いた依頼の目印が立つ
    const refs = missionMarkers(m).map((k) => k.ref)
    expect(refs).not.toContain(first.id)
    expect(refs).toEqual(MISSIONS.filter((d) => d.after === first.id).map((d) => d.id))
  })

  it('時間切れと逮捕で失敗する', () => {
    const timed = MISSIONS.find((d) => d.steps.some((s) => s.kind === 'goto' && s.timeLimit))
    if (!timed) throw new Error('mission')
    const timedStep = timed.steps.findIndex((s) => s.kind === 'goto' && s.timeLimit)
    let m = stepMissions(startMission(createMissions(), timed.id, 0, timedStep), { ...view, inVehicle: true }, [], DT).mission
    expect(m.active?.timeLeft).toBeGreaterThan(60)
    let failed = false
    for (let i = 0; i < 200 && !failed; i++) {
      const r = stepMissions(m, { ...view, inVehicle: true }, [], 1)
      m = r.mission
      failed = r.events.some((e) => e.type === 'missionFail')
    }
    expect(failed).toBe(true)
    const busted = stepMissions(startMission(createMissions(), MISSIONS[0].id, 0), view, [ev('busted')], DT)
    expect(busted.mission.active).toBeNull()
    expect(busted.mission.done).toEqual([])
  })
})
