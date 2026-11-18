import { describe, expect, it } from 'vitest'
import { BLADE_ART, LATTICE, latticeBlades, latticeMembers } from '../mapLattice'
import { photoStandpoint } from '../mapPhoto'
import { pointInPolygon } from '../math'
import { world } from './helpers'

const building = world.map.buildings.find((b) => b.id === LATTICE.building)!
/** 109_12 の立ち位置（分岐の先端） */
const stand = photoStandpoint(-142.4, 14.7, 95)

describe('gto mapLattice: 道玄坂下の北の角の棟の鉄骨の格子と袖看板（109_12 / dogenzaka_13 の左手前）', () => {
  it('棟は 109 前から駅を向いて左（北）の手前 60m 以内にある', () => {
    expect(building).toBeDefined()
    const near = building.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - stand.x, building.pts[i + 1] - stand.z) < 60)
    expect(near).toBe(true)
    expect(Math.max(...building.pts.filter((_, i) => i % 2 === 1))).toBeLessThan(stand.z)
  })

  it('格子は壁の外に立ち、店先の上から屋上の手前まで、水平材・柱・斜材がそろう', () => {
    const m = latticeMembers(building)
    const level = m.filter((s) => s.a[1] === s.b[1])
    const post = m.filter((s) => s.a[0] === s.b[0] && s.a[2] === s.b[2])
    const brace = m.filter((s) => s.a[1] !== s.b[1] && (s.a[0] !== s.b[0] || s.a[2] !== s.b[2]))
    expect(level.length).toBeGreaterThanOrEqual(12)
    expect(post.length).toBeGreaterThanOrEqual(8)
    expect(brace.length).toBeGreaterThanOrEqual(40)
    for (const s of m) {
      for (const p of [s.a, s.b]) {
        // 自分の壁の外。隣の棟の屋上（24m）より低い部材は、どの建物の中にも入らない
        expect(pointInPolygon(building.pts, p[0], p[2]), `${p}`).toBe(false)
        if (p[1] < building.y + 24) expect(world.insideBuilding(p[0], p[2]), `${p}`).toBe(false)
        expect(p[1]).toBeGreaterThanOrEqual(building.y + LATTICE.faces[0].y0 - 0.01)
        expect(p[1]).toBeLessThanOrEqual(building.y + building.h)
      }
    }
    // 斜材は水平材より細い
    expect(Math.max(...brace.map((s) => s.half))).toBeLessThan(Math.min(...level.map((s) => s.half)))
  })

  it('軽量設定では斜材を省き、部材が半分以下になる', () => {
    expect(latticeMembers(building, false).length).toBeLessThan(latticeMembers(building).length / 2)
  })

  it('袖看板は南の面から通り（南）へ直角に突き出し、車道には掛からず、車の屋根より高い', () => {
    const blades = latticeBlades(building)
    expect(blades).toHaveLength(2)
    for (const b of blades) {
      expect(b.bz).toBeGreaterThan(b.az + 1.5)
      expect(Math.abs(b.bx - b.ax)).toBeLessThan(0.5)
      expect(b.y0 - building.y).toBeGreaterThan(4)
      const road = world.nearestRoad(b.bx, b.bz, true, 30)
      if (road) expect(road.dist).toBeGreaterThan(world.map.roads[road.road].width / 2)
    }
    // 青い看板が手前（西）、黄色い看板がその先（東）
    expect(blades[0].ax).toBeLessThan(blades[1].ax)
  })

  it('ほかの建物には何も付けない', () => {
    const other = world.map.buildings.find((b) => b.id !== LATTICE.building)!
    expect(latticeMembers(other)).toEqual([])
    expect(latticeBlades(other)).toEqual([])
  })

  it('109 の向かいの赤い大看板の棟は、西の端から通り（北）へ突き出す赤い縦長の袖看板が屋上より高く伸びる', () => {
    const red = world.map.buildings.find((b) => b.id === 136587824)
    expect(red).toBeDefined()
    if (!red) return
    const blades = latticeBlades(red)
    expect(blades.length).toBe(1)
    const [b] = blades
    expect(b.art).toBe(BLADE_ART.redShop)
    expect(b.bz).toBeLessThan(b.az - 1.5)
    expect(b.y1 - red.y).toBeGreaterThan(red.h + 6)
    expect(world.insideBuilding(b.bx, b.bz)).toBe(false)
    // 格子の部材は付かない
    expect(latticeMembers(red)).toEqual([])
  })
})
