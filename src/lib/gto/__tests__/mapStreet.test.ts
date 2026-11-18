import { describe, expect, it } from 'vitest'
import { landmarkOf } from '../map'
import { MAIN_STREETS, wallAds, WALL_AD_ARTS } from '../mapStreet'
import type { MapBuilding, MapRoad } from '../types'
import { world } from './helpers'

describe('gto mapStreet: 通りに面した壁の大きな広告面', () => {
  const road = { id: 1, kind: 'tertiary', name: '道玄坂', width: 11, drive: 1, pts: [0, 0, 200, 0] } as MapRoad
  const box = (id: number, x: number, z: number, w = 16, d = 12, h = 30): MapBuilding => ({ id, h, y: 0, pts: [x, z, x + w, z, x + w, z + d, x, z + d] })
  // 道の南側に並ぶ棟（北の辺が道に面する）
  const row = Array.from({ length: 30 }, (_, k) => box(100 + k, k * 6, 10, 6))
  const ads = wallAds(row, [road], () => false)

  it('通りに面した棟の多くに、通りを向いた広告面を付ける', () => {
    expect(ads.length).toBeGreaterThan(row.length * 0.5)
    expect(ads.length).toBeLessThanOrEqual(row.length)
    for (const ad of ads) {
      expect(ad.nz).toBeCloseTo(-1, 5)
      expect(ad.z).toBeCloseTo(10, 5)
      expect(ad.art).toBeGreaterThanOrEqual(0)
      expect(ad.art).toBeLessThan(WALL_AD_ARTS)
    }
  })

  it('広告面は辺の幅と建物の高さに収まり、店先の帯より上にある', () => {
    for (const ad of ads) {
      const b = row.find((r) => r.id === ad.building)
      expect(b).toBeTruthy()
      if (!b) continue
      expect(ad.x - ad.w / 2).toBeGreaterThanOrEqual(b.pts[0] - 1e-6)
      expect(ad.x + ad.w / 2).toBeLessThanOrEqual(b.pts[2] + 1e-6)
      expect(ad.y0).toBeGreaterThanOrEqual(6)
      expect(ad.y0 + ad.h).toBeLessThanOrEqual(b.h)
    }
  })

  it('通りから離れた棟・低い棟・目印の建物には付けない', () => {
    expect(wallAds([box(1, 20, 80)], [road], () => false)).toEqual([])
    expect(wallAds([box(2, 20, 10, 16, 12, 9)], [road], () => false)).toEqual([])
    expect(wallAds(row, [road], () => true)).toEqual([])
  })

  it('同じ入力なら同じ並び', () => {
    expect(wallAds(row, [road], () => false)).toEqual(ads)
  })

  it('実際の地図では、主な通り沿いに数十枚以上が付き、どれも車道や建物の中に浮かない', () => {
    const real = wallAds(world.map.buildings, world.map.roads, (b) => landmarkOf(b) != null, world.insideBuilding)
    expect(real.length).toBeGreaterThan(80)
    expect(real.length).toBeLessThan(1500)
    expect(MAIN_STREETS.has('道玄坂')).toBe(true)
    for (const ad of real) expect(world.insideBuilding(ad.x + ad.nx * 1.2, ad.z + ad.nz * 1.2)).toBe(false)
  })
})
