// [部品: vehicle] 車輪が乗る路面の高さ（車道の舗装・縁石の帯・歩道・地面）のテスト。
// 四輪を1つずつ「描かれている面」に付けるための数字なので、街の描画（renderCityRoads.ts）の段差と揃っていること。
import { describe, expect, it } from 'vitest'
import { surfaceLift, VEHICLE_GROUND, wheelSurface } from '../vehicleGround'
import { wheelOffsets } from '../vehicleSuspension'
import type { GtoWorld, MapRoad, NearestRoad } from '../types'

/** x 軸に沿って伸びる幅 8m の車道（z=0 が中心）と、z=20 を通る幅 3m の歩道だけの世界。スクランブルは遠くへ外す */
const roads = [
  { id: 1, kind: 'primary', width: 8, drive: 1, pts: [200, 0, 400, 0] },
  { id: 2, kind: 'footway', width: 3, pts: [200, 20, 400, 20] },
] as unknown as MapRoad[]
const world = {
  map: { roads },
  groundY: (x: number) => x * 0.01,
  nearestRoad: (x: number, z: number, driveOnly = false, maxDist = 60): NearestRoad | null => {
    const hits = roads
      .map((r, road) => ({ road, x, z: r.pts[1], dist: Math.abs(z - r.pts[1]), heading: 0, drive: r.drive === 1 }))
      .filter((h) => h.dist < maxDist && (!driveOnly || h.drive))
      .sort((a, b) => a.dist - b.dist)
    return hits[0] ?? null
  },
} as unknown as GtoWorld

describe('gto vehicleGround: 面の高さ', () => {
  it('車道の上は舗装の厚みだけ高い', () => {
    expect(surfaceLift(world, 300, 0)).toBeCloseTo(VEHICLE_GROUND.road, 6)
    expect(surfaceLift(world, 300, 3.9)).toBeCloseTo(VEHICLE_GROUND.road, 6)
  })

  it('車道の縁のすぐ外は縁石の帯、その外は地面', () => {
    expect(surfaceLift(world, 300, 4.1)).toBeCloseTo(VEHICLE_GROUND.kerb, 6)
    expect(surfaceLift(world, 300, 6)).toBe(0)
  })

  it('歩道の上は敷石の厚み', () => {
    expect(surfaceLift(world, 300, 20)).toBeCloseTo(VEHICLE_GROUND.walk, 6)
    expect(surfaceLift(world, 300, 23)).toBe(0)
  })

  it('スクランブル交差点の広場は車道より少し高い', () => {
    expect(surfaceLift(world, 5, 5)).toBeCloseTo(VEHICLE_GROUND.plaza, 6)
  })
})

describe('gto vehicleGround: 四輪の接地', () => {
  const offsets = wheelOffsets(2.7, 1.58)
  const EAST = Math.PI / 2
  const level = { ...world, groundY: () => 0 } as unknown as GtoWorld

  it('車道の真ん中では四輪とも舗装の上（地面の傾きはそのまま）', () => {
    // 向き π/2 は ＋x を向く。前輪は x が大きい側
    const h = wheelSurface(world, 300, 0, EAST, offsets)
    expect(h[0]).toBeCloseTo((300 + 1.35) * 0.01 + VEHICLE_GROUND.road, 6)
    expect(h[2]).toBeCloseTo((300 - 1.35) * 0.01 + VEHICLE_GROUND.road, 6)
    expect(h[0]).toBeCloseTo(h[1], 6)
  })

  it('右の輪だけが車道から落ちると、右の2輪だけが低い', () => {
    // 東向きで右は ＋z。車の中心を縁（z=4）の少し手前に置く
    const h = wheelSurface(level, 300, 3.9, EAST, offsets)
    expect([h[0], h[2]]).toEqual([VEHICLE_GROUND.road, VEHICLE_GROUND.road])
    expect([h[1], h[3]]).toEqual([0, 0])
  })

  it('斜めに縁を越えると、1輪だけが落ちる', () => {
    const h = wheelSurface(level, 300, 3.2, EAST + 0.5, offsets)
    expect(h[1]).toBe(0)
    expect([h[0], h[2], h[3]]).toEqual([VEHICLE_GROUND.road, VEHICLE_GROUND.road, VEHICLE_GROUND.road])
  })
})
