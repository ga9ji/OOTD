import { describe, expect, it } from 'vitest'
import { CORNER_CUTS, ORIGIN, ROAD_WIDTH_MIN, STREET_WALL_CAP, STREET_WALL_MIN, bake, cutCorners, raiseStreetWalls, simplify, toLatLon, toLocal } from '../gto-bake-map.mjs'

describe('gto-bake-map 座標変換', () => {
  it('原点（スクランブル交差点）は (0,0) になる', () => {
    expect(toLocal(ORIGIN.lat, ORIGIN.lon)).toEqual([0, -0])
  })

  it('東が +x、南が +z', () => {
    const [x, z] = toLocal(ORIGIN.lat - 0.001, ORIGIN.lon + 0.001)
    expect(x).toBeGreaterThan(85)
    expect(x).toBeLessThan(95)
    expect(z).toBeGreaterThan(105)
    expect(z).toBeLessThan(115)
  })

  it('toLatLon は toLocal の逆変換', () => {
    const [lat, lon] = toLatLon(...toLocal(35.6581, 139.7017))
    expect(lat).toBeCloseTo(35.6581, 9)
    expect(lon).toBeCloseTo(139.7017, 9)
  })
})

describe('gto-bake-map simplify', () => {
  it('直線上の点を間引く', () => {
    expect(simplify([[0, 0], [5, 0.1], [10, 0]], 0.5)).toEqual([[0, 0], [10, 0]])
  })

  it('角は残す', () => {
    expect(simplify([[0, 0], [10, 0], [10, 10]], 0.5)).toHaveLength(3)
  })

  it('交差点として指定した点は直線上でも残す', () => {
    expect(simplify([[0, 0], [5, 0], [10, 0]], 0.5, [false, true, false])).toHaveLength(3)
  })
})

describe('gto-bake-map bake', () => {
  const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) })
  const osm = {
    elements: [
      node(1, ORIGIN.lat, ORIGIN.lon, { highway: 'crossing', crossing: 'traffic_signals' }),
      node(2, ORIGIN.lat, ORIGIN.lon + 0.001),
      node(3, ORIGIN.lat + 0.0002, ORIGIN.lon),
      node(4, ORIGIN.lat + 0.0002, ORIGIN.lon + 0.0002),
      node(5, ORIGIN.lat + 0.0004, ORIGIN.lon + 0.0002),
      node(6, ORIGIN.lat + 0.0004, ORIGIN.lon),
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'tertiary', name: '道玄坂', lanes: '2' } },
      { type: 'way', id: 11, nodes: [3, 4, 5, 6, 3], tags: { building: 'yes', 'building:levels': '10' } },
      { type: 'way', id: 12, nodes: [1, 2], tags: { railway: 'rail', bridge: 'yes', layer: '1', name: '山手線' } },
      // `>; out skel;` が返すタグ無しの重複ノード
      node(1, ORIGIN.lat, ORIGIN.lon),
    ],
  }
  const map = bake(osm, (lat) => 15 + (lat - ORIGIN.lat) * 10000)

  it('道路は実名・幅・ローカル座標の折れ線になる', () => {
    expect(map.roads).toHaveLength(1)
    expect(map.roads[0]).toMatchObject({ kind: 'tertiary', name: '道玄坂', lanes: 2, drive: 1 })
    expect(map.roads[0].pts.slice(0, 2)).toEqual([0, -0])
    expect(map.roads[0].pts[2]).toBeCloseTo(90.5, 0)
  })

  it('現地写真で車道が広いと分かっている通りは、車線数からの幅より広げる', () => {
    // 道玄坂は OSM では 2 車線（6.2m）だが、実際は停車帯を含めて 11m ある
    expect(map.roads[0].width).toBe(ROAD_WIDTH_MIN['道玄坂'])
    expect(ROAD_WIDTH_MIN['道玄坂']).toBeGreaterThan(2 * 3.1)
  })

  it('階数だけの建物は高さを推定して est を立てる', () => {
    expect(map.buildings).toHaveLength(1)
    expect(map.buildings[0]).toMatchObject({ h: 33.5, est: 1 })
    expect(map.buildings[0].y).toBeGreaterThan(0) // 北は標高が高い（テスト用の斜面）
  })

  it('高架の線路は地表より上に線路面を持つ', () => {
    expect(map.rails[0]).toMatchObject({ line: 'jr', elevated: 1 })
    expect(map.rails[0].y[0]).toBe(7)
  })

  it('タグ付きノードは重複で消えない（横断歩道が残る）', () => {
    expect(map.crossings).toEqual([[0, -0, 1, 0]])
  })

  it('標高グリッドは原点が 0', () => {
    const e = map.elevation
    const i = Math.round((0 - e.z0) / e.step) * e.cols + Math.round((0 - e.x0) / e.step)
    expect(e.data[i]).toBe(0)
    expect(e.data).toHaveLength(e.cols * e.rows)
  })
})

describe('gto-bake-map raiseStreetWalls（通り沿いの壁の高さ）', () => {
  const road = { name: '道玄坂', kind: 'tertiary', width: 11, drive: 1, pts: [0, 0, 100, 0] }
  const square = (x, z, size = 10) => [x, z, x + size, z, x + size, z + size, x, z + size]
  const low = { id: 1, h: 9, est: 1, y: 0, pts: square(20, 9) }
  const far = { id: 2, h: 9, est: 1, y: 0, pts: square(20, 60) }
  const tall = { id: 3, h: 40, y: 0, pts: square(40, 9) }
  const kiosk = { id: 4, h: 4, y: 0, pts: square(60, 7, 3) }
  const measured = { id: 5, h: 9, y: 0, pts: square(70, 9) }
  const out = raiseStreetWalls([low, far, tall, kiosk, measured], [road])

  it('通りに面した低い建物は、通りごとの下限まで上げて est を立てる', () => {
    const floor = Math.min(STREET_WALL_CAP, STREET_WALL_MIN['道玄坂'])
    expect(out[0].h).toBeGreaterThanOrEqual(floor)
    expect(out[0].h).toBeLessThanOrEqual(STREET_WALL_CAP)
    expect(out[0].est).toBe(1)
    expect(out[4].h).toBeGreaterThanOrEqual(floor)
    expect(out[4].est).toBe(1)
  })

  it('通りから離れた建物、もう高い建物、小さな箱（出入口）は変えない', () => {
    expect(out[1]).toEqual(far)
    expect(out[2]).toEqual(tall)
    expect(out[3]).toEqual(kiosk)
  })

  it('同じ入力なら同じ高さ（乱数を使わない）', () => {
    expect(raiseStreetWalls([low], [road])[0].h).toBe(out[0].h)
  })

  it('屋根だけ・浮いた部品・駅舎は変えない', () => {
    const roof = { ...low, id: 6, roof: 1 }
    const floating = { ...low, id: 7, minH: 5 }
    const station = { ...low, id: 8, use: 'train_station' }
    expect(raiseStreetWalls([roof, floating, station], [road])).toEqual([roof, floating, station])
  })
})

describe('gto-bake-map cutCorners（写真で確かめた隅切り）', () => {
  it('表にある建物の、指定した点にいちばん近い角を 1 つ落とす。ほかの建物は触らない', () => {
    const cut = CORNER_CUTS[0]
    const pts = [cut.near[0] - 14, cut.near[1] - 6, cut.near[0], cut.near[1], cut.near[0] + 1.3, cut.near[1] + 4, cut.near[0] - 16, cut.near[1] + 4]
    const [a, b] = cutCorners([
      { id: cut.id, pts },
      { id: 1, pts },
    ])
    expect(a.pts).toEqual([pts[0], pts[1], pts[4], pts[5], pts[6], pts[7]])
    expect(b.pts).toEqual(pts)
  })

  it('落とす角が近くに無い（すでに落とした）輪郭と、三角形はそのまま返す', () => {
    const cut = CORNER_CUTS[0]
    const far = [0, 0, 10, 0, 10, 10, 0, 10]
    expect(cutCorners([{ id: cut.id, pts: far }])[0].pts).toEqual(far)
    const tri = [cut.near[0], cut.near[1], cut.near[0] + 5, cut.near[1], cut.near[0], cut.near[1] + 5]
    expect(cutCorners([{ id: cut.id, pts: tri }])[0].pts).toEqual(tri)
  })
})
