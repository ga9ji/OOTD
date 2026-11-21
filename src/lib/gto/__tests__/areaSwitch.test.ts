import { describe, expect, it } from 'vitest'
import { AREA_IDS, AREAS, areaDef, isAreaId } from '../areas'
import { CRANES, createWorld, loadAreaWorld, loadWorld, streetProps } from '../map'
import { EAST_SIGNALS } from '../mapEastFront'
import { MISSIONS, missionsOf } from '../missionData'
import { createMissions, missionMarkers, startMission, stepMissions } from '../missions'
import { createFootGround } from '../onFootGround'
import { applySave, hasProgress, parseSave, saveArea, saveOf, type GtoSave } from '../save'
import { isCaptureQuery, launchArea, parseLaunch } from '../shot'
import { createGtoState, SPAWN, START_CASH } from '../sim'
import { TITLE_CAMERA, titleCamera } from '../titleCamera'
import { surfaceLift } from '../vehicleGround'
import { cfg, DT, start, world as shibuya } from './helpers'

// [areas] エリアを差し替える仕組みそのもの（地図の中身に依らない決まり）。
// 「渋谷の地図に、別のエリアの札を付けた世界」を作って、出し分けが地図ではなくエリアで決まることを確かめる。
// 渋谷はこれまでと同じに動き、ほかのエリアでは渋谷だけの決まり（固定の座標に置く物・原点の広場・渋谷の依頼）が出てこない。

const elsewhere = createWorld(shibuya.map, 'shinjuku')
const save = (over: Partial<GtoSave> = {}): GtoSave => ({ v: 1, cash: 4200, wearing: 'c', wardrobe: ['c', 'a', 'b'], done: [MISSIONS[0].id], ...over })

describe('gto areas: 表と世界', () => {
  it('世界は自分のエリアを知っている。エリアの分からない世界は渋谷として扱う', () => {
    expect(AREA_IDS).toEqual(['shibuya', 'shinjuku'])
    expect(loadWorld().area).toBe('shibuya')
    expect(createWorld(shibuya.map).area).toBe('shibuya')
    expect(elsewhere.area).toBe('shinjuku')
    expect(areaDef(elsewhere)).toBe(AREAS.shinjuku)
    expect(areaDef({ area: undefined as never }).id).toBe('shibuya')
    expect(isAreaId('shinjuku')).toBe(true)
    expect(isAreaId('ikebukuro')).toBe(false)
    expect(isAreaId(null)).toBe(false)
    expect(isAreaId('toString')).toBe(false)
  })

  it('エリアを選んで読む: 渋谷は同梱の世界そのもの', async () => {
    expect(await loadAreaWorld('shibuya')).toBe(loadWorld())
  })

  it('渋谷のこれまでの書き出し名は、エリアの表の渋谷のぶんと同じ物', () => {
    expect(SPAWN).toBe(AREAS.shibuya.spawn)
    expect(SPAWN).toEqual({ x: 26, z: 32, heading: -0.75 })
    expect(TITLE_CAMERA).toBe(AREAS.shibuya.title)
    expect(CRANES).toBe(AREAS.shibuya.cranes)
    expect(CRANES).toHaveLength(4)
    // 弧の中心を省いたときは原点を見る（渋谷のこれまでの弧）。中心を決めれば、そこを回る
    const c = titleCamera(0)
    expect([c.tx, c.tz]).toEqual([0, 0])
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(150, 6)
    const moved = titleCamera(0, { ...TITLE_CAMERA, cx: 40, cz: -90 })
    expect([moved.tx, moved.tz]).toEqual([40, -90])
    expect(moved.x - 40).toBeCloseTo(c.x, 6)
    expect(moved.z + 90).toBeCloseTo(c.z, 6)
  })
})

describe('gto areas: 渋谷だけの決まりは、ほかのエリアに出てこない', () => {
  const here = streetProps(shibuya)
  const there = streetProps(elsewhere)

  it('固定の座標に立てる信号柱・行灯の街灯・広場の木は、渋谷だけ', () => {
    for (const [x, z] of EAST_SIGNALS) {
      expect(here.some((p) => p.kind === 'signal' && p.x === x && p.z === z)).toBe(true)
      expect(there.some((p) => p.kind === 'signal' && p.x === x && p.z === z)).toBe(false)
    }
    // 広場の中（原点から 46m）の木は、渋谷の広場の木だけ
    expect(here.filter((p) => p.kind === 'tree' && Math.hypot(p.x, p.z) < 46).length).toBeGreaterThan(0)
  })

  it('原点のまわりの「街具を立てない円」は渋谷だけ（ほかのエリアでは、道沿いの決まりどおりに立つ）', () => {
    const inPlaza = (list: typeof here) => list.filter((p) => p.kind !== 'signal' && p.kind !== 'tree' && Math.hypot(p.x, p.z) < 27)
    expect(inPlaza(here)).toHaveLength(0)
    expect(inPlaza(there).length).toBeGreaterThan(0)
  })

  it('原点の広場の面（人と車輪が乗る 0.13m の面）は渋谷だけ', () => {
    expect(surfaceLift(shibuya, 0, 0)).toBe(0.13)
    expect(surfaceLift(elsewhere, 0, 0)).not.toBe(0.13)
    expect(createFootGround(shibuya, 5).lift(12, 3)).toBe(0.13)
    expect(createFootGround(elsewhere, 5).lift(12, 3)).not.toBe(0.13)
  })

  it('工事のクレーンは、エリアの表にあるぶんだけ', () => {
    expect(areaDef(shibuya).cranes).toHaveLength(4)
    expect(areaDef(elsewhere).cranes).toHaveLength(0)
  })
})

describe('gto areas: 出発地点と依頼', () => {
  it('出発地点はエリアの表から決まる', () => {
    const s = createGtoState(elsewhere, cfg, { seed: 3 })
    const want = elsewhere.resolveCircle(AREAS.shinjuku.spawn.x, AREAS.shinjuku.spawn.z, 0.4)
    expect(Math.hypot(s.player.x - want.x, s.player.z - want.z)).toBeLessThan(1)
    expect(s.mission.area).toBe('shinjuku')
    const home = start()
    expect(Math.hypot(home.player.x - SPAWN.x, home.player.z - SPAWN.z)).toBeLessThan(1)
  })

  it('渋谷の状態は、これまでと同じ形（エリアの欄を持たない）', () => {
    expect(createMissions()).toEqual({ active: null, done: [], banner: null, cue: null })
    expect(start().mission.area).toBeUndefined()
    expect(createMissions('shinjuku').area).toBe('shinjuku')
  })

  it('依頼人が立つ・踏んで始まるのは、いまいるエリアの依頼だけ', () => {
    expect(missionsOf(undefined)).toBe(MISSIONS)
    expect(missionsOf('shibuya')).toBe(MISSIONS)
    expect(missionsOf('shinjuku')).not.toBe(MISSIONS)
    expect(missionMarkers(createMissions()).map((m) => m.ref)).toEqual(MISSIONS.filter((d) => !d.after).map((d) => d.id))
    const shibuyaIds = new Set(MISSIONS.map((d) => d.id))
    expect(missionMarkers(createMissions('shinjuku')).some((m) => shibuyaIds.has(m.ref))).toBe(false)
    const view = { x: MISSIONS[0].start.x, z: MISSIONS[0].start.z, inVehicle: false, wantedLevel: 0, t: 1 }
    expect(stepMissions(createMissions(), view, [], DT).mission.active?.id).toBe(MISSIONS[0].id)
    expect(stepMissions(createMissions('shinjuku'), view, [], DT).mission.active).toBeNull()
  })
})

describe('gto areas: 進行の保存と持ち越し', () => {
  it('エリアの欄が無い保存（これまでの保存）はそのまま読めて、渋谷として始まる', () => {
    const parsed = parseSave(JSON.stringify({ v: 1, cash: 4200, wearing: 'c', wardrobe: ['c', 'a', 'b'], done: [MISSIONS[0].id] }))!
    expect(parsed).toEqual(save())
    expect(parsed.area).toBeUndefined()
    expect(saveArea(parsed)).toBe('shibuya')
    expect(saveArea(null)).toBe('shibuya')
  })

  it('いまいるエリアを保存して読み直せる。渋谷にいるあいだは、これまでと同じ形の保存になる', () => {
    const state = applySave(start(), save(), cfg.outfitKeys)
    expect(saveOf(state)).toEqual(save())
    expect('area' in saveOf(state)).toBe(false)
    const there = saveOf(state, 'shinjuku')
    expect(there.area).toBe('shinjuku')
    expect(saveArea(parseSave(JSON.stringify(there)))).toBe('shinjuku')
  })

  it('知らないエリアの名前が入った保存は、渋谷として始まる（ほかの進行は読める）', () => {
    const odd = parseSave(JSON.stringify({ ...save(), area: 'atlantis' }))!
    expect(saveArea(odd)).toBe('shibuya')
    expect(odd.cash).toBe(4200)
    expect(saveArea(parseSave(JSON.stringify({ ...save(), area: 42 })))).toBe('shibuya')
  })

  it('エリアを移ると、所持金・服・達成した依頼は持ち越し、場所・車・手配・進行中の依頼は持ち越さない', () => {
    // 渋谷で進めた状態（車に乗り、手配が付き、依頼の途中）
    let played = applySave(start({ mode: 'drive' }), save(), cfg.outfitKeys)
    played = { ...played, wanted: { ...played.wanted, level: 3, heat: 30 }, mission: startMission(played.mission, MISSIONS[1].id, 0) }
    const carry: GtoSave = { ...saveOf(played), area: 'shinjuku' }
    // 着いた先の始めの状態へ戻す（engine が、エリアを移ったときにやること）
    const fresh = createGtoState(elsewhere, cfg, { seed: 1 })
    const arrived = applySave(fresh, carry, cfg.outfitKeys)
    expect(arrived.cash).toBe(4200)
    expect(arrived.outfit.wearing).toBe('c')
    expect(arrived.outfit.wardrobe).toEqual(['c', 'a', 'b'])
    expect(arrived.mission.done).toEqual([MISSIONS[0].id])
    expect(arrived.mission.area).toBe('shinjuku')
    expect(arrived.mission.active).toBeNull()
    expect(arrived.wanted.level).toBe(0)
    expect(arrived.mode).toBe('foot')
    expect(arrived.player.vehicleId).toBeNull()
    expect(arrived.player).toBe(fresh.player)
  })

  it('ほかのエリアにいるだけでも「進行あり」（題名の画面に「つづきから」が出る）', () => {
    const fresh = saveOf(start())
    expect(hasProgress(fresh, START_CASH)).toBe(false)
    expect(hasProgress({ ...fresh, area: 'shinjuku' }, START_CASH)).toBe(true)
  })
})

describe('gto areas: 撮影用の URL', () => {
  const q = (s: string) => new URLSearchParams(s)

  it('&area= でエリアを選べる。無い・知らない名前は指定なし', () => {
    expect(launchArea(q('area=shinjuku&mode=foot'))).toBe('shinjuku')
    expect(launchArea(q('area=shibuya'))).toBe('shibuya')
    expect(launchArea(q('mode=foot'))).toBeNull()
    expect(launchArea(q('area=osaka'))).toBeNull()
  })

  it('撮影用の URL かどうかの見分けは、parseLaunch の autostart と同じ', () => {
    for (const s of ['', 'area=shinjuku', 'mode=foot', 'gtoShot=scramble', 'demo=foot-turn', 'demo=nothing-like-this', 'time=night&quality=mobile']) {
      expect(isCaptureQuery(q(s)), s).toBe(parseLaunch(q(s), shibuya).autostart)
    }
  })

  it('ほかのエリアでは、渋谷のデモの場所と依頼を外して、入力だけを再生する。渋谷ではこれまでどおり', () => {
    const inShibuya = parseLaunch(q('demo=mission'), shibuya)
    expect(inShibuya.demo?.stage?.mission).toBeTruthy()
    const there = parseLaunch(q('demo=mission'), elsewhere)
    expect(there.demo).not.toBeNull()
    expect(there.demo?.stage?.mission).toBeUndefined()
    expect(there.demo?.stage?.at).toBeUndefined()
    expect(there.demo?.spot).toBeUndefined()
    expect(there.demo?.segments).toBe(inShibuya.demo?.segments)
  })
})
