// Grand Theft Outfit [部品: hud-minimap] ミニマップに出すものの導出。
// 入口: minimapLayers(world) / minimapModel(state, markers) / minimapTarget(markers, x, z) / minimapRange(mode, speed) / minimapRoute(graph, …)
// 契約: 動かない絵の材料（道・街区・線路。最初に1回だけ作る）と、毎フレームの中心・回転・点
//       （縁取りの円の半径を 1 に正規化）と、目的地までの道筋を返す。描くのは GtoMinimap.tsx。建物の実名は出さない。
import { clamp, dirOf } from './math'
import type { Flat, GtoState, GtoWorld, Marker, PlayMode, RoadGraph } from './types'

/** 道の段。太さと色を変えて、幹線を目で追えるようにする */
export type RoadTier = 'walk' | 'minor' | 'major' | 'elevated'

export interface MinimapRoad {
  pts: Flat
  width: number
  tier: RoadTier
}

export interface MinimapBuilding {
  pts: Flat
  /** 高い建物（目印になるので少し明るく塗る） */
  tall: boolean
}

export interface MinimapLayers {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  roads: MinimapRoad[]
  buildings: MinimapBuilding[]
  rails: Flat[]
}

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary'])
const TALL_M = 60

export function minimapLayers(world: GtoWorld): MinimapLayers {
  const roads = world.map.roads
    .filter((r) => !r.tunnel && r.kind !== 'steps' && !(r.bridge && !r.drive))
    .map((r): MinimapRoad => {
      const elevated = r.kind === 'motorway' || r.kind === 'motorway_link'
      const tier: RoadTier = elevated ? 'elevated' : r.drive !== 1 ? 'walk' : MAJOR.has(r.kind) ? 'major' : 'minor'
      return { pts: r.pts, width: r.width, tier }
    })
  const buildings = world.map.buildings
    .filter((b) => !b.part && !b.roof && b.pts.length >= 6)
    .map((b): MinimapBuilding => ({ pts: b.pts, tall: b.h >= TALL_M }))
  const rails = world.map.rails.filter((r) => r.kind === 'rail' || r.elevated === 1).map((r) => r.pts)
  return { bounds: world.bounds, roads, buildings, rails }
}

/** 道だけが要るとき用（統合テストが読む） */
export const minimapRoads = (world: GtoWorld): MinimapRoad[] => minimapLayers(world).roads

export const MINIMAP_TUNING = {
  footRange: 80,
  driveRange: 125,
  /** 速さ 1 m/s あたり、これだけ遠くまで見せる */
  rangePerSpeed: 2.6,
  maxRange: 190,
  /** 主人公を置く高さ（0 が中心。負は下）。円なので下げすぎると後ろが見えなくなる */
  anchor: -0.2,
  /** 点を寄せる縁（縁取りの中心線までの半径を 1 とした割合） */
  rim: 0.82,
  /** 縁取りの中心線の半径（キャンバスの半分を 1 とした割合）。外側は縁に乗る札のはみ出し分 */
  dial: 0.88,
  /** これより近い目的地には道筋を引かない m */
  routeMin: 30,
  /** 道筋の終わりが目的地からこれ以上離れていたら、別の道でも引いてみる m */
  routeGap: 25,
  /** 追っ手の点は、多くてもこの数まで */
  maxPolice: 4,
  /** 追っ手の点どうしがこれより近ければ1つにまとめる（枠の半分を 1 とした長さ） */
  policeGap: 0.2,
  /** 向かう先がこれより近ければ、縁の札は上に置く m */
  pinMin: 1,
  /** 枠の中の向かう先に輪を出すのは、主人公の印からこれだけ離れているときだけ（枠の半分を 1 とした長さ） */
  spotMin: 0.24,
}

/** 中心から縁までの距離 m。車は速いほど先まで見せる */
export function minimapRange(mode: PlayMode, speed: number): number {
  if (mode === 'foot') return MINIMAP_TUNING.footRange
  const wide = MINIMAP_TUNING.driveRange + Math.abs(speed) * MINIMAP_TUNING.rangePerSpeed
  return Math.min(MINIMAP_TUNING.maxRange, wide)
}

/** 円の内側へ点を寄せる。(ou, ov) から点へ引いた線が半径 radius の円を出る所に置くので、
 *  主人公から見た向きが変わらない。radius を 1 にすると縁取りの上に乗る */
export function clampToDial(u: number, v: number, ou = 0, ov = 0, radius = MINIMAP_TUNING.rim): { u: number; v: number; edge: boolean } {
  if (Math.hypot(u, v) <= radius) return { u, v, edge: false }
  const du = u - ou
  const dv = v - ov
  // |o + k·d| = radius を k について解く（o は円の中なので、正の解が1つある）
  const a = du * du + dv * dv
  const b = ou * du + ov * dv
  const c = ou * ou + ov * ov - radius * radius
  const k = (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a
  return { u: ou + du * k, v: ov + dv * k, edge: true }
}

export type BlipKind = 'player' | 'police' | 'start' | 'goal'

export interface Blip {
  kind: BlipKind
  /** 右が＋、上（カメラの向き）が＋。縁取りの円の半径を 1 とする */
  u: number
  v: number
  /** 範囲の外にあって、縁に寄せて出しているか */
  edge: boolean
  /** 点の向き（上を 0 とした時計回りのラジアン）。player は体の向き、縁の点はその先にある向き */
  rot: number
  /** 主人公からの距離 m */
  dist: number
  /** 向かう先（goal / start）だけ: 枠の縁に固定する札の位置と、指す向き。枠の中にあっても縁に出す */
  pin?: { u: number; v: number; rot: number }
}

export interface MinimapModel {
  /** 主人公の位置（地図はここを anchor の高さに合わせて描く） */
  cx: number
  cz: number
  /** 地図を回す角度（カメラが見ている向き＝進む向きが上） */
  yaw: number
  /** 中心から縁までの距離 m */
  range: number
  /** 主人公を置く高さ（−1..1） */
  anchor: number
  /** 北の印を置く位置（縁取りの中心線の半径を 1 とする） */
  north: { u: number; v: number }
  /** 追っ手が出ているか（枠を点滅させる） */
  alert: boolean
  /** 描く順。向かう先（多くて1つ）→ 追っ手（数を絞ったもの）→ 主人公 */
  blips: Blip[]
}

/** 近い順に max 個まで残す。すでに残した点から gap（枠の半分を 1 とした長さ）以内の点は捨てる。
 *  交差点に追っ手が固まっても、赤い点が団子にならないようにする */
export function thinBlips(blips: Blip[], gap: number, max: number): Blip[] {
  const kept: Blip[] = []
  for (const b of [...blips].sort((p, q) => p.dist - q.dist)) {
    if (kept.length >= max) break
    if (kept.every((k) => Math.hypot(k.u - b.u, k.v - b.v) > gap)) kept.push(b)
  }
  return kept
}

/** 向かう先の目印を1つ選ぶ（目的地、無ければいちばん近い開始地点。見回りは選ばない） */
export function minimapTarget(markers: Marker[], x: number, z: number): Marker | null {
  const open = markers.filter((m) => !m.threat)
  const goals = open.filter((m) => m.kind === 'goal')
  const pool = goals.length > 0 ? goals : open
  return pool.reduce<Marker | null>(
    (best, m) => (!best || Math.hypot(m.x - x, m.z - z) < Math.hypot(best.x - x, best.z - z) ? m : best),
    null,
  )
}

export function minimapModel(state: GtoState, markers: Marker[], range = minimapRange(state.mode, state.player.speed)): MinimapModel {
  const yaw = state.camera.yaw
  const anchor = MINIMAP_TUNING.anchor
  const f = dirOf(yaw)
  const local = (x: number, z: number) => {
    const dx = x - state.player.x
    const dz = z - state.player.z
    return { right: -dx * f.z + dz * f.x, ahead: dx * f.x + dz * f.z, dist: Math.hypot(dx, dz) }
  }
  const place = (x: number, z: number, kind: BlipKind): Blip => {
    const { right, ahead, dist } = local(x, z)
    const p = clampToDial(right / range, ahead / range + anchor, 0, anchor)
    return { kind, u: p.u, v: p.v, edge: p.edge, rot: p.edge ? Math.atan2(right, ahead) : 0, dist }
  }
  // 向かう先は1つだけ。枠の中にあっても、縁の札で方角を示す
  const target = minimapTarget(markers, state.player.x, state.player.z)
  const dest: Blip[] = []
  if (target) {
    const { right, ahead, dist } = local(target.x, target.z)
    const far = dist < MINIMAP_TUNING.pinMin ? { r: 0, a: 1 } : { r: right / dist, a: ahead / dist }
    // 札は縁取りの上（半径 1）に乗せる
    const rim = clampToDial(far.r * 9, anchor + far.a * 9, 0, anchor, 1)
    dest.push({ ...place(target.x, target.z, target.kind), pin: { u: rim.u, v: rim.v, rot: Math.atan2(far.r, far.a) } })
  }
  // 追っ手と、枠の中にいる見回り。近い順に絞り、重なりをまとめる
  const red = [
    ...state.vehicles.filter((v) => v.driver === 'police').map((v) => place(v.x, v.z, 'police')),
    ...state.peds.filter((p) => p.cop).map((p) => place(p.x, p.z, 'police')),
    ...markers.filter((m) => m.threat).map((m) => place(m.x, m.z, 'police')).filter((b) => !b.edge),
  ]
  const blips: Blip[] = [
    ...dest,
    ...thinBlips(red, MINIMAP_TUNING.policeGap, MINIMAP_TUNING.maxPolice),
    { kind: 'player', u: 0, v: anchor, edge: false, rot: state.player.heading - yaw, dist: 0 },
  ]
  // 北（−z）の印は、縁取りの上（半径 1）を回る
  const north = { u: -Math.sin(yaw), v: Math.cos(yaw) }
  return {
    cx: state.player.x,
    cz: state.player.z,
    yaw,
    range,
    anchor,
    north: { u: north.u, v: north.v },
    alert: state.wanted.level > 0,
    blips,
  }
}

// ----------------------------------------------------------------------------
// 目的地までの道筋（道路グラフの最短路）
// ----------------------------------------------------------------------------

export interface MinimapRoute {
  pts: Flat
  length: number
  /** 道が途切れていて、最後に直線で繋いだ長さ m（繋がっていれば 0 に近い） */
  gap: number
}

function nearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]
    if (n.out.length === 0) continue
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** 小さな二分ヒープ（距離の小さい順に取り出す） */
function heapPush(heap: [number, number][], item: [number, number]) {
  heap.push(item)
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent][0] <= heap[i][0]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}
function heapPop(heap: [number, number][]): [number, number] | undefined {
  const top = heap[0]
  const last = heap.pop()
  if (last && heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r
      if (m === i) break
      ;[heap[m], heap[i]] = [heap[i], heap[m]]
      i = m
    }
  }
  return top
}

/** (ax, az) から (bx, bz) まで、グラフの道に沿った折れ線。近すぎる・近づけないときは null。
 *  グラフが途中で切れているときは、目的地にいちばん近づける所まで辿り、残りを直線で繋ぐ */
export function minimapRoute(graph: RoadGraph, ax: number, az: number, bx: number, bz: number): MinimapRoute | null {
  if (Math.hypot(bx - ax, bz - az) < MINIMAP_TUNING.routeMin) return null
  const from = nearestNode(graph, ax, az)
  const goal = nearestNode(graph, bx, bz)
  if (from < 0 || goal < 0) return null
  const cost = new Float64Array(graph.nodes.length).fill(Infinity)
  const via = new Int32Array(graph.nodes.length).fill(-1)
  const heap: [number, number][] = []
  cost[from] = 0
  heapPush(heap, [0, from])
  for (let top = heapPop(heap); top; top = heapPop(heap)) {
    const [d, node] = top
    if (node === goal) break
    if (d > cost[node]) continue
    for (const id of graph.nodes[node].out) {
      const e = graph.edges[id]
      const next = d + e.length
      if (next < cost[e.to]) {
        cost[e.to] = next
        via[e.to] = id
        heapPush(heap, [next, e.to])
      }
    }
  }
  // 目的地の節に届かなければ、届いた節のうち目的地にいちばん近いものまで
  let to = goal
  if (from !== goal && via[goal] < 0) {
    const reach = (i: number) => Math.hypot(graph.nodes[i].x - bx, graph.nodes[i].z - bz)
    to = from
    for (let i = 0; i < graph.nodes.length; i++) if (via[i] >= 0 && reach(i) < reach(to)) to = i
    if (reach(to) > Math.hypot(bx - ax, bz - az) * 0.5) return null
  }
  const chain: number[] = []
  for (let node = to; node !== from; node = graph.edges[via[node]].from) chain.push(via[node])
  const pts: Flat = [ax, az]
  for (let i = chain.length - 1; i >= 0; i--) pts.push(...graph.edges[chain[i]].pts)
  pts.push(bx, bz)
  let length = 0
  for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  const end = graph.nodes[to]
  return { pts, length, gap: Math.hypot(end.x - bx, end.z - bz) }
}

/** 徒歩は歩く道を先に試し、途切れていたら車道でも引いて、目的地により近づける方を使う */
export function minimapRouteFor(world: GtoWorld, mode: PlayMode, ax: number, az: number, bx: number, bz: number) {
  const drive = () => minimapRoute(world.driveGraph, ax, az, bx, bz)
  if (mode === 'drive') return drive()
  const walk = minimapRoute(world.walkGraph, ax, az, bx, bz)
  if (walk && walk.gap < MINIMAP_TUNING.routeGap) return walk
  const road = drive()
  if (!walk || !road) return walk ?? road
  return road.gap < walk.gap ? road : walk
}

/** 道筋を引き直すべきか（主人公が動いた・目的地が変わった） */
export function routeStale(
  last: { ax: number; az: number; bx: number; bz: number } | null,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  moved = 14,
): boolean {
  if (!last) return true
  if (last.bx !== bx || last.bz !== bz) return true
  return Math.hypot(last.ax - ax, last.az - az) > moved
}

/** 画面に合わせたミニマップのキャンバスの一辺 px（短い辺の 27%。丸い地図の直径はその 88%。小さすぎ・大きすぎは止める） */
export const minimapSize = (stageW: number, stageH: number, touch: boolean) =>
  Math.round(clamp(Math.min(stageW, stageH) * (touch ? 0.3 : 0.27), touch ? 112 : 140, touch ? 132 : 236))
