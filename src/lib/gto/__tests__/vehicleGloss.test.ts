// [部品: vehicle] 塗装の明暗（艶の帯）のテスト。
// バーの実物は、車体の側面に上が明るく裾が暗い帯が走り、肩の線が光って金属に見える。単色の平塗りにしない。
import { describe, expect, it } from 'vitest'
import { glossShade, topSheen, VEHICLE_GLOSS } from '../vehicleGloss'

describe('gto vehicleGloss: 塗装の明暗', () => {
  it('側面は裾が暗く、肩へ向けて明るくなる（裾は肩の 6 割以下）', () => {
    const sill = glossShade(0, 0)
    const waist = glossShade(0, 0.5)
    const belt = glossShade(0, 0.95)
    expect(sill).toBeLessThan(waist)
    expect(waist).toBeLessThan(belt)
    expect(sill).toBeLessThanOrEqual(belt * 0.6)
  })

  it('肩の面取り（斜め上を向く面）がいちばん明るく、上面はそれより落ち着く', () => {
    const shoulder = glossShade(0.5, 1)
    expect(shoulder).toBeGreaterThan(glossShade(0, 0.95))
    expect(shoulder).toBeGreaterThan(glossShade(1, 1))
    expect(shoulder).toBeCloseTo(VEHICLE_GLOSS.shoulder, 6)
    expect(glossShade(1, 1.4)).toBeGreaterThanOrEqual(1)
  })

  it('下を向く面は暗い。範囲の外の高さでも破綻しない（裾より下・屋根より上）', () => {
    expect(glossShade(-1, 0)).toBeLessThanOrEqual(VEHICLE_GLOSS.sill)
    expect(glossShade(0, -3)).toBeCloseTo(glossShade(0, 0), 6)
    expect(glossShade(0, 9)).toBeCloseTo(glossShade(0, 1), 6)
  })

  it('向きが少し変わっても明るさは飛ばない（曲面で段にならない）', () => {
    for (let ny = -1; ny < 1; ny += 0.05) {
      expect(Math.abs(glossShade(ny + 0.05, 0.8) - glossShade(ny, 0.8))).toBeLessThan(0.16)
    }
  })
})

describe('gto vehicleGloss: 上面の光の帯', () => {
  it('ボンネット・屋根の前寄り・荷室の上に明るい帯が乗り、帯のあいだは落ち着く（上面が一枚のベタ塗りにならない）', () => {
    for (const band of VEHICLE_GLOSS.sheenBands) {
      expect(topSheen(band.z)).toBeCloseTo(VEHICLE_GLOSS.sheenPeak, 6)
      expect(topSheen(band.z + band.half * 1.5)).toBeLessThan(VEHICLE_GLOSS.sheenPeak - 0.2)
    }
    expect(topSheen(-0.12)).toBeCloseTo(VEHICLE_GLOSS.sheenBase, 6)
    expect(VEHICLE_GLOSS.sheenPeak / VEHICLE_GLOSS.sheenBase).toBeGreaterThan(1.4)
  })

  it('帯は滑らかに立ち上がる（隣の頂点で段にならない）。車体の外の位置でも破綻しない', () => {
    for (let z = -0.6; z < 0.6; z += 0.01) expect(Math.abs(topSheen(z + 0.01) - topSheen(z))).toBeLessThan(0.16)
    expect(topSheen(-2)).toBeCloseTo(VEHICLE_GLOSS.sheenBase, 6)
  })
})
