// 交通と歩行者（traffic-peds）: 交差点で固まらない（曲がる車が横向きのまま居座らない）・ぶつけられた車の運転手が逃げる
import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { angleDiff, DEG, dirOf, pointAlong, rng } from '../math'
import { bailOut } from '../pedestrians'
import { QUALITY } from '../quality'
import { createGtoState, stepGto } from '../sim'
import { demoRoad, gapAhead, laneLeftOf, routePoint, stepTraffic, turnBetween, type Hazard } from '../traffic'
import type { GtoState, SimConfig, VehicleState } from '../types'
import { DT, world } from './helpers'

const keys = Array.from({ length: 12 }, (_, i) => `k${i}`)
const high: SimConfig = { maxVehicles: QUALITY.high.maxVehicles, maxPeds: QUALITY.high.maxPeds, outfitKeys: keys }
const g = world.driveGraph

/** デモを流す。each は毎歩の状態を受け取る */
function play(name: string, seconds: number, each: (s: GtoState) => void, config = high) {
  const demo = DEMOS[name]
  const spot = demo.spot ? world.spot(demo.spot) : undefined
  let s = createGtoState(world, config, { seed: 1, mode: demo.mode, stage: demo.stage, start: spot ? { x: spot.x, z: spot.z, heading: (spot.heading ?? 0) * DEG } : null })
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const road = world.nearestRoad(s.player.x, s.player.z, true, 30)
    const inp = demoInput(demo, s.t, DT, {
      x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal: null, heading: s.player.heading, road,
      gap: gapAhead(s.player, s.vehicles, world, s.t), speed: s.player.speed,
      lane: laneLeftOf(world, s.player.x, s.player.z, s.player.heading),
      laneRoad: demoRoad(world, s.player.x, s.player.z, s.player.heading),
    })
    s = stepGto(s, inp, world, config, DT)
    each(s)
  }
  return s
}

describe('gto 交通: 交差点で固まらない', () => {
  it('右折の車は、対向の速い車が遠くから来ていても、交差点の中で横向きに止まらない（手前の車線で真っ直ぐ待つ）', () => {
    // 対面通行の道 a から、短い辺 b へ右へ折れる所（対向車線を横切る）。対向の長い直線 o がある
    let found: { a: number; b: number; o: number } | null = null
    for (const a of g.edges) {
      if (a.rev < 0) continue
      const b = g.nodes[a.to].out.map((id) => g.edges[id]).find((e) => e.id !== a.rev && turnBetween(a, e) > 1 && e.length < 14)
      const endH = pointAlong(a.pts, a.cum, a.length).heading
      const o = g.edges.find((e) => e.to === a.to && e.length > 60 && Math.abs(angleDiff(pointAlong(e.pts, e.cum, e.length).heading, endH)) > 2.7)
      if (b && o) {
        found = { a: a.id, b: b.id, o: o.id }
        break
      }
    }
    expect(found).not.toBeNull()
    const a = g.edges[found!.a]
    const o = g.edges[found!.o]
    const laneH = pointAlong(a.pts, a.cum, a.length).heading
    const route = { edge: a.id, s: 0.3, cruise: 8, next: found!.b }
    const p0 = routePoint(g, route, 1)
    let v: VehicleState = { id: 1, kind: 'sedan', color: 0, x: p0.x, y: 0, z: p0.z, heading: p0.heading, speed: 7, slip: 0, steer: 0, yawRate: 0, driver: 'traffic', route, accel: 0 }
    const R = rng(3)
    let sideways = 0
    let closest = Infinity
    let os = o.length - 45
    for (let i = 0; i < Math.round(14 / DT); i++) {
      os += 10.6 * DT
      // 対向の車（主人公）は、交差点を過ぎても同じ向きへ走り去る
      const end = pointAlong(o.pts, o.cum, Math.min(os, o.length))
      const f = dirOf(end.heading)
      const over = Math.max(0, os - o.length)
      const rival: Hazard = { x: end.x + f.x * over + f.z * 2.5, z: end.z + f.z * over - f.x * 2.5, r: 2, id: 2, heading: end.heading, speed: 10.6 }
      v = stepTraffic(v, world, [rival, { x: v.x, z: v.z, r: 2, id: 1, heading: v.heading, speed: v.speed, edge: v.route?.edge }], R.next, DT, 0)
      if (!v.route) break
      closest = Math.min(closest, Math.hypot(v.x - rival.x, v.z - rival.z))
      if (v.speed < 0.3 && Math.abs(angleDiff(v.heading, laneH)) > 0.45) sideways++
    }
    expect(sideways).toBe(0)
    expect(closest).toBeGreaterThan(3)
    // 対向が通り過ぎたら、曲がって出ていく
    expect(v.route == null || v.route.edge !== a.id).toBe(true)
  })

  it('デモ tp-drive: 45 秒のうち止まっているのは短く、追突せず、スクランブルを抜けて先へ進む', () => {
    let stopped = 0
    let crashes = 0
    const s = play('tp-drive', 45, (st) => {
      if (st.t > 1.5 && st.player.speed < 0.5) stopped += DT
      crashes += st.events.filter((e) => e.type === 'crash').length
    })
    expect(stopped).toBeLessThan(9)
    expect(crashes).toBe(0)
    expect(s.player.x).toBeGreaterThan(30)
  })

  it('デモ tp-drive: 走っているあいだ、すぐ近くで横や斜めを向いたまま止まっている車がほとんど無い', () => {
    let bad = 0
    let n = 0
    play('tp-drive', 45, (st) => {
      if (st.frame % 30 !== 0 || st.player.speed < 3) return
      n++
      const f = dirOf(st.player.heading)
      for (const v of st.vehicles) {
        if (v.driver !== 'traffic') continue
        const dx = v.x - st.player.x
        const dz = v.z - st.player.z
        const ahead = dx * f.x + dz * f.z
        const rel = Math.abs(angleDiff(v.heading, st.player.heading))
        if (ahead > -2 && ahead < 22 && Math.abs(-dx * f.z + dz * f.x) < 9 && v.speed < 0.5 && rel > 0.6 && rel < 2.5) bad++
      }
    })
    expect(bad / n).toBeLessThan(0.06)
  })
})

describe('gto 交通: ぶつけられた車', () => {
  it('bailOut: 運転手は車の右のドアの外に出て、ぶつけた相手から離れる向きへ逃げる', () => {
    const car = { x: 10, z: 5, heading: 0 }
    const ped = bailOut(world, car, 77, 'k1', { x: 10, z: 12 })
    expect(ped.id).toBe(77)
    expect(ped.mood).toBe('flee')
    expect(ped.speed).toBeGreaterThan(3)
    expect(Math.hypot(ped.x - car.x, ped.z - car.z)).toBeGreaterThan(1)
    expect(Math.hypot(ped.x - car.x, ped.z - car.z)).toBeLessThan(3)
    // 相手（南）から離れる = 北寄りへ
    const d = dirOf(ped.heading)
    expect(d.z).toBeLessThan(0)
    // ふつうは右（北向きの車なら東）のドアから。右から当てられたら左へ出る
    expect(ped.x).toBeGreaterThan(car.x)
    expect(bailOut(world, car, 78, 'k1', { x: 13, z: 5 }).x).toBeLessThan(car.x)
  })

  it('デモ tp-bump: 前の車に追突すると、その車は道筋を外れ、運転手が降りて逃げる。対向車はすれ違い続ける', () => {
    let crashes = 0
    let fled = false
    let knocked = false
    play('tp-bump', 20, (st) => {
      crashes += st.events.filter((e) => e.type === 'crash').length
      for (const v of st.vehicles) {
        if (v.driver !== 'none' || v.id === st.player.vehicleId) continue
        knocked = true
        if (st.peds.some((p) => p.mood === 'flee' && Math.hypot(p.x - v.x, p.z - v.z) < 12)) fled = true
      }
    })
    expect(crashes).toBeGreaterThanOrEqual(1)
    expect(knocked).toBe(true)
    expect(fled).toBe(true)
  })
})
