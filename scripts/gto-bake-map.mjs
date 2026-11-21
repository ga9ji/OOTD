#!/usr/bin/env node
// Grand Theft Outfit: 街（渋谷駅周辺・新宿駅東口）の地図を OpenStreetMap + 国土地理院 標高タイルから
// ゲーム用 JSON（src/lib/gto/data/<エリア>Map.json）に焼き込む。
//
//   node scripts/gto-bake-map.mjs [--area shibuya|shinjuku] <overpass.json> <demタイルのディレクトリ> [出力.json]
//
// - --area        : 焼くエリア（省くと shibuya）。原点・範囲・補正表・出力先はエリアごとに BAKE_AREAS が持つ。
// - overpass.json : Overpass API の out:json（way + 参照ノード）。
// - dem ディレクトリ: 国土地理院 標高タイル dem5a の z15 テキスト
//   （ファイル名 dem5a-15-<x>-<y>.txt。256x256 の CSV、欠測は "e"）。
// 生データはリポジトリに入れない。出力 JSON だけをコミットする。
//
// 座標系: エリアごとの原点（渋谷はスクランブル交差点中心 = OSM node 291758776、
//   新宿は東口の交差点「新宿駅東口」= OSM node 472382995）からのローカル座標。
//   x = 東が +（m）、z = 南が +（m。北は -z）、y = 原点地表からの標高差（m、上が +）。
// 地図データ © OpenStreetMap contributors (ODbL)。標高は国土地理院 基盤地図情報 数値標高モデル。

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORNER_CUTS, DROP_BUILDINGS, EXTRA_BUILDINGS, HEIGHT_OVERRIDES, HEIGHT_OVERRIDES_BY_NAME, SHINJUKU_TABLES } from './lib/gto-bake-tables.mjs'

export { CORNER_CUTS, DROP_BUILDINGS, EXTRA_BUILDINGS, HEIGHT_OVERRIDES, HEIGHT_OVERRIDES_BY_NAME }

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '../src/lib/gto/data')

// ---- 範囲と原点 -------------------------------------------------------------
export const ORIGIN = { lat: 35.6594821, lon: 139.7005723 } // スクランブル交差点中心
export const BBOX = { south: 35.655, north: 35.663, west: 139.696, east: 139.7065 }
const CLIP_MARGIN = 40 // m。範囲の外へこれ以上はみ出す線は切る
const DEM_ZOOM = 15
const GRID_STEP = 10 // m
const SIZE_LIMIT = 500 * 1024

// 緯度1度・経度1度あたりの長さ（WGS84 の級数近似）。原点の緯度で固定する。
const rad = (d) => (d * Math.PI) / 180
/** 原点を決めたときの、緯度経度とローカル座標の行き来 */
export const projectionOf = (origin) => {
  const phi = rad(origin.lat)
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi)
  const mPerDegLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi)
  return {
    mPerDegLat,
    mPerDegLon,
    toLocal: (lat, lon) => [(lon - origin.lon) * mPerDegLon, -(lat - origin.lat) * mPerDegLat],
    toLatLon: (x, z) => [origin.lat - z / mPerDegLat, origin.lon + x / mPerDegLon],
  }
}
// 渋谷の変換（これまでの書き出し名。テストと道具が使う）
const SHIBUYA_PROJECTION = projectionOf(ORIGIN)
export const M_PER_DEG_LAT = SHIBUYA_PROJECTION.mPerDegLat
export const M_PER_DEG_LON = SHIBUYA_PROJECTION.mPerDegLon
export const toLocal = SHIBUYA_PROJECTION.toLocal
export const toLatLon = SHIBUYA_PROJECTION.toLatLon

const r1 = (v) => Math.round(v * 10) / 10
const num = (s) => {
  if (s == null) return null
  const v = parseFloat(String(s).replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

// ---- 隅切り（表は lib/gto-bake-tables.mjs）-----------------------------------
/** 隅切りの表を建物の列に当てる。元の配列は書き換えない */
export function cutCorners(buildings, cuts = CORNER_CUTS) {
  return buildings.map((b) => {
    const cut = cuts.find((c) => c.id === b.id)
    if (!cut || b.pts.length <= 6) return b
    let best = -1
    let bestDist = 1
    for (let i = 0; i < b.pts.length; i += 2) {
      const d = Math.hypot(b.pts[i] - cut.near[0], b.pts[i + 1] - cut.near[1])
      if (d < bestDist) {
        best = i
        bestDist = d
      }
    }
    return best < 0 ? b : { ...b, pts: [...b.pts.slice(0, best), ...b.pts.slice(best + 2)] }
  })
}

// ---- 現地写真で確かめた車道の幅（m）-----------------------------------------
// OSM の車線数だけだと狭くなる通り。停車帯・ゼブラ帯を含めた車道の幅の下限を通り名で与える。
// 道玄坂: 片側 1 車線＋停車帯（dogenzaka_03, _09）。宮益坂: 4 車線相当（miyamasuzaka_01, _02）。公園通り: 2 車線＋停車帯（koen-dori_07）。
export const ROAD_WIDTH_MIN = { 道玄坂: 11, 宮益坂: 12.4, 公園通り: 9 }

// ---- 通り沿いの壁の高さ（m）---------------------------------------------------
// 現地写真では、主な通りの両側は 6〜10 階建てが切れ目なく並ぶ（109_09 / dogenzaka_03 / miyamasuzaka_13 / center-gai_11）。
// OSM に高さが無く 2〜4 階ぶんに推定された棟が混じると、谷間に穴が開いて通りの見え方が変わるので、
// 通りに面した低い棟をこの下限（＋棟ごとに 0〜8m）まで上げる。
export const STREET_WALL_MIN = {
  道玄坂: 27,
  文化村通り: 27,
  井ノ頭通り: 24,
  神宮通り: 25,
  明治通り: 27,
  宮益坂: 27,
  公園通り: 24,
  青山通り: 27,
  渋谷センター街: 18,
  旧大山街道: 27,
}
/**
 * 上げた棟の高さの上限。看板役は 24m 以上の棟に大型の壁面広告を付けるので、これを越えて上げると駅前だけに
 * 広告が集まり、遠くの通りへ回らなくなる。描画側が街区を間口ごとに割って 1.32 倍まで伸ばすので、見た目は 7〜9 階の並びになる。
 */
export const STREET_WALL_CAP = 23.9
/** 通りの車道の縁から、この距離までに輪郭がかかる棟を「面している」とみなす */
const STREET_WALL_REACH = 14
/** これより狭い輪郭（地下鉄の出入口・交番・売店）は上げない */
const STREET_WALL_MIN_AREA = 45
/** 上げない用途（教会）と、建物ではない輪郭（西口の歩行者デッキ） */
const STREET_WALL_SKIP_USE = new Set(['train_station', 'roof', 'bridge', 'church'])
const STREET_WALL_SKIP_ID = new Set([1333409445])

const distToSegment = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

const flatArea = (pts) => {
  let a = 0
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    const j = (i + 1) % n
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]
  }
  return Math.abs(a / 2)
}

/** 通りに面した低い棟を、通りごとの下限まで上げる。入力は変えず、新しい配列を返す */
export function raiseStreetWalls(buildings, roads, keep = new Set(), wallMin = STREET_WALL_MIN) {
  const streets = roads
    .map((r) => ({ r, min: wallMin[(r.name ?? '').replace(/\(.*$/, '')] }))
    .filter((s) => s.min != null && !s.r.bridge && !s.r.tunnel)
  return buildings.map((b) => {
    if (keep.has(b.id) || b.hasParts || b.roof || b.part || b.minH || STREET_WALL_SKIP_USE.has(b.use) || STREET_WALL_SKIP_ID.has(b.id)) return b
    if (flatArea(b.pts) < STREET_WALL_MIN_AREA) return b
    let min = 0
    for (const { r, min: streetMin } of streets) {
      if (streetMin <= min || b.h >= Math.min(streetMin, STREET_WALL_CAP)) continue
      const reach = r.width / 2 + STREET_WALL_REACH
      let near = false
      for (let i = 0; i < b.pts.length && !near; i += 2) {
        // 輪郭の頂点と辺の中点で測る
        const j = (i + 2) % b.pts.length
        const samples = [b.pts[i], b.pts[i + 1], (b.pts[i] + b.pts[j]) / 2, (b.pts[i + 1] + b.pts[j + 1]) / 2]
        for (let k = 2; k < r.pts.length && !near; k += 2) {
          for (let s = 0; s < 4; s += 2) {
            if (distToSegment(samples[s], samples[s + 1], r.pts[k - 2], r.pts[k - 1], r.pts[k], r.pts[k + 1]) <= reach) near = true
          }
        }
      }
      if (near) min = streetMin
    }
    if (min === 0) return b
    // 棟ごとに 0〜8m のばらつき（id から決める）
    const jitter = ((b.id * 2654435761) >>> 0) / 4294967296
    const h = r1(Math.min(STREET_WALL_CAP, min + jitter * 8))
    return h > b.h ? { ...b, h, est: 1 } : b
  })
}

// ---- 道路の種別と幅 ---------------------------------------------------------
// width は車道（歩行者系は通路）の幅。OSM の width > lanes*車線幅 > 種別の既定値 の順に採る。
const ROAD_DEFAULTS = {
  motorway: { w: 8, lane: 3.5 },
  motorway_link: { w: 5, lane: 3.5 },
  trunk: { w: 10, lane: 3.3 },
  trunk_link: { w: 5, lane: 3.3 },
  primary: { w: 10, lane: 3.2 },
  primary_link: { w: 5, lane: 3.2 },
  secondary: { w: 9, lane: 3.2 },
  secondary_link: { w: 5, lane: 3.2 },
  tertiary: { w: 8, lane: 3.1 },
  tertiary_link: { w: 5, lane: 3.1 },
  unclassified: { w: 6, lane: 3 },
  residential: { w: 5, lane: 3 },
  service: { w: 4, lane: 3 },
  living_street: { w: 5, lane: 3 },
  pedestrian: { w: 7, lane: 3 },
  footway: { w: 3, lane: 3 },
  path: { w: 2, lane: 3 },
  steps: { w: 3, lane: 3 },
  cycleway: { w: 2, lane: 3 },
}
const DRIVABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary',
  'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service',
  'living_street',
])
// 高架の床の高さ（地表から、m）。OSM に実測値は無いので layer からの推定値。
const roadDeck = (kind, layer) => {
  if (kind === 'motorway' || kind === 'motorway_link') return 14 + Math.max(0, layer - 2) * 5
  if (DRIVABLE.has(kind)) return 6 * Math.max(1, layer)
  return 5.5 * Math.max(1, layer) // 歩道橋・デッキ
}

// 線路面の高さの推定（原点＝スクランブル交差点の地表からの差、m）。
// - 銀座線: 渋谷駅は地上 3 階。明治通りをまたいで宮益坂の丘へそのまま水平にトンネルで入る。
//   西側はマークシティ 3 階の車庫線。
// - 井の頭線: マークシティ 2 階のホームから、水平のまま道玄坂の丘のトンネルへ入る。
// - JR 山手線・埼京線: 駅のホームは地上 2 階相当。北は宮下公園の脇まで高架/盛土でほぼ水平、
//   南は新南口の先（z≈260）から地表へ下る。
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t))
const RAIL_PROFILES = [
  { line: 'ginza', test: (r) => r.kind === 'subway', y: () => 12.7 },
  { line: 'inokashira', test: (r, pts) => /井の頭/.test(r.name ?? '') || (!r.name && pts[0][0] < 0), y: () => 7.5 },
  { line: 'jr', test: () => true, y: (_x, z) => lerp(7, 2.4, (z - 260) / 260) },
]

// ---- 幾何 -------------------------------------------------------------------
const distSeg = (p, a, b) => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** Douglas-Peucker。keep[i] が true の点（交差点など）は必ず残す。 */
export const simplify = (pts, tol, keep = []) => {
  if (pts.length <= 2) return pts
  const anchors = pts.map((_, i) => i).filter((i) => i === 0 || i === pts.length - 1 || keep[i])
  const dp = (lo, hi) => {
    let worst = -1
    let worstD = tol
    for (let i = lo + 1; i < hi; i++) {
      const d = distSeg(pts[i], pts[lo], pts[hi])
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    return worst < 0 ? [] : [...dp(lo, worst), worst, ...dp(worst, hi)]
  }
  const idx = anchors.flatMap((a, k) => (k === 0 ? [a] : [...dp(anchors[k - 1], a), a]))
  return idx.map((i) => pts[i])
}

const ringArea = (ring) =>
  ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0) / 2

const centroid = (ring) => {
  const n = ring.length
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
}

const pointInRing = (p, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

/** 範囲外の区間を捨てて、範囲内に連続する折れ線の配列に分ける（端は境界で切る）。 */
const clipLine = (pts, keep, b) => {
  const inside = (p) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minZ && p[1] <= b.maxZ
  const cut = (a, c) => {
    // a=内側, c=外側。境界との交点を二分法で求める。
    let lo = a
    let hi = c
    for (let i = 0; i < 20; i++) {
      const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]
      if (inside(mid)) lo = mid
      else hi = mid
    }
    return lo
  }
  const out = []
  let cur = null
  pts.forEach((p, i) => {
    const pin = inside(p)
    const prev = i > 0 ? pts[i - 1] : null
    const prevIn = prev ? inside(prev) : false
    if (pin) {
      if (!cur) cur = { pts: prev && !prevIn ? [cut(p, prev)] : [], keep: prev && !prevIn ? [false] : [] }
      cur.pts.push(p)
      cur.keep.push(!!keep[i])
    } else if (cur) {
      cur.pts.push(cut(prev, p))
      cur.keep.push(false)
      out.push(cur)
      cur = null
    }
  })
  if (cur) out.push(cur)
  return out.filter((s) => s.pts.length >= 2)
}

const flat = (pts) => pts.flatMap((p) => [r1(p[0]), r1(p[1])])

// ---- 標高 -------------------------------------------------------------------
const loadDem = async (dir) => {
  const files = (await readdir(dir)).filter((f) => /^dem5a-15-\d+-\d+\.txt$/.test(f))
  if (files.length === 0) throw new Error(`標高タイル(dem5a-15-x-y.txt)が ${dir} に見つかりません`)
  const tiles = new Map()
  for (const f of files) {
    const [, x, y] = f.match(/^dem5a-15-(\d+)-(\d+)\.txt$/)
    const rows = (await readFile(join(dir, f), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.split(',').map((v) => (v === 'e' ? NaN : parseFloat(v))))
    if (rows.length !== 256 || rows.some((r) => r.length !== 256)) {
      throw new Error(`標高タイルの形が 256x256 ではありません: ${f}`)
    }
    tiles.set(`${x}/${y}`, rows)
  }
  const n = 2 ** DEM_ZOOM
  const px = (lat, lon) => {
    const s = Math.sin(rad(lat))
    return [((lon + 180) / 360) * n * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256]
  }
  const at = (ix, iy) => {
    const row = tiles.get(`${Math.floor(ix / 256)}/${Math.floor(iy / 256)}`)
    return row ? row[iy % 256][ix % 256] : NaN
  }
  /** 緯度経度の標高（m、東京湾平均海面）。双一次補間。タイル外・欠測は NaN。 */
  return (lat, lon) => {
    const [fx, fy] = px(lat, lon).map((v) => v - 0.5) // 画素中心基準
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const v = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]
    const ok = v.filter((e) => !Number.isNaN(e))
    if (ok.length === 0) return NaN
    const fill = ok.reduce((s, e) => s + e, 0) / ok.length
    const [a, b, c, d] = v.map((e) => (Number.isNaN(e) ? fill : e))
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
  }
}

// ---- 本体 -------------------------------------------------------------------
const stitchRings = (ways) => {
  // 多角形リレーションの outer way 群を端点でつないで閉じた輪にする。
  const rest = ways.map((w) => [...w])
  const rings = []
  while (rest.length > 0) {
    let ring = rest.shift()
    let grew = true
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i]
        const tail = ring[ring.length - 1]
        if (w[0] === tail) ring = [...ring, ...w.slice(1)]
        else if (w[w.length - 1] === tail) ring = [...ring, ...[...w].reverse().slice(1)]
        else continue
        rest.splice(i, 1)
        grew = true
        break
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring)
  }
  return rings
}

// 新宿の線路面の高さの推定（原点＝東口の交差点の地表からの差、m）。
// JR の線路は東口の地表とほぼ同じ高さを南北に水平に通り、北の大ガードでは靖国通りのほうが線路の下へ潜る。
// 西武新宿線も駅の手前まで同じ高さの盛土。地表より下には潜らせない（bake の共通の決まり）ので、ここは水平の 1 本だけ。
// line は描画の色分けに使う名前で、渋谷の JR と同じ 'jr' にそろえる（地下の路線は焼き込まない）。
const SHINJUKU_RAIL_PROFILES = [{ line: 'jr', test: () => true, y: () => 1.8 }]
/** 新宿で地表に出さない道: 駅の構内の通路とホーム（名前に駅・番線・ホームが入る歩道）、バスターミナルへ上がる高架の構内道路 */
const shinjukuDropRoad = (t, { foot, layer }) =>
  (foot && /駅|番線|ホーム|改札|のりかえ/.test(t.name ?? '')) || (t.highway === 'service' && !!t.bridge && layer >= 2)
/**
 * 新宿の道の名前のうち、画面に出してよい「通りの名前」だけを残す（出入口・施設・連絡通路の名前は、建物の実名を含むので落とす）。
 * 「新宿通り;新宿三丁目」のように ; で注記が付く物は、前の部分だけを見る。
 */
const SHINJUKU_STREET_NAME = /(通り|街道|坂|横丁|ロード|小路|番街|の路|の抜け道|線(\(連絡路\))?)$/
const shinjukuRoadName = (name) => {
  const first = (name ?? '').split(';')[0].trim()
  return SHINJUKU_STREET_NAME.test(first) ? first : null
}
/** 新宿で地表に建てない建物: 地下街（location=underground か layer が負。靖国通りの真下の地下街が、通りを塞ぐ箱になる） */
const shinjukuDropBuilding = (t) => t.location === 'underground' || (num(t.layer) ?? 0) < 0
/**
 * 新宿の高架の床の高さ。線路をまたぐ甲州街道の陸橋は、標高データがすでに橋の取り付けの坂を含んでいるので、
 * 「地上の道として扱う低い橋」（map.ts の GROUND_BRIDGE_DECK = 6 以下）に収めて、車で渡れる道にする。
 */
const shinjukuRoadDeck = (kind, layer) => (DRIVABLE.has(kind) && kind !== 'motorway' && kind !== 'motorway_link' ? Math.min(6, 6 * Math.max(1, layer)) : null)

// ---- エリア ------------------------------------------------------------------
// 原点・範囲・出力先・補正表・目印の場所を、エリアごとに持つ。bake() はここに書いた物だけを見る。
// spots は「原点の場所」を最初に置く（ゲームの出発地点や題名の画面のカメラが、ここからの相対で決まる）。
export const BAKE_AREAS = {
  shibuya: {
    id: 'shibuya',
    title: 'Shibuya station area (Grand Theft Outfit)',
    out: 'shibuyaMap.json',
    origin: ORIGIN,
    bbox: BBOX,
    roadWidthMin: ROAD_WIDTH_MIN,
    streetWallMin: STREET_WALL_MIN,
    railProfiles: RAIL_PROFILES,
    tables: { HEIGHT_OVERRIDES, HEIGHT_OVERRIDES_BY_NAME, EXTRA_BUILDINGS, DROP_BUILDINGS, CORNER_CUTS },
    spots: ({ roadEnds, nearestViaduct, spotOfBuilding }) => [
      { key: 'scramble', x: 0, z: 0, y: 0 },
      ...roadEnds('dogenzaka', /^道玄坂$/),
      ...roadEnds('center-gai', /渋谷センター街/),
      ...roadEnds('miyamasuzaka', /^宮益坂$/),
      ...roadEnds('koen-dori', /公園通り/),
      ...roadEnds('bunkamura-dori', /^文化村通り$/),
      ...nearestViaduct('viaduct-jr', /山手線/, 'jr'),
      ...nearestViaduct('viaduct-ginza', /銀座線/, 'ginza'),
      ...spotOfBuilding('tower-scramble-square', /スクランブルスクエア/),
      ...spotOfBuilding('tower-hikarie', /ヒカリエ/),
      ...spotOfBuilding('tower-stream', /^渋谷ストリーム$/),
      ...spotOfBuilding('tower-fukuras', /フクラス/),
      ...spotOfBuilding('tower-sakura-stage', /Sakura Stage SHIBUYA Tower/),
      ...spotOfBuilding('tower-cerulean', /セルリアンタワー/),
      ...spotOfBuilding('mark-city', /マークシティ イースト/),
      ...spotOfBuilding('bldg-109', /^Shibuya 109$/),
      ...spotOfBuilding('bldg-magnet', /MAGNET/),
      ...spotOfBuilding('bldg-parco', /Parco/i),
      ...spotOfBuilding('miyashita-park', /^MIYASHITA PARK$/),
    ],
  },
  // 新宿駅の東口・歌舞伎町・新宿三丁目（渋谷と同じ広さ）。原点は東口の交差点「新宿駅東口」（OSM node 472382995）
  shinjuku: {
    id: 'shinjuku',
    title: 'Shinjuku east side (Grand Theft Outfit)',
    out: 'shinjukuMap.json',
    origin: { lat: 35.6922507, lon: 139.7017709 },
    bbox: { south: 35.688, north: 35.696, west: 139.6975, east: 139.708 },
    roadWidthMin: SHINJUKU_TABLES.ROAD_WIDTH_MIN,
    streetWallMin: SHINJUKU_TABLES.STREET_WALL_MIN,
    railProfiles: SHINJUKU_RAIL_PROFILES,
    dropRoad: shinjukuDropRoad,
    roadName: shinjukuRoadName,
    dropBuilding: shinjukuDropBuilding,
    roadDeck: shinjukuRoadDeck,
    tables: SHINJUKU_TABLES,
    spots: ({ roadEnds, spotOfBuilding }) => [
      { key: 'east-exit', x: 0, z: 0, y: 0 },
      ...roadEnds('shinjuku-dori', /^新宿通り$/),
      ...roadEnds('yasukuni-dori', /^靖国通り$/),
      ...roadEnds('meiji-dori', /^明治通り$/),
      ...roadEnds('hanamichi-dori', /^花道通り$/),
      ...roadEnds('kuyakusho-dori', /^区役所通り$/),
      ...SHINJUKU_TABLES.SPOT_BUILDINGS.flatMap(([key, re]) => spotOfBuilding(key, re)),
    ],
  },
}

/**
 * Overpass の JSON と標高の関数から、ゲーム用の地図を作る。
 * area は BAKE_AREAS のどれか（省くと渋谷。これまでと同じ出力）。
 */
export const bake = (osm, elevationAt, area = BAKE_AREAS.shibuya) => {
  const ORIGIN = area.origin
  const BBOX = area.bbox
  const { toLocal, toLatLon, mPerDegLat: M_PER_DEG_LAT, mPerDegLon: M_PER_DEG_LON } = projectionOf(ORIGIN)
  const { HEIGHT_OVERRIDES, HEIGHT_OVERRIDES_BY_NAME, EXTRA_BUILDINGS, DROP_BUILDINGS, CORNER_CUTS } = area.tables
  const ROAD_WIDTH_MIN = area.roadWidthMin
  const RAIL_PROFILES = area.railProfiles
  const nodes = new Map()
  const ways = []
  const relations = []
  for (const e of osm.elements) {
    // `out body; >; out skel;` は同じノードをタグ付き・タグ無しの 2 回返す。タグ付きを残す。
    if (e.type === 'node') {
      if (!nodes.has(e.id) || e.tags) nodes.set(e.id, e)
    }
    else if (e.type === 'way') ways.push(e)
    else if (e.type === 'relation') relations.push(e)
  }
  const wayById = new Map(ways.map((w) => [w.id, w]))
  const local = (id) => {
    const n = nodes.get(id)
    return n ? toLocal(n.lat, n.lon) : null
  }
  const [minX, maxZ] = toLocal(BBOX.south, BBOX.west)
  const [maxX, minZ] = toLocal(BBOX.north, BBOX.east)
  const bounds = { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) }
  const clipB = {
    minX: minX - CLIP_MARGIN, maxX: maxX + CLIP_MARGIN, minZ: minZ - CLIP_MARGIN, maxZ: maxZ + CLIP_MARGIN,
  }

  const originElev = elevationAt(ORIGIN.lat, ORIGIN.lon)
  const groundY = (x, z) => {
    const [lat, lon] = toLatLon(x, z)
    return elevationAt(lat, lon) - originElev
  }

  // ---- 道路 ----
  const isSurfaceRoad = (w) => {
    const t = w.tags ?? {}
    if (!t.highway || !ROAD_DEFAULTS[t.highway]) return false
    if (t.area === 'yes') return false
    const layer = num(t.layer) ?? 0
    const level = num(t.level) ?? 0
    const foot = !DRIVABLE.has(t.highway)
    // 地下通路・駅構内・ビル内の通路は街の地表には出さない
    if (foot && (t.indoor || layer < 0 || level < 0 || t.tunnel === 'yes')) return false
    if (foot && level > 0 && !t.bridge) return false
    if (t.highway === 'service' && (layer < 0 || t.service === 'parking_aisle')) return false
    if (t.access === 'private' && foot) return false
    if (area.dropRoad?.(t, { foot, layer })) return false
    return true
  }
  const roadWays = ways.filter(isSurfaceRoad)
  // 2 本以上の道が共有するノード（交差点）は間引きで消さない
  const useCount = new Map()
  for (const w of roadWays) for (const id of new Set(w.nodes)) useCount.set(id, (useCount.get(id) ?? 0) + 1)

  const roads = roadWays.flatMap((w) => {
    const t = w.tags
    const kind = t.highway
    const def = ROAD_DEFAULTS[kind]
    const lanes = num(t.lanes)
    const layer = num(t.layer) ?? 0
    const bridge = !!t.bridge && t.bridge !== 'no'
    const tunnel = !!t.tunnel && t.tunnel !== 'no'
    const crossing = t.footway === 'crossing'
    const base = num(t.width) ?? (lanes ? lanes * def.lane : crossing ? 6 : def.w)
    const width = DRIVABLE.has(kind) && !t.bridge ? Math.max(base, ROAD_WIDTH_MIN[t.name] ?? 0) : base
    const ids = w.nodes.filter((id) => nodes.has(id))
    const pts = ids.map(local)
    const keep = ids.map((id) => (useCount.get(id) ?? 0) > 1)
    // 道の名前は画面（HUD の地名）に出る。エリアが決まりを持つときは、通りの名前だけを残す
    const name = area.roadName ? area.roadName(t.name) : t.name
    return clipLine(pts, keep, clipB).map((seg, i) => ({
      id: w.id,
      ...(i > 0 ? { seg: i } : {}),
      kind,
      ...(name ? { name } : {}),
      ...(name && t['name:en'] ? { nameEn: t['name:en'] } : {}),
      width: r1(width),
      ...(lanes ? { lanes } : {}),
      ...(DRIVABLE.has(kind) ? { drive: 1 } : {}),
      ...(t.oneway === 'yes' ? { oneway: 1 } : t.oneway === '-1' ? { oneway: -1 } : {}),
      ...(crossing ? { crossing: 1 } : {}),
      ...(t.footway === 'sidewalk' ? { sidewalk: 1 } : {}),
      ...(bridge ? { bridge: 1, deck: area.roadDeck?.(kind, layer) ?? roadDeck(kind, layer) } : {}),
      ...(tunnel ? { tunnel: 1 } : {}),
      ...(layer ? { layer } : {}),
      pts: flat(simplify(seg.pts, crossing ? 0.3 : 0.5, seg.keep)),
    }))
  })

  // ---- 線路 ----
  const RAIL_KINDS = new Set(['rail', 'subway', 'light_rail'])
  const rails = ways
    .filter((w) => w.tags && RAIL_KINDS.has(w.tags.railway))
    .flatMap((w) => {
      const t = w.tags
      const layer = num(t.layer) ?? 0
      const tunnel = (!!t.tunnel && t.tunnel !== 'no') || layer < 0
      const bridge = !!t.bridge && t.bridge !== 'no'
      const pts = w.nodes.filter((id) => nodes.has(id)).map(local)
      return clipLine(pts, [], clipB).map((seg, i) => ({
        id: w.id,
        ...(i > 0 ? { seg: i } : {}),
        kind: t.railway,
        ...(t.name ? { name: t.name } : {}),
        ...(bridge ? { bridge: 1 } : {}),
        ...(tunnel ? { tunnel: 1 } : {}),
        ...(layer ? { layer } : {}),
        _pts: simplify(seg.pts, 0.5),
      }))
    })
  // 線路面の高さ(y、原点地表からの差)。OSM に線路の標高は無いので、路線ごとの推定プロファイル
  // （RAIL_PROFILES）を使い、地表より下には潜らせない（切土・盛土の区間は地表 + 道床 0.6m）。
  const railsOut = rails
    .filter((r) => !r.tunnel)
    .map(({ _pts, ...r }) => {
      const profile = RAIL_PROFILES.find((p) => p.test(r, _pts)) ?? RAIL_PROFILES[RAIL_PROFILES.length - 1]
      const grounds = _pts.map((p) => groundY(p[0], p[1]))
      const ys = _pts.map((p, i) => Math.max(grounds[i] + 0.6, profile.y(p[0], p[1])))
      return {
        ...r,
        line: profile.line,
        elevated: ys.some((y, i) => y - grounds[i] > 3) ? 1 : 0,
        pts: flat(_pts),
        y: ys.map(r1),
      }
    })
  const tunnelsOut = rails.filter((r) => r.tunnel).map(({ _pts, ...r }) => ({ ...r, pts: flat(_pts) }))

  // ---- 建物 ----
  const ringOfWay = (w) => {
    const ids = w.nodes.filter((id) => nodes.has(id))
    if (ids.length < 4 || ids[0] !== ids[ids.length - 1]) return null
    return ids.slice(0, -1).map(local)
  }
  const isBuilding = (t) => t && ((t.building && t.building !== 'no') || t['building:part']) && !area.dropBuilding?.(t)
  const rawBuildings = [
    ...ways.filter((w) => isBuilding(w.tags)).map((w) => ({ id: w.id, tags: w.tags, ring: ringOfWay(w) })),
    ...relations
      .filter((r) => isBuilding(r.tags) && r.tags.type === 'multipolygon')
      .flatMap((r) => {
        const outers = r.members
          .filter((m) => m.type === 'way' && m.role !== 'inner' && wayById.has(m.ref))
          .map((m) => wayById.get(m.ref).nodes)
        return stitchRings(outers).map((ids, i) => ({
          id: r.id * 10 + i, // リレーション由来は id*10+輪番号 で区別する
          tags: r.tags,
          ring: ids.slice(0, -1).map(local).filter(Boolean),
        }))
      }),
  ].filter((b) => b.ring && b.ring.length >= 3)

  const LEVEL_H = 3.2
  const sized = rawBuildings
    .map((b) => {
      const t = b.tags
      const c = centroid(b.ring)
      const byName = HEIGHT_OVERRIDES_BY_NAME.find((o) => o.test.test(t.name ?? '') || o.test.test(t['name:en'] ?? ''))
      const ov = HEIGHT_OVERRIDES[b.id] ?? byName
      const levels = num(t['building:levels'])
      const minLevel = num(t['building:min_level'])
      const tagH = num(t.height)
      const h = ov?.h ?? tagH ?? (levels ? levels * LEVEL_H + 1.5 : null)
      const minH = ov?.minH ?? num(t.min_height) ?? (minLevel ? minLevel * LEVEL_H : 0)
      return {
        id: b.id,
        ring: b.ring,
        c,
        area: Math.abs(ringArea(b.ring)),
        part: !!t['building:part'],
        roof: t['building:part'] === 'roof' || t.building === 'roof',
        name: t.name ?? ov?.ref ?? null,
        use: t.building && t.building !== 'yes' ? t.building : null,
        levels,
        h,
        minH,
        // OSM の height タグも公開情報の補正もない物は推定扱い
        est: !(ov?.h != null || tagH != null),
        src: ov?.h != null ? 'override' : tagH != null ? 'height' : levels ? 'levels' : 'neighbors',
      }
    })
    .filter(
      (b) => b.c[0] >= clipB.minX && b.c[0] <= clipB.maxX && b.c[1] >= clipB.minZ && b.c[1] <= clipB.maxZ && b.area >= 6,
    )

  // 高さが分からない建物は、60m 以内の高さが分かる建物の中央値（無ければ 12m）
  const known = sized.filter((b) => b.h != null && !b.part)
  const neighborH = (b) => {
    const hs = known
      .filter((k) => Math.hypot(k.c[0] - b.c[0], k.c[1] - b.c[1]) < 60 && k.h < 60)
      .map((k) => k.h)
      .sort((a, c) => a - c)
    return hs.length ? hs[Math.floor(hs.length / 2)] : 12
  }
  const withH = sized.map((b) => (b.h == null ? { ...b, h: neighborH(b) } : b))

  // building:part を持つ建物: 部品側が実際の形。輪郭側は基壇（最も低い部品の高さ）に落とす。
  // 部品に height が無く輪郭に height があるときは、階数の比で輪郭の高さを割り当てる。
  const outlines = withH.filter((b) => !b.part)
  const parts = withH.filter((b) => b.part)
  const parentOf = new Map(
    parts.map((p) => {
      const inside = outlines.filter((o) => pointInRing(p.c, o.ring)).sort((a, b) => a.area - b.area)
      return [p.id, inside[0] ?? null]
    }),
  )
  const fixedParts = parts.map((p) => {
    const parent = parentOf.get(p.id)
    if (p.src !== 'levels' || !parent || parent.src === 'neighbors' || parent.src === 'levels') return p
    if (!parent.levels || !p.levels) return p
    const ratio = Math.min(1, p.levels / parent.levels)
    // 輪郭とほぼ同じ階数の部品が塔本体。輪郭の実測高さをそのまま与える。
    return { ...p, h: ratio >= 0.85 ? parent.h : parent.h * ratio, est: ratio < 0.85 }
  })
  const fixedOutlines = outlines.map((o) => {
    const mine = fixedParts.filter((p) => parentOf.get(p.id) === o && !p.roof)
    if (mine.length === 0 || HEIGHT_OVERRIDES[o.id]) return o
    const tall = mine.filter((p) => p.h >= o.h * 0.9)
    if (tall.length === 0) return o // 部品が塔屋を表していない（輪郭の高さをそのまま使う）
    const low = mine.filter((p) => p.minH > 0).map((p) => p.minH)
    const lower = mine.filter((p) => p.h < o.h * 0.9).map((p) => p.h)
    // 基壇の高さ: 塔の下端(min_height) > 低い部品の高さ > どちらも無ければ 20m と仮定
    const podium = low.length ? Math.max(...low) : lower.length ? Math.min(...lower) : 20
    return { ...o, h: Math.min(o.h, podium), est: true, hasParts: true }
  })

  const builtBuildings = [...fixedOutlines, ...fixedParts]
    .filter((b) => !DROP_BUILDINGS.includes(b.id))
    .map((b) => {
      const ring = simplify([...b.ring, b.ring[0]], b.area > 2000 ? 0.6 : 0.9).slice(0, -1)
      // 時計回り/反時計回りを揃える（xz 平面で符号付き面積が正 = 上から見て時計回り）
      const ordered = ringArea(ring) < 0 ? [...ring].reverse() : ring
      return {
        id: b.id,
        ...(b.name ? { name: b.name } : {}),
        ...(b.use ? { use: b.use } : {}),
        h: r1(Math.max(b.h, b.minH + 2)),
        ...(b.minH > 0 ? { minH: r1(b.minH) } : {}),
        ...(b.est ? { est: 1 } : {}),
        ...(b.part ? { part: 1 } : {}),
        ...(b.roof ? { roof: 1 } : {}),
        ...(b.hasParts ? { hasParts: 1 } : {}),
        y: r1(groundY(b.c[0], b.c[1])),
        pts: flat(ordered),
      }
    })
    .filter((b) => b.pts.length >= 6)
  // 公開情報で高さを決めた棟（補正表）は、通り沿いの下限で上書きしない
  const measuredIds = new Set(withH.filter((b) => b.src === 'override').map((b) => b.id))
  // 写真から足す建物は、隣の目印の建物（needs）が地図にあるときだけ
  const bakedIds = new Set(builtBuildings.map((b) => b.id))
  const extras = EXTRA_BUILDINGS.filter((b) => bakedIds.has(b.needs)).map(({ needs: _needs, ...b }) => b)
  const buildings = cutCorners([...raiseStreetWalls(builtBuildings, roads, measuredIds, area.streetWallMin), ...extras], CORNER_CUTS).sort((a, b) => b.h - a.h)

  // ---- 横断歩道・信号（点） ----
  const inB = (p) => p[0] >= bounds.minX && p[0] <= bounds.maxX && p[1] >= bounds.minZ && p[1] <= bounds.maxZ
  const pointNodes = [...nodes.values()].filter((n) => n.tags)
  const crossings = pointNodes
    .filter((n) => n.tags.highway === 'crossing' && n.tags.crossing !== 'unmarked' && n.tags.crossing !== 'informal')
    .map((n) => ({ p: toLocal(n.lat, n.lon), t: n.tags }))
    .filter((c) => inB(c.p))
    .map((c) => [
      r1(c.p[0]),
      r1(c.p[1]),
      /traffic_signals/.test(c.t.crossing ?? '') ? 1 : 0, // 1 = 信号あり
      c.t['crossing:scramble'] === 'yes' ? 1 : 0, // 1 = スクランブル式
    ])
  const signals = pointNodes
    .filter((n) => n.tags.highway === 'traffic_signals')
    .map((n) => toLocal(n.lat, n.lon))
    .filter(inB)
    .map((p) => [r1(p[0]), r1(p[1])])

  // ---- 標高グリッド ----
  const gx0 = Math.floor(clipB.minX / GRID_STEP) * GRID_STEP
  const gz0 = Math.floor(clipB.minZ / GRID_STEP) * GRID_STEP
  const cols = Math.ceil((clipB.maxX - gx0) / GRID_STEP) + 1
  const rows = Math.ceil((clipB.maxZ - gz0) / GRID_STEP) + 1
  const grid = Array.from({ length: rows * cols }, (_, i) => {
    const y = groundY(gx0 + (i % cols) * GRID_STEP, gz0 + Math.floor(i / cols) * GRID_STEP)
    if (Number.isNaN(y)) throw new Error('標高タイルが範囲を覆っていません。隣のタイルも取得してください')
    return r1(y)
  })

  // ---- 主要スポット ----
  const bld = (re) => buildings.filter((b) => b.name && re.test(b.name) && !b.roof).sort((a, b) => b.h - a.h)[0]
  const spotOfBuilding = (key, re) => {
    const b = bld(re)
    if (!b) return []
    const ring = Array.from({ length: b.pts.length / 2 }, (_, i) => [b.pts[i * 2], b.pts[i * 2 + 1]])
    // 塔本体が building:part に分かれている建物は、輪郭の内側で最も高い部品を指す
    const top = buildings
      .filter((p) => p.part && !p.roof && p.h > b.h)
      .filter((p) => pointInRing(centroid(Array.from({ length: p.pts.length / 2 }, (_, i) => [p.pts[i * 2], p.pts[i * 2 + 1]])), ring))
      .sort((p, q) => q.h - p.h)[0]
    const topRing = top ? Array.from({ length: top.pts.length / 2 }, (_, i) => [top.pts[i * 2], top.pts[i * 2 + 1]]) : ring
    const c = centroid(topRing)
    return [{ key, x: r1(c[0]), z: r1(c[1]), y: b.y, h: (top ?? b).h }]
  }
  const roadEnds = (key, re, kindRe = /./) => {
    const pts = roads
      .filter((r) => r.name && re.test(r.name) && kindRe.test(r.kind))
      .flatMap((r) => Array.from({ length: r.pts.length / 2 }, (_, i) => [r.pts[i * 2], r.pts[i * 2 + 1]]))
    if (pts.length === 0) return []
    // 原点（駅前）に最も近い点 = 坂下/入口、最も遠い点 = 坂上/奥
    const sorted = [...pts].sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
    const near = sorted[0]
    const far = sorted[sorted.length - 1]
    const heading = (a, b) => r1((((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI) + 360) % 360)
    return [
      { key: `${key}-bottom`, x: near[0], z: near[1], y: r1(groundY(near[0], near[1])), heading: heading(near, far) },
      { key: `${key}-top`, x: far[0], z: far[1], y: r1(groundY(far[0], far[1])), heading: heading(far, near) },
    ]
  }
  const viaduct = railsOut
    .filter((r) => r.bridge)
    .map((r) => {
      const n = r.pts.length / 2
      const i = Math.floor(n / 2)
      return { name: r.name ?? '', line: r.line, x: r.pts[i * 2], z: r.pts[i * 2 + 1], y: r.y[i] }
    })
  const nearestViaduct = (key, re, line) => {
    const v = viaduct
      .filter((e) => re.test(e.name) && e.line === line)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]
    return v ? [{ key, x: v.x, z: v.z, y: v.y }] : []
  }
  const spots = area.spots({ roadEnds, nearestViaduct, spotOfBuilding })

  return {
    meta: {
      title: area.title,
      attribution: '© OpenStreetMap contributors (ODbL) / 標高: 国土地理院 基盤地図情報 数値標高モデル',
      osmTimestamp: osm.osm3s?.timestamp_osm_base ?? null,
      origin: { lat: ORIGIN.lat, lon: ORIGIN.lon, elevation: r1(originElev) },
      mPerDegLat: Math.round(M_PER_DEG_LAT * 100) / 100,
      mPerDegLon: Math.round(M_PER_DEG_LON * 100) / 100,
      axes: 'x=east(+), z=south(+) / north(-), y=up, metres. y is relative to ground at origin.',
      bounds,
    },
    spots,
    elevation: { x0: gx0, z0: gz0, step: GRID_STEP, cols, rows, data: grid },
    roads,
    rails: railsOut,
    railTunnels: tunnelsOut,
    buildings,
    crossings,
    signals,
  }
}

/** コマンドラインの引数を [エリア, 残りの引数] に分ける（--area <名前> と --area=<名前> のどちらでも） */
export const parseArgs = (argv) => {
  const rest = []
  let areaId = 'shibuya'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--area') areaId = argv[++i]
    else if (argv[i].startsWith('--area=')) areaId = argv[i].slice('--area='.length)
    else rest.push(argv[i])
  }
  return { areaId, rest }
}

const main = async () => {
  const { areaId, rest } = parseArgs(process.argv.slice(2))
  const area = BAKE_AREAS[areaId]
  if (!area) throw new Error(`知らないエリアです: ${areaId}（${Object.keys(BAKE_AREAS).join(' / ')}）`)
  const [osmPath, demDir, outPath = join(DATA_DIR, area.out)] = rest
  if (!osmPath || !demDir) {
    process.stderr.write('使い方: node scripts/gto-bake-map.mjs [--area shibuya|shinjuku] <overpass.json> <demタイルのディレクトリ> [出力.json]\n')
    process.exit(1)
  }
  const osm = JSON.parse(await readFile(osmPath, 'utf8'))
  if (!Array.isArray(osm.elements)) throw new Error('Overpass の JSON ではありません（elements がない）')
  const map = bake(osm, await loadDem(demDir), area)
  const json = JSON.stringify(map)
  const bytes = Buffer.byteLength(json)
  if (bytes > SIZE_LIMIT) {
    throw new Error(`出力が ${Math.round(bytes / 1024)}KB で上限 500KB を超えました。間引きを強めてください`)
  }
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${json}\n`)
  const est = map.buildings.filter((b) => b.est).length
  process.stdout.write(
    `${outPath}\n  ${Math.round(bytes / 1024)}KB / 道路 ${map.roads.length} / 建物 ${map.buildings.length}` +
      `（高さ推定 ${est}） / 線路 ${map.rails.length}+地下 ${map.railTunnels.length} / 横断 ${map.crossings.length}` +
      ` / 信号 ${map.signals.length} / 標高 ${map.elevation.cols}x${map.elevation.rows}\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`gto-bake-map: ${error.message}\n`)
    process.exit(1)
  })
}
