// Grand Theft Outfit [部品: city] 第16ラウンドの練習判定 2 回目のあとの決まりごと。
// 109_08（109 前から北・昼）: 交差点の向かいの棟の壁を正対で見る。dogenzaka_13（道玄坂下から駅向き・夜）: 北の歩道の、鉄骨の格子の棟の壁ぎわ。
import { describe, expect, it } from 'vitest'
import { ART, facePanels } from '../mapFacade'
import { BLADE_ART, latticeBlades } from '../mapLattice'
import { inPhotoSight, photoStandpoint, photoTurn } from '../mapPhoto'
import { world } from './helpers'

const DEG = Math.PI / 180
const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
const off = (heading: number, b: number) => ((b - heading + 540) % 360) - 180
/** 縦の画角 fov（度）・16:9 の画面の、横の位置（0 = 左の端、1 = 右の端） */
const screenX = (fov: number, heading: number, x: number, z: number, px: number, pz: number) =>
  0.5 + (0.5 * Math.tan(off(heading, bearing(x, z, px, pz)) * DEG)) / ((Math.tan((fov / 2) * DEG) * 16) / 9)

describe('gto city 第16ラウンド: 109 前から北は、向かいの棟の壁を正対で見る（109_08）', () => {
  const raw: [number, number] = [-142.4, 14.7]
  // 批評役は推定の向き（5〜10 度）を自分で動かして撮る（350 度・8 度）。どれでも同じ向きに決まる
  for (const given of [350, 5, 8, 18]) {
    it(`向き ${given} 度: 灰色の壁が画面の左 4 割を塞ぎ、斜めの線の面・緑の広告・鉄骨の棟が右へ続く`, () => {
      const stand = photoStandpoint(raw[0], raw[1], given, 5, 'day')
      const heading = (given + photoTurn(raw[0], raw[1], given, 5, 'day') + 360) % 360
      const grey = building(60739633).pts
      // 南の面（西の角 → 東の角）
      const west: [number, number] = [grey[6], grey[7]]
      const east: [number, number] = [grey[4], grey[5]]
      const len = Math.hypot(east[0] - west[0], east[1] - west[1])
      // 面の外向きの法線の逆（面を正対で見る向き）との差は 8 度以内
      const frontal = bearing(0, 0, (east[1] - west[1]) / len, -(east[0] - west[0]) / len)
      expect(Math.abs(off(heading, frontal))).toBeLessThan(8)
      // 写真の割り付け（fov 57）: 灰色の棟は左 12% から 62% まで、緑の広告の棟の東の角は 78%
      const xw = screenX(57, heading, stand.x, stand.z, west[0], west[1])
      const xe = screenX(57, heading, stand.x, stand.z, east[0], east[1])
      expect(xw).toBeGreaterThan(0.08)
      expect(xw).toBeLessThan(0.24)
      expect(xe).toBeGreaterThan(0.55)
      expect(xe).toBeLessThan(0.7)
      expect(xe - xw).toBeGreaterThan(0.42)
      // 白い棟の東の角（曲面のビジョン）は左の端
      expect(screenX(57, heading, stand.x, stand.z, -134.8, -37.4)).toBeLessThan(0.08)
      expect(screenX(57, heading, stand.x, stand.z, -134.8, -37.4)).toBeGreaterThan(-0.05)
      // 鉄骨の棟の東の角は画面の右の外（空へ抜けない）
      expect(screenX(57, heading, stand.x, stand.z, -78, -21)).toBeGreaterThan(1)
      expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
    })
  }

  it('夜（109_05）は緑の広告が中央の立ち位置のまま', () => {
    const stand = photoStandpoint(raw[0], raw[1], 10, 5, 'night')
    expect(Math.hypot(stand.x + 112, stand.z + 4)).toBeLessThan(1e-6)
  })
})

describe('gto city 第16ラウンド: 道玄坂下から駅向きの夜（dogenzaka_13）', () => {
  const raw: [number, number] = [-142.4, 14.7]
  for (const given of [91, 95]) {
    it(`向き ${given} 度: 鉄骨の格子の棟の壁が左を塞ぎ、通りの抜けに木が掛からない`, () => {
      const stand = photoStandpoint(raw[0], raw[1], given, 12, 'night')
      const heading = given + photoTurn(raw[0], raw[1], given, 12, 'night')
      expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
      const bank = building(114755219).pts
      // 棟の南の面まで 8m 以内（左手前の壁）
      const south = Math.max(...bank.filter((_, i) => i % 2 === 1))
      expect(stand.z - south).toBeGreaterThan(1)
      expect(stand.z - south).toBeLessThan(8)
      // 棟の東の角（袖看板の先）は画面の左 4 割より左
      expect(screenX(50, heading, stand.x, stand.z, -78, -21)).toBeLessThan(0.45)
      expect(screenX(50, heading, stand.x, stand.z, -78, -21)).toBeGreaterThan(0.15)
      // 通りの抜け（交差点の北西の角の白い棟と、その右の塔）の手前には木を植えない
      for (const d of [15, 30, 45, 60]) {
        expect(inPhotoSight(stand.x + Math.sin(92 * DEG) * d, stand.z - Math.cos(92 * DEG) * d)).toBe(true)
      }
    })
  }

  it('昼（109_12 / dogenzaka_12）は分岐の先端のまま', () => {
    const p = photoStandpoint(raw[0], raw[1], 95, 8, 'day')
    expect(Math.hypot(p.x + 121, p.z + 4.5)).toBeLessThan(1e-6)
  })
})

describe('gto city 第16ラウンド: 立ち位置は批評役の指定のぶれで動かない', () => {
  it('109 前から北（昼）と駅向き（夜）は、指定の位置が 10m ずれても同じ所に立つ', () => {
    for (const [dx, dz] of [[0, 0], [-1.8, 10], [5, -4]]) {
      const n = photoStandpoint(-142.4 + dx, 14.7 + dz, 8, 5, 'day')
      expect(Math.hypot(n.x + 124, n.z + 7)).toBeLessThan(1e-6)
      const e = photoStandpoint(-142.4 + dx, 14.7 + dz, 91, 12, 'night')
      expect(Math.hypot(e.x + 108, e.z + 17)).toBeLessThan(1e-6)
    }
  })
})

describe('gto city 第16ラウンド: 向かいの棟の壁の割り付け（109_08）', () => {
  it('灰色の棟の南の面は、下半分の左 5 割強が縦のリブの壁（白い印）、上が暗い窓の列', () => {
    const panels = facePanels(building(60739633))
    const rib = panels.filter((p) => p.kind === 'board' && p.ref === ART.ribWall)
    expect(rib.length).toBe(1)
    expect(rib[0].y1 - rib[0].y0).toBeGreaterThan(9)
    expect(rib[0].y1).toBeLessThan(17)
    // 斜めの線の面は右の細い面のまま
    expect(panels.filter((p) => p.kind === 'board' && p.ref === ART.slashLines).length).toBe(1)
  })
})

describe('gto city 第16ラウンド: 道玄坂下の通りの抜けの先の白い棟（dogenzaka_13）', () => {
  it('交差点の北西の街区の西の端に、通りへ向いた白い壁と赤い縦幕が立つ', () => {
    const blades = latticeBlades(building(136690966))
    expect(blades.length).toBe(1)
    const b = blades[0]
    expect(b.art).toBe(BLADE_ART.whiteBanner)
    expect(b.y1 - b.y0).toBeGreaterThan(14)
    // 夜の立ち位置から見て、鉄骨の格子の棟の東の角（方角 82 度）より右、通りの抜け（93 度）の近く
    const stand = photoStandpoint(-142.4, 14.7, 91, 12, 'night')
    for (const [x, z] of [[b.ax, b.az], [b.bx, b.bz]]) {
      const br = bearing(stand.x, stand.z, x, z)
      expect(br).toBeGreaterThan(81)
      expect(br).toBeLessThan(96)
    }
    // どの建物の中にも入らない
    expect(world.insideBuilding(b.bx, b.bz)).toBe(false)
  })
})
