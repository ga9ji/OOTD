import { describe, expect, it } from 'vitest'
import { clearOfWalls, parseLaunch } from '../shot'
import { DEG } from '../math'
import { world } from './helpers'

const ahead = (p: { x: number; z: number }, h: number, reach = 14) => world.segmentClear(p.x, p.z, p.x + Math.sin(h) * reach, p.z - Math.cos(h) * reach)

describe('gto shot: 写真の推定位置が壁の中のとき', () => {
  // refs/shibuya/index.json の推定位置（道玄坂の途中・宮益坂の下部・センター街の分岐）
  const cases: [x: number, z: number, deg: number][] = [
    [-228, 70, 65],
    [211, -41, 260],
    [-88, -57, 300],
  ]
  it('向きは変えずに、見通しのある通りの上へ寄せる', () => {
    for (const [x, z, deg] of cases) {
      const p = clearOfWalls(world, x, z, deg * DEG)
      expect(world.insideBuilding(p.x, p.z)).toBe(false)
      expect(ahead(p, deg * DEG)).toBeGreaterThanOrEqual(1)
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(60)
    }
  })

  it('見通しのある場所は動かさない', () => {
    const p = clearOfWalls(world, 0, 0, 0)
    expect(p).toEqual({ x: 0, z: 0 })
  })

  it('緯度経度の撮影クエリにも効く', () => {
    const { mPerDegLat, mPerDegLon, origin } = world.map.meta
    const lat = origin.lat - 70 / mPerDegLat
    const lon = origin.lon + -228 / mPerDegLon
    const l = parseLaunch(new URLSearchParams(`gtoShot=${lat},${lon},65`), world)
    expect(l.photo).not.toBeNull()
    if (!l.photo) return
    expect(world.insideBuilding(l.photo.x, l.photo.z)).toBe(false)
    expect(ahead(l.photo, 65 * DEG)).toBeGreaterThanOrEqual(1)
  })
})
