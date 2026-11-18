// Grand Theft Outfit [部品: traffic-peds] 道路グラフの上の共通の道具と、信号。
// 入口: pickEdgeNear / nextEdge / corridorFrom / getSignals / lampAt / walkAt / signalLamps
// 契約: 信号は「時刻 t だけで決まる」純粋な関数（状態を持たない）。車（traffic.ts）と歩行者（pedestrians.ts）、
//       描画（信号機の灯り）は、同じ t を渡せば同じ色を得る。
import { angleDiff, closestOnSegment, dist2, hash, headingOf, pointAlong } from './math'
import type { GraphEdge, GtoWorld, RoadGraph } from './types'

/** 中心から minD〜maxD の距離にある辺を乱数で選ぶ。見つからなければ null */
export function pickEdgeNear(
  graph: RoadGraph,
  x: number,
  z: number,
  minD: number,
  maxD: number,
  next: () => number,
  tries = 48,
): { edge: GraphEdge; s: number } | null {
  if (graph.edges.length === 0) return null
  for (let i = 0; i < tries; i++) {
    const edge = graph.edges[Math.floor(next() * graph.edges.length)]
    if (edge.length < 4) continue
    const s = next() * edge.length
    const p = pointAlong(edge.pts, edge.cum, s)
    const d2 = dist2(p.x, p.z, x, z)
    if (d2 >= minD * minD && d2 <= maxD * maxD) return { edge, s }
  }
  return null
}

/** 辺の終点から先へ進む辺を選ぶ。引き返す辺は、ほかに道が無いときだけ選ぶ */
export function nextEdge(graph: RoadGraph, edge: GraphEdge, next: () => number): GraphEdge | null {
  const out = graph.nodes[edge.to].out
  const onward = out.filter((id) => id !== edge.rev)
  const pool = onward.length > 0 ? onward : out
  if (pool.length === 0) return null
  return graph.edges[pool[Math.floor(next() * pool.length)]]
}

// ----------------------------------------------------------------------------
// 道なり（主人公のいる道を、向いている側へ辿った辺の並び）
// ----------------------------------------------------------------------------

/** 道なりの1区間。辺 edge の s0 から終点まで。d0 は出発点からそこまでの道のり m */
export interface CorridorPart {
  edge: number
  s0: number
  d0: number
  len: number
}

const roadEdges = new WeakMap<RoadGraph, Map<number, number[]>>()

/** 道（map.roads の添字）を走る辺の番号 */
function edgesOfRoad(graph: RoadGraph, road: number): number[] {
  let byRoad = roadEdges.get(graph)
  if (!byRoad) {
    byRoad = new Map()
    for (const e of graph.edges) byRoad.set(e.road, [...(byRoad.get(e.road) ?? []), e.id])
    roadEdges.set(graph, byRoad)
  }
  return byRoad.get(road) ?? []
}

const twins = new WeakMap<RoadGraph, Map<number, number>>()

/**
 * 一方通行の辺と対になる、反対向きの一方通行の辺（中央分離のある大通りの対向車線）。無ければ −1。
 * 左側通行なので、まず進行方向の右を探す。
 */
export function oncomingEdge(world: GtoWorld, edgeId: number): number {
  const graph = world.driveGraph
  let memo = twins.get(graph)
  if (!memo) {
    memo = new Map()
    twins.set(graph, memo)
  }
  const hit = memo.get(edgeId)
  if (hit != null) return hit
  const edge = graph.edges[edgeId]
  const mid = pointAlong(edge.pts, edge.cum, edge.length / 2)
  const rx = Math.cos(mid.heading)
  const rz = Math.sin(mid.heading)
  let found = -1
  for (const side of [1, -1]) {
    for (const k of [3, 7, 12, 18]) {
      const off = side * (edge.width / 2 + k)
      const near = world.nearestRoad(mid.x + rx * off, mid.z + rz * off, true, 4)
      if (!near || near.road === edge.road) continue
      for (const id of edgesOfRoad(graph, near.road)) {
        const o = graph.edges[id]
        if (o.rev >= 0) continue
        const at = projectOn(o, near.x, near.z, 1.5)
        if (at != null && Math.abs(angleDiff(pointAlong(o.pts, o.cum, at).heading, mid.heading)) > 2.6) found = id
      }
      if (found >= 0) break
    }
    if (found >= 0) break
  }
  memo.set(edgeId, found)
  return found
}

/** 点を辺へ下ろした足の、始点からの距離（maxD より遠ければ null） */
export const projectOnEdge = (edge: GraphEdge, x: number, z: number, maxD: number) => projectOn(edge, x, z, maxD)

/** 道なりの最初の辺を選ぶとき、向きのずれ 1 ラジアンを何 m ぶんの遠さとみなすか */
const CORRIDOR_TURN_COST = 14
/** これより大きく折れる所で、道なりは終わる（ラジアン） */
const CORRIDOR_BEND = 0.9

/**
 * (x, z) の近くで向きの合う車道を、heading の側へ道なりに maxD m 先まで辿る。
 * 交差点ではいちばん真っ直ぐな辺へ進み、突き当たりや直角の角で終わる。車道が maxOff m 以内に無ければ空。
 */
export function corridorFrom(world: GtoWorld, x: number, z: number, heading: number, maxD: number, maxOff = 30): CorridorPart[] {
  const graph = world.driveGraph
  // いちばん近い道ではなく、近くて向きの合う辺を選ぶ（交差点の中では、横切る道のほうが近いことがある）
  let first: { edge: GraphEdge; s: number } | null = null
  let bestCost = Infinity
  for (const edge of graph.edges) {
    const foot = footOn(edge, x, z, maxOff)
    if (!foot) continue
    const off = Math.abs(angleDiff(pointAlong(edge.pts, edge.cum, foot.s).heading, heading))
    const cost = Math.sqrt(foot.d2) + off * CORRIDOR_TURN_COST
    if (cost < bestCost) {
      bestCost = cost
      first = { edge, s: foot.s }
    }
  }
  if (!first) return []
  const parts: CorridorPart[] = [{ edge: first.edge.id, s0: first.s, d0: 0, len: first.edge.length - first.s }]
  let edge = first.edge
  let d = parts[0].len
  for (let i = 0; i < 40 && d < maxD; i++) {
    const endH = pointAlong(edge.pts, edge.cum, edge.length).heading
    let next: GraphEdge | null = null
    let bend = CORRIDOR_BEND
    for (const id of graph.nodes[edge.to].out) {
      if (id === edge.rev) continue
      const o = graph.edges[id]
      const turn = Math.abs(angleDiff(endH, pointAlong(o.pts, o.cum, 0).heading))
      if (turn < bend) {
        bend = turn
        next = o
      }
    }
    if (!next) break
    parts.push({ edge: next.id, s0: 0, d0: d, len: next.length })
    d += next.length
    edge = next
  }
  return parts
}

// ----------------------------------------------------------------------------
// 信号
// ----------------------------------------------------------------------------

/** 信号の秒数。スクランブルは車の2方向のあとに、歩行者だけの時間が入る */
export const SIGNAL_TUNING = {
  green0: 18,
  green1: 14,
  yellow: 3,
  allRed: 2,
  /**
   * スクランブル以外の交差点: 主な道（0番の組）と交わる道（1番の組）の青の秒。主な道を長くして、流れを止めにくくする。
   * 周期はスクランブルと同じ長さにする（ずれていかないので、スクランブルの青に合わせて順に青にできる）
   */
  mainGreen: 40,
  sideGreen: 16,
  /** 青の波: スクランブルへ向かう車が この速さ m/s で走ると、手前の交差点から順に青で抜けられる。lead は列がはけるのを待つ秒 */
  waveSpeed: 10.5,
  waveLead: 3,
  /** スクランブルで歩行者だけが渡る秒（終わりの pedFlash 秒は点滅＝渡り始めない） */
  ped: 20,
  pedFlash: 6,
  /** 信号と横断歩道を、同じ交差点にまとめる距離 m */
  cluster: 26,
  /** 停止線を、横断歩道の中心からどれだけ手前に引くか m（横断歩道の半幅に足す） */
  stopBack: 1.5,
  /** 停止線を、何 m 手前の辺から見えるようにするか */
  lookAhead: 34,
  /** スクランブルで t=0 を周期のどこにするか（撮り始めて数秒で歩行者の青になる） */
  scrambleOffset: 34,
}

export type Lamp = 'green' | 'yellow' | 'red'

export interface Junction {
  id: number
  x: number
  z: number
  /** 0番の組が走る向き（ラジアン、180°で同じ） */
  axis: number
  scramble: boolean
  /** 周期のずれ（秒） */
  offset: number
}

/** 車道の辺の上の停止線 */
export interface EdgeStop {
  /** 辺の始点からの距離 */
  s: number
  junction: number
  /** 車の組（0 = 交差点の主な向き、1 = それと交わる向き） */
  group: 0 | 1
  x: number
  z: number
  heading: number
  /** 先の辺にある停止線を手前の辺から見るとき: この辺の次に進む辺（s は辺の長さより大きい） */
  via?: number
}

/** 歩く辺が、信号のある横断歩道のとき */
export interface WalkCross {
  junction: number
  /** この横断歩道を横切る車の組 */
  group: 0 | 1
  /** 始点が車道の中か（中なら、渡っている途中なので待たない） */
  fromInRoad: boolean
}

export interface SignalNet {
  junctions: Junction[]
  /** 車道の辺の番号 → 停止線（s の小さい順） */
  stops: EdgeStop[][]
  /** 車道の辺の番号 → 先の辺にある停止線（lookAhead m 先まで。via の辺へ進むときだけ効く） */
  ahead: EdgeStop[][]
  /** 歩く辺の番号 → 横断歩道の信号（無ければ null） */
  cross: (WalkCross | null)[]
  /** 歩く辺の番号 → 横断歩道か（信号の有無によらない） */
  isCrossing: boolean[]
  /** 車道の節 → 信号のある交差点の中か */
  signalNode: boolean[]
}

const cache = new WeakMap<GtoWorld, SignalNet>()

/** 世界ごとに1回だけ信号を組み立てる */
export function getSignals(world: GtoWorld): SignalNet {
  const found = cache.get(world)
  if (found) return found
  const built = buildSignals(world)
  cache.set(world, built)
  return built
}

const keyOf = (x: number, z: number) => `${x},${z}`

/** 線分 a-b と c-d の交点（a-b の上の割合 0..1）。交わらなければ null */
function crossAt(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax
  const rz = bz - az
  const sx = dx - cx
  const sz = dz - cz
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((cx - ax) * sz - (cz - az) * sx) / den
  const u = ((cx - ax) * rz - (cz - az) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

/** 折れ線どうしの交点を、a の始点からの距離で返す */
function polyCross(a: GraphEdge, pts: number[]): number[] {
  const out: number[] = []
  for (let i = 2; i < a.pts.length; i += 2) {
    for (let k = 2; k < pts.length; k += 2) {
      const t = crossAt(a.pts[i - 2], a.pts[i - 1], a.pts[i], a.pts[i + 1], pts[k - 2], pts[k - 1], pts[k], pts[k + 1])
      if (t != null) out.push(a.cum[i / 2 - 1] + t * (a.cum[i / 2] - a.cum[i / 2 - 1]))
    }
  }
  return out
}

/** 点を辺へ下ろした足（始点からの距離 s と、点からの距離の2乗）。maxD より遠ければ null */
function footOn(edge: GraphEdge, x: number, z: number, maxD: number): { s: number; d2: number } | null {
  let best: number | null = null
  let bestD2 = maxD * maxD
  for (let i = 2; i < edge.pts.length; i += 2) {
    const c = closestOnSegment(x, z, edge.pts[i - 2], edge.pts[i - 1], edge.pts[i], edge.pts[i + 1])
    if (c.d2 > bestD2) continue
    bestD2 = c.d2
    best = edge.cum[i / 2 - 1] + c.t * (edge.cum[i / 2] - edge.cum[i / 2 - 1])
  }
  return best == null ? null : { s: best, d2: bestD2 }
}

/** 点を辺へ下ろした足の、始点からの距離。maxD より遠ければ null */
const projectOn = (edge: GraphEdge, x: number, z: number, maxD: number) => footOn(edge, x, z, maxD)?.s ?? null

/** 180°で同じとみなした向きの差（0..π/2） */
const axisDiff = (a: number, b: number) => {
  const d = Math.abs(angleDiff(a, b))
  return d > Math.PI / 2 ? Math.PI - d : d
}

export function buildSignals(world: GtoWorld): SignalNet {
  const T = SIGNAL_TUNING
  const map = world.map
  // ---- 信号機と信号つき横断歩道の点を、近いものどうしで交差点にまとめる ----
  const pts: { x: number; z: number; scramble: boolean }[] = [
    ...map.signals.map(([x, z]) => ({ x, z, scramble: false })),
    ...map.crossings.filter((c) => c[2] === 1).map(([x, z, , scr]) => ({ x, z, scramble: scr === 1 })),
  ]
  const parent = pts.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < pts.length; i++) {
    for (let k = i + 1; k < pts.length; k++) {
      if (dist2(pts[i].x, pts[i].z, pts[k].x, pts[k].z) < T.cluster * T.cluster) parent[find(i)] = find(k)
    }
  }
  const junctionOfRoot = new Map<number, number>()
  const junctions: Junction[] = []
  const sums: { x: number; z: number; n: number }[] = []
  const pointJunction = new Map<string, number>()
  pts.forEach((p, i) => {
    const root = find(i)
    let j = junctionOfRoot.get(root)
    if (j == null) {
      j = junctions.length
      junctionOfRoot.set(root, j)
      junctions.push({ id: j, x: 0, z: 0, axis: 0, scramble: false, offset: 0 })
      sums.push({ x: 0, z: 0, n: 0 })
    }
    sums[j].x += p.x
    sums[j].z += p.z
    sums[j].n++
    if (p.scramble) junctions[j].scramble = true
    pointJunction.set(keyOf(p.x, p.z), j)
  })
  junctions.forEach((j, i) => {
    j.x = sums[i].x / sums[i].n
    j.z = sums[i].z / sums[i].n
  })

  // ---- 信号つきの横断歩道（道のデータ）を、交差点に割り当てる ----
  const crossWays: { road: number; pts: number[]; half: number; junction: number }[] = []
  map.roads.forEach((r, ri) => {
    if (!r.crossing) return
    let junction = -1
    for (let i = 0; i < r.pts.length && junction < 0; i += 2) junction = pointJunction.get(keyOf(r.pts[i], r.pts[i + 1])) ?? -1
    if (junction >= 0) crossWays.push({ road: ri, pts: r.pts, half: r.width / 2, junction })
  })
  const junctionOfRoad = new Map(crossWays.map((c) => [c.road, c.junction]))

  // ---- 車道の辺に停止線を引く ----
  const drive = world.driveGraph
  const stops: EdgeStop[][] = drive.edges.map(() => [])
  const signalNode = drive.nodes.map(() => false)
  const widest = junctions.map(() => ({ w: 0, axis: 0, toHub: Infinity }))
  const hub = junctions.find((j) => j.scramble)
  const addStop = (edge: GraphEdge, s: number, junction: number) => {
    const list = stops[edge.id]
    const old = list.findIndex((o) => o.junction === junction)
    if (old >= 0) {
      if (list[old].s <= s) return
      list.splice(old, 1)
    }
    const p = pointAlong(edge.pts, edge.cum, s)
    list.push({ s, junction, group: 0, x: p.x, z: p.z, heading: p.heading })
    // いちばん広い道を主な向きにする。同じ幅なら、スクランブルへ向かう道のほう（青の波に乗る道）
    const best = widest[junction]
    const j = junctions[junction]
    const toHub = hub && hub !== j ? axisDiff(p.heading, headingOf(hub.x - j.x, hub.z - j.z)) : 0
    if (edge.width > best.w + 0.01 || (edge.width > best.w - 0.01 && toHub < best.toHub)) widest[junction] = { w: edge.width, axis: p.heading, toHub }
  }
  /** その場所で、辺が交差点の中心へ向かっているか。一方通行は、遠ざかっていなければよい */
  const entering = (edge: GraphEdge, s: number, j: Junction) => {
    const p = pointAlong(edge.pts, edge.cum, s)
    const to = Math.hypot(j.x - p.x, j.z - p.z)
    if (to < 5) return false
    const off = Math.abs(angleDiff(p.heading, headingOf(j.x - p.x, j.z - p.z)))
    return off < Math.PI * (edge.rev < 0 ? 0.6 : 0.42)
  }
  for (const edge of drive.edges) {
    for (const way of crossWays) {
      for (const at of polyCross(edge, way.pts)) {
        if (at < 3) continue
        if (entering(edge, at, junctions[way.junction])) addStop(edge, Math.max(0.5, at - way.half - T.stopBack), way.junction)
      }
    }
  }
  // 横断歩道の無い側は、信号機の点そのものを停止線にする
  for (const [x, z] of map.signals) {
    const j = pointJunction.get(keyOf(x, z))
    if (j == null) continue
    for (const edge of drive.edges) {
      if (stops[edge.id].some((o) => o.junction === j)) continue
      const s = projectOn(edge, x, z, 1.2)
      if (s == null || s < 2) continue
      const atEnd = s > edge.length - 1
      if (atEnd) signalNode[edge.to] = true
      if (atEnd && edge.length <= 9) continue
      if (entering(edge, Math.max(0, s - 7), junctions[j])) addStop(edge, Math.max(0.5, s - (atEnd ? 7 : 1)), j)
    }
  }
  // 辺の終わりの停止線は、すぐ先の辺に同じ交差点の停止線があるなら要らない
  for (const edge of drive.edges) {
    const list = stops[edge.id]
    for (let i = list.length - 1; i >= 0; i--) {
      const st = list[i]
      if (st.s < edge.length - 8) continue
      const dup = drive.nodes[edge.to].out.some((id) => stops[id].some((o) => o.junction === st.junction && o.s < 15))
      if (dup) list.splice(i, 1)
    }
  }
  junctions.forEach((j, i) => {
    j.axis = widest[i].axis
    // スクランブルの0番の組が青になる時刻より、そこまで走る秒のぶん早く青にする（青の波）。スクランブルが無い地図では ばらばら
    j.offset = j.scramble ? T.scrambleOffset : hub ? T.scrambleOffset + T.waveLead + Math.hypot(j.x - hub.x, j.z - hub.z) / T.waveSpeed : hash(j.x, j.z) * cycleOf(j)
  })
  for (const list of stops) {
    for (const st of list) st.group = axisDiff(st.heading, junctions[st.junction].axis) < Math.PI / 4 ? 0 : 1
    list.sort((a, b) => a.s - b.s)
  }
  // 短い辺が続く所でも早めに減速できるよう、停止線を手前の辺からも見えるようにする
  const ahead: EdgeStop[][] = drive.edges.map(() => [])
  const incoming: number[][] = drive.nodes.map(() => [])
  for (const e of drive.edges) incoming[e.to].push(e.id)
  const spread = (to: GraphEdge, st: EdgeStop, s: number, depth: number) => {
    if (depth > 5 || s > T.lookAhead) return
    for (const id of incoming[to.from]) {
      if (id === to.rev) continue
      const from = drive.edges[id]
      ahead[id].push({ ...st, s: from.length + s, via: to.id })
      spread(from, st, from.length + s, depth + 1)
    }
  }
  drive.edges.forEach((e) => stops[e.id].forEach((st) => spread(e, st, st.s, 0)))
  // 信号のある交差点の中の節（ここでは「譲り合い」ではなく信号に従う）
  drive.nodes.forEach((n, i) => {
    if (signalNode[i]) return
    for (const j of junctions) {
      if (dist2(n.x, n.z, j.x, j.z) < 18 * 18) {
        signalNode[i] = true
        break
      }
    }
  })

  // ---- 歩く辺のうち、横断歩道のもの ----
  const walk = world.walkGraph
  const inRoad = (x: number, z: number) => {
    const near = world.nearestRoad(x, z, true, 12)
    return near != null && near.dist < map.roads[near.road].width / 2 - 0.3
  }
  const isCrossing = walk.edges.map((e) => map.roads[e.road].crossing === 1)
  const cross = walk.edges.map((e): WalkCross | null => {
    const junction = junctionOfRoad.get(e.road)
    if (junction == null) return null
    const mid = pointAlong(e.pts, e.cum, e.length / 2)
    // 横断歩道と直角に走る車の組が、この横断歩道を横切る
    const group = axisDiff(mid.heading + Math.PI / 2, junctions[junction].axis) < Math.PI / 4 ? 0 : 1
    const from = walk.nodes[e.from]
    return { junction, group, fromInRoad: inRoad(from.x, from.z) }
  })
  return { junctions, stops, ahead, cross, isCrossing, signalNode }
}

const cycleOf = (j: Pick<Junction, 'scramble'>) => {
  const T = SIGNAL_TUNING
  return j.scramble ? T.green0 + T.green1 + (T.yellow + T.allRed) * 2 + T.ped + T.allRed : T.mainGreen + T.sideGreen + (T.yellow + T.allRed) * 2
}

interface Phase {
  lamp0: Lamp
  lamp1: Lamp
  /** スクランブルの歩行者の時間か */
  ped: boolean
  /** いまの区切りが終わるまでの秒 */
  left: number
}

/** 時刻 t の、交差点の信号の様子 */
export function phaseAt(j: Junction, t: number): Phase {
  const T = SIGNAL_TUNING
  const cycle = cycleOf(j)
  let p = (((t + j.offset) % cycle) + cycle) % cycle
  const step = (len: number) => {
    if (p < len) return true
    p -= len
    return false
  }
  const green0 = j.scramble ? T.green0 : T.mainGreen
  const green1 = j.scramble ? T.green1 : T.sideGreen
  if (step(green0)) return { lamp0: 'green', lamp1: 'red', ped: false, left: green0 - p }
  if (step(T.yellow)) return { lamp0: 'yellow', lamp1: 'red', ped: false, left: T.yellow - p }
  if (step(T.allRed)) return { lamp0: 'red', lamp1: 'red', ped: false, left: T.allRed - p }
  if (step(green1)) return { lamp0: 'red', lamp1: 'green', ped: false, left: green1 - p }
  if (step(T.yellow)) return { lamp0: 'red', lamp1: 'yellow', ped: false, left: T.yellow - p }
  if (step(T.allRed)) return { lamp0: 'red', lamp1: 'red', ped: false, left: T.allRed - p }
  if (step(T.ped)) return { lamp0: 'red', lamp1: 'red', ped: true, left: T.ped - p }
  return { lamp0: 'red', lamp1: 'red', ped: false, left: T.allRed - p }
}

/** 車の信号の色 */
export function lampAt(net: SignalNet, junction: number, group: 0 | 1, t: number): Lamp {
  const ph = phaseAt(net.junctions[junction], t)
  return group === 0 ? ph.lamp0 : ph.lamp1
}

/**
 * 歩行者の信号。walk = 渡ってよい、left = 車が動き出すまでの残り秒、
 * flash = 点滅（渡り始めない）。group は、その横断歩道を横切る車の組。
 */
export function walkAt(net: SignalNet, junction: number, group: 0 | 1, t: number): { walk: boolean; left: number; flash: boolean } {
  const T = SIGNAL_TUNING
  const j = net.junctions[junction]
  const ph = phaseAt(j, t)
  if (j.scramble) {
    if (!ph.ped) return { walk: false, left: 0, flash: false }
    return { walk: true, left: ph.left, flash: ph.left < T.pedFlash }
  }
  // ふつうの交差点は、横切る車が赤で、並んで走る車が青のあいだに渡る
  const other = group === 0 ? ph.lamp1 : ph.lamp0
  if (other !== 'green') return { walk: false, left: 0, flash: false }
  return { walk: true, left: ph.left + T.yellow, flash: ph.left < T.pedFlash - T.yellow }
}

/** 描画用: すべての停止線の信号の色（信号機の灯りを描く部品が読む） */
export function signalLamps(world: GtoWorld, t: number): { x: number; z: number; heading: number; lamp: Lamp; junction: number }[] {
  const net = getSignals(world)
  const out: { x: number; z: number; heading: number; lamp: Lamp; junction: number }[] = []
  for (const list of net.stops) {
    for (const st of list) out.push({ x: st.x, z: st.z, heading: st.heading, lamp: lampAt(net, st.junction, st.group, t), junction: st.junction })
  }
  return out
}

/** 人が集まる場所（スクランブル交差点）。無ければ null */
export function crowdSpot(world: GtoWorld): { x: number; z: number } | null {
  const spot = world.spot('scramble')
  return spot ? { x: spot.x, z: spot.z } : null
}
