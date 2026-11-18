// 交通と歩行者（traffic-peds）: 車道の流れ。運転中の視界に、流れている車が常に数台いること
import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { corridorFrom } from '../graph'
import { DEG, dirOf, rng } from '../math'
import { QUALITY } from '../quality'
import { createGtoState, stepGto } from '../sim'
import { laneLeftOf, gapAhead, laneOffset, routePoint, stepTraffic, type Hazard } from '../traffic'
import type { GtoState, SimConfig, VehicleState } from '../types'
import { DT, world } from './helpers'

const keys = Array.from({ length: 12 }, (_, i) => `k${i}`)
const high: SimConfig = { maxVehicles: QUALITY.high.maxVehicles, maxPeds: QUALITY.high.maxPeds, outfitKeys: keys }
const mobile: SimConfig = { maxVehicles: QUALITY.mobile.maxVehicles, maxPeds: QUALITY.mobile.maxPeds, outfitKeys: keys }

/** 主人公の走っている道の先（前 8〜maxAhead m、左右 11m 以内 = 同じ車線と対向車線、建物に遮られない）にいる交通の車 */
export function trafficInView(s: GtoState, maxAhead = 120) {
  const f = dirOf(s.player.heading)
  return s.vehicles.filter((v) => {
    if (v.driver !== 'traffic') return false
    const dx = v.x - s.player.x
    const dz = v.z - s.player.z
    const ahead = dx * f.x + dz * f.z
    const side = -dx * f.z + dz * f.x
    return ahead > 8 && ahead < maxAhead && Math.abs(side) < 11 && world.segmentClear(s.player.x, s.player.z, v.x, v.z) >= 1
  })
}

/** デモを seconds 秒流して、0.5 秒ごとの視界の中の車の数（全部 / 動いている車）を返す */
function watch(name: string, seconds: number, config: SimConfig, seed = 1) {
  const demo = DEMOS[name]
  const spot = demo.spot ? world.spot(demo.spot) : undefined
  let s = createGtoState(world, config, { seed, mode: demo.mode, stage: demo.stage, start: spot ? { x: spot.x, z: spot.z, heading: (spot.heading ?? 0) * DEG } : null })
  const all: number[] = []
  const moving: number[] = []
  /** 車の形が分かる近さ（60m 以内）にいる台数 */
  const near: number[] = []
  let crashes = 0
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const road = world.nearestRoad(s.player.x, s.player.z, true, 30)
    const inp = demoInput(demo, s.t, DT, { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal: null, heading: s.player.heading, road, gap: gapAhead(s.player, s.vehicles), speed: s.player.speed, lane: laneLeftOf(world, s.player.x, s.player.z, s.player.heading) })
    s = stepGto(s, inp, world, config, DT)
    crashes += s.events.filter((e) => e.type === 'crash').length
    // 道なりに真っ直ぐ走っているあいだだけ数える（曲がっている最中とスピンの後は、道の先を向いていない）
    const straight = road != null && Math.abs(Math.sin(road.heading - s.player.heading)) < 0.25 && s.player.speed > 3
    if (i % 30 === 0 && straight) {
      const seen = trafficInView(s)
      all.push(seen.length)
      moving.push(seen.filter((v) => v.speed > 2).length)
      near.push(trafficInView(s, 60).length)
    }
  }
  return { all, moving, near, crashes, state: s }
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const share = (a: number[], min: number) => a.filter((n) => n >= min).length / a.length

describe('gto 交通の流れ', () => {
  for (const name of ['tp-flow', 'drive-brake', 'drive-accel']) {
    it(`デモ ${name}: 運転中の視界に、交通の車がふだん3台以上いて、動いている車が途切れない`, () => {
      if (!DEMOS[name]) throw new Error(`demo ${name} が無い`)
      const w = watch(name, Math.min(DEMOS[name].loop, 20), high)
      expect(w.all.length).toBeGreaterThanOrEqual(6)
      expect(mean(w.all)).toBeGreaterThanOrEqual(2.5)
      expect(share(w.all, 2)).toBeGreaterThanOrEqual(0.7)
      // 赤信号の列だけが見えている瞬間は、動いている車がいない
      expect(share(w.moving, 1)).toBeGreaterThanOrEqual(0.7)
      expect(mean(w.near)).toBeGreaterThanOrEqual(1.3)
      expect(share(w.near, 1)).toBeGreaterThanOrEqual(0.7)
    })
  }

  it('同じ世界で遊びを始め直しても、前の遊びの車に邪魔されず道なりに車が出る', () => {
    const spot = world.spot('miyamasuzaka-bottom')!
    const open = () => createGtoState(world, high, { seed: 1, mode: 'drive', start: { x: spot.x, z: spot.z, heading: (spot.heading ?? 0) * DEG } })
    const first = trafficInView(open()).length
    expect(first).toBeGreaterThanOrEqual(3)
    expect(trafficInView(open()).length).toBe(first)
  })

  it('デモ tp-flow: 前の車に追突せず、20 秒流れに乗って走り続ける', () => {
    const w = watch('tp-flow', 20, high)
    expect(w.crashes).toBe(0)
    expect(w.all.length).toBeGreaterThanOrEqual(25)
    // 赤信号の列に付いて止まることはあるが、それまでに道なりに 90m より先へ進んでいる（前の車列の速さに合わせて走る）
    const spot = world.spot('miyamasuzaka-bottom')!
    expect(Math.hypot(w.state.player.x - spot.x, w.state.player.z - spot.z)).toBeGreaterThan(90)
  })

  it('スマホの台数でも、視界に車が1台以上いる時間がほとんど', () => {
    const w = watch('tp-flow', 20, mobile)
    expect(share(w.all, 1)).toBeGreaterThanOrEqual(0.85)
    expect(w.state.vehicles.filter((v) => v.driver === 'traffic').length).toBeLessThanOrEqual(mobile.maxVehicles)
  })

  it('出したばかりの車が、ほかの車と重ならない', () => {
    const w = watch('tp-flow', 20, high)
    const cars = w.state.vehicles.filter((v) => v.driver === 'traffic')
    for (const a of cars) for (const b of cars) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.2)
  })

  it('後ろから速い車が同じ車線で迫ると、横へ寄って先に行かせ、通り過ぎたら車線へ戻る', () => {
    const spot = world.spot('miyamasuzaka-bottom')!
    const run = corridorFrom(world, spot.x, spot.z, (spot.heading ?? 0) * DEG, 160)
    const part = run.find((q) => q.len > 50)!
    const edge = world.driveGraph.edges[part.edge]
    // 番号 2 は中央寄りの車線
    const route = { edge: edge.id, s: part.s0 + 25, cruise: 10 }
    const at = routePoint(world.driveGraph, route, 2)
    let v: VehicleState = { id: 2, kind: 'sedan', color: 0, x: at.x, y: 0, z: at.z, heading: at.heading, speed: 10, slip: 0, steer: 0, yawRate: 0, driver: 'traffic', route, accel: 0 }
    const f = dirOf(at.heading)
    const R = rng(5)
    // 追う車は同じ車線の 22m 後ろ（主人公が走る、中心線から 1.6m の所）から 20 m/s で真っ直ぐ走る
    const lane = -1.6 - laneOffset(edge, 2)
    let chaser = { x: at.x - f.x * 22 - f.z * lane, z: at.z - f.z * 22 + f.x * lane }
    let passedAt = -1
    let sideAtPass = 0
    let t = 0
    for (; t < 7; t += DT) {
      chaser = { x: chaser.x + f.x * 20 * DT, z: chaser.z + f.z * 20 * DT }
      const hazards: Hazard[] = [{ x: chaser.x, z: chaser.z, r: 2, id: 99, heading: at.heading, speed: 20 }]
      v = stepTraffic(v, world, hazards, R.next, DT, 0)
      const ahead = (chaser.x - v.x) * f.x + (chaser.z - v.z) * f.z
      if (passedAt < 0 && ahead > -5) {
        passedAt = t
        sideAtPass = Math.abs(-(chaser.x - v.x) * f.z + (chaser.z - v.z) * f.x)
      }
    }
    expect(passedAt).toBeGreaterThan(0)
    expect(sideAtPass).toBeGreaterThan(2.4)
    expect(v.speed).toBeGreaterThan(5)
    expect(Math.abs(v.route!.swerve ?? 0)).toBeLessThan(0.3)
  })
})
