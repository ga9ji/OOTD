// Grand Theft Outfit [部品: city] 第16ラウンドの決まりごとの確かめ。
// center-gai_09（センター街の中から駅向き・夜）: 通りの突き当たりを、中から白く灯る角のガラスの棟が塞ぎ、その真上に駅の塔がかぶさる。
import { describe, expect, it } from 'vitest'
import { blockStyleOf } from '../map'
import { STEPPED_BANK } from '../mapBlockStyles'
import { ART, CORNER_GLASS, FACE_DECOS, facePanels } from '../mapFacade'
import { PHOTO_LAMPS, photoStandpoint, photoTurn } from '../mapPhoto'
import { pointInPolygon } from '../math'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
const corners = (pts: number[]) => Array.from({ length: pts.length / 2 }, (_, i) => [pts[i * 2], pts[i * 2 + 1]] as [number, number])

describe('gto city 第16ラウンド: センター街の突き当たりの角の棟と、その真上の塔（center-gai_09）', () => {
  // 批評役のクエリ（35.6603, 139.6989・110 度・夜）
  const raw: [number, number] = [-151.5, -90.7]
  const stand = photoStandpoint(raw[0], raw[1], 110, 6, 'night')
  const heading = 110 + photoTurn(raw[0], raw[1], 110, 6, 'night')
  const eye = 1.6

  it('角の棟は、立ち位置から見える面（西・隅切り・北）の帯の看板の上から屋上までが灯るガラス', () => {
    const corner = building(136690970)
    const glass = facePanels(corner).filter((p) => p.kind === 'board' && p.ref === ART.litGlass)
    const facing = glass.filter((p) => p.nx * (stand.x - p.ax) + p.nz * (stand.z - p.az) > 0)
    expect(facing.length).toBeGreaterThanOrEqual(3)
    for (const p of facing) {
      expect(p.y0).toBeLessThan(8.5)
      expect(p.y1).toBeGreaterThan(corner.h - 1.5)
      expect(p.y1).toBeLessThanOrEqual(corner.h)
    }
    expect(CORNER_GLASS.ref).toBe(ART.litGlass)
    // 帯の看板は残す
    expect((FACE_DECOS[136690970] ?? []).flatMap((d) => d.panels).some((p) => p.ref === ART.blackBand)).toBe(true)
  })

  it('角の棟は画面の中央をまたぐ（中央から左右 10 度以内に両端）', () => {
    const v = corners(building(136690970).pts).map(([x, z]) => bearing(stand.x, stand.z, x, z) - heading)
    expect(Math.min(...v)).toBeLessThan(0)
    expect(Math.min(...v)).toBeGreaterThan(-10)
    expect(Math.max(...v)).toBeGreaterThan(0)
    expect(Math.max(...v)).toBeLessThan(10)
  })

  it('塔の左半分は、角の棟の屋根のすぐ上（見上げ 19 度まで）から見える: 手前の棟の高い部分が重ならない', () => {
    const tower = building(617560918)
    const tb = corners(tower.pts).map(([x, z]) => bearing(stand.x, stand.z, x, z))
    const left = Math.min(...tb)
    const center = (left + Math.max(...tb)) / 2
    const bank = building(114755219)
    const style = blockStyleOf(bank)
    expect(style?.upper).toBeDefined()
    // 高い部分の輪郭は元の輪郭の中
    for (const [x, z] of corners(STEPPED_BANK.pts)) {
      const cx = bank.pts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (bank.pts.length / 2)
      const cz = bank.pts.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (bank.pts.length / 2)
      expect(pointInPolygon(bank.pts, x + (cx - x) * 0.02, z + (cz - z) * 0.02)).toBe(true)
    }
    // 高い部分は、塔の左の端から中央までの方角に掛からない
    const ub = corners(STEPPED_BANK.pts).map(([x, z]) => bearing(stand.x, stand.z, x, z))
    expect(Math.min(...ub)).toBeGreaterThan(center - 1.5)
    expect(Math.min(...ub)).toBeGreaterThan(left + 5)
    // 段の下の屋上は、見上げ 19 度より低い
    const near = Math.min(...corners(bank.pts).map(([x, z]) => Math.hypot(x - stand.x, z - stand.z)))
    expect((Math.atan2(bank.y + STEPPED_BANK.from + 0.9 - eye, near) * 180) / Math.PI).toBeLessThan(19)
    // 塔の頂部は画面の上の端（見上げ 27 度）より上まで届く
    const far = Math.max(...corners(tower.pts).map(([x, z]) => Math.hypot(x - stand.x, z - stand.z)))
    expect((Math.atan2(tower.y + tower.h - eye, far) * 180) / Math.PI).toBeGreaterThan(27)
  })

  it('手前の行灯の街灯は、角の棟の左の端より左に立つ（灯具のにじみが棟と塔を隠さない）', () => {
    const [lx, lz] = PHOTO_LAMPS[0]
    const off = bearing(stand.x, stand.z, lx, lz) - heading
    const cornerLeft = Math.min(...corners(building(136690970).pts).map(([x, z]) => bearing(stand.x, stand.z, x, z) - heading))
    expect(off).toBeLessThan(cornerLeft + 1)
    expect(off).toBeGreaterThan(-14)
    expect(Math.hypot(lx - stand.x, lz - stand.z)).toBeGreaterThan(11)
  })
})
