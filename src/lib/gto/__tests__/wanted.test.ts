import { describe, expect, it } from 'vitest'
import { dirOf } from '../math'
import type { GtoEvent, PedState, VehicleState } from '../types'
import { createVehicle, stepVehicle } from '../vehicle'
import {
  createWanted,
  officerDone,
  officersWanted,
  planPursuit,
  policeControl,
  policeSees,
  shortestPath,
  spawnOfficer,
  spawnPolice,
  stepOfficer,
  stepWanted,
  wantedBanner,
  WANTED_TUNING,
} from '../wanted'
import { DT, world } from './helpers'

const ev = (type: GtoEvent['type'], value?: number, ref?: string): GtoEvent => ({ type, x: 0, z: 0, value, ref })
const calm = { policeDist: Infinity, seen: false, playerSpeed: 5, x: 0, z: 0, changedOutfit: false }
const seq = (values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}
/** 0..1 を満遍なく返す、決まった乱数 */
const lcg = (seed = 1) => {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}
const police = (id: number, x: number, z: number, heading = 0): VehicleState => ({
  ...createVehicle(id, 'police', x, z, heading, world),
  driver: 'police',
})
/** 車道の上の点と、その道の向き */
const roadAt = (x: number, z: number) => {
  const r = world.nearestRoad(x, z, true, 200)
  if (!r) throw new Error('no road')
  return r
}

describe('gto wanted: 手配度の上がり下がり', () => {
  it('警察車両にぶつけると、ふつうの衝突より大きく上がる', () => {
    const plain = stepWanted(createWanted(), [ev('crash', 8, '7')], calm, DT).wanted.heat
    const rammed = stepWanted(createWanted(), [ev('crash', 8, '7')], { ...calm, policeIds: [7] }, DT).wanted.heat
    expect(rammed).toBeGreaterThan(plain + 10)
    // 止まっているところへ警察が当ててきたぶんは数えない
    expect(stepWanted(createWanted(), [ev('crash', 8, '7')], { ...calm, policeIds: [7], playerSpeed: 1 }, DT).wanted.heat).toBe(0)
  })

  it('見られたまま飛ばして逃げ続けると少しずつ上がるが、最大までは上がらない', () => {
    let w = { ...createWanted(), heat: 20, level: 1 }
    for (let i = 0; i < 60 * 400; i++) w = stepWanted(w, [], { ...calm, seen: true, policeDist: 30, playerSpeed: 20 }, DT).wanted
    expect(w.level).toBeGreaterThanOrEqual(3)
    expect(w.level).toBeLessThan(5)
  })

  it('見られているあいだは最後に見た場所を覚え、見失っても残り、消えたら忘れる', () => {
    const hot = { ...createWanted(), heat: 20, level: 1 }
    const a = stepWanted(hot, [], { ...calm, seen: true, policeDist: 20, x: 12, z: -7 }, DT).wanted
    expect(a.lastSeen).toEqual({ x: 12, z: -7 })
    const b = stepWanted(a, [], { ...calm, x: 80, z: 80 }, DT).wanted
    expect(b.lastSeen).toEqual({ x: 12, z: -7 })
    let w = b
    for (let i = 0; i < 60 * 15; i++) w = stepWanted(w, [], calm, DT).wanted
    expect(w.level).toBe(0)
    expect(w.lastSeen ?? null).toBeNull()
  })

  it('冷めていく途中で印は1つずつ減らず、冷めきったときに一度に消える', () => {
    let w = { ...createWanted(), heat: 238, level: 5 }
    const seenLevels = new Set<number>()
    let cleared = 0
    let frames = 0
    for (; frames < 60 * 60 && w.level > 0; frames++) {
      const r = stepWanted(w, [], calm, DT)
      w = r.wanted
      seenLevels.add(w.level)
      cleared += r.events.filter((e) => e.type === 'wantedClear').length
    }
    expect([...seenLevels].sort()).toEqual([0, 5])
    expect(cleared).toBe(1)
    // 見失ってから消えるまでは、待ち時間＋冷める時間
    expect(frames * DT).toBeGreaterThan(WANTED_TUNING.coolDelay + 15)
    expect(frames * DT).toBeLessThan(45)
  })

  it('冷めかけで見つかり直しても段階は戻らず保たれ、着替えたときだけ下がる', () => {
    let w = { ...createWanted(), heat: 160, level: 4 }
    for (let i = 0; i < 60 * 12; i++) w = stepWanted(w, [], calm, DT).wanted
    expect(w.heat).toBeLessThan(150)
    expect(w.level).toBe(4)
    w = stepWanted(w, [], { ...calm, seen: true, policeDist: 20 }, DT).wanted
    expect(w.level).toBe(4)
    const changed = stepWanted(w, [], { ...calm, changedOutfit: true }, DT).wanted
    expect(changed.level).toBeLessThan(4)
  })

  it('徒歩の警官に触れられると、走っていても捕まる', () => {
    let w = { ...createWanted(), heat: 50, level: 2 }
    let busted = false
    let frames = 0
    for (; frames < 60 * 3 && !busted; frames++) {
      const r = stepWanted(w, [], { ...calm, seen: true, policeDist: 40, officerDist: 1, playerSpeed: 6 }, DT)
      w = r.wanted
      busted = r.events.some((e) => e.type === 'busted')
    }
    expect(busted).toBe(true)
    expect(frames * DT).toBeLessThan(WANTED_TUNING.bustTime)
  })

  it('警察車両や乗り捨てた車が人をはねても、主人公の手配は上がらない', () => {
    const hit: GtoEvent = { type: 'hitPed', x: 30, z: 0, value: 9 }
    expect(stepWanted(createWanted(), [hit], { ...calm, driving: true }, DT).wanted.heat).toBe(0)
    expect(stepWanted(createWanted(), [hit], { ...calm, driving: false, x: 30 }, DT).wanted.heat).toBe(0)
    expect(stepWanted(createWanted(), [hit], { ...calm, driving: true, x: 28 }, DT).wanted.heat).toBeGreaterThan(0)
  })

  it('決着の一言: 逮捕と逃げ切り', () => {
    expect(wantedBanner([ev('busted')], 10)?.text).toContain('逮捕')
    expect(wantedBanner([ev('wantedClear')], 10)?.until).toBeGreaterThan(10)
    expect(wantedBanner([ev('crash')], 10)).toBeNull()
  })
})

describe('gto wanted: 視界', () => {
  it('建物の向こうからは見えない。徒歩の警官も見張る', () => {
    const r = roadAt(163, -6)
    const cop: PedState = { id: 5, x: r.x + 6, y: 0, z: r.z, heading: 0, speed: 0, outfitKey: 'a', mood: 'walk', timer: 0, route: null, stride: 0, cop: true }
    const near = policeSees(world, [], r.x, r.z, [cop])
    expect(near.seen).toBe(true)
    expect(near.officerDist).toBeCloseTo(6, 0)
    expect(policeSees(world, [police(1, r.x + 400, r.z + 400)], r.x, r.z).seen).toBe(false)
    expect(policeSees(world, [], r.x, r.z, [{ ...cop, mood: 'stunned' }]).seen).toBe(false)
  })
})

describe('gto wanted: 道沿いの追跡', () => {
  const g = world.driveGraph

  it('最短の道筋は、辺が順につながっている', () => {
    const from = 0
    // 遠い交差点を1つ選ぶ
    let to = 0
    let best = 0
    g.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - g.nodes[from].x, n.z - g.nodes[from].z)
      if (d > best && d < 400) {
        best = d
        to = i
      }
    })
    const path = shortestPath(g, from, to)
    expect(path).not.toBeNull()
    if (!path) return
    expect(g.edges[path[0]].from).toBe(from)
    expect(g.edges[path[path.length - 1]].to).toBe(to)
    for (let i = 1; i < path.length; i++) expect(g.edges[path[i]].from).toBe(g.edges[path[i - 1]].to)
    expect(shortestPath(g, from, from)).toEqual([])
  })

  it('見えない相手へは、建物を突っ切らずに道の上の地点へ向かう', () => {
    const a = roadAt(163, -6)
    const b = roadAt(-165, -17)
    const car = police(1, a.x, a.z, a.heading)
    const w0 = { ...createWanted(), heat: 100, level: 3 }
    const w = planPursuit(w0, [car], { x: b.x, z: b.z, heading: 0, speed: 0 }, true, world, DT)
    const unit = w.units?.find((u) => u.id === 1)
    expect(unit).toBeDefined()
    if (!unit) return
    expect(unit.direct).toBe(false)
    // 向かう先は車から見通せて、車道の上にある
    expect(world.segmentClear(car.x, car.z, unit.wx, unit.wz)).toBe(1)
    expect(world.nearestRoad(unit.wx, unit.wz, true, 30)?.dist).toBeLessThan(6)
    expect(Math.hypot(unit.wx - b.x, unit.wz - b.z)).toBeGreaterThan(50)
  })

  it('道沿いに走らせると、離れた主人公のそばまで辿り着く', () => {
    const a = roadAt(163, -6)
    const b = roadAt(-103, -2)
    let car = police(1, a.x, a.z, a.heading)
    let w = { ...createWanted(), heat: 100, level: 3 }
    const target = { x: b.x, z: b.z, heading: 0, speed: 0 }
    let best = Infinity
    for (let i = 0; i < 60 * 60 && best > 12; i++) {
      w = planPursuit(w, [car], target, true, world, DT)
      car = stepVehicle(car, policeControl(car, target, world, w), world, DT).vehicle
      best = Math.min(best, Math.hypot(car.x - b.x, car.z - b.z))
    }
    expect(best).toBeLessThan(12)
  })

  it('2台目は回り込み役になり、主人公の行く手を目指す', () => {
    const a = roadAt(163, -6)
    const cars = [police(1, a.x, a.z, a.heading), police(2, a.x + 3, a.z + 3, a.heading)]
    const w = planPursuit({ ...createWanted(), heat: 100, level: 3 }, cars, { x: -100, z: -2, heading: 0, speed: 20 }, true, world, DT)
    expect(w.units?.map((u) => u.role)).toEqual(['chase', 'flank'])
    // いなくなった車の役割は消える
    const w2 = planPursuit(w, [cars[1]], { x: -100, z: -2, heading: 0, speed: 20 }, true, world, DT)
    expect(w2.units?.map((u) => u.id)).toEqual([2])
  })

  it('歩きの相手には車をぶつけず、手前で止める', () => {
    const a = roadAt(163, -6)
    const f = dirOf(a.heading)
    const car = { ...police(1, a.x, a.z, a.heading), speed: 8 }
    const walker = { x: a.x + f.x * 8, z: a.z + f.z * 8, heading: a.heading, speed: 6, vehicleId: null }
    const w = planPursuit({ ...createWanted(), heat: 20, level: 1 }, [car], walker, true, world, DT)
    const c = policeControl(car, walker, world, w)
    expect(c.throttle).toBe(0)
    expect(c.brake).toBe(1)
    // 車に乗っている相手なら、そのまま当てに行く
    const driver = { ...walker, speed: 12, vehicleId: 7 }
    expect(policeControl(car, driver, world, planPursuit({ ...createWanted(), heat: 20, level: 1 }, [car], driver, true, world, DT)).throttle).toBe(1)
  })

  it('動けなくなったら下がって切り返す', () => {
    const a = roadAt(163, -6)
    const car = police(1, a.x, a.z, a.heading)
    let w = { ...createWanted(), heat: 100, level: 3 }
    const target = { x: -100, z: -2, heading: 0, speed: 10 }
    for (let i = 0; i < 60 * 2.5; i++) w = planPursuit(w, [car], target, true, world, DT)
    expect(w.units?.[0].reverse).toBeGreaterThan(0)
    expect(policeControl(car, target, world, w).brake).toBe(1)
  })

  it('塞ぐ役は止まって待ち、主人公が通り過ぎたら追う役になる', () => {
    const a = roadAt(163, -6)
    const van: VehicleState = { ...createVehicle(3, 'van', a.x, a.z, a.heading + Math.PI / 2, world), driver: 'police' }
    const f = dirOf(a.heading)
    const before = { x: a.x - f.x * 50, z: a.z - f.z * 50, heading: a.heading, speed: 15 }
    let w = planPursuit({ ...createWanted(), heat: 100, level: 3 }, [van], before, true, world, DT)
    expect(w.units?.[0].role).toBe('block')
    expect(policeControl(van, before, world, w).throttle).toBe(0)
    const after = { x: a.x + f.x * 14, z: a.z + f.z * 14, heading: a.heading, speed: 15 }
    for (let i = 0; i < 60 * 4; i++) w = planPursuit(w, [van], after, true, world, DT)
    expect(w.units?.[0].role).toBe('chase')
  })

  it('走っている主人公には、行く手の車道に、こちらを向けて出す', () => {
    const a = roadAt(163, -6)
    const f = dirOf(a.heading)
    let ahead = 0
    let total = 0
    const next = lcg(7)
    for (let i = 0; i < 20; i++) {
      const v = spawnPolice(world, 50 + i, { x: a.x, z: a.z }, next, { heading: a.heading, speed: 18, level: 2, index: 0 })
      if (!v) continue
      total++
      const dx = v.x - a.x
      const dz = v.z - a.z
      expect(Math.hypot(dx, dz)).toBeGreaterThan(40)
      expect(world.nearestRoad(v.x, v.z, true, 20)?.dist).toBeLessThan(5)
      if (dx * f.x + dz * f.z > 0) ahead++
    }
    expect(total).toBeGreaterThan(10)
    expect(ahead / total).toBeGreaterThan(0.7)
  })

  it('手配度3からは、3台目に道を塞ぐ護送車が出る', () => {
    const a = roadAt(163, -6)
    const v = spawnPolice(world, 9, { x: a.x, z: a.z }, lcg(3), { heading: a.heading, speed: 18, level: 3, index: 2 })
    expect(v?.kind).toBe('van')
    expect(v?.driver).toBe('police')
    expect(spawnPolice(world, 9, { x: a.x, z: a.z }, lcg(3), { heading: a.heading, speed: 18, level: 2, index: 2 })?.kind).toBe('police')
  })
})

describe('gto wanted: 徒歩の警官', () => {
  const a = roadAt(26, 32)
  const cop = (over: Partial<PedState> = {}): PedState => ({
    id: 5, x: a.x, y: 0, z: a.z, heading: 0, speed: 0, outfitKey: 'a', mood: 'walk', timer: 0, route: null, stride: 0, cop: true, ...over,
  })

  it('歩きの主人公には手配度に応じて出て、車で走っているあいだは出ない', () => {
    expect(officersWanted(0, 'foot', 0)).toBe(0)
    expect(officersWanted(1, 'foot', 0)).toBeGreaterThan(0)
    expect(officersWanted(4, 'foot', 0)).toBeGreaterThan(officersWanted(1, 'foot', 0))
    expect(officersWanted(3, 'drive', 20)).toBe(0)
    expect(officersWanted(3, 'drive', 0)).toBeGreaterThan(0)
  })

  it('近くに止まった警察車両があれば、そこから降りてくる', () => {
    const car = police(1, a.x + 20, a.z, 0)
    const p = spawnOfficer(world, 9, { x: a.x, z: a.z }, [car], ['a', 'b'], seq([0.3, 0.6]))
    expect(p?.cop).toBe(true)
    if (!p) return
    expect(Math.hypot(p.x - car.x, p.z - car.z)).toBeLessThan(4)
    expect(world.insideBuilding(p.x, p.z)).toBe(false)
    // 車に乗った相手には、止まった警察車両がそばに無ければ出さない
    expect(spawnOfficer(world, 9, { x: a.x, z: a.z }, [], ['a', 'b'], seq([0.3, 0.6]), 'drive')).toBeNull()
    expect(spawnOfficer(world, 9, { x: a.x, z: a.z }, [], ['a', 'b'], lcg(5), 'foot')?.cop).toBe(true)
  })

  it('主人公へ走って近づく', () => {
    let p = cop()
    const target = { x: a.x + 14, z: a.z + 3 }
    const d0 = Math.hypot(p.x - target.x, p.z - target.z)
    for (let i = 0; i < 60 * 2; i++) p = stepOfficer(p, target, world, [], DT).ped
    expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(d0 - 6)
    expect(p.stride).toBeGreaterThan(0)
  })

  it('車ではねられると倒れ、手配が重くなる', () => {
    const r = stepOfficer(cop(), { x: a.x + 10, z: a.z }, world, [{ x: a.x, z: a.z, r: 1.2, speed: 9 }], DT)
    expect(r.ped.mood).toBe('stunned')
    expect(r.events[0]?.type).toBe('hitPed')
    const heat = stepWanted(createWanted(), r.events, calm, DT).wanted.heat
    expect(heat).toBeGreaterThan(WANTED_TUNING.heat.hitPed ?? 0)
  })

  it('手配が消えたら立ち止まり、しばらくして引き上げる', () => {
    let p = cop({ speed: 5 })
    for (let i = 0; i < 60 * 10; i++) p = stepOfficer(p, null, world, [], DT).ped
    expect(p.speed).toBe(0)
    expect(officerDone(p, { x: a.x, z: a.z }, 0)).toBe(true)
    expect(officerDone(cop(), { x: a.x, z: a.z }, 2)).toBe(false)
    expect(officerDone(cop(), { x: a.x + 300, z: a.z }, 2)).toBe(true)
  })
})
