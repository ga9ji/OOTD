// Grand Theft Outfit [部品: city] 第13ラウンドの決まりごとの確かめ。
// dogenzaka_01（109 前から駅側）: 通りの抜けの先に、駅側の高層棟が 2 本立って見える。
// 109_13（109 前から南）: 円筒の足元の鉄骨の庇は 2 階の高さの薄い帯。
// miyamasuzaka_01（東口の広場から坂上）: 手前に仮囲いが無く、正面の屋上の板が画面の中央に来る。
import { describe, expect, it } from 'vitest'
import { blockStyleOf, streetProps } from '../map'
import { HOARDINGS } from '../mapEastFront'
import { inPhotoSight, PHOTO_SIGHTS, photoStandpoint, photoTurn } from '../mapPhoto'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
const bearings = (x: number, z: number, pts: number[]) => Array.from({ length: pts.length / 2 }, (_, i) => bearing(x, z, pts[i * 2], pts[i * 2 + 1]))

describe('gto city 第13ラウンド: 109 前から駅側（dogenzaka_01）', () => {
  const stand = photoStandpoint(-42.5, 7.8, 110)

  it('立ち位置は道玄坂を渡る横断歩道の北の端の西（車道の縁。第15ラウンドで壁ぎわから移した）で、建物の外', () => {
    expect(Math.hypot(stand.x + 99, stand.z + 11)).toBeLessThan(1e-6)
    expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
  })

  it('いちばん高い塔の左の縁は、道玄坂の南の角の棟の左の縁より 3 度以上左に出て見える', () => {
    const tower = Math.min(...bearings(stand.x, stand.z, building(617560918).pts))
    const corner = Math.min(...bearings(stand.x, stand.z, building(60739635).pts))
    expect(corner - tower).toBeGreaterThan(3)
  })

  it('塔 2 本への見通しの上に街路樹を植えない', () => {
    expect(PHOTO_SIGHTS.length).toBeGreaterThan(0)
    expect(inPhotoSight(-70, -8)).toBe(true)
    expect(inPhotoSight(-70, -40)).toBe(false)
    for (const p of streetProps(world)) if (p.kind === 'tree') expect(inPhotoSight(p.x, p.z), `${p.x},${p.z}`).toBe(false)
  })

  it('道玄坂の南の角の棟は赤い帯の入った明るい外壁、その西に低い白い棟と細い青い棟が並ぶ', () => {
    expect(blockStyleOf(building(60739635))?.facade).toBe('ribbon')
    const thin = blockStyleOf(building(116806276))
    expect(thin).toBeTruthy()
    expect(building(844691964).h).toBeLessThan(building(60739635).h - 10)
    expect(building(116806276).h + (thin?.raise ?? 0) * 3.4).toBeGreaterThan(building(844691964).h + 8)
  })
})

describe('gto city 第13ラウンド: 東口の広場から坂上（miyamasuzaka_01）', () => {
  it('推定の向き 75 度は、屋上の板が画面の中央に来る向きへ回す', () => {
    const stand = photoStandpoint(152.1, -18.6, 75)
    const heading = 75 + photoTurn(152.1, -18.6, 75)
    const board = building(155797253)
    const b = bearings(stand.x, stand.z, board.pts)
    const mid = (Math.min(...b) + Math.max(...b)) / 2
    expect(Math.abs(mid - heading)).toBeLessThan(10)
  })

  it('立ち位置の 14m 以内に白い仮囲いを立てない', () => {
    const stand = photoStandpoint(152.1, -18.6, 75)
    for (const s of HOARDINGS) for (const t of [0, 0.5, 1]) expect(Math.hypot(s[0] + (s[2] - s[0]) * t - stand.x, s[1] + (s[3] - s[1]) * t - stand.z)).toBeGreaterThan(14)
  })
})
