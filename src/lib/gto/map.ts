// Grand Theft Outfit: 渋谷の地図（shibuyaMap.json）から、動かない世界への問い合わせ口を組み立てる。
// 地表の高さ、建物との当たり判定、いちばん近い道、車と人の道路グラフ。
// 入口は loadWorld()（同梱の地図）と createWorld(map)（テスト用に小さな地図も渡せる）。
import mapJson from './data/shibuyaMap.json'
import { BLOCK_STYLES, EXTRA_BOARDS } from './mapBlockStyles'
import { EAST_SIGNALS } from './mapEastFront'
import { inPhotoSight, nearPhotoStand, PHOTO_LAMPS, PHOTO_SIGNAL_CLEAR, PHOTO_STAND_CLEAR } from './mapPhoto'
import { clamp, closestOnPolygon, closestOnSegment, cumulative, hash, headingOf, pointAlong, pointInPolygon } from './math'
import type {
  CircleHit,
  Flat,
  GraphEdge,
  GraphNode,
  GtoWorld,
  MapBuilding,
  MapRoad,
  NearestRoad,
  RoadGraph,
  ShibuyaMap,
} from './types'

const BUILDING_CELL = 16
const ROAD_CELL = 24
/** これより下端が高い建物（高架の駅や渡り廊下）は下をくぐれる */
const WALK_UNDER = 2.5
/** 川をまたぐだけの低い橋は地上の道として扱う（OSM の layer からの推定高さがこれ以下） */
const GROUND_BRIDGE_DECK = 6

/** 道の路面が地表からどれだけ浮いているか（地上の道は 0） */
export function roadDeck(r: MapRoad): number {
  if (!r.bridge) return 0
  const deck = r.deck ?? 0
  return r.drive && r.kind !== 'motorway' && r.kind !== 'motorway_link' && deck <= GROUND_BRIDGE_DECK ? 0 : deck
}

/** 地上にあって歩いたり走ったりできる道か */
export const isGroundRoad = (r: MapRoad) => !r.tunnel && roadDeck(r) === 0

/** 車が走れる地上の道か */
export const isDriveRoad = (r: MapRoad) => r.drive === 1 && isGroundRoad(r)

/** 建物が「歩いて入れない塊」か（屋根だけ・浮いている部分は除く） */
export const isSolidBuilding = (b: MapBuilding) =>
  !b.roof && b.use !== 'roof' && b.use !== 'bridge' && (b.minH ?? 0) < WALK_UNDER

type Grid = Map<number, number[]>
const cellKey = (cx: number, cz: number) => (cx + 512) * 4096 + (cz + 512)

function addToGrid(grid: Grid, cell: number, minX: number, minZ: number, maxX: number, maxZ: number, value: number) {
  for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
    for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
      const key = cellKey(cx, cz)
      const list = grid.get(key)
      if (list) list.push(value)
      else grid.set(key, [value])
    }
  }
}

function boundsOf(pts: Flat) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i])
    maxX = Math.max(maxX, pts[i])
    minZ = Math.min(minZ, pts[i + 1])
    maxZ = Math.max(maxZ, pts[i + 1])
  }
  return { minX, minZ, maxX, maxZ }
}

/** 道の集まりから、交差点を節・その間を辺とするグラフを作る */
export function buildGraph(roads: MapRoad[], indices: number[], respectOneway: boolean): RoadGraph {
  const keyOf = (x: number, z: number) => `${x},${z}`
  const uses = new Map<string, number>()
  for (const ri of indices) {
    const pts = roads[ri].pts
    for (let i = 0; i < pts.length; i += 2) {
      const k = keyOf(pts[i], pts[i + 1])
      const ends = i === 0 || i === pts.length - 2
      // 端点は必ず節にする（2 を足して閾値を越えさせる）
      uses.set(k, (uses.get(k) ?? 0) + (ends ? 2 : 1))
    }
  }
  const nodes: GraphNode[] = []
  const nodeIndex = new Map<string, number>()
  const nodeAt = (x: number, z: number) => {
    const k = keyOf(x, z)
    const found = nodeIndex.get(k)
    if (found != null) return found
    nodes.push({ x, z, out: [] })
    nodeIndex.set(k, nodes.length - 1)
    return nodes.length - 1
  }
  const edges: GraphEdge[] = []
  const addEdge = (ri: number, pts: Flat, rev: number): number => {
    const r = roads[ri]
    const cum = cumulative(pts)
    const id = edges.length
    const from = nodeAt(pts[0], pts[1])
    const to = nodeAt(pts[pts.length - 2], pts[pts.length - 1])
    edges.push({
      id,
      from,
      to,
      road: ri,
      pts,
      cum,
      length: cum[cum.length - 1],
      width: r.width,
      lanes: r.lanes ?? (r.width >= 9 ? 2 : 1),
      kind: r.kind,
      name: r.name,
      rev,
    })
    nodes[from].out.push(id)
    return id
  }
  for (const ri of indices) {
    const r = roads[ri]
    const pts = r.pts
    let start = 0
    for (let i = 2; i < pts.length; i += 2) {
      const isNode = i === pts.length - 2 || (uses.get(keyOf(pts[i], pts[i + 1])) ?? 0) >= 2
      if (!isNode) continue
      const piece = pts.slice(start, i + 2)
      start = i
      if (piece.length < 4) continue
      const reversed: Flat = []
      for (let k = piece.length - 2; k >= 0; k -= 2) reversed.push(piece[k], piece[k + 1])
      const forwardOk = !respectOneway || r.oneway !== -1
      const backwardOk = !respectOneway || r.oneway !== 1
      if (forwardOk && backwardOk) {
        const a = addEdge(ri, piece, edges.length + 1)
        addEdge(ri, reversed, a)
      } else if (forwardOk) addEdge(ri, piece, -1)
      else addEdge(ri, reversed, -1)
    }
  }
  return { nodes, edges }
}

export function createWorld(map: ShibuyaMap): GtoWorld {
  const { elevation: el, buildings, roads } = map
  const bounds = map.meta.bounds

  const groundY = (x: number, z: number) => {
    const fx = clamp((x - el.x0) / el.step, 0, el.cols - 1.001)
    const fz = clamp((z - el.z0) / el.step, 0, el.rows - 1.001)
    const c = Math.floor(fx)
    const r = Math.floor(fz)
    const tx = fx - c
    const tz = fz - r
    const i = r * el.cols + c
    const top = el.data[i] * (1 - tx) + el.data[i + 1] * tx
    const bottom = el.data[i + el.cols] * (1 - tx) + el.data[i + el.cols + 1] * tx
    return top * (1 - tz) + bottom * tz
  }

  // ---- 建物の当たり判定 ----
  const solid = buildings.map(isSolidBuilding)
  const rawGrid: Grid = new Map()
  buildings.forEach((b, i) => {
    if (!solid[i]) return
    const bb = boundsOf(b.pts)
    addToGrid(rawGrid, BUILDING_CELL, bb.minX, bb.minZ, bb.maxX, bb.maxZ, i)
  })
  const hitBuilding = (grid: Grid, x: number, z: number): number => {
    const list = grid.get(cellKey(Math.floor(x / BUILDING_CELL), Math.floor(z / BUILDING_CELL)))
    if (!list) return -1
    for (const i of list) if (pointInPolygon(buildings[i].pts, x, z)) return i
    return -1
  }
  // 地上の車道が下を通り抜けている建物（駅のガードなど）は、塊として扱わない
  const crossed = new Map<number, number>()
  roads.forEach((r) => {
    if (!isDriveRoad(r)) return
    for (let i = 2; i < r.pts.length; i += 2) {
      const ax = r.pts[i - 2]
      const az = r.pts[i - 1]
      const len = Math.hypot(r.pts[i] - ax, r.pts[i + 1] - az)
      const steps = Math.max(1, Math.ceil(len / 3))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const hit = hitBuilding(rawGrid, ax + (r.pts[i] - ax) * t, az + (r.pts[i + 1] - az) * t)
        if (hit >= 0) crossed.set(hit, (crossed.get(hit) ?? 0) + 1)
      }
    }
  })
  const passUnder = buildings.map((_, i) => (crossed.get(i) ?? 0) >= 3)
  const grid: Grid = new Map()
  buildings.forEach((b, i) => {
    if (!solid[i] || passUnder[i]) return
    const bb = boundsOf(b.pts)
    addToGrid(grid, BUILDING_CELL, bb.minX, bb.minZ, bb.maxX, bb.maxZ, i)
  })

  const insideBuilding = (x: number, z: number) => hitBuilding(grid, x, z) >= 0
  // [cheats] 屋根の高さ: 当たり判定のある建物（insideBuilding と同じ集まり）のうち、その点を含むいちばん高い屋根
  const roofY = (x: number, z: number) => {
    let top = -Infinity
    for (const i of grid.get(cellKey(Math.floor(x / BUILDING_CELL), Math.floor(z / BUILDING_CELL))) ?? []) {
      const b = buildings[i]
      if (b.y + b.h > top && pointInPolygon(b.pts, x, z)) top = b.y + b.h
    }
    return top
  }

  const resolveCircle = (x0: number, z0: number, r: number): CircleHit => {
    let x = clamp(x0, bounds.minX + r, bounds.maxX - r)
    let z = clamp(z0, bounds.minZ + r, bounds.maxZ - r)
    let hit = x !== x0 || z !== z0
    let nx = 0
    let nz = 0
    for (let pass = 0; pass < 2; pass++) {
      const seen = new Set<number>()
      for (let cx = Math.floor((x - r) / BUILDING_CELL); cx <= Math.floor((x + r) / BUILDING_CELL); cx++) {
        for (let cz = Math.floor((z - r) / BUILDING_CELL); cz <= Math.floor((z + r) / BUILDING_CELL); cz++) {
          for (const bi of grid.get(cellKey(cx, cz)) ?? []) {
            if (seen.has(bi)) continue
            seen.add(bi)
            const pts = buildings[bi].pts
            const c = closestOnPolygon(pts, x, z)
            const inside = pointInPolygon(pts, x, z)
            const d = Math.sqrt(c.d2)
            if (!inside && d >= r) continue
            // 外にいれば辺から離れる向き、中にいれば辺へ向かう向きへ押す
            let ux = inside ? c.x - x : x - c.x
            let uz = inside ? c.z - z : z - c.z
            const ul = Math.hypot(ux, uz)
            if (ul < 1e-6) {
              ux = 1
              uz = 0
            } else {
              ux /= ul
              uz /= ul
            }
            const push = inside ? d + r : r - d
            x += ux * push
            z += uz * push
            nx = ux
            nz = uz
            hit = true
          }
        }
      }
    }
    return { x, z, hit, nx, nz }
  }

  const segmentClear = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.ceil(len / 0.5))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      if (insideBuilding(ax + (bx - ax) * t, az + (bz - az) * t)) return (s - 1) / steps
    }
    return 1
  }

  // ---- いちばん近い道 ----
  const roadGrid: Grid = new Map()
  const segs: number[] = [] // [road, ax, az, bx, bz] の繰り返し
  roads.forEach((r, ri) => {
    if (!isGroundRoad(r)) return
    for (let i = 2; i < r.pts.length; i += 2) {
      const ax = r.pts[i - 2]
      const az = r.pts[i - 1]
      const bx = r.pts[i]
      const bz = r.pts[i + 1]
      addToGrid(roadGrid, ROAD_CELL, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), segs.length)
      segs.push(ri, ax, az, bx, bz)
    }
  })
  const nearestRoad = (x: number, z: number, driveOnly = false, maxDist = 60): NearestRoad | null => {
    const reach = Math.ceil(maxDist / ROAD_CELL)
    const cx0 = Math.floor(x / ROAD_CELL)
    const cz0 = Math.floor(z / ROAD_CELL)
    let best: NearestRoad | null = null
    let bestD2 = maxDist * maxDist
    for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) {
      for (let cz = cz0 - reach; cz <= cz0 + reach; cz++) {
        for (const si of roadGrid.get(cellKey(cx, cz)) ?? []) {
          const r = roads[segs[si]]
          if (driveOnly && !r.drive) continue
          const c = closestOnSegment(x, z, segs[si + 1], segs[si + 2], segs[si + 3], segs[si + 4])
          if (c.d2 >= bestD2) continue
          bestD2 = c.d2
          best = {
            road: segs[si],
            x: c.x,
            z: c.z,
            dist: Math.sqrt(c.d2),
            heading: headingOf(segs[si + 3] - segs[si + 1], segs[si + 4] - segs[si + 2]),
            name: r.name,
            drive: r.drive === 1,
          }
        }
      }
    }
    return best
  }

  // ---- 道路グラフ ----
  const driveIdx: number[] = []
  const walkIdx: number[] = []
  roads.forEach((r, ri) => {
    if (isDriveRoad(r)) driveIdx.push(ri)
    else if (!r.drive && isGroundRoad(r)) {
      // 建物の中（駅の構内など）を通る歩道は使わない
      let inside = 0
      const n = r.pts.length / 2
      for (let i = 0; i < r.pts.length; i += 2) if (insideBuilding(r.pts[i], r.pts[i + 1])) inside++
      if (inside / n < 0.34) walkIdx.push(ri)
    }
  })

  const spots = new Map(map.spots.map((s) => [s.key, s]))

  return {
    map,
    bounds,
    groundY,
    passUnder,
    insideBuilding,
    roofY,
    resolveCircle,
    segmentClear,
    nearestRoad,
    driveGraph: buildGraph(roads, driveIdx, true),
    walkGraph: buildGraph(roads, walkIdx, false),
    spot: (key) => spots.get(key),
  }
}

let cached: GtoWorld | null = null

/** 同梱の渋谷の地図から世界を作る（1回だけ組み立てて使い回す） */
export function loadWorld(): GtoWorld {
  if (!cached) cached = createWorld(mapJson as unknown as ShibuyaMap)
  return cached
}

/** 緯度経度 → ゲーム内の座標 */
export function fromLatLon(map: ShibuyaMap, lat: number, lon: number) {
  const { origin, mPerDegLat, mPerDegLon } = map.meta
  return { x: (lon - origin.lon) * mPerDegLon, z: -(lat - origin.lat) * mPerDegLat }
}

// ----------------------------------------------------------------------------
// 街並みの決まりごと（描画 renderCity*.ts が読む。three には触れない）
// ----------------------------------------------------------------------------

/** 形を作り込む目印の建物。画面に名前は出さない（OSM の id で見分けるだけ） */
export type LandmarkKind =
  | 'qfront'
  | 'cylinder109'
  | 'scramble-square'
  | 'hikarie'
  | 'stream'
  | 'markcity'
  | 'cerulean'
  | 'fukuras'
  | 'sakura'
  | 'parco'
  | 'magnet'
  | 'ginza-station'
  | 'jr-station'
  | 'miyashita'
  | 'vision'
  | 'kiosk'
  | 'concourse'
  | 'styled'

/** 形そのものを作り込む建物 */
const SHAPED_LANDMARKS: Record<number, LandmarkKind> = {
  136691386: 'qfront',
  55895868: 'cylinder109',
  617560918: 'scramble-square',
  521569267: 'hikarie',
  521438304: 'stream',
  521569271: 'markcity',
  521569274: 'markcity',
  521569269: 'cerulean',
  55588118: 'fukuras',
  1200029947: 'sakura',
  1200029949: 'sakura',
  451564412: 'parco',
  116806281: 'magnet',
  810356690: 'ginza-station',
  760664437: 'ginza-station',
  904652318: 'jr-station',
  904652357: 'jr-station',
  193706810: 'miyashita',
  1074513113: 'miyashita',
  // 交差点に面して大型ビジョンを載せる雑居ビル
  136690966: 'vision',
  // ハチ公前広場の南西、道をまたぐ白い枠のガラス張りの連絡通路（scramble_14/16/17/18 の駅向きの眺めの右半分）
  355250634: 'concourse',
  // 交差点の角にある地下鉄出入口のガラスの箱
  142438894: 'kiosk',
  142438895: 'kiosk',
  155807209: 'kiosk',
  155807210: 'kiosk',
  155807211: 'kiosk',
  155807215: 'kiosk',
}

/** 屋上の広告塔1基ぶんの決めごと */
export interface BoardSpec {
  /** 板の表を見せたい相手の場所（広場や交差点） */
  toward: [x: number, z: number]
  /** 板の幅と高さ m */
  w: number
  h: number
  /** 絵の番号（renderCityBoards の BOARD_ARTS） */
  art: number
  /** 屋上から板の下端までの脚の高さ m */
  lift?: number
  /** 板を横へずらす量 m（相手から見て右が＋） */
  shift?: number
}

/** 現地写真から起こした、建物ごとの外装（壁の種類と色）と屋上の広告塔。中身の絵は架空 */
export interface BlockStyle {
  facade: FacadeKind
  color: number
  /** 店先の看板帯の色（省くと建物ごとの既定） */
  shop?: number
  /** 地図の高さに足す階数ぶんの高さ m（写真の高さ関係に合わせる） */
  raise?: number
  boards?: BoardSpec[]
  /** 夜に外装ごと照らされて、壁の色のまま光る棟か（センター街の桃色の棟） */
  lit?: boolean
  /** 壁に載せる大型ビジョン。見せたい相手の場所と、映像の絵の番号 */
  vision?: { toward: [x: number, z: number]; tile: number }
  /** 上の階が輪郭の一部だけになる棟（外装は下と同じ）。from = 足元からこの高さ m までは輪郭の全体、その上は pts の輪郭だけ */
  upper?: { from: number; pts: Flat }
  /** 低い基壇の上に、輪郭の一部だけが高く立つ棟。podium = 基壇の高さ m、pts = 高い部分の輪郭（外装は小窓のタイル張り） */
  tower?: { podium: number; pts: Flat; color: number }
}

export { BLOCK_STYLES }

/** 目印の建物の表（形を作り込む建物＋外装を決めてある街区）。看板役はここに載る建物へ勝手な広告塔を立てない */
export const LANDMARK_IDS: Record<number, LandmarkKind> = {
  ...Object.fromEntries(Object.keys(BLOCK_STYLES).map((id) => [id, 'styled' as const])),
  ...SHAPED_LANDMARKS,
  551944268: 'styled',
}

export const landmarkOf = (b: MapBuilding): LandmarkKind | null => LANDMARK_IDS[b.id] ?? null

/** 描かない部品（外装を決めて建て直した棟の、宙に浮いた庇など） */
// 551944268 は円筒の屋根の部品（円筒は renderCity109 が建てる。看板役がここへネオンを吊らないよう目印の表にも載せる）
// 9100000001 は広場の南の解体現場（足場と仮囲いは renderCityFacade が建てる）
// 355252207 は宮益坂下の北の歩道の、地下への出入口の屋根（ガラスの囲いは renderCityEastSide が NORTH_PLAZA の寸法で建てる）
const HIDDEN_PARTS = new Set([1126025809, 1126025810, 551944268, 9100000001, 355252207])
export const isHiddenBuilding = (b: MapBuilding) => HIDDEN_PARTS.has(b.id)

export const blockStyleOf = (b: MapBuilding): BlockStyle | null => BLOCK_STYLES[b.id] ?? null

/** 建物に立てる屋上の広告塔の決めごと（外装を決めた街区のぶん＋形を作り込む建物に足すぶん） */
export const boardSpecsOf = (b: MapBuilding): BoardSpec[] => BLOCK_STYLES[b.id]?.boards ?? EXTRA_BOARDS[b.id] ?? []

/** 駅の建て替え工事のクレーン。立つ場所・マストの高さ m・ジブの向き（度、北 0・時計回り）。建物の上なら屋上から立つ */
export const CRANES: { x: number; z: number; h: number; heading: number }[] = [
  { x: 86, z: 118, h: 58, heading: 40 },
  { x: 72, z: 158, h: 66, heading: 300 },
  { x: 104, z: 150, h: 50, heading: 160 },
  { x: 58, z: 96, h: 44, heading: 230 },
]

export interface RoofBoard {
  /** 板の中心 */
  x: number
  z: number
  /** 板の表が向く向き（ラジアン、北 0・時計回り） */
  heading: number
  w: number
  h: number
  lift: number
  art: number
}

/** 屋上の縁から板までの引き m */
const BOARD_INSET = 1.4

/**
 * 屋上の広告塔の置き場所。建物の重心から相手のほうへ進み、屋上の縁の手前に立てる。
 * 板の表は相手を向く（屋上の縁に沿わせない。写真でも広場へ向けて振ってある）。
 */
export function roofBoards(b: MapBuilding): RoofBoard[] {
  const specs = boardSpecsOf(b)
  if (specs.length === 0) return []
  const n = b.pts.length / 2
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += b.pts[i * 2] / n
    cz += b.pts[i * 2 + 1] / n
  }
  return specs.map((spec) => {
    const dl = Math.hypot(spec.toward[0] - cx, spec.toward[1] - cz) || 1
    const ux = (spec.toward[0] - cx) / dl
    const uz = (spec.toward[1] - cz) / dl
    // 相手から見て右へのずらし（相手はこちらを向いているので、進む向きの左が相手の右）
    const sx = uz * (spec.shift ?? 0)
    const sz = -ux * (spec.shift ?? 0)
    // 重心から進んで、板の中心と両端のどれかが屋上を出る手前で止める
    const fits = (t: number) => {
      const x = cx + sx + ux * t
      const z = cz + sz + uz * t
      return [-0.5, 0, 0.5].every((k) => pointInPolygon(b.pts, x - uz * spec.w * k * 0.8 + ux * BOARD_INSET, z + ux * spec.w * k * 0.8 + uz * BOARD_INSET))
    }
    let t = 0
    while (t < dl && fits(t + 0.5)) t += 0.5
    return { x: cx + sx + ux * t, z: cz + sz + uz * t, heading: headingOf(ux, uz), w: spec.w, h: spec.h, lift: spec.lift ?? 1.5, art: spec.art }
  })
}

/** 壁の模様の種類 */
export type FacadeKind = 'office' | 'ribbon' | 'curtain' | 'tile' | 'stream' | 'blank'

/** 建物の壁の種類。高層はガラス張り、住宅とホテルは小窓、雑居ビルは建物ごとにばらつかせる */
export function facadeOf(b: MapBuilding): FacadeKind {
  if (b.h >= 60) return 'curtain'
  if (b.use === 'apartments' || b.use === 'hotel' || b.use === 'residential') return 'tile'
  const h = hash(b.id, 11)
  if (h < 0.34) return 'office'
  if (h < 0.7) return 'ribbon'
  if (h < 0.86) return 'tile'
  // 窓の無い箱は作らない（低い棟は横連窓にする）
  return b.h >= 18 ? 'curtain' : 'ribbon'
}

/** スクランブル交差点の横断歩道か（原点のまわり 45m に収まる横断歩道） */
export function isScrambleCrossing(r: MapRoad): boolean {
  if (!r.crossing) return false
  for (let i = 0; i < r.pts.length; i += 2) if (Math.hypot(r.pts[i], r.pts[i + 1]) > 45) return false
  return true
}

/**
 * 大きな輪郭を、いちばん長い辺に沿って幅 maxWidth 以下の短冊に割る（雑居ビルが肩を並べる街区を作る）。
 * 割るほど長くなければ、元の輪郭を1つだけ返す。
 */
export function splitFootprint(pts: Flat, maxWidth: number): Flat[] {
  const n = pts.length / 2
  if (n < 3) return [pts]
  // いちばん長い辺の向きを軸にする
  let ax = 1
  let az = 0
  let best = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const dx = pts[i * 2] - pts[j * 2]
    const dz = pts[i * 2 + 1] - pts[j * 2 + 1]
    const len = Math.hypot(dx, dz)
    if (len > best) {
      best = len
      ax = dx / len
      az = dz / len
    }
  }
  let t0 = Infinity
  let t1 = -Infinity
  for (let i = 0; i < n; i++) {
    const t = pts[i * 2] * ax + pts[i * 2 + 1] * az
    t0 = Math.min(t0, t)
    t1 = Math.max(t1, t)
  }
  const count = Math.round((t1 - t0) / maxWidth)
  if (count < 2) return [pts]
  // 軸の位置 t が keep 側（sign=1 なら t >= cut、-1 なら t <= cut）の部分だけ残す
  const clip = (poly: Flat, cut: number, sign: number): Flat => {
    const out: Flat = []
    const m = poly.length / 2
    for (let i = 0, j = m - 1; i < m; j = i, i++) {
      const px = poly[j * 2]
      const pz = poly[j * 2 + 1]
      const qx = poly[i * 2]
      const qz = poly[i * 2 + 1]
      const dp = (px * ax + pz * az - cut) * sign
      const dq = (qx * ax + qz * az - cut) * sign
      if (dp >= 0 !== dq >= 0) {
        const k = dp / (dp - dq)
        out.push(px + (qx - px) * k, pz + (qz - pz) * k)
      }
      if (dq >= 0) out.push(qx, qz)
    }
    return out
  }
  const parts: Flat[] = []
  for (let k = 0; k < count; k++) {
    const lo = t0 + ((t1 - t0) * k) / count
    const hi = t0 + ((t1 - t0) * (k + 1)) / count
    let piece = k === 0 ? pts : clip(pts, lo, 1)
    if (k < count - 1) piece = clip(piece, hi, -1)
    if (piece.length >= 6) parts.push(piece)
  }
  return parts.length > 0 ? parts : [pts]
}

export type PropKind = 'lamp-dogenzaka' | 'lamp-center' | 'lamp-miyamasu' | 'lamp-koen' | 'lamp-plain' | 'tree' | 'signal'

export interface StreetProp {
  kind: PropKind
  x: number
  z: number
  /** 車道の中心へ向く向き（ラジアン、北 0・時計回り）。信号は車の進む向き */
  heading: number
}

/** 通りごとの街灯の型と間隔・街路樹の間隔（m）。現地写真で見分けの付く通りだけ専用の型にする */
const STREET_FURNITURE: Record<string, { lamp: PropKind; every: number; tree: number }> = {
  道玄坂: { lamp: 'lamp-dogenzaka', every: 18, tree: 13 },
  宮益坂: { lamp: 'lamp-miyamasu', every: 20, tree: 12 },
  公園通り: { lamp: 'lamp-koen', every: 20, tree: 14 },
  神宮通り: { lamp: 'lamp-koen', every: 24, tree: 18 },
  明治通り: { lamp: 'lamp-plain', every: 30, tree: 12 },
  文化村通り: { lamp: 'lamp-plain', every: 26, tree: 16 },
  青山通り: { lamp: 'lamp-plain', every: 32, tree: 14 },
  玉川通り: { lamp: 'lamp-plain', every: 34, tree: 0 },
  六本木通り: { lamp: 'lamp-plain', every: 34, tree: 0 },
  旧大山街道: { lamp: 'lamp-miyamasu', every: 28, tree: 0 },
  井ノ頭通り: { lamp: 'lamp-center', every: 22, tree: 0 },
}
const CENTER_GAI = '渋谷センター街'
const PROP_GAP = 3.5
/** ハチ公前広場の木の場所 */
const PLAZA_TREES: [number, number][] = [
  [27, 22],
  [36, 31],
  [32, 46],
  [40, 18],
  [30, 27],
  [26, 44],
  [14, 44],
  [34, 38],
]
/** 109 の分岐の先端の少し手前と、そのまわりで街路樹を植えない半径 m */
const FORK_109: [number, number] = [-126, -5]
const FORK_CLEAR = 36
/** 分岐の東（駅側）は、合わさった通りの並木が横断歩道のすぐ先から始まる（109_09 / 109_12）ので、この半径 m まで */
const FORK_CLEAR_EAST = 27
const FORK_EAST_FROM = -104
/** スクランブル交差点の広場の半径 m（この内側は車道の線が無くても路面） */
const SCRAMBLE_CLEAR = 27
/** 交差点の中心からこの距離 m までは街路樹を植えない（109_09 / 109_12 / scramble_13: 道玄坂の並木は交差点の角の棟の先から 109 の手前まで続く） */
const SCRAMBLE_TREE_CLEAR = 46
/** 宮益坂下の角から橋までの明治通り [x0, x1, z0, z1]。街路樹が無く、橋と塔の裾まで見通せる（miyamasuzaka_08、viaduct_01） */
export const EAST_VISTA = [118, 186, -34, 62] as const
/** 宮益坂下の角の立ち位置と、そのまわりで街灯を立てない半径 m（現地は信号柱だけ） */
export const EAST_CORNER: [x: number, z: number, r: number] = [152, -20, 16]
/** 宮益坂下の交差点の北の明治通りと坂の入口 [x0, x1, z0, z1]。葉の茂った木を立てず、正面の街区と東の並びが壁として見える（miyamasuzaka_01/02） */
export const MIYAMASU_BARE = [112, 205, -125, -8] as const
/** センター街の行灯の街灯の間隔 m と、通りの中心からの離れ m（center-gai_11/15: 柱は壁ぎわではなく通りの中に立つ） */
const CENTER_LAMP = { every: 22, offset: 2.1 } as const

/** 街灯・街路樹・信号の置き場所。地図だけから決まり、毎回同じ並びになる */
export function streetProps(world: GtoWorld): StreetProp[] {
  const roads = world.map.roads
  const out: StreetProp[] = []
  const cells = new Map<number, number[]>()
  const key = (x: number, z: number) => cellKey(Math.floor(x / 8), Math.floor(z / 8))
  const crowded = (x: number, z: number) => {
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        for (const i of cells.get(key(x + cx * 8, z + cz * 8)) ?? []) {
          if (Math.hypot(out[i].x - x, out[i].z - z) < PROP_GAP) return true
        }
      }
    }
    return false
  }
  const onCarriageway = (x: number, z: number) => {
    const near = world.nearestRoad(x, z, true, 30)
    return near != null && near.dist < roads[near.road].width / 2 + 0.25
  }
  const place = (kind: PropKind, x: number, z: number, heading: number, checkRoad = true, plaza = false) => {
    const px = Math.round(x * 10) / 10
    const pz = Math.round(z * 10) / 10
    if (world.insideBuilding(px, pz) || crowded(px, pz)) return
    // スクランブル交差点の広場の中には、信号柱しか立てない
    if (kind !== 'signal' && Math.hypot(px, pz) < SCRAMBLE_CLEAR) return
    if (kind === 'tree' && !plaza && Math.hypot(px, pz) < SCRAMBLE_TREE_CLEAR) return
    // 109 の分岐の先端の前には植えない（現地でも円筒の正面は開けている）
    if (kind === 'tree' && Math.hypot(px - FORK_109[0], pz - FORK_109[1]) < (px > FORK_EAST_FROM ? FORK_CLEAR_EAST : FORK_CLEAR)) return
    if (kind === 'tree' && px > EAST_VISTA[0] && px < EAST_VISTA[1] && pz > EAST_VISTA[2] && pz < EAST_VISTA[3]) return
    if (kind === 'tree' && px > MIYAMASU_BARE[0] && px < MIYAMASU_BARE[1] && pz > MIYAMASU_BARE[2] && pz < MIYAMASU_BARE[3]) return
    if (kind !== 'tree' && kind !== 'signal' && Math.hypot(px - EAST_CORNER[0], pz - EAST_CORNER[1]) < EAST_CORNER[2]) return
    // 現地写真の立ち位置の目の前には、木も街灯も立てない（幹や柱が画面の真ん中を塞ぐ）。信号柱はすぐ脇だけ避ける
    if (nearPhotoStand(px, pz, kind === 'signal' ? PHOTO_SIGNAL_CLEAR : PHOTO_STAND_CLEAR)) return
    // 写真の決め手（通りの先の塔）への見通しの上には植えない
    if (kind === 'tree' && inPhotoSight(px, pz)) return
    if (checkRoad && onCarriageway(px, pz)) return
    // 建物の壁ぎわすぎる所（歩道が無い所）には置かない
    if (world.resolveCircle(px, pz, 0.35).hit) return
    const k = key(px, pz)
    const list = cells.get(k)
    if (list) list.push(out.length)
    else cells.set(k, [out.length])
    out.push({ kind, x: px, z: pz, heading })
  }
  /** 道の両側（または片側）に、every メートルごとに置く */
  const along = (r: MapRoad, kind: PropKind, every: number, offset: number, phase: number, sides: number[]) => {
    const cum = cumulative(r.pts)
    const total = cum[cum.length - 1]
    for (let s = phase; s < total; s += every) {
      const p = pointAlong(r.pts, cum, s)
      const rx = Math.cos(p.heading)
      const rz = Math.sin(p.heading)
      for (const side of sides) place(kind, p.x + rx * offset * side, p.z + rz * offset * side, p.heading - (Math.PI / 2) * side)
    }
  }

  // 写真の手前に写る行灯の街灯（等間隔の並びより先に立てて、すぐ隣の 1 本と入れ替える）
  for (const [x, z] of PHOTO_LAMPS) place('lamp-center', x, z, 0, false)
  roads.forEach((r) => {
    if (!isGroundRoad(r)) return
    if (r.name === CENTER_GAI && !r.drive) {
      // 歩行者の通り。行灯付きの街灯を左右交互に
      along(r, 'lamp-center', CENTER_LAMP.every * 2, CENTER_LAMP.offset, 12, [1])
      along(r, 'lamp-center', CENTER_LAMP.every * 2, CENTER_LAMP.offset, 12 + CENTER_LAMP.every, [-1])
      return
    }
    if (!r.drive || r.width < 6) return
    const rule = (r.name && STREET_FURNITURE[r.name.replace(/\(.*$/, '')]) || null
    if (rule) {
      along(r, rule.lamp, rule.every, r.width / 2 + 1.1, rule.every / 2, [1, -1])
      if (rule.tree > 0) along(r, 'tree', rule.tree, r.width / 2 + 1.7, rule.tree * 0.25, [1, -1])
    } else if (r.width >= 7.5 && r.kind !== 'service') {
      along(r, 'lamp-plain', 34, r.width / 2 + 1.1, 9, [1, -1])
    }
  })

  // ハチ公前広場の木（scramble_14/16: 駅舎の前に大きな広葉樹が数本）
  for (const [x, z] of PLAZA_TREES) place('tree', x, z, 0, true, true)

  // 宮益坂下の横断歩道の信号柱（写真の立ち位置の脇にも立てるので、place の空きの決まりを通さない）
  for (const [x, z, deg] of EAST_SIGNALS) out.push({ kind: 'signal', x, z, heading: (deg * Math.PI) / 180 })
  // 信号柱。停止位置の点から道の左の歩道へ寄せ、腕を車道の上へ伸ばす
  for (const [sx, sz] of world.map.signals) {
    const near = world.nearestRoad(sx, sz, true, 12)
    if (!near) continue
    const w = roads[near.road].width
    const rx = Math.cos(near.heading)
    const rz = Math.sin(near.heading)
    for (const side of [-1, 1]) {
      const x = sx + rx * (w / 2 + 0.9) * side
      const z = sz + rz * (w / 2 + 0.9) * side
      const before = out.length
      place('signal', x, z, near.heading - (Math.PI / 2) * side, false)
      if (out.length > before) break
    }
  }
  return out
}

export interface GatePlacement {
  /** 左右の柱の真ん中 */
  x: number
  z: number
  /** 通りの奥へ向かう向き（ラジアン、北 0・時計回り） */
  heading: number
  /** 中心から柱までの距離 m */
  half: number
}

/** センター街の歩行者の通りを、交差点側の端から何 m 入った所にゲートが立つか（角のガラスのビルの壁が始まる所） */
const GATE_INSET = 28.5
const GATE_HALF_MAX = 4.6

/** センター街入口のゲートの置き場所。通りの両脇の壁ぎわまで柱を寄せる */
export function centerGaiGate(world: GtoWorld): GatePlacement | null {
  const road = world.map.roads.find((r) => r.name === CENTER_GAI && !r.drive)
  if (!road) return null
  const n = road.pts.length
  const startNear = Math.hypot(road.pts[0], road.pts[1]) < Math.hypot(road.pts[n - 2], road.pts[n - 1])
  const cum = cumulative(road.pts)
  const total = cum[cum.length - 1]
  const at = pointAlong(road.pts, cum, startNear ? GATE_INSET : total - GATE_INSET)
  const heading = startNear ? at.heading : at.heading + Math.PI
  const rx = Math.cos(heading)
  const rz = Math.sin(heading)
  // 左右それぞれ、柱（太さ 0.55m）が壁に当たらずに立てる一番外側を探す
  const reach = (side: number) => {
    let d = 1
    while (d + 0.25 <= GATE_HALF_MAX && !world.resolveCircle(at.x + rx * (d + 0.25) * side, at.z + rz * (d + 0.25) * side, 0.55).hit) d += 0.25
    return d
  }
  const half = Math.min(reach(1), reach(-1))
  if (half < 2.5) return null
  return { x: at.x, z: at.z, heading, half }
}
