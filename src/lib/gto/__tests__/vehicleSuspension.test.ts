// [部品: vehicle] 四輪が別々に路面へ付き、車体がその上でばねに乗っていることのテスト。
// バーの実物（四輪は路面に付いたまま、車体だけが遅れて傾いて戻る）を数値で確かめる。
import { describe, expect, it } from 'vitest'
import { groundFit, restSuspension, stepSuspension, VEHICLE_SUSPENSION, wheelCompression, wheelOffsets, type Suspension } from '../vehicleSuspension'

const DT = 1 / 60
const BASE = 2.7
const TRACK = 1.58
const flat: [number, number, number, number] = [0, 0, 0, 0]

const run = (s: Suspension, h: [number, number, number, number], seconds: number) => {
  let out = s
  for (let i = 0; i < Math.round(seconds / DT); i++) out = stepSuspension(out, h, BASE, TRACK, DT)
  return out
}

describe('gto vehicleSuspension: 車輪の位置', () => {
  it('前左・前右・後左・後右の順で、前が −z、右が ＋x', () => {
    const w = wheelOffsets(BASE, TRACK)
    expect(w).toEqual([
      [-TRACK / 2, -BASE / 2],
      [TRACK / 2, -BASE / 2],
      [-TRACK / 2, BASE / 2],
      [TRACK / 2, BASE / 2],
    ])
  })
})

describe('gto vehicleSuspension: 路面の当てはめ', () => {
  it('平らなら傾かない', () => {
    expect(groundFit(flat, BASE, TRACK)).toEqual({ y: 0, pitch: 0, roll: 0 })
  })

  it('上り坂では鼻が上がり（pitch ＋）、右が高ければ左へ傾く（roll ＋）', () => {
    const up = groundFit([0.2, 0.2, 0, 0], BASE, TRACK)
    expect(up.pitch).toBeGreaterThan(0.05)
    expect(up.roll).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(0.1, 6)
    const bank = groundFit([0, 0.1, 0, 0.1], BASE, TRACK)
    expect(bank.roll).toBeGreaterThan(0.03)
    expect(bank.pitch).toBeCloseTo(0, 6)
  })
})

describe('gto vehicleSuspension: ばね', () => {
  it('平らな路面で静止していれば動かない', () => {
    const s = run(restSuspension(flat, BASE, TRACK), flat, 1)
    expect(s.y).toBeCloseTo(0, 5)
    expect(s.wheelY.every((y) => Math.abs(y) < 1e-5)).toBe(true)
  })

  it('片輪が縁石（12cm）に乗ると、その輪だけすぐ上がり、車体は遅れて少しだけ傾く', () => {
    const kerb: [number, number, number, number] = [0, 0.12, 0, 0]
    const start = restSuspension(flat, BASE, TRACK)
    const early = run(start, kerb, 0.08)
    // 車輪は 0.08 秒でほぼ縁石の上、ほかの3輪は路面のまま
    expect(early.wheelY[1]).toBeGreaterThan(0.1)
    expect(Math.abs(early.wheelY[0])).toBeLessThan(0.005)
    expect(Math.abs(early.wheelY[2])).toBeLessThan(0.005)
    // その時点で車体はまだ付いてきていない＝その輪が車体へ沈み込んでいる
    expect(wheelCompression(early, 1, BASE, TRACK)).toBeGreaterThan(0.05)
    const late = run(early, kerb, 1.5)
    const fit = groundFit(kerb, BASE, TRACK)
    expect(late.roll).toBeCloseTo(fit.roll, 2)
    // 箱ごと倒れない: 車体の傾きは 3° 未満、乗った輪は沈んだまま
    expect(Math.abs(late.roll)).toBeLessThan((3 * Math.PI) / 180)
    expect(wheelCompression(late, 1, BASE, TRACK)).toBeGreaterThan(0.025)
    expect(late.wheelY[1]).toBeCloseTo(0.12, 3)
  })

  it('段差を越えた直後、車体は少し行き過ぎてから戻る（ばねの揺れ）', () => {
    const step: [number, number, number, number] = [0.15, 0.15, 0.15, 0.15]
    let s = restSuspension(flat, BASE, TRACK)
    let peak = 0
    for (let i = 0; i < 90; i++) {
      s = stepSuspension(s, step, BASE, TRACK, DT)
      peak = Math.max(peak, s.y)
    }
    expect(peak).toBeGreaterThan(0.155)
    expect(peak).toBeLessThan(0.2)
    expect(s.y).toBeCloseTo(0.15, 2)
  })

  it('車輪の沈み込みは bump まで。それ以上の段差は車体が持ち上がる', () => {
    const tall: [number, number, number, number] = [0.4, 0.4, 0, 0]
    const s = stepSuspension(restSuspension(flat, BASE, TRACK), tall, BASE, TRACK, 0.2)
    for (let i = 0; i < 4; i++) expect(wheelCompression(s, i, BASE, TRACK)).toBeLessThanOrEqual(VEHICLE_SUSPENSION.bump + 1e-6)
  })

  it('路面が急に落ちた輪は droop までしか伸びず、宙に浮く', () => {
    const hole: [number, number, number, number] = [0, 0, 0, -0.6]
    const s = run(restSuspension(flat, BASE, TRACK), hole, 0.1)
    expect(wheelCompression(s, 3, BASE, TRACK)).toBeGreaterThanOrEqual(-VEHICLE_SUSPENSION.droop - 1e-6)
    expect(s.wheelY[3]).toBeGreaterThan(-0.6)
  })

  it('車体の傾きは tiltMax を超えない', () => {
    const cliff: [number, number, number, number] = [3, 3, 0, 0]
    const s = run(restSuspension(flat, BASE, TRACK), cliff, 2)
    expect(Math.abs(s.pitch)).toBeLessThanOrEqual(VEHICLE_SUSPENSION.tiltMax + 1e-6)
  })
})
