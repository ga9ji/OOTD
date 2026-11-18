// 交通と歩行者（traffic-peds）: 自分の進む車線の前に、流れている車の列がいること。対向車と、横切る車が次々に現れること
import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { getSignals, lampAt } from '../graph'
import { angleDiff, DEG, dirOf } from '../math'
import { QUALITY } from '../quality'
import { createGtoState, stepGto } from '../sim'
import { laneLeftOf, gapAhead } from '../traffic'
import type { GtoState, SimConfig, VehicleState } from '../types'
import { DT, world } from './helpers'

const keys = Array.from({ length: 12 }, (_, i) => `k${i}`)
const high: SimConfig = { maxVehicles: QUALITY.high.maxVehicles, maxPeds: QUALITY.high.maxPeds, outfitKeys: keys }
const mobile: SimConfig = { maxVehicles: QUALITY.mobile.maxVehicles, maxPeds: QUALITY.mobile.maxPeds, outfitKeys: keys }

/** 主人公から見た交通の車を、同じ向きの前の車・対向車・横切る車に分ける */
function sort(s: GtoState, maxAhead: number, maxSide: number) {
  const f = dirOf(s.player.heading)
  const same: VehicleState[] = []
  const oncoming: VehicleState[] = []
  const crossing: VehicleState[] = []
  for (const v of s.vehicles) {
    if (v.driver !== 'traffic') continue
    const dx = v.x - s.player.x
    const dz = v.z - s.player.z
    const ahead = dx * f.x + dz * f.z
    const side = -dx * f.z + dz * f.x
    if (ahead < 6 || ahead > maxAhead) continue
    const rel = Math.abs(angleDiff(v.heading, s.player.heading))
    if (rel < 0.6 && Math.abs(side) < maxSide) same.push(v)
    else if (rel > 2.5 && Math.abs(side) < 14) oncoming.push(v)
    else if (rel >= 0.6 && rel <= 2.5 && Math.abs(side) < 20) crossing.push(v)
  }
  return { same, oncoming, crossing }
}

function open(name: string, config: SimConfig, seed = 1) {
  const demo = DEMOS[name]
  const spot = demo.spot ? world.spot(demo.spot) : undefined
  return createGtoState(world, config, { seed, mode: demo.mode, stage: demo.stage, start: spot ? { x: spot.x, z: spot.z, heading: (spot.heading ?? 0) * DEG } : null })
}

/** デモを流して、0.5 秒ごとに前の車・対向車・横切る車を数える */
function watch(name: string, seconds: number, config: SimConfig, seed = 1) {
  const demo = DEMOS[name]
  let s = open(name, config, seed)
  const lead: number[] = []
  const rolling: number[] = []
  const oncomingIds = new Set<number>()
  const crossingIds = new Set<number>()
  let crashes = 0
  let ranRed = 0
  const net = getSignals(world)
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const road = world.nearestRoad(s.player.x, s.player.z, true, 30)
    const gap = gapAhead(s.player, s.vehicles, world, s.t)
    const inp = demoInput(demo, s.t, DT, { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal: null, heading: s.player.heading, road, gap, speed: s.player.speed, lane: laneLeftOf(world, s.player.x, s.player.z, s.player.heading) })
    const before = s.player
    s = stepGto(s, inp, world, config, DT)
    crashes += s.events.filter((e) => e.type === 'crash').length
    // 赤の停止線を、走ったまま越えたら数える
    const f = dirOf(before.heading)
    for (const list of net.stops) {
      for (const st of list) {
        if (Math.abs(angleDiff(st.heading, before.heading)) > 0.5 || lampAt(net, st.junction, st.group, s.t) !== 'red') continue
        const a0 = (st.x - before.x) * f.x + (st.z - before.z) * f.z
        const a1 = (st.x - s.player.x) * f.x + (st.z - s.player.z) * f.z
        const side = Math.abs(-(st.x - before.x) * f.z + (st.z - before.z) * f.x)
        if (a0 > 0 && a1 <= 0 && side < 4 && s.player.speed > 2) ranRed++
      }
    }
    if (i % 30 === 0) {
      const seen = sort(s, 70, 7)
      lead.push(seen.same.length)
      rolling.push(seen.same.filter((v) => v.speed > 1.5).length)
      for (const v of sort(s, 90, 7).oncoming) oncomingIds.add(v.id)
      for (const v of seen.crossing) crossingIds.add(v.id)
    }
  }
  return { lead, rolling, oncoming: oncomingIds.size, crossing: crossingIds.size, crashes, ranRed, state: s }
}
const share = (a: number[], min: number) => a.filter((n) => n >= min).length / a.length

describe('gto 交通の車列', () => {
  it('走り始める前から、同じ向きの車が自分の前に2台以上、車の形が分かる近さ（60m 以内）にいる', () => {
    for (const name of ['tp-flow', 'drive-brake']) {
      const seen = sort(open(name, high), 60, 7)
      expect(seen.same.length, name).toBeGreaterThanOrEqual(2)
    }
  })

  it('走り出して3秒後、隣の車線の斜め前に走っている車の列がいて、自分の車線の先にも走っている車がいる', () => {
    const s = watch('tp-flow', 3, high).state
    const f = dirOf(s.player.heading)
    const sideOf = (v: VehicleState) => -(v.x - s.player.x) * f.z + (v.z - s.player.z) * f.x
    const rolling = sort(s, 70, 7).same.filter((v) => v.speed > 3)
    // 隣の車線（左へ 2〜5m）の 45m 以内に2台。発進しても追突しない
    expect(rolling.filter((v) => sideOf(v) < -2 && sideOf(v) > -5 && Math.hypot(v.x - s.player.x, v.z - s.player.z) < 45).length).toBeGreaterThanOrEqual(2)
    // 自分の車線の先（流して走れば追い付く）
    expect(rolling.filter((v) => Math.abs(sideOf(v)) < 2).length).toBeGreaterThanOrEqual(1)
  })

  it('片側1車線の道では、始めの配置で自分の車線の 30m 以内に同じ向きの車を置かない（発進してすぐ追突しない）', () => {
    const s = open('mission-timed', high)
    const f = dirOf(s.player.heading)
    const close = sort(s, 28, 7).same.filter((v) => Math.abs(-(v.x - s.player.x) * f.z + (v.z - s.player.z) * f.x) < 2)
    expect(close.length).toBe(0)
  })

  // tp-drive は途中でスクランブルの赤を 10 秒ほど待つので、長めに見る
  for (const [name, seconds] of [['tp-flow', 30], ['tp-drive', 50]] as const) {
    it(`デモ ${name}: ${seconds} 秒のほとんどで、自分の進む側の前（70m 以内）に車がいて、対向車と横切る車が次々に現れる`, () => {
      const w = watch(name, seconds, high)
      expect(share(w.lead, 1)).toBeGreaterThanOrEqual(0.7)
      expect(share(w.lead, 2)).toBeGreaterThanOrEqual(0.5)
      // 止まった列だけでなく、走っている車が前にいる時間が長い（赤信号で並んでいるあいだと、道が曲がる所は数に入らない）
      expect(share(w.rolling, 1)).toBeGreaterThanOrEqual(0.4)
      expect(w.oncoming).toBeGreaterThanOrEqual(5)
      expect(w.crossing).toBeGreaterThanOrEqual(2)
      expect(w.crashes).toBe(0)
    })

    it(`デモ ${name}: 赤信号を走ったまま越えない`, () => {
      expect(watch(name, 45, high).ranRed).toBe(0)
    })
  }

  it('スマホの台数でも、前に車がいる時間が長い', () => {
    const w = watch('tp-flow', 30, mobile)
    expect(share(w.lead, 1)).toBeGreaterThanOrEqual(0.6)
    expect(w.oncoming).toBeGreaterThanOrEqual(2)
    expect(w.state.vehicles.filter((v) => v.driver === 'traffic').length).toBeLessThanOrEqual(mobile.maxVehicles)
  })

  it('gapAhead は、赤の停止線も前の車と同じに扱う（青なら見ない）', () => {
    const net = getSignals(world)
    const st = net.stops.flat().find((q) => q.via == null)!
    const f = dirOf(st.heading)
    const me = { x: st.x - f.x * 20, z: st.z - f.z * 20, heading: st.heading, vehicleId: null }
    let tRed = -1
    let tGreen = -1
    for (let t = 0; t < 90; t += 0.5) {
      const lamp = lampAt(net, st.junction, st.group, t)
      if (lamp === 'red' && tRed < 0) tRed = t
      if (lamp === 'green' && tGreen < 0) tGreen = t
    }
    expect(gapAhead(me, [], world, tRed)).toBeLessThan(20)
    expect(gapAhead(me, [], world, tRed)).toBeGreaterThan(12)
    expect(gapAhead(me, [], world, tGreen)).toBe(Infinity)
    expect(gapAhead(me, [])).toBe(Infinity)
  })
})
