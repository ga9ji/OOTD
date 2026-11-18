// 分岐の先端に立つ円筒の建物の割り付け（円筒・後ろの棟・吹き抜けの面）を確かめる
import { describe, expect, it } from 'vitest'
import mapJson from '../data/shibuyaMap.json'
import { forkCanopy, forkTower } from '../map109'
import { pointInPolygon } from '../math'
import type { ShibuyaMap } from '../types'

const map = mapJson as unknown as ShibuyaMap
const bd = map.buildings.find((b) => b.id === 55895868)

describe('forkTower', () => {
  it('地図に円筒の建物がある', () => {
    expect(bd).toBeTruthy()
  })
  const f = forkTower(bd!.pts)

  it('円筒は輪郭の先端（交差点にいちばん近い側）に収まる', () => {
    expect(pointInPolygon(bd!.pts, f.cx, f.cz)).toBe(true)
    let nearest = Infinity
    for (let i = 0; i < bd!.pts.length; i += 2) nearest = Math.min(nearest, Math.hypot(bd!.pts[i], bd!.pts[i + 1]))
    expect(Math.hypot(f.cx, f.cz) - f.r).toBeLessThan(nearest + 1.5)
  })

  it('後ろの棟は円筒の前へ出ない（円筒が先端に独立して見える）', () => {
    const dist = Math.hypot(f.cx, f.cz)
    for (let i = 0; i < f.body.length; i += 2) {
      // 交差点から見て、円筒の中心より手前に棟の角が無い
      expect(Math.hypot(f.body[i], f.body[i + 1])).toBeGreaterThan(dist - 1)
    }
    expect(f.body.length).toBeGreaterThanOrEqual(8)
  })

  it('吹き抜けの面は道玄坂（南）側の長い辺で、外を向く', () => {
    const { ax, az, bx, bz, nx, nz } = f.atrium
    expect(Math.hypot(bx - ax, bz - az)).toBeGreaterThan(20)
    expect(nz).toBeGreaterThan(0.6)
    expect(Math.hypot(nx, nz)).toBeCloseTo(1, 5)
    // 面の始点は円筒の側
    expect(Math.hypot(ax - f.cx, az - f.cz)).toBeLessThan(f.r + 1)
  })

  it('輪郭が小さすぎても壊れない', () => {
    const tiny = forkTower([0, 0, 4, 0, 4, 4, 0, 4])
    expect(tiny.body.length).toBeGreaterThanOrEqual(6)
    expect(Number.isFinite(tiny.cx)).toBe(true)
  })

  it('足元の鉄骨の庇は円筒の前を巻き、交差点の側と坂（南）の側の両方に柱が立つ', () => {
    const c = forkCanopy(f)
    expect(c.posts.length).toBeGreaterThanOrEqual(5)
    expect(c.posts.length).toBe(c.inner.length)
    // 柱はどれも円筒の外、内側の弦は円筒の壁のすぐ外
    for (const [x, z] of c.posts) expect(Math.hypot(x - f.cx, z - f.cz)).toBeGreaterThan(f.r + 3)
    for (const [x, z] of c.inner) expect(Math.hypot(x - f.cx, z - f.cz)).toBeGreaterThan(f.r + 0.5)
    // 交差点の側（円筒の正面）に柱がある
    const front = c.posts.some(([x, z]) => ((x - f.cx) * f.fx + (z - f.cz) * f.fz) / Math.hypot(x - f.cx, z - f.cz) > 0.95)
    expect(front).toBe(true)
    // 坂の側（南）: 109 前の歩道（-142, 3 のあたり）から東を見て、左手前 10m 以内に柱がある
    const near = c.posts.some(([x, z]) => x > -142 && z < 3 && Math.hypot(x + 142.4, z - 3) < 10)
    expect(near).toBe(true)
    // 柱は後ろの棟の中に立たない
    for (const [x, z] of c.posts) expect(pointInPolygon(f.body, x, z)).toBe(false)
  })
})
