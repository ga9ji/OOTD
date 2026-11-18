// [部品: vehicle] ドアの枠と座席の位置（車体の座標）のテスト。
import { describe, expect, it } from 'vitest'
import { cabinLayout, doorSwing, VEHICLE_CABIN, type CabinLook } from '../vehicleCabin'

const spec = { length: 4.6, width: 1.8, height: 1.42 }
// セダンに近い断面（鼻 → フロントガラスの付け根 → 屋根 → 柱 → 後ろの窓 → 荷室）
const look: CabinLook = {
  clearance: 0.2,
  stations: [
    { z: -0.5, belt: 0.46, w: 0.84 },
    { z: -0.17, belt: 0.63, w: 1 },
    { z: -0.03, belt: 0.65, roof: 0.985, w: 1, wRoof: 0.74 },
    { z: 0.08, belt: 0.655, roof: 1, w: 1, wRoof: 0.75, pillar: true },
    { z: 0.105, belt: 0.655, roof: 1, w: 1, wRoof: 0.75 },
    { z: 0.22, belt: 0.66, roof: 0.975, w: 1, wRoof: 0.73 },
    { z: 0.345, belt: 0.66, w: 0.99 },
    { z: 0.5, belt: 0.58, w: 0.86 },
  ],
}

describe('gto vehicleCabin: ドアの枠', () => {
  const c = cabinLayout(spec, look)

  it('ヒンジはフロントガラスの付け根（前の柱の下）、後ろの端は真ん中の柱にある', () => {
    expect(c.door.hingeZ).toBeCloseTo(-0.17 * 4.6, 5)
    expect(c.door.rearZ).toBeCloseTo(0.08 * 4.6, 5)
    expect(c.door.rearZ - c.door.hingeZ).toBeGreaterThan(0.9)
  })

  it('下は敷居、肩は窓の下の線、上は屋根。上へ行くほど内側へ寄る', () => {
    expect(c.door.sillY).toBeGreaterThan(look.clearance)
    expect(c.door.sillY).toBeLessThan(c.door.beltY - 0.3)
    expect(c.door.beltY).toBeCloseTo(0.655 * 1.42, 2)
    expect(c.door.roofY).toBeGreaterThan(c.door.beltY + 0.3)
    expect(c.door.halfBelt).toBeCloseTo(0.9, 5)
    expect(c.door.halfRoof).toBeLessThan(c.door.halfBelt)
  })

  it('柱の無い形（屋根の断面が1つだけ）でも、屋根の真ん中までをドアにする', () => {
    const plain = cabinLayout(spec, { clearance: 0.2, stations: [look.stations[0], look.stations[1], look.stations[2], { z: 0.2, belt: 0.65, roof: 1, w: 1, wRoof: 0.75 }, look.stations[6], look.stations[7]] })
    expect(plain.door.rearZ).toBeGreaterThan(plain.door.hingeZ + 0.6)
  })
})

describe('gto vehicleCabin: 座席', () => {
  const c = cabinLayout(spec, look)

  it('座席はドアの開口の中（前後）、車体の中心と側面のあいだ（左右）にある', () => {
    expect(c.seat.z).toBeGreaterThan(c.door.hingeZ + 0.3)
    expect(c.seat.z).toBeLessThan(c.door.rearZ)
    expect(c.seat.x).toBeGreaterThan(0.2)
    expect(c.seat.x).toBeLessThan(c.door.halfRoof)
  })

  it('頭は窓の高さ（肩の線より上、屋根より下）にあり、窓越しに見える', () => {
    expect(c.head.y).toBeGreaterThan(c.door.beltY + 0.08)
    expect(c.head.y + VEHICLE_CABIN.headRadius).toBeLessThan(c.door.roofY)
    expect(c.seat.y).toBeLessThan(c.door.beltY)
    expect(c.seat.y).toBeGreaterThan(look.clearance)
  })
})

describe('gto vehicleCabin: ドアの開き', () => {
  it('0 で閉じ、1 でいっぱい（約 65°）。範囲の外は丸める', () => {
    expect(doorSwing(0)).toBe(0)
    expect(doorSwing(1)).toBeCloseTo(VEHICLE_CABIN.swing, 5)
    expect(doorSwing(2)).toBeCloseTo(VEHICLE_CABIN.swing, 5)
    expect(doorSwing(-1)).toBe(0)
    expect(doorSwing(0.5)).toBeGreaterThan(0)
    expect(doorSwing(0.5)).toBeLessThan(VEHICLE_CABIN.swing)
  })
})
