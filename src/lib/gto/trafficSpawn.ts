// Grand Theft Outfit [部品: traffic-peds] 交通の車を出す場所を決める。
// 入口: spawnTraffic / needsRespawn / noteHazards
// 契約: 車は主人公のいる道の「道なり」に優先して出す。運転中は、同じ向きの前の車を切らさない
//       （自分の進む車線の前に、流れている車の列が見える）。残りは対向車線と、周りの道へ回す。
//       通り過ぎた車・視界の外の遠い車は早めに出し直して、限られた台数を見える所へ回す。
import { corridorFrom, getSignals, oncomingEdge, pickEdgeNear, projectOnEdge, type CorridorPart } from './graph'
import { angleDiff, dirOf, dist2, hash, pointAlong } from './math'
import { cruiseOf, laneCount, laneOffset, lanePoint, rankOf, TRAFFIC_TUNING, type Hazard } from './trafficLane'
import type { GraphEdge, GtoWorld, VehicleKind, VehicleState } from './types'

/** 東京の街で見かける車の色と車種の比率 */
const PAINTS = [0xf2f2ee, 0xf2f2ee, 0xc9ccd0, 0xb4b8bd, 0x1d1f23, 0x1d1f23, 0x55595f, 0x2b3a67, 0x8a1c22, 0xd9d2c0, 0x3d5a4a]
const KINDS: VehicleKind[] = ['sedan', 'sedan', 'kei', 'kei', 'taxi', 'taxi', 'van']
const TAXI_PAINTS = [0x15161a, 0x1c2440, 0x1f6b4a, 0xe3a21a]

/** 出す場所の中心（主人公）。向きと速さがあれば、道なりと視界を考えて出す */
export interface TrafficCenter {
  x: number
  z: number
  heading?: number
  speed?: number
}

/** 直前の1歩で見た車の位置（出す場所を決めるために覚えておく。世界ごと） */
interface Known {
  /** stepTraffic に渡された配列そのもの（同じ1歩かどうかの見分け）。出し始めは null */
  hazards: Hazard[] | null
  cars: { x: number; z: number; edge?: number }[]
  /** 始めの配置で最後に出した車の番号 */
  lastFresh: number
}
const known = new WeakMap<GtoWorld, Known>()
/** 直前の1歩の世界（needsRespawn は世界を受け取らないので、見通しを調べるために覚えておく） */
let lastWorld: GtoWorld | null = null

export function noteHazards(world: GtoWorld, hazards: Hazard[]) {
  lastWorld = world
  if (known.get(world)?.hazards === hazards) return
  known.set(world, { hazards, cars: hazards.filter((h) => h.id >= 0).map((h) => ({ x: h.x, z: h.z, edge: h.edge })), lastFresh: -1 })
}

/**
 * 覚えている車。始めの配置（fresh）では、前の遊びの残りを捨てて数え直す。
 * 始めの配置は番号の小さい順に出すので、番号が戻ったら新しい遊びが始まったと分かる
 * （出せなかったときは同じ番号でもう一度呼ばれるので、同じ番号は続きとみなす）。
 */
function recall(world: GtoWorld, fresh: boolean, id: number): Known {
  const found = known.get(world)
  if (found && !(fresh && (found.hazards || id < found.lastFresh))) {
    if (fresh) found.lastFresh = id
    return found
  }
  const made: Known = { hazards: null, cars: [], lastFresh: fresh ? id : -1 }
  known.set(world, made)
  return made
}

/** 道なりは全部の辺を調べて求めるので、主人公がほとんど動いていないあいだは前の答えを使い回す */
interface RunMemo {
  x: number
  z: number
  heading: number
  slow: boolean
  maxD: number
  runs: CorridorPart[][]
}
const runMemo = new WeakMap<GtoWorld, RunMemo>()

function corridorsOf(world: GtoWorld, center: TrafficCenter, slow: boolean, maxD: number): CorridorPart[][] {
  const heading = center.heading ?? 0
  const m = runMemo.get(world)
  if (m && m.slow === slow && m.maxD === maxD && dist2(m.x, m.z, center.x, center.z) < 9 && Math.abs(angleDiff(m.heading, heading)) < 0.15) return m.runs
  const runs = [corridorFrom(world, center.x, center.z, heading, maxD)]
  // 歩いているときは、どちらを向いても車が来るよう道の両側へ辿る
  if (slow) runs.push(corridorFrom(world, center.x, center.z, heading + Math.PI, maxD))
  runMemo.set(world, { x: center.x, z: center.z, heading, slow, maxD, runs })
  return runs
}

/** 主人公から見て、もう要らない場所か（通り過ぎた後ろ、視界の外の遠く） */
function outOfPlay(x: number, z: number, center: TrafficCenter): boolean {
  const T = TRAFFIC_TUNING
  const dx = x - center.x
  const dz = z - center.z
  const d2 = dx * dx + dz * dz
  if (d2 > T.despawn * T.despawn) return true
  if (center.heading == null) return false
  if (Math.abs(center.speed ?? 0) < T.drivingSpeed) return d2 > T.footDrop * T.footDrop
  const f = dirOf(center.heading)
  const ahead = dx * f.x + dz * f.z
  const side = -dx * f.z + dz * f.x
  if (ahead < -T.behindDrop) return true
  return d2 > T.sideDrop * T.sideDrop && Math.abs(side) > Math.max(0, ahead)
}

/** 対向車線の辺（対面通行なら逆向きの辺、一方通行なら中央分離の向こうの車道）。無ければ −1 */
const oppositeOf = (world: GtoWorld, edgeId: number) => {
  const rev = world.driveGraph.edges[edgeId].rev
  return rev >= 0 ? rev : oncomingEdge(world, edgeId)
}

/** 辺の s の位置で、点 (x, z) にいちばん近い車線の番号 */
function nearestLane(edge: GraphEdge, s: number, x: number, z: number): number {
  const p = pointAlong(edge.pts, edge.cum, s)
  const f = dirOf(p.heading)
  const side = -(x - p.x) * f.z + (z - p.z) * f.x
  const count = laneCount(edge)
  let best = 0
  for (let k = 1; k < count; k++) if (Math.abs(laneOffset(edge, k) - side) < Math.abs(laneOffset(edge, best) - side)) best = k
  return best
}

/**
 * 撮影用のデモ運転が使う: (x, z) を heading の向きに走る車の、いちばん近い車線の中心が、道の中心線から左へ何 m か。
 * 車道が近くに無ければ null。
 */
export function laneLeftOf(world: GtoWorld, x: number, z: number, heading: number): number | null {
  const first = corridorFrom(world, x, z, heading, 1, 12)[0]
  if (!first) return null
  const edge = world.driveGraph.edges[first.edge]
  if (Math.abs(angleDiff(pointAlong(edge.pts, edge.cum, first.s0).heading, heading)) > 0.8) return null
  return -laneOffset(edge, nearestLane(edge, first.s0, x, z))
}

/**
 * 撮影用のデモ運転が使う: (x, z) を heading の向きに走る車の、向きの合ういちばん近い車道の上の点と、その道の進む向き。
 * いちばん近い道ではなく向きの合う道を選ぶので、交差点の中で交わる道や斜めの路地に釣られない。無ければ null。
 */
export function demoRoad(world: GtoWorld, x: number, z: number, heading: number): { x: number; z: number; heading: number } | null {
  const first = corridorFrom(world, x, z, heading, 1, 12)[0]
  if (!first) return null
  const edge = world.driveGraph.edges[first.edge]
  const p = pointAlong(edge.pts, edge.cum, first.s0)
  if (Math.abs(angleDiff(p.heading, heading)) > 0.8) return null
  return { x: p.x, z: p.z, heading: p.heading }
}

/** 出す場所の候補 */
interface Pick {
  edge: GraphEdge
  s: number
  /** 走る車線（決めないなら車の id から） */
  lane?: number
  /** 巡航の上限 m/s（前へ補充する車を、主人公が追い付ける速さにする） */
  pace?: number
}

/** 道なりの d m 先の、辺と位置 */
function atRun(world: GtoWorld, run: CorridorPart[], d: number): { edge: GraphEdge; s: number } | null {
  const part = run.find((q) => d >= q.d0 && d < q.d0 + q.len)
  return part ? { edge: world.driveGraph.edges[part.edge], s: part.s0 + (d - part.d0) } : null
}

/** 中心の周りの道に、交通の車を1台出す */
export function spawnTraffic(
  world: GtoWorld,
  id: number,
  center: TrafficCenter,
  next: () => number,
  minD = TRAFFIC_TUNING.spawnMin,
  maxD = TRAFFIC_TUNING.spawnMax,
): VehicleState | null {
  const T = TRAFFIC_TUNING
  // 始めの配置（近くまで出してよい）か、遊んでいる最中の補充か
  const fresh = minD < T.spawnMin - 5
  const memo = recall(world, fresh, id)
  const graph = world.driveGraph
  const junctions = getSignals(world).junctions
  const f = center.heading != null ? dirOf(center.heading) : null
  /** その場所に出してよいか */
  const free = (pick: Pick, corridor: boolean, clear = T.spawnClear) => {
    const p = lanePoint(pick.edge, pick.s, pick.lane ?? id)
    // 信号のある交差点の中（停止線より先）には出さない。赤のあいだに交差点へ湧いて横切ってしまう
    if (junctions.some((j) => dist2(p.x, p.z, j.x, j.z) < (j.scramble ? 36 * 36 : 15 * 15))) return false
    if (memo.cars.some((c) => dist2(p.x, p.z, c.x, c.z) < clear * clear)) return false
    // 遊んでいる最中は、交差点のすぐ手前には出さない（出た途端に譲って止まり、交差点の口を塞ぐ）
    if (!fresh && pick.edge.length - pick.s < T.spawnNodeClear && graph.nodes[pick.edge.to].out.length > 2) return false
    if (corridor || fresh) return true
    if (outOfPlay(p.x, p.z, center)) return false
    if (!f) return true
    // 見通せる近くには湧かせない
    const dx = p.x - center.x
    const dz = p.z - center.z
    const ahead = dx * f.x + dz * f.z
    const near = dx * dx + dz * dz < T.popIn * T.popIn && ahead > 0 && Math.abs(-dx * f.z + dz * f.x) < ahead * 0.7 + 6
    return !near || world.segmentClear(center.x, center.z, p.x, p.z) < 1
  }

  let found: Pick | null = null
  // ---- まず、主人公のいる道の道なりへ（同じ向きと対向の両方） ----
  if (center.heading != null && f) {
    const speed = Math.abs(center.speed ?? 0)
    const slow = speed < T.drivingSpeed
    const runs = corridorsOf(world, center, slow, maxD)
    const forward = runs[0]
    const sameWay = new Set(forward.map((q) => q.edge))
    const onRun = new Set<number>()
    for (const run of runs) {
      for (const part of run) {
        onRun.add(part.edge)
        const other = oppositeOf(world, part.edge)
        if (other >= 0) onRun.add(other)
      }
    }
    const reach = forward.length > 0 ? Math.min(maxD, forward[forward.length - 1].d0 + forward[forward.length - 1].len) : 0
    // 自分の進む側の前を、同じ向きに走っている車
    const ahead = memo.cars.filter((c) => c.edge != null && sameWay.has(c.edge) && (c.x - center.x) * f.x + (c.z - center.z) * f.z > 6).length
    const want = fresh || memo.cars.length >= 14 ? T.aheadWant : T.aheadWantFew
    if (ahead < want && reach > T.platoonFirst) {
      if (fresh) {
        // ---- 始めの配置: 自分の車線の前に、間を空けて車の列を置く（先頭は主人公と同じ車線、後ろは隣の車線と交互） ----
        // 片側2車線の道だけ: 隣の車線に近い車列を置く（自分の車の陰にならず斜め前に見え、発進しても追突しない）。
        // 自分の車線には、加速しても すぐには追い付かない遠さに1台だけ。1車線の道には車列を置かない（追い越せない）
        const here = atRun(world, forward, T.platoonFirst)
        const wide = here != null && laneCount(here.edge) > 1
        const beside = ahead < T.platoonBeside
        const base = beside ? T.platoonFirst + ahead * T.platoonGap : T.freshAhead + 2
        for (let i = 0; wide && ahead <= T.platoonBeside && i < 5 && !found; i++) {
          const at = atRun(world, forward, base + i * 6 + next() * 2)
          if (!at || at.edge.length < 4) continue
          const mine = nearestLane(at.edge, at.s, center.x, center.z)
          const pick = { ...at, lane: beside ? mine + 1 : mine, pace: beside ? T.platoonPace - ahead * T.platoonLag : T.platoonPaceLane }
          if (free(pick, true)) found = pick
        }
      } else if (!slow && reach > T.popIn) {
        // ---- 運転中: 前の車が足りなければ、見えにくい遠さの同じ向きの車線へ出す。主人公より遅く走らせて、追い付かせる ----
        for (let i = 0; i < 4 && !found; i++) {
          const at = atRun(world, forward, T.popIn + next() * Math.min(T.aheadSpan, reach - T.popIn))
          if (!at || at.edge.length < 4) continue
          const pick = { ...at, pace: Math.max(T.aheadPaceMin, speed * T.aheadPace) }
          if (free(pick, true)) found = pick
        }
      }
    }
    // ---- 対向車が足りなければ、道なりの先の対向車線へ出す（すれ違う車が次々に来る） ----
    if (!found && !fresh && reach > T.popIn) {
      const facing = new Set<number>()
      for (const q of forward) {
        const other = oppositeOf(world, q.edge)
        if (other >= 0) facing.add(other)
      }
      const coming = memo.cars.filter((c) => c.edge != null && facing.has(c.edge) && (c.x - center.x) * f.x + (c.z - center.z) * f.z > 10).length
      const wantFacing = memo.cars.length >= 14 ? T.oncomingWant : T.oncomingWantFew
      for (let i = 0; i < 4 && !found && coming < wantFacing; i++) {
        const at = atRun(world, forward, T.popIn + next() * (reach - T.popIn))
        const other = at ? oppositeOf(world, at.edge.id) : -1
        if (!at || other < 0) continue
        const back = graph.edges[other]
        const p = pointAlong(at.edge.pts, at.edge.cum, at.s)
        const backS = other === at.edge.rev ? back.length - at.s : projectOnEdge(back, p.x, p.z, 30)
        if (backS == null || back.length < 4) continue
        const pick = { edge: back, s: backS }
        if (free(pick, true)) found = pick
      }
    }
    const have = memo.cars.filter((c) => c.edge != null && onRun.has(c.edge)).length
    if (!found && onRun.size > 0 && have < T.corridorWant && next() < T.corridorShare) {
      const lo = fresh ? minD : Math.max(minD, T.popIn)
      for (let i = 0; i < 6 && !found; i++) {
        const run = runs[Math.floor(next() * runs.length)]
        const last = run[run.length - 1]
        const hi = last ? Math.min(maxD, last.d0 + last.len) : 0
        if (hi <= lo) continue
        // 近いほうへ寄せる（始めの配置は強く寄せて、走り出す前から近くに車がいるようにする）
        const d = lo + next() ** (fresh ? 2 : 1.4) * (hi - lo)
        const part = run.find((q) => d >= q.d0 && d < q.d0 + q.len)
        if (!part) continue
        const along = graph.edges[part.edge]
        const s = part.s0 + (d - part.d0)
        // 半分は対向車線へ（対面通行の逆向きの辺か、中央分離の向こうの車道）
        const other = next() < T.oncomingShare || (fresh && d < T.freshAhead) ? oppositeOf(world, part.edge) : -1
        const back = other >= 0 ? graph.edges[other] : null
        const at = pointAlong(along.pts, along.cum, s)
        const backS = !back ? null : other === along.rev ? back.length - s : projectOnEdge(back, at.x, at.z, 30)
        if (!back && fresh && d < T.freshAhead) continue
        const pick = back && backS != null ? { edge: back, s: backS } : { edge: along, s }
        if (pick.edge.length >= 4 && free(pick, true)) found = pick
      }
    }
  }
  // ---- それ以外は周りの道へ。候補を引いて、いちばん格上の道に出す（大通りに車が多く、路地に少なくなる） ----
  if (!found) {
    for (let i = 0; i < 3; i++) {
      // 始めの配置では、横の道の車を少し遠ざける（発進した途端に交差点で横から当たらない）
      const c = pickEdgeNear(graph, center.x, center.z, fresh ? Math.max(minD, T.freshSide) : minD, maxD, next, 16)
      if (!c || (found && rankOf(c.edge) <= rankOf(found.edge))) continue
      if (free(c, false)) found = c
    }
  }
  if (!found) return null
  const kind = KINDS[Math.floor(next() * KINDS.length)]
  const paints = kind === 'taxi' ? TAXI_PAINTS : kind === 'van' ? [0xf2f2ee, 0xc9ccd0, 0x2b3a67] : PAINTS
  const pos = lanePoint(found.edge, found.s, found.lane ?? id)
  const cruise = Math.min(cruiseOf(found.edge, id, next), found.pace ?? Infinity)
  memo.cars.push({ x: pos.x, z: pos.z, edge: found.edge.id })
  return {
    id,
    kind,
    color: paints[Math.floor(next() * paints.length)],
    ...pos,
    y: world.groundY(pos.x, pos.z),
    // 始めの配置は、もう流れている速さで出す
    speed: cruise * (fresh ? 0.9 : 0.75),
    slip: 0,
    steer: 0,
    yawRate: 0,
    driver: 'traffic',
    route: { edge: found.edge.id, s: found.s, cruise, ...(found.lane != null ? { lane: found.lane } : {}), ...(found.pace != null ? { pace: found.pace } : {}) },
    accel: 0,
  }
}

/** 遠くへ行った交通の車、通り過ぎた車、視界の外の遠い車は消して出し直す */
export const needsRespawn = (v: VehicleState, center: TrafficCenter) =>
  v.driver === 'traffic' && (v.route == null || outOfPlay(v.x, v.z, center) || hiddenIdle(v, center))

/**
 * 歩いているとき: 主人公のいる道の道なりから外れ、建物の陰で見えない遠くの車は、少しずつ出し直す
 * （立ち止まって通りを眺めていても、限られた台数が目の前の道へ回ってきて、車の流れが途切れない）。
 */
function hiddenIdle(v: VehicleState, center: TrafficCenter): boolean {
  const T = TRAFFIC_TUNING
  const world = lastWorld
  if (!world || center.heading == null || Math.abs(center.speed ?? 0) >= T.drivingSpeed || !v.route) return false
  if (dist2(v.x, v.z, center.x, center.z) < T.hiddenDrop * T.hiddenDrop) return false
  // 毎歩ではなく、ときどきだけ（位置から作る乱数。走っている車は1秒ほどで当たる）
  if (hash(Math.floor(v.x * 4), Math.floor(v.z * 4)) > 0.03) return false
  const runs = runMemo.get(world)?.runs
  if (!runs) return false
  for (const run of runs) {
    for (const part of run) if (part.edge === v.route.edge || oppositeOf(world, part.edge) === v.route.edge) return false
  }
  return world.segmentClear(center.x, center.z, v.x, v.z) < 1
}
