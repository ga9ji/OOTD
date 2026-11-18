import { describe, expect, it } from 'vitest'
import mapData from '../data/shibuyaMap.json'
import { pointInPolygon } from '../math'
import { BRICK_WALK, GUARD_EAST, guardEastFace, isBrickWalkRoad, ROOF_SCREENS, roofScreens, splitSlab, walkRuns } from '../mapVista'
import { world } from './helpers'
import type { MapBuilding, ShibuyaMap } from '../types'

const map = mapData as unknown as ShibuyaMap
const byId = (id: number) => map.buildings.find((b) => b.id === id) as MapBuilding

/** 宮益坂下の交差点とガードの間の北の歩道（miyamasuzaka_04/05 の立ち位置）と、目の高さ */
const EYE: [number, number, number] = [134, -12, 3.1]

describe('屋上の大型ビジョン（ガードの向こうの突き当たり）', () => {
  const b = byId(60739635)
  const screens = roofScreens(b)

  it('交差点の西の棟の屋上に 2 面並ぶ', () => {
    expect(screens).toHaveLength(2)
    expect(Object.keys(ROOF_SCREENS)).toContain('60739635')
  })

  it('どちらも東（ガードの手前の歩道）から表が見え、屋上の縁に載る', () => {
    for (const s of screens) {
      const mx = (s.ax + s.bx) / 2
      const mz = (s.az + s.bz) / 2
      const dl = Math.hypot(EYE[0] - mx, EYE[1] - mz)
      // 表の向きと、見る人への向きの内積
      expect((s.nx * (EYE[0] - mx) + s.nz * (EYE[1] - mz)) / dl).toBeGreaterThan(0.6)
      // 下辺の両端は輪郭の上（内へ 0.5m 入れば中、外へ 0.5m 出れば外）
      expect(pointInPolygon(b.pts, mx - s.nx * 0.5, mz - s.nz * 0.5)).toBe(true)
      expect(pointInPolygon(b.pts, mx + s.nx * 0.5, mz + s.nz * 0.5)).toBe(false)
      expect(Math.hypot(s.bx - s.ax, s.bz - s.az)).toBeGreaterThan(11)
      expect(s.y1 - s.y0).toBeGreaterThan(9)
    }
  })

  it('ガードの上の電車の屋根より上に出る', () => {
    // ガードのいちばん東の線路（x ≈ 78）の電車の屋根（レール 7m ＋ 4.05m）をかすめる視線
    const slope = (7 + 4.05 - EYE[2]) / (EYE[0] - 78)
    for (const s of screens) {
      const d = Math.hypot(EYE[0] - (s.ax + s.bx) / 2, EYE[1] - (s.az + s.bz) / 2)
      const hidden = EYE[2] + slope * d
      // 画面の上 2/3 は電車の上に出る
      expect(b.y + b.h + s.y0 + (s.y1 - s.y0) / 3).toBeGreaterThan(hidden)
    }
  })

  it('決めていない建物には無い', () => {
    expect(roofScreens(byId(136691386))).toEqual([])
  })
})

describe('板状の塔を、両端の妻面と胴に分ける', () => {
  it('四角い輪郭は、長手に沿って 端・胴・端 に分かれる', () => {
    const parts = splitSlab([0, 0, 60, 0, 60, 15, 0, 15], 3)
    expect(parts).not.toBeNull()
    if (!parts) return
    expect(parts.ends).toHaveLength(2)
    const xs = (p: number[]) => p.filter((_, i) => i % 2 === 0)
    expect(Math.max(...xs(parts.ends[0])) - Math.min(...xs(parts.ends[0]))).toBeCloseTo(3, 5)
    expect(Math.max(...xs(parts.body)) - Math.min(...xs(parts.body))).toBeCloseTo(54, 5)
    expect(Math.max(...xs(parts.ends[1]))).toBeCloseTo(60, 5)
  })

  it('マークシティの高層部（ホテル棟）は板状で、分けられる', () => {
    const parts = splitSlab(byId(521569271).pts, 3)
    expect(parts).not.toBeNull()
  })

  it('四角でない輪郭は分けない', () => {
    expect(splitSlab([0, 0, 10, 0, 12, 5, 10, 10, 0, 10], 3)).toBeNull()
  })
})

describe('ガードの東の面', () => {
  it('いちばん東の線路の東の縁に沿い、道をまたぐ区間だけ', () => {
    const f = guardEastFace(map)
    expect(f).not.toBeNull()
    if (!f) return
    expect(Math.min(f.ax, f.bx)).toBeGreaterThan(72)
    expect(Math.max(f.ax, f.bx)).toBeLessThan(84)
    expect(f.nx).toBeGreaterThan(0.9)
    // 道（z ≈ -6..3）をまたぐ
    expect(Math.min(f.az, f.bz)).toBeLessThan(-8)
    expect(Math.max(f.az, f.bz)).toBeGreaterThan(5)
    expect(f.y).toBeCloseTo(7, 1)
    expect(GUARD_EAST.top).toBeGreaterThan(0)
  })
})

describe('レンガ調の歩道と緑の横パイプ柵（宮益坂とガードの手前）', () => {
  it('宮益坂と、ガードより東の旧大山街道だけ', () => {
    const roads = map.roads.filter(isBrickWalkRoad)
    expect(roads.length).toBeGreaterThan(3)
    for (const r of roads) {
      expect(['宮益坂', '旧大山街道']).toContain(r.name)
      for (let i = 0; i < r.pts.length; i += 2) expect(r.pts[i]).toBeGreaterThanOrEqual(BRICK_WALK.xMin)
    }
  })

  it('歩道の帯は車道にも建物にも掛からず、途切れた所で分かれる', () => {
    const r = map.roads.find((q) => q.id === 213526440)
    expect(r).toBeDefined()
    if (!r) return
    for (const side of [1, -1]) {
      const runs = walkRuns(world, r, (r.width / 2 + BRICK_WALK.fence) * side, 2)
      expect(runs.length).toBeGreaterThan(0)
      for (const run of runs) {
        expect(run.length).toBeGreaterThanOrEqual(2)
        for (const [x, z] of run) {
          expect(world.insideBuilding(x, z)).toBe(false)
          const near = world.nearestRoad(x, z, true, 30)
          if (near) expect(near.dist).toBeGreaterThanOrEqual(world.map.roads[near.road].width / 2)
        }
      }
    }
  })
})
