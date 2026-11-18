import { describe, expect, it } from 'vitest'
import mapData from '../data/shibuyaMap.json'
import { isSkylineTower, sightTo, SKYLINE_MIN_HEIGHT } from '../mapSkyline'
import type { MapBuilding } from '../types'

const buildings = (mapData as unknown as { buildings: MapBuilding[] }).buildings
const byId = (id: number) => buildings.find((b) => b.id === id) as MapBuilding

describe('遠くの目印になる塔', () => {
  it('駅前の高層棟はすべて含む', () => {
    // 駅直上の塔、ヒカリエ、ストリーム、サクラステージ、セルリアン、マークシティの高層部、フクラス
    for (const id of [617560918, 521569267, 521438304, 1200029947, 521569269, 521569271, 55588118]) expect(isSkylineTower(byId(id))).toBe(true)
  })

  it('雑居ビルと屋根は含まない', () => {
    expect(isSkylineTower({ id: 1, h: SKYLINE_MIN_HEIGHT - 1, y: 0, pts: [] })).toBe(false)
    expect(isSkylineTower({ id: 2, h: 200, y: 0, pts: [], roof: 1 } as MapBuilding)).toBe(false)
    const towers = buildings.filter(isSkylineTower)
    expect(towers.length).toBeGreaterThan(8)
    expect(towers.length).toBeLessThan(60)
  })
})

describe('塔の見える方角と見かけの高さ', () => {
  it('センター街の中から、駅直上の塔は東南東の空に大きく見える', () => {
    const s = sightTo(byId(617560918), -151, -89, 1.6)
    expect(s.bearing).toBeGreaterThan(115)
    expect(s.bearing).toBeLessThan(135)
    // 見上げる角度は 25 度より上（通りの突き当たりの建物の上に出る）
    expect(s.elevation).toBeGreaterThan(25)
    expect(s.distance).toBeGreaterThan(300)
  })

  it('真北から見ると方角は 180 度', () => {
    const s = sightTo({ id: 3, h: 100, y: 0, pts: [-10, 90, 10, 90, 10, 110, -10, 110] }, 0, 0, 0)
    expect(s.bearing).toBeCloseTo(180, 5)
    expect(s.distance).toBeCloseTo(100, 5)
    expect(s.elevation).toBeCloseTo(45, 5)
  })
})
