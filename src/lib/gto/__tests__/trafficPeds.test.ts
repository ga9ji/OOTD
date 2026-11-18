// 交通と歩行者（traffic-peds）: 信号・車線・譲り合い・横断・飛びのき・人だかり
import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { getSignals, lampAt, phaseAt, SIGNAL_TUNING, walkAt } from '../graph'
import { angleDiff, dirOf, pointAlong, rng } from '../math'
import { needsPedRespawn, PED_TUNING, spawnPed, stepPed, type PedThreat } from '../pedestrians'
import { laneOffset, routePoint, stepTraffic, TRAFFIC_TUNING, type Hazard } from '../traffic'
import { stepGto } from '../sim'
import type { GtoState, PedState, VehicleState } from '../types'
import { DT, start, world } from './helpers'

const net = getSignals(world)
const scramble = net.junctions.find((j) => j.scramble)!
/** スクランブルの周期の中で、歩行者の時間が始まる時刻と、車の0番の組が青になる時刻 */
const T = SIGNAL_TUNING
const cycle0 = -scramble.offset
const pedStart = cycle0 + T.green0 + T.green1 + (T.yellow + T.allRed) * 2
const cycle = pedStart - cycle0 + T.ped + T.allRed

const car = (edge: number, s: number, over: Partial<VehicleState> = {}): VehicleState => {
  const route = { edge, s, cruise: 8 }
  const p = routePoint(world.driveGraph, route, 1)
  return { id: 1, kind: 'sedan', color: 0, x: p.x, y: 0, z: p.z, heading: p.heading, speed: 6, slip: 0, steer: 0, yawRate: 0, driver: 'traffic', route, accel: 0, ...over }
}
const drive = (v: VehicleState, seconds: number, t0: number, hazards: Hazard[] = [], seed = 3) => {
  const R = rng(seed)
  let cur = v
  const trail: VehicleState[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    cur = stepTraffic(cur, world, hazards, R.next, DT, t0 + i * DT)
    trail.push(cur)
  }
  return { v: cur, trail }
}

describe('gto 信号', () => {
  it('スクランブル交差点があり、車の停止線と歩行者の横断歩道が結び付いている', () => {
    expect(scramble).toBeDefined()
    expect(Math.hypot(scramble.x, scramble.z)).toBeLessThan(30)
    expect(net.stops.flat().filter((s) => s.junction === scramble.id).length).toBeGreaterThanOrEqual(3)
    expect(net.cross.filter((c) => c?.junction === scramble.id).length).toBeGreaterThanOrEqual(8)
  })

  it('どの交差点でも、2つの組が同時に青にならず、周期で繰り返す', () => {
    for (const j of net.junctions) {
      let greens = 0
      for (let t = 0; t < 140; t += 0.5) {
        const ph = phaseAt(j, t)
        expect(ph.lamp0 !== 'red' && ph.lamp1 !== 'red').toBe(false)
        if (ph.lamp0 === 'green' || ph.lamp1 === 'green') greens++
      }
      expect(greens).toBeGreaterThan(60)
    }
    expect(phaseAt(scramble, 5)).toEqual(phaseAt(scramble, 5 + cycle))
  })

  it('スクランブルは、車が全部赤のあいだだけ歩行者が全方向に渡れる', () => {
    const during = pedStart + 2
    expect(lampAt(net, scramble.id, 0, during)).toBe('red')
    expect(lampAt(net, scramble.id, 1, during)).toBe('red')
    expect(walkAt(net, scramble.id, 0, during).walk).toBe(true)
    expect(walkAt(net, scramble.id, 1, during).walk).toBe(true)
    expect(walkAt(net, scramble.id, 0, pedStart + T.ped - 1).flash).toBe(true)
    for (const t of [cycle0 + 2, cycle0 + T.green0 + T.yellow + T.allRed + 2]) {
      expect(walkAt(net, scramble.id, 0, t).walk).toBe(false)
      expect(walkAt(net, scramble.id, 1, t).walk).toBe(false)
    }
  })

  it('撮り始めて10秒以内に、スクランブルの歩行者の時間が始まる', () => {
    let first = -1
    for (let t = 0; t < 30 && first < 0; t += 0.25) if (phaseAt(scramble, t).ped) first = t
    expect(first).toBeGreaterThan(3)
    expect(first).toBeLessThan(10)
  })
})

describe('gto 交通', () => {
  /** スクランブルへ入る辺のうち、停止線までの助走がいちばん長いもの */
  const approach = world.driveGraph.edges
    .flatMap((e) => net.stops[e.id].filter((s) => s.junction === scramble.id).map((s) => ({ e, s })))
    .sort((a, b) => b.s.s - a.s.s)[0]

  it('赤では停止線の手前で止まり、青になると進む', () => {
    const g = world.driveGraph
    // 停止線のある辺の、ひとつ手前の辺から走らせる（停止線は辺の始まりの近くにあることが多い）
    const before = g.edges.find((e) => e.to === approach.e.from && e.id !== approach.e.rev && e.length > 30)!
    const red = pedStart + 1 // 歩行者の時間は、車は全部赤
    const start = car(before.id, before.length - 26, { route: { edge: before.id, s: before.length - 26, cruise: 8, next: approach.e.id } })
    const stopped = drive(start, 12, red).v
    // 停止線から測った位置（手前が負）
    const fromLine = (v: VehicleState) => (v.route!.edge === before.id ? v.route!.s - before.length : v.route!.s) - approach.s.s
    expect([before.id, approach.e.id]).toContain(stopped.route!.edge)
    expect(fromLine(stopped)).toBeLessThanOrEqual(-TRAFFIC_TUNING.nose + 0.3)
    expect(fromLine(stopped)).toBeGreaterThan(-TRAFFIC_TUNING.nose - 2)
    expect(stopped.speed).toBeLessThan(0.2)
    // 自分の組が青になる時刻から走らせる
    const greenAt = approach.s.group === 0 ? cycle0 + cycle + 0.5 : cycle0 + T.green0 + T.yellow + T.allRed + 0.5
    const moved = drive(stopped, 6, greenAt).v
    expect(moved.route!.edge !== before.id && (moved.route!.edge !== approach.e.id || fromLine(moved) > 3)).toBe(true)
  })

  it('対面通行の道では、中心線より左の車線を走る', () => {
    const edge = world.driveGraph.edges.find((e) => e.rev >= 0 && e.length > 40 && e.lanes >= 4)!
    expect(laneOffset(edge, 1)).toBeLessThan(0)
    expect(laneOffset(edge, 2)).toBeLessThan(0)
    expect(laneOffset(edge, 1)).not.toBe(laneOffset(edge, 2))
    const v = car(edge.id, edge.length / 2)
    const mid = pointAlong(edge.pts, edge.cum, edge.length / 2)
    const f = dirOf(mid.heading)
    const right = -(v.x - mid.x) * f.z + (v.z - mid.z) * f.x
    expect(right).toBeLessThan(-0.5)
    expect(Math.abs(right)).toBeLessThan(edge.width / 2)
  })

  it('交差点を曲がっても、位置も向きも飛ばない', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const edge = world.driveGraph.edges.filter((e) => e.length > 30 && net.stops[e.id].length === 0)[seed * 7]
      const { trail } = drive(car(edge.id, edge.length - 20), 14, 0, [], seed)
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]
        const b = trail[i]
        if (!a.route || !b.route) break
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(Math.max(a.speed, b.speed) * DT * 2.5 + 0.08)
        expect(Math.abs(angleDiff(a.heading, b.heading))).toBeLessThan(0.12)
      }
    }
  })

  it('前に止まっている物があれば、ぶつからずに止まる', () => {
    const edge = world.driveGraph.edges.find((e) => e.length > 60 && net.stops[e.id].length === 0)!
    const v = car(edge.id, 5)
    const ahead = routePoint(world.driveGraph, { edge: edge.id, s: 35, cruise: 8 }, 1)
    const out = drive(v, 10, 0, [{ x: ahead.x, z: ahead.z, r: 2, id: 99, heading: ahead.heading, speed: 0 }]).v
    expect(out.speed).toBeLessThan(0.2)
    expect(out.route!.s).toBeLessThan(35 - 2 - 2.2)
    expect(out.route!.s).toBeGreaterThan(24)
  })

  it('停まったままの車は、しばらく待ってから横へよけて通り過ぎる', () => {
    const edge = world.driveGraph.edges.find((e) => e.length > 70 && net.stops[e.id].length === 0 && e.rev >= 0)!
    const ahead = routePoint(world.driveGraph, { edge: edge.id, s: 30, cruise: 8 }, 1)
    const out = drive(car(edge.id, 5), 20, 0, [{ x: ahead.x, z: ahead.z, r: 2, id: 99, heading: ahead.heading, speed: 0, parked: true }])
    expect(out.trail.some((v) => Math.abs(v.route?.swerve ?? 0) > 2)).toBe(true)
    expect(out.v.route == null || out.v.route.edge !== edge.id || out.v.route.s > 40).toBe(true)
  })

  it('信号の無い交差点では、格上の道から来る車に譲る', () => {
    const g = world.driveGraph
    const RANK: Record<string, number> = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 1, service: 0 }
    let found: { minor: number; major: number } | null = null
    for (const minor of g.edges) {
      if (net.signalNode[minor.to] || minor.length < 30 || net.stops[minor.id].length > 0) continue
      const major = g.edges.find(
        (e) => e.to === minor.to && e.id !== minor.id && e.id !== minor.rev && e.length > 30 && (RANK[e.kind] ?? 1) > (RANK[minor.kind] ?? 1) &&
          Math.abs(Math.abs(angleDiff(pointAlong(e.pts, e.cum, e.length).heading, pointAlong(minor.pts, minor.cum, minor.length).heading)) - Math.PI / 2) < 0.6,
      )
      if (major && g.nodes[minor.to].out.some((id) => id !== minor.rev)) {
        found = { minor: minor.id, major: major.id }
        break
      }
    }
    expect(found).not.toBeNull()
    const minor = g.edges[found!.minor]
    const major = g.edges[found!.major]
    const other = routePoint(g, { edge: major.id, s: major.length - 12, cruise: 8 }, 2)
    const rival: Hazard = { x: other.x, z: other.z, r: 2, id: 2, heading: other.heading, speed: 8, edge: major.id }
    const free = drive(car(minor.id, minor.length - 16), 1.5, 0).v
    const yielding = drive(car(minor.id, minor.length - 16), 1.5, 0, [rival]).v
    expect(free.route!.edge !== minor.id || free.route!.s > minor.length - 8).toBe(true)
    expect(yielding.route!.edge).toBe(minor.id)
    expect(yielding.speed).toBeLessThan(free.speed)
    expect(yielding.route!.s).toBeLessThan(minor.length - TRAFFIC_TUNING.yieldBack + 0.5)
    // いつまでも譲り続けない（しびれを切らして進む）
    const later = drive(car(minor.id, minor.length - 16), 14, 0, [rival]).v
    expect(later.route == null || later.route.edge !== minor.id).toBe(true)
    // 交通ではない車（主人公や警察）が格上の道を来るときも譲り、鼻先を相手の道へ出さずに待つ
    const player: Hazard = { ...rival, edge: undefined, speed: 12 }
    const polite = drive(car(minor.id, minor.length - 16), 4, 0, [player]).v
    expect(polite.route!.edge).toBe(minor.id)
    expect(polite.speed).toBeLessThan(0.5)
    expect(minor.length - polite.route!.s).toBeGreaterThanOrEqual(major.width / 2 + TRAFFIC_TUNING.nose)
  })
})

describe('gto 歩行者', () => {
  const g = world.walkGraph
  /** スクランブルの横断歩道（歩道の角から始まるもの）と、その手前の歩道の辺 */
  const crossId = net.cross.findIndex((c, i) => c?.junction === scramble.id && !c.fromInRoad && g.edges[i].length > 12 &&
    g.edges.some((e) => e.to === g.edges[i].from && !net.isCrossing[e.id] && e.id !== g.edges[i].rev && e.length > 6))
  const before = g.edges.find((e) => e.to === g.edges[crossId].from && !net.isCrossing[e.id] && e.id !== g.edges[crossId].rev && e.length > 6)!
  const ped = (over: Partial<PedState> = {}): PedState => {
    const s = before.length - 5
    const p = pointAlong(before.pts, before.cum, s)
    return { id: 7, x: p.x, y: 0, z: p.z, heading: p.heading, speed: 1.4, outfitKey: 'a', mood: 'walk', timer: 0, route: { edge: before.id, s, side: 0, next: crossId, pace: 1.4 }, stride: 0, ...over }
  }
  const walk = (p: PedState, seconds: number, t0: number, threats: PedThreat[] = []) => {
    const R = rng(5)
    let cur = p
    const seen: string[] = []
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const r = stepPed(cur, world, threats, [], R.next, DT, t0 + i * DT)
      cur = r.ped
      for (const e of r.events) seen.push(e.type)
    }
    return { p: cur, seen }
  }

  it('赤のあいだは横断歩道の手前で立ち止まり、歩行者の時間になると渡る', () => {
    expect(crossId).toBeGreaterThanOrEqual(0)
    const waiting = walk(ped(), 8, cycle0 + 1).p
    expect(waiting.route!.edge).toBe(before.id)
    expect(waiting.speed).toBe(0)
    const node = g.nodes[before.to]
    expect(Math.hypot(waiting.x - node.x, waiting.z - node.z)).toBeLessThan(PED_TUNING.waitDepth + 1.5)
    const crossed = walk(waiting, 9, pedStart).p
    expect(crossed.route!.edge).not.toBe(before.id)
    expect(Math.hypot(crossed.x - waiting.x, crossed.z - waiting.z)).toBeGreaterThan(6)
  })

  it('渡っている途中で時間が切れたら、急いで渡りきる', () => {
    const edge = g.edges[crossId]
    const mid = pointAlong(edge.pts, edge.cum, 3)
    const on = ped({ x: mid.x, z: mid.z, route: { edge: crossId, s: 3, side: 0, pace: 1.4 } })
    const r = walk(on, 1, cycle0 + 1).p
    expect(r.speed).toBeGreaterThan(1.4 * 1.5)
  })

  it('迫ってくる車の進路から、横へ飛びのく', () => {
    // 南から北へ走ってくる車の真正面に立つ20人。ゆっくりの車なら全員が横へ逃げる
    const dodgers = (dist: number, speed: number) => {
      let n = 0
      for (let id = 1; id <= 20; id++) {
        const p = ped({ id, route: null })
        const r = walk(p, 0.6, 0, [{ x: p.x, z: p.z + dist, r: 1.4, speed, heading: 0 }]).p
        if (r.mood === 'flee' && Math.abs(r.x - p.x) > 1.2) n++
      }
      return n
    }
    expect(dodgers(3, 9)).toBe(20)
    // 速い車が遠くにいるうちは、気づくのが遅い人はまだ動かない（その人たちが、はねられる）
    const early = dodgers(9, 22)
    expect(early).toBeGreaterThanOrEqual(6)
    expect(early).toBeLessThan(20)
  })

  it('はねられると、車の進む向きへ飛ばされて倒れ、やがて起きて逃げる', () => {
    const p = ped({ route: null })
    const threat: PedThreat = { x: p.x, z: p.z + 1, r: 1.4, speed: 10, heading: 0 }
    const first = stepPed(p, world, [threat], [], rng(1).next, DT, 0)
    expect(first.events.map((e) => e.type)).toEqual(['hitPed'])
    expect(first.ped.mood).toBe('stunned')
    const down = walk(first.ped, 1.5, 0).p
    expect(down.mood).toBe('stunned')
    expect(down.speed).toBe(0)
    expect(Math.hypot(down.x - p.x, down.z - p.z)).toBeGreaterThan(1)
    expect(walk(down, PED_TUNING.downTime, 0).p.mood).not.toBe('stunned')
  })

  it('近くの騒ぎからは逃げ、遠くの騒ぎには気づかない', () => {
    const p = ped()
    const near = stepPed(p, world, [], [{ type: 'crash', x: p.x + 6, z: p.z }], rng(1).next, DT, 0).ped
    expect(near.mood).toBe('flee')
    expect(dirOf(near.heading).x).toBeLessThan(0)
    expect(stepPed(p, world, [], [{ type: 'crash', x: p.x + 60, z: p.z }], rng(1).next, DT, 0).ped.mood).toBe('walk')
  })

  it('スクランブルの近くでは、人が交差点の周りに集まる。離れた所では集めない', () => {
    const count = (center: { x: number; z: number }) => {
      const R = rng(11)
      let near = 0
      let all = 0
      for (let i = 0; i < 120; i++) {
        const p = spawnPed(world, i + 1, center, ['a', 'b'], R.next, 5)
        if (!p) continue
        all++
        expect(net.cross[p.route!.edge]).toBeNull()
        if (Math.hypot(p.x - scramble.x, p.z - scramble.z) < PED_TUNING.crowdRadius + 8) near++
      }
      return near / all
    }
    expect(count({ x: 10, z: 10 })).toBeGreaterThan(0.6)
    expect(count({ x: 380, z: -150 })).toBeLessThan(0.05)
  })

  it('人を集めているあいだは、遠くの人を早めに出し直す', () => {
    const far = ped({ x: 120, z: 10 })
    expect(needsPedRespawn(far, { x: 0, z: 0 }, world)).toBe(true)
    expect(needsPedRespawn(far, { x: 0, z: 0 })).toBe(false)
    expect(needsPedRespawn(ped(), { x: 0, z: 0 }, world)).toBe(false)
  })
})

describe('gto 交通と歩行者: 街の中で', () => {
  const play = (name: string, seconds: number, each?: (s: GtoState) => void) => {
    const demo = DEMOS[name]
    let s = start({ mode: demo.mode, stage: demo.stage }, { maxVehicles: 26, maxPeds: 70, outfitKeys: ['a', 'b', 'c', 'd'] })
    const seen: string[] = []
    for (let i = 0; i < seconds / DT; i++) {
      s = stepGto(s, demoInput(demo, s.t, DT, { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal: null }), world, { maxVehicles: 26, maxPeds: 70, outfitKeys: ['a', 'b', 'c', 'd'] }, DT)
      for (const e of s.events) seen.push(e.type)
      each?.(s)
    }
    return { s, seen }
  }
  const nearScramble = (p: { x: number; z: number }, r: number) => Math.hypot(p.x - scramble.x, p.z - scramble.z) < r

  it('デモ tp-scramble: 歩行者の時間は交差点の中に車が入らず、人が車道を渡っている', () => {
    let carsInBox = 0
    let crossingPeds = 0
    const { s } = play('tp-scramble', 26, (st) => {
      // 歩行者の時間が始まって5秒たてば、前の信号で入った車は出きっている
      if (st.t < pedStart + 5 || st.t > pedStart + T.ped - 1) return
      carsInBox = Math.max(carsInBox, st.vehicles.filter((v) => v.driver === 'traffic' && Math.abs(v.speed) > 1 && nearScramble(v, 12)).length)
      crossingPeds = Math.max(crossingPeds, st.peds.filter((p) => p.route && net.cross[p.route.edge]?.junction === scramble.id).length)
    })
    expect(carsInBox).toBe(0)
    expect(crossingPeds).toBeGreaterThanOrEqual(8)
    expect(s.peds.filter((p) => nearScramble(p, 60)).length).toBeGreaterThan(35)
  })

  it('デモ tp-panic: 人波へ突っ込むと、周りの人が逃げる', () => {
    let fleeing = 0
    const { seen } = play('tp-panic', 17, (st) => {
      fleeing = Math.max(fleeing, st.peds.filter((p) => p.mood === 'flee').length)
    })
    expect(seen.includes('hitPed') || seen.includes('crash') || fleeing >= 4).toBe(true)
    expect(fleeing).toBeGreaterThanOrEqual(3)
  })

  it('スマホの人数でも、スクランブルの周りに人が寄る', () => {
    const small = { maxVehicles: 10, maxPeds: 22, outfitKeys: ['a', 'b'] }
    const s = start({ start: { x: 24, z: 17, heading: -0.96 }, starterCar: false }, small)
    expect(s.peds.length).toBeLessThanOrEqual(22)
    expect(s.peds.filter((p) => nearScramble(p, 60)).length).toBeGreaterThanOrEqual(10)
  })
})
