import { describe, expect, it } from 'vitest'
import { ART, FACE_DECOS, facePanels, pickEdge, WEST_SITE } from '../mapFacade'
import { blockStyleOf, boardSpecsOf, isHiddenBuilding } from '../map'
import { pointInPolygon } from '../math'
import { sightTo } from '../mapSkyline'
import type { MapBuilding } from '../types'
import { world } from './helpers'

const square: MapBuilding = { id: 1, h: 20, y: 0, pts: [0, 0, 10, 0, 10, 10, 0, 10] } as MapBuilding
const byId = new Map(world.map.buildings.map((b) => [b.id, b]))

describe('壁面いっぱいの看板と大型ビジョンの置き場所', () => {
  it('指した点にいちばん近い辺を選び、外から見て左を a・右を b にする', () => {
    // 南（z が大きい側）の辺。南から北を向いて見ると、左は西
    const e = pickEdge(square.pts, [5, 14])
    expect(e).not.toBeNull()
    if (!e) return
    expect([e.ax, e.az, e.bx, e.bz]).toEqual([0, 10, 10, 10])
    expect([e.nx, e.nz]).toEqual([0, 1])
    // 北の辺。北から南を向いて見ると、左は東
    const n = pickEdge(square.pts, [5, -4])
    expect(n && [n.ax, n.az, n.bx, n.bz]).toEqual([10, 0, 0, 0])
  })

  it('辺の中の割合と高さから、面の四隅が決まる', () => {
    const panels = facePanels(square, [{ near: [5, 14], panels: [{ t0: 0.2, t1: 0.7, y0: 6, y1: 12, kind: 'board', ref: 3 }] }])
    expect(panels).toHaveLength(1)
    const p = panels[0]
    expect(p.ax).toBeCloseTo(2)
    expect(p.bx).toBeCloseTo(7)
    expect(p.az).toBeCloseTo(10)
    expect([p.y0, p.y1, p.kind, p.ref]).toEqual([6, 12, 'board', 3])
  })

  it('表に載せた建物は地図にあり、面は建物の外を向き、屋上より 3m 以上は飛び出さない', () => {
    for (const [id, decos] of Object.entries(FACE_DECOS)) {
      const b = byId.get(Number(id))
      expect(b, id).toBeDefined()
      if (!b) continue
      const panels = facePanels(b, decos)
      expect(panels.length, id).toBeGreaterThan(0)
      for (const p of panels) {
        const mx = (p.ax + p.bx) / 2 + p.nx * 1.5
        const mz = (p.az + p.bz) / 2 + p.nz * 1.5
        expect(world.insideBuilding(mx, mz), `${id} の面の前が建物の中`).toBe(false)
        expect(p.y1, id).toBeLessThanOrEqual(b.h + 3)
        expect(p.y1).toBeGreaterThan(p.y0)
      }
    }
  })

  it('109 の向かい（道玄坂の南）は、東から白い棟（高い）・黒い棟・赤い大看板の棟（低い）で、低い 2 棟の真後ろを背後のホテル棟の壁が塞ぐ', () => {
    const white = byId.get(116710254)
    const black = byId.get(136587748)
    const red = byId.get(136587824)
    const hotel = byId.get(521569271)
    expect(white && black && red && hotel).toBeTruthy()
    if (!white || !black || !red || !hotel) return
    expect(white.h).toBeGreaterThan(black.h + 12)
    expect(black.h).toBeGreaterThan(red.h + 3)
    expect(blockStyleOf(white)?.color).toBeGreaterThan(0xe0e0e0)
    expect(blockStyleOf(black)?.facade).toBe('blank')
    // 写真の立ち位置 2 つ（109_10: 分岐の先端の真北の横断歩道、109_13: 文化村通りの北の歩道の奥）から。
    // ホテル棟の西の端は赤い大看板の棟の方角の中に来て、頂部は赤い大看板の棟より 15 度以上高く見える
    const bearingOf = (ox: number, oz: number, x: number, z: number) => ((Math.atan2(x - ox, -(z - oz)) * 180) / Math.PI + 360) % 360
    const span = (b: { pts: number[] }, ox: number, oz: number) => {
      const bs = Array.from({ length: b.pts.length / 2 }, (_, i) => bearingOf(ox, oz, b.pts[i * 2], b.pts[i * 2 + 1]))
      return [Math.min(...bs), Math.max(...bs)]
    }
    for (const [ox, oz] of [
      [-122, -20],
      [-128, -30.5],
    ]) {
      const [, hotelWest] = span(hotel, ox, oz)
      const [redEast, redWest] = span(red, ox, oz)
      const [, whiteWest] = span(white, ox, oz)
      expect(hotelWest).toBeGreaterThan(redEast + 4)
      expect(hotelWest).toBeLessThan(redWest + 6)
      // 白い棟の西の端より右に、ホテル棟が 10 度以上はみ出して見える
      expect(hotelWest - whiteWest).toBeGreaterThan(10)
      const top = sightTo(hotel, ox, oz, 1.6)
      expect(top.elevation - sightTo(red, ox, oz, 1.6).elevation).toBeGreaterThan(15)
      expect(top.elevation - sightTo(black, ox, oz, 1.6).elevation).toBeGreaterThan(8)
    }
  })

  it('109 の向かいの赤い大看板は、黒い棟の右隣の低い棟の北の面いっぱいに 1 枚（109_10 の画面の右 3 分の 1）。白い棟の北の面は 2 段 2 列の広告', () => {
    const red = byId.get(136587824)
    const white = byId.get(116710254)
    expect(red && white).toBeTruthy()
    if (!red || !white) return
    const reds = facePanels(red).filter((p) => p.kind === 'board' && p.ref === ART.bigRed && p.nz < -0.8)
    expect(reds.length).toBe(1)
    expect(reds[0].len).toBeGreaterThan(12)
    expect(reds[0].y1).toBeLessThanOrEqual(red.h + 0.5)
    // ほかの棟に同じ赤い大看板を繰り返さない（正面の 1 枚が決め手）
    for (const id of [136587721, 136587834, 136587748]) {
      const b = byId.get(id)
      if (b) expect(facePanels(b).filter((p) => p.ref === ART.bigRed && p.kind === 'board').length, String(id)).toBe(0)
    }
    const ads = facePanels(white).filter((p) => p.kind === 'board' && p.nz < -0.8 && p.y0 > 9 && p.ref !== ART.redCrown)
    expect(ads.length).toBe(4)
    // 屋上の赤い字の看板（北の面の上に 1 枚、西へ向けて屋上にもう 1 枚）
    const crown = facePanels(white).filter((p) => p.kind === 'board' && p.ref === ART.redCrown)
    expect(crown.length).toBe(1)
    expect(crown[0].y0).toBeGreaterThan(white.h - 1)
    expect(boardSpecsOf(white).some((s) => s.art === ART.redCrown && s.toward[0] < -120)).toBe(true)
  })

  it('赤い大看板の背後の棟は、低い基壇の奥に小窓の高い棟が立ち、黒い棟の真上には掛からない', () => {
    const cine = byId.get(136587834)
    // 赤い大看板の棟（黒い棟の西隣）
    const black = byId.get(136587824)
    expect(cine && black).toBeTruthy()
    if (!cine || !black) return
    const tower = blockStyleOf(cine)?.tower
    expect(tower).toBeDefined()
    if (!tower) return
    expect(tower.podium).toBeLessThan(cine.h - 20)
    const bearing = (x: number, z: number) => (Math.atan2(-116 - x, z + 21) * 180) / Math.PI
    // 黒い棟の西の角より右（西）に、高い部分の全部が見える
    const blackWest = Math.max(...Array.from({ length: black.pts.length / 2 }, (_, i) => bearing(black.pts[i * 2], black.pts[i * 2 + 1])))
    for (let i = 0; i < tower.pts.length; i += 2) {
      expect(pointInPolygon(cine.pts, tower.pts[i], tower.pts[i + 1])).toBe(true)
      expect(bearing(tower.pts[i], tower.pts[i + 1])).toBeGreaterThan(blackWest + 3)
    }
  })

  it('広場の解体現場は地図の建物で（中へ歩いて入れない）、歩道と車道を塞がず、看板役の対象にならない', () => {
    const site = byId.get(WEST_SITE.building)
    expect(site).toBeDefined()
    if (!site) return
    expect(world.insideBuilding(36, 88)).toBe(true)
    expect(site.part).toBe(1)
    expect(isHiddenBuilding(site)).toBe(true)
    // 写真の立ち位置（広場の南寄り）から、北の面まで 25m 以上引ける
    expect(world.segmentClear(9, 48, 9 + Math.sin((150 * Math.PI) / 180) * 25, 48 - Math.cos((150 * Math.PI) / 180) * 25)).toBeGreaterThanOrEqual(1)
    // 輪郭の中を通る道が無い
    for (const r of world.map.roads) {
      if (r.bridge || r.tunnel) continue
      for (let i = 0; i < r.pts.length; i += 2) expect(pointInPolygon(site.pts, r.pts[i], r.pts[i + 1]), `道 ${r.id}`).toBe(false)
    }
    // 仮囲いと広告面を載せる辺が見つかる
    for (const near of WEST_SITE.hoardingNear) expect(pickEdge(site.pts, near)).not.toBeNull()
  })
})
