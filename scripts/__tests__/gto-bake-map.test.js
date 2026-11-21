import { describe, expect, it } from 'vitest'
import { BAKE_AREAS, CORNER_CUTS, ORIGIN, ROAD_WIDTH_MIN, STREET_WALL_CAP, STREET_WALL_MIN, bake, cutCorners, parseArgs, projectionOf, raiseStreetWalls, simplify, toLatLon, toLocal } from '../gto-bake-map.mjs'

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

describe('gto-bake-map エリア（渋谷・新宿）', () => {
  const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) })
  const S = BAKE_AREAS.shinjuku
  const O = S.origin
  const square = (id0, lat, lon, d = 0.0002) => [node(id0, lat, lon), node(id0 + 1, lat, lon + d), node(id0 + 2, lat + d, lon + d), node(id0 + 3, lat + d, lon)]
  const ring = (id0) => [id0, id0 + 1, id0 + 2, id0 + 3, id0]

  it('引数の --area でエリアを選ぶ（省くと渋谷）。残りの引数はそのまま', () => {
    expect(parseArgs(['a.json', 'dem'])).toEqual({ areaId: 'shibuya', rest: ['a.json', 'dem'] })
    expect(parseArgs(['--area', 'shinjuku', 'a.json', 'dem', 'out.json'])).toEqual({ areaId: 'shinjuku', rest: ['a.json', 'dem', 'out.json'] })
    expect(parseArgs(['a.json', '--area=shinjuku', 'dem'])).toEqual({ areaId: 'shinjuku', rest: ['a.json', 'dem'] })
  })

  it('エリアごとに、原点・範囲・出力先が違う。新宿は渋谷と同じ広さ', () => {
    expect(Object.keys(BAKE_AREAS)).toEqual(['shibuya', 'shinjuku'])
    expect(BAKE_AREAS.shibuya.origin).toBe(ORIGIN)
    expect(BAKE_AREAS.shibuya.out).toBe('shibuyaMap.json')
    expect(S.out).toBe('shinjukuMap.json')
    const size = (a) => [a.bbox.north - a.bbox.south, a.bbox.east - a.bbox.west]
    expect(size(S)[0]).toBeCloseTo(size(BAKE_AREAS.shibuya)[0], 6)
    expect(size(S)[1]).toBeCloseTo(size(BAKE_AREAS.shibuya)[1], 6)
    // 原点は範囲の中
    expect(O.lat).toBeGreaterThan(S.bbox.south)
    expect(O.lat).toBeLessThan(S.bbox.north)
    expect(O.lon).toBeGreaterThan(S.bbox.west)
    expect(O.lon).toBeLessThan(S.bbox.east)
  })

  it('座標の変換は、エリアの原点が (0,0) になる。渋谷の変換は、これまでの書き出しと同じ', () => {
    const p = projectionOf(O)
    expect(p.toLocal(O.lat, O.lon)).toEqual([0, -0])
    const [lat, lon] = p.toLatLon(...p.toLocal(35.6931, 139.7034))
    expect(lat).toBeCloseTo(35.6931, 9)
    expect(lon).toBeCloseTo(139.7034, 9)
    expect(projectionOf(ORIGIN).toLocal(35.6581, 139.7017)).toEqual(toLocal(35.6581, 139.7017))
  })

  it('エリアを省いた bake は渋谷（題名・原点・スポット）。新宿を渡すと新宿の題名・原点・スポットになる', () => {
    const shibuya = bake({ elements: [node(1, ORIGIN.lat, ORIGIN.lon), node(2, ORIGIN.lat, ORIGIN.lon + 0.001), { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'tertiary', name: '道玄坂' } }] }, () => 15)
    expect(shibuya.meta.title).toMatch(/Shibuya/)
    expect(shibuya.meta.origin).toMatchObject({ lat: ORIGIN.lat, lon: ORIGIN.lon })
    expect(shibuya.spots[0]).toMatchObject({ key: 'scramble', x: 0, z: 0 })
    const shinjuku = bake({ elements: [node(1, O.lat, O.lon), node(2, O.lat, O.lon + 0.001), { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'secondary', name: '新宿通り' } }] }, () => 36, S)
    expect(shinjuku.meta.title).toMatch(/Shinjuku/)
    expect(shinjuku.meta.origin).toMatchObject({ lat: O.lat, lon: O.lon, elevation: 36 })
    expect(shinjuku.spots[0]).toMatchObject({ key: 'east-exit', x: 0, z: 0 })
    expect(shinjuku.spots.map((s) => s.key)).toContain('shinjuku-dori-bottom')
    expect(shinjuku.roads[0].pts.slice(0, 2)).toEqual([0, -0])
    // 渋谷のスポットは新宿には無い
    expect(shinjuku.spots.some((s) => s.key === 'scramble')).toBe(false)
  })

  it('新宿: 道の名前は通りの名前だけを残す（出入口・施設の名前は落とし、; の注記は前の部分だけ）', () => {
    const way = (id, name, highway = 'footway') => ({ type: 'way', id, nodes: [1, 2], tags: { highway, name, 'name:en': 'X' } })
    const map = bake(
      {
        elements: [
          node(1, O.lat, O.lon),
          node(2, O.lat, O.lon + 0.001),
          way(10, '新宿通り;新宿三丁目', 'tertiary'),
          way(11, '東急歌舞伎町タワー;1階出入口'),
          way(12, '新宿ターミナル;A8出入口'),
          way(13, 'ルミネ新宿'),
          way(14, '花道通り', 'unclassified'),
          way(15, '芝新宿王子線(連絡路)', 'primary_link'),
          way(16, 'メンズ館連絡通路', 'pedestrian'),
        ],
      },
      () => 36,
      S,
    )
    const names = Object.fromEntries(map.roads.map((r) => [r.id, r.name ?? null]))
    expect(names).toEqual({ 10: '新宿通り', 11: null, 12: null, 13: null, 14: '花道通り', 15: '芝新宿王子線(連絡路)', 16: null })
    // 名前を落とした道には、英語の名前も付けない
    expect(map.roads.find((r) => r.id === 11).nameEn).toBeUndefined()
    expect(map.roads.find((r) => r.id === 14).nameEn).toBe('X')
  })

  it('新宿: 駅の構内の通路とホーム、高架の構内道路は地表に出さない', () => {
    const way = (id, tags) => ({ type: 'way', id, nodes: [1, 2], tags })
    const map = bake(
      {
        elements: [
          node(1, O.lat, O.lon),
          node(2, O.lat, O.lon + 0.001),
          way(10, { highway: 'footway', name: 'JR新宿駅;1階;16番線' }),
          way(11, { highway: 'footway', name: '小田急 新宿駅;1階;6番ホーム' }),
          way(12, { highway: 'service', bridge: 'yes', layer: '3' }),
          way(13, { highway: 'footway', name: '四季の路' }),
          way(14, { highway: 'service' }),
          // 「駅前通り」は通りの名前（駅の構内ではない）が、車道なので残る
          way(15, { highway: 'unclassified', name: '西武新宿駅前通り' }),
        ],
      },
      () => 36,
      S,
    )
    expect(map.roads.map((r) => r.id).sort()).toEqual([13, 14, 15])
    expect(map.roads.find((r) => r.id === 15).name).toBe('西武新宿駅前通り')
  })

  it('新宿: 線路をまたぐ陸橋は、車で渡れる低い橋（床 6m 以下）として焼く。歩道橋はそのまま', () => {
    const way = (id, tags) => ({ type: 'way', id, nodes: [1, 2], tags })
    const map = bake(
      { elements: [node(1, O.lat, O.lon), node(2, O.lat, O.lon + 0.001), way(10, { highway: 'trunk', name: '甲州街道', bridge: 'yes', layer: '2' }), way(11, { highway: 'footway', bridge: 'yes', layer: '1' })] },
      () => 36,
      S,
    )
    expect(map.roads.find((r) => r.id === 10)).toMatchObject({ bridge: 1, deck: 6, drive: 1 })
    expect(map.roads.find((r) => r.id === 11)).toMatchObject({ bridge: 1, deck: 5.5 })
    // 渋谷の決まりでは、同じ道が layer ぶん高い床になる（これまでどおり）
    const shibuya = bake({ elements: [node(1, ORIGIN.lat, ORIGIN.lon), node(2, ORIGIN.lat, ORIGIN.lon + 0.001), way(10, { highway: 'trunk', bridge: 'yes', layer: '2' })] }, () => 15)
    expect(shibuya.roads[0].deck).toBe(12)
  })

  it('新宿: 地下街（location=underground・layer が負）は建物として建てない', () => {
    const map = bake(
      {
        elements: [
          ...square(1, O.lat, O.lon),
          ...square(11, O.lat + 0.001, O.lon),
          ...square(21, O.lat - 0.001, O.lon),
          { type: 'way', id: 100, nodes: ring(1), tags: { building: 'yes', location: 'underground', layer: '-2' } },
          { type: 'way', id: 101, nodes: ring(11), tags: { building: 'yes', layer: '-1' } },
          { type: 'way', id: 102, nodes: ring(21), tags: { building: 'yes', 'building:levels': '5' } },
        ],
      },
      () => 36,
      S,
    )
    expect(map.buildings.map((b) => b.id)).toEqual([102])
  })

  it('新宿: 通り沿いの低い棟は、新宿の通りの下限まで上げる（渋谷の通りの表は使わない）', () => {
    expect(S.streetWallMin['靖国通り']).toBeGreaterThan(20)
    expect(S.streetWallMin['道玄坂']).toBeUndefined()
    const road = { name: '靖国通り', kind: 'primary', width: 12.8, drive: 1, pts: [0, 0, 100, 0] }
    const low = { id: 1, h: 9, est: 1, y: 0, pts: [20, 9, 30, 9, 30, 19, 20, 19] }
    expect(raiseStreetWalls([low], [road])[0]).toEqual(low)
    const raised = raiseStreetWalls([low], [road], new Set(), S.streetWallMin)[0]
    expect(raised.h).toBeGreaterThanOrEqual(Math.min(STREET_WALL_CAP, S.streetWallMin['靖国通り']))
    expect(raised.h).toBeLessThanOrEqual(STREET_WALL_CAP)
  })
})
