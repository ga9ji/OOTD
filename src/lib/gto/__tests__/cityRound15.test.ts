// Grand Theft Outfit [部品: city] 第15ラウンドの決まりごとの確かめ。
// 宮益坂下から南（miyamasuzaka_06〜09、viaduct_01、towers_17）: 東口だと読める決め手は「JR の高架が右手を手前から奥へ伸びる」こと。
// 橋（銀座線）は東西に道路をまたぎ、JR は南北。橋だけが画面を横切る立ち位置にしない。
import { describe, expect, it } from 'vitest'
import { JR_EAST, jrEastEdges, towerNorthFace } from '../mapEast'
import { nearPhotoStand, photoStandpoint, photoTurn } from '../mapPhoto'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
/** 向き heading から見た方角 b の左右の角度（右が＋） */
const off = (heading: number, b: number) => ((b - heading + 540) % 360) - 180

describe('gto city 第15ラウンド: 宮益坂下から南（東口）', () => {
  // index.json の推定位置（6 枚とも同じ）
  const raw: [number, number] = [151.9, -18.6]
  const station = building(904652357)
  const edges = jrEastEdges(station.pts)
  const tower = towerNorthFace(building(617560918).pts)

  it('JR の線路は南北、銀座線の橋は東西に走る（地図）', () => {
    const jr = world.map.rails.filter((r) => r.line === 'jr' && r.pts.some((_, i) => i % 2 === 1 && Math.abs(r.pts[i] - 40) < 40 && Math.abs(r.pts[i - 1] - 75) < 30))
    expect(jr.length).toBeGreaterThan(2)
    for (const r of jr) {
      const dx = r.pts[r.pts.length - 2] - r.pts[0]
      const dz = r.pts[r.pts.length - 1] - r.pts[1]
      expect(Math.abs(dz)).toBeGreaterThan(Math.abs(dx) * 1.5)
    }
    const ginza = world.map.rails.filter((r) => r.line === 'ginza' && r.pts[0] > 100 && r.pts[0] < 260)
    expect(ginza.length).toBeGreaterThan(0)
    for (const r of ginza) {
      const dx = r.pts[r.pts.length - 2] - r.pts[0]
      const dz = r.pts[r.pts.length - 1] - r.pts[1]
      expect(Math.abs(dx)).toBeGreaterThan(Math.abs(dz) * 1.5)
    }
  })

  // 練習判定 1 回目のあと: 高架の目の前（東の面から 35m）に立つと、斜めの高架が主役になって「線路に向かって西を見ている」と読まれた。
  // 写真（miyamasuzaka_07）は橋のガラスの帯が塔の足元を左端から画面の 8 割まで横切り、高架は右端に小さく見える
  for (const given of [168, 185, 190, 200]) {
    it(`向き ${given} 度: 橋が画面の左から中央を横切り、高架は右の端に奥へ伸びる（主役にしない）`, () => {
      const stand = photoStandpoint(raw[0], raw[1], given, 12, 'dusk')
      const heading = given + photoTurn(raw[0], raw[1], given, 12, 'dusk')
      // 第17ラウンド: 夕方の指定は向きも 187 度に固定（指定のずれで絵が変わらない）
      expect(heading).toBeCloseTo(187, 5)
      expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
      expect(nearPhotoStand(stand.x, stand.z, 1)).toBe(true)
      const near = edges[0]
      const far = edges[edges.length - 1]
      const dNear = Math.hypot(near.ax - stand.x, near.az - stand.z)
      // 高架の東の面まで 45〜65m（目の前でも、画面の外でもない）
      expect(dNear).toBeGreaterThan(45)
      expect(dNear).toBeLessThan(65)
      // 奥の端は画面の右寄り、手前の端はそれよりさらに右
      const farOff = off(heading, bearing(stand.x, stand.z, far.bx, far.bz))
      const nearOff = off(heading, bearing(stand.x, stand.z, near.ax, near.az))
      expect(farOff).toBeGreaterThan(0)
      expect(farOff).toBeLessThan(36)
      expect(nearOff).toBeGreaterThan(farOff + 25)
      // 塔の大型ビジョンの面は高架の奥の端より左で、画面の中
      expect(tower).not.toBeNull()
      if (!tower) return
      const screenOff = off(heading, bearing(stand.x, stand.z, (tower.ax + tower.bx) / 2, (tower.az + tower.bz) / 2))
      expect(screenOff).toBeLessThan(farOff - 5)
      expect(screenOff).toBeGreaterThan(-36)
    })
  }

  it('見上げの強い指定（towers_15/16）は北の歩道の奥のまま', () => {
    const stand = photoStandpoint(raw[0], raw[1], 190, 27, 'day')
    expect(stand.z).toBeLessThan(-50)
  })

  it('高架の東の面は、電車の床の上に柱と桁、その上に工事中の躯体が載る', () => {
    expect(JR_EAST.girder0).toBeGreaterThan(JR_EAST.rail + 3.6)
    expect(JR_EAST.top).toBeGreaterThan(JR_EAST.girder1 + 8)
  })
})
