import { describe, expect, it } from 'vitest'
import { fromLatLon } from '../map'
import { NORTH_PLAZA } from '../mapEast'
import { ART, FACE_DECOS, facePanels } from '../mapFacade'
import { EAST_PASSAGE_FACE, EAST_PASSAGE_STAND, photoStandpoint, photoTurn } from '../mapPhoto'
import { world } from './helpers'

/** 立ち位置 from から見た点 (x, z) の方角が、向き face（度）から右へ何度か */
const rightOf = (from: readonly [number, number], face: number, x: number, z: number) => {
  const bearing = (Math.atan2(x - from[0], -(z - from[1])) * 180) / Math.PI
  return ((bearing - face + 540) % 360) - 180
}

describe('gto city 第17ラウンド 練習判定 1 回目の外れ', () => {
  it('scramble_13: スクランブル交差点の西の横断歩道の北の端から道玄坂を見る（南西の角の棟の壁ぎわではない）', () => {
    const raw = fromLatLon(world.map, 35.65945, 139.7002)
    for (const [dx, dz, given] of [[0, 0, 263], [4, -3, 265], [-6, 2, 270], [8, 4, 258]]) {
      const p = photoStandpoint(raw.x + dx, raw.z + dz, given, 14, 'dusk')
      expect(p.z).toBeLessThan(-6)
      expect(p.x).toBeGreaterThan(-37)
      expect(p.x).toBeLessThan(-27)
      expect(world.insideBuilding(p.x, p.z)).toBe(false)
      const face = given + photoTurn(raw.x + dx, raw.z + dz, given, 14, 'dusk')
      // 円筒（分岐の先端）は画面の中央より右
      const cyl = rightOf([p.x, p.z], face, -141, -8.5)
      expect(cyl).toBeGreaterThan(4)
      expect(cyl).toBeLessThan(16)
    }
  })

  it('南西の角の棟の道玄坂の面に、屋上まで届く縦長の寄せ絵の広告面と、階ごとの店の看板がある', () => {
    const b = world.map.buildings.find((x) => x.id === 60739635)!
    const panels = facePanels(b, FACE_DECOS[60739635])
    const collage = panels.find((p) => p.kind === 'board' && p.ref === ART.collage)!
    expect(collage).toBeTruthy()
    expect(collage.y1 - collage.y0).toBeGreaterThan(22)
    expect(collage.len).toBeLessThan(collage.y1 - collage.y0)
    // 交差点へ向いた隅切りの面は、階ごとの看板の帯が 5 本以上
    const corner = panels.filter((p) => p.nx > 0.5 && p.nz < -0.4 && p.y1 - p.y0 < 3)
    expect(corner.length).toBeGreaterThanOrEqual(5)
  })

  it('towers_15: 隙間の立ち位置から、案内塔は塔の裾の右（6 度前後）、白い円柱は右 20〜28 度、その右に店の立体の印', () => {
    const P = NORTH_PLAZA
    const pylon = rightOf(EAST_PASSAGE_STAND, EAST_PASSAGE_FACE, P.pylon.x, P.pylon.z)
    expect(pylon).toBeGreaterThan(3)
    expect(pylon).toBeLessThan(10)
    const [cx, cz] = P.columns[0]
    const column = rightOf(EAST_PASSAGE_STAND, EAST_PASSAGE_FACE, cx, cz)
    expect(column).toBeGreaterThan(20)
    expect(column).toBeLessThan(28)
    const mark = rightOf(EAST_PASSAGE_STAND, EAST_PASSAGE_FACE, P.mark.x, P.mark.z)
    expect(mark).toBeGreaterThan(column)
    expect(mark).toBeLessThan(36)
    // 印は立体（壁から通りへ突き出す）で、目の高さより上
    expect(P.mark.y0).toBeGreaterThan(2.4)
    expect(world.insideBuilding(P.pylon.x, P.pylon.z)).toBe(false)
  })
})
