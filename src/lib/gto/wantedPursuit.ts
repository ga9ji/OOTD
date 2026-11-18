// Grand Theft Outfit [部品: wanted] 警察車両の追い方（道沿いの追跡・回り込み・道塞ぎ・捜索）。
// 入口: shortestPath / planPursuit / policeControl（外からは wanted.ts 経由で使う）
// 契約: 車両ごとの役割と「いま向かう地点」を WantedState.units に持ち、0.5 秒おきに道路グラフで引き直す。
//       毎歩の操作（VehicleControl）はその地点へ向かうだけなので軽い。車の動きは vehicle.ts が計算する。
import { angleDiff, clamp, closestOnSegment, cumulative, dirOf, hash, headingOf, pointAlong, TAU } from './math'
import type { GtoWorld, PoliceRole, PoliceUnit, RoadGraph, VehicleControl, VehicleState, WantedState } from './types'

/** 追い方の手触りを決める数字 */
export const PURSUIT_TUNING = {
  /** 道筋を引き直す間隔（秒） */
  replan: 0.5,
  /** この距離の中で見通せたら、道筋ではなく本人へ向かう */
  directRange: 130,
  /** 一方通行を逆走するときは、道のりをこの倍に数える（大回りするくらいなら逆走する） */
  wrongWay: 1.3,
  /** 遠くにいて道がまっすぐなら、この速さまで出して追いつく m/s */
  catchUp: 34,
  catchUpRange: 55,
  /** 道筋の上で、この距離まで先の見通せる地点を目指す（建物の角を突っ切らない） */
  lookAhead: 46,
  /** 道沿いに走るとき・本人へ向かうときの上限 m/s */
  cruise: 25,
  chaseSpeed: 40,
  /** 曲がり角の手前と、大きく向きを変えるときの上限 m/s */
  cornerSpeed: 9,
  turnSpeed: 6,
  /** 回り込み役が目指す「行く手」までの秒と、その距離の範囲 m */
  flankLead: 3.5,
  flankMin: 28,
  flankMax: 85,
  /** 動けない秒がこれを超えたら、この秒だけ下がって切り返す */
  stuckTime: 1.4,
  reverseTime: 1.3,
  /** 見失ったあと、最後に見た場所の周りを捜す半径 m と、捜す先を変える間隔（秒） */
  searchRadius: 70,
  searchEvery: 6,
  /** 塞ぐ役が待ち続ける上限（秒） */
  blockTime: 22,
  /** 主人公がこの速さより遅くてこの距離より近ければ、横に止めて捕まえに掛かる */
  arrestSpeed: 2.5,
  arrestRange: 6.5,
  /** 歩きの相手には、この距離で止めて警官を降ろす。近づくときの上限 m/s */
  footStop: 14,
  footApproach: 13,
  /** 向かい合って正面から寄せるときの上限 m/s */
  headOnSpeed: 17,
}

/** 追う相手（主人公）のいま */
export interface PursuitTarget {
  x: number
  z: number
  heading: number
  speed: number
  /** 乗っている車の id。null なら歩き（歩きの相手には車をぶつけず、手前で止めて警官を降ろす） */
  vehicleId?: number | null
}

// ----------------------------------------------------------------------------
// 道路グラフの最短の道筋（A*）
// ----------------------------------------------------------------------------

/** 交差点ごとの「入ってくる一方通行の辺」。警察が逆走するときに使う（グラフごとに1回だけ作る） */
const oneWayInto = new WeakMap<RoadGraph, number[][]>()
function oneWaysInto(graph: RoadGraph): number[][] {
  const cached = oneWayInto.get(graph)
  if (cached) return cached
  const into: number[][] = graph.nodes.map(() => [])
  for (const e of graph.edges) if (e.rev < 0) into[e.to].push(e.id)
  oneWayInto.set(graph, into)
  return into
}

/** 逆走する辺の印（~id）を、辺の番号と向きへ戻す */
const edgeOf = (code: number) => (code < 0 ? { id: ~code, reversed: true } : { id: code, reversed: false })

/**
 * from の交差点から to の交差点までの辺の並び。同じ交差点なら []、届かなければ null。
 * wrongWay を渡すと、一方通行の逆走も（道のりをその倍に数えて）許す。逆走する辺は ~id で返す。
 */
export function shortestPath(graph: RoadGraph, from: number, to: number, wrongWay = 0): number[] | null {
  if (from === to) return []
  const n = graph.nodes.length
  if (!graph.nodes[from] || !graph.nodes[to]) return null
  const cost = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  /** その交差点へ逆走で入ったか */
  const back = new Uint8Array(n)
  const goal = graph.nodes[to]
  const guess = (i: number) => Math.hypot(graph.nodes[i].x - goal.x, graph.nodes[i].z - goal.z)
  // 小さい順に取り出す二分ヒープ（[見込み, 交差点] の組）
  const heap: [number, number][] = []
  const push = (f: number, node: number) => {
    heap.push([f, node])
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent][0] <= heap[i][0]) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }
  const pop = (): number => {
    const top = heap[0][1]
    const last = heap.pop()
    if (heap.length > 0 && last) {
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

  cost[from] = 0
  push(guess(from), from)
  while (heap.length > 0) {
    const cur = pop()
    if (cur === to) break
    if (closed[cur]) continue
    closed[cur] = 1
    for (const id of graph.nodes[cur].out) {
      const edge = graph.edges[id]
      const c = cost[cur] + edge.length
      if (c < cost[edge.to]) {
        cost[edge.to] = c
        via[edge.to] = id
        back[edge.to] = 0
        push(c + guess(edge.to), edge.to)
      }
    }
    if (wrongWay <= 0) continue
    for (const id of oneWaysInto(graph)[cur]) {
      const edge = graph.edges[id]
      const c = cost[cur] + edge.length * wrongWay
      if (c < cost[edge.from]) {
        cost[edge.from] = c
        via[edge.from] = id
        back[edge.from] = 1
        push(c + guess(edge.from), edge.from)
      }
    }
  }
  if (via[to] < 0) return null
  const path: number[] = []
  for (let at = to; at !== from; ) {
    const id = via[at]
    path.push(back[at] ? ~id : id)
    at = back[at] ? graph.edges[id].to : graph.edges[id].from
  }
  return path.reverse()
}

/** 近い順に k 個の交差点 */
function nearNodes(world: GtoWorld, x: number, z: number, k: number): number[] {
  const nodes = world.driveGraph.nodes
  const best: { i: number; d: number }[] = []
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) * (nodes[i].x - x) + (nodes[i].z - z) * (nodes[i].z - z)
    if (best.length === k && d >= best[k - 1].d) continue
    best.push({ i, d })
    best.sort((a, b) => a.d - b.d)
    if (best.length > k) best.pop()
  }
  return best.map((b) => b.i)
}

/** いちばん近い交差点。近い3つのうち、建物に遮られず見通せるものを優先する */
function nearestNode(world: GtoWorld, x: number, z: number): number {
  const nodes = world.driveGraph.nodes
  const near = nearNodes(world, x, z, 3)
  for (const i of near) {
    if (world.segmentClear(x, z, nodes[i].x, nodes[i].z) >= 1) return i
  }
  return near[0] ?? -1
}

/**
 * 車のいる場所から to の交差点までの道筋。
 * 上下線が分かれた道で反対車線側の交差点を拾うと大回りになるので、近くの交差点をいくつか試して、
 * 「そこまでの距離 ＋ 道のり」がいちばん短いものを選ぶ（警察は車線の向きに縛られず隣の車線へ移る）。
 */
function pathFrom(world: GtoWorld, x: number, z: number, to: number): number[] | null {
  const graph = world.driveGraph
  let best: number[] | null = null
  let bestCost = Infinity
  for (const from of nearNodes(world, x, z, 5)) {
    const n = graph.nodes[from]
    if (world.segmentClear(x, z, n.x, n.z) < 1) continue
    const path = shortestPath(graph, from, to, PURSUIT_TUNING.wrongWay)
    if (!path) continue
    const cost = Math.hypot(n.x - x, n.z - z) * 1.5 + path.reduce((sum, code) => sum + graph.edges[edgeOf(code).id].length, 0)
    if (cost < bestCost) {
      bestCost = cost
      best = path
    }
  }
  return best
}

interface Waypoint {
  wx: number
  wz: number
  direct: boolean
  corner: boolean
}

/** 道路グラフを辿って goal へ向かうとき、いま目指すべき道の上の地点 */
function routePoint(world: GtoWorld, v: { x: number; z: number; speed?: number }, goal: { x: number; z: number }): Waypoint {
  const graph = world.driveGraph
  const fallback: Waypoint = { wx: goal.x, wz: goal.z, direct: false, corner: false }
  const to = nearestNode(world, goal.x, goal.z)
  if (to < 0) return fallback
  const path = pathFrom(world, v.x, v.z, to)
  if (!path || path.length === 0) return fallback

  // 道筋の中心線を、先読みの距離の少し先まで点の列に並べる
  const pts: number[] = []
  let run = 0
  for (const code of path) {
    const { id, reversed } = edgeOf(code)
    const e = graph.edges[id]
    const n = e.pts.length
    for (let i = pts.length === 0 ? 0 : 2; i < n; i += 2) {
      const k = reversed ? n - 2 - i : i
      pts.push(e.pts[k], e.pts[k + 1])
    }
    run += e.length
    if (run > PURSUIT_TUNING.lookAhead * 3) break
  }
  if (pts.length < 4) return fallback
  const cum = cumulative(pts)

  // 車をその線の上へ落とし、そこから先読みの距離だけ進んだ地点を目指す（道の途中にいても引き返さない）
  let at = 0
  let bestD = Infinity
  for (let i = 2; i < pts.length; i += 2) {
    const c = closestOnSegment(v.x, v.z, pts[i - 2], pts[i - 1], pts[i], pts[i + 1])
    const d = (c.x - v.x) * (c.x - v.x) + (c.z - v.z) * (c.z - v.z)
    if (d < bestD) {
      bestD = d
      at = cum[i / 2 - 1] + Math.hypot(c.x - pts[i - 2], c.z - pts[i - 1])
    }
  }
  // 速いほど遠くを見る。建物の角に遮られるなら、見通せるところまで手前へ詰める
  let reach = clamp(10 + Math.abs(v.speed ?? 0) * 1.1, 12, PURSUIT_TUNING.lookAhead)
  let aim = pointAlong(pts, cum, at + reach)
  for (let i = 0; i < 3 && world.segmentClear(v.x, v.z, aim.x, aim.z) < 1; i++) {
    reach *= 0.5
    aim = pointAlong(pts, cum, at + reach)
  }
  // その先で道が大きく曲がる（または道筋が終わる）なら、手前で速さを落とす
  const total = cum[cum.length - 1]
  const beyond = pointAlong(pts, cum, Math.min(total, at + reach + 14))
  const corner = at + reach + 4 >= total || Math.abs(angleDiff(headingOf(aim.x - v.x, aim.z - v.z), beyond.heading)) > 0.55
  return { wx: aim.x, wz: aim.z, direct: false, corner }
}

// ----------------------------------------------------------------------------
// 役割ごとの行き先
// ----------------------------------------------------------------------------

const newUnit = (id: number, role: PoliceRole, v: VehicleState): PoliceUnit => ({
  id,
  role,
  wx: v.x,
  wz: v.z,
  direct: false,
  corner: false,
  replan: 0,
  stuck: 0,
  reverse: 0,
  age: 0,
})

/** 新しく出た車両の役割。護送車は塞ぐ役、あとは追う役と回り込み役を交互に */
function roleFor(v: VehicleState, units: PoliceUnit[]): PoliceRole {
  if (v.kind === 'van') return 'block'
  const chase = units.filter((u) => u.role === 'chase').length
  const flank = units.filter((u) => u.role === 'flank').length
  return chase <= flank ? 'chase' : 'flank'
}

/** この車がいま目指す場所（道筋を引く前の、最終的な行き先） */
function goalOf(
  u: PoliceUnit,
  v: VehicleState,
  target: PursuitTarget,
  seen: boolean,
  lastSeen: { x: number; z: number } | null | undefined,
): { x: number; z: number; chasing: boolean } {
  const T = PURSUIT_TUNING
  if (!seen && lastSeen) {
    // 見失った: まず最後に見た場所へ。着いたら周りを順に捜す
    if (Math.hypot(v.x - lastSeen.x, v.z - lastSeen.z) > 30 && u.age % (T.searchEvery * 2) < T.searchEvery) {
      return { x: lastSeen.x, z: lastSeen.z, chasing: false }
    }
    const a = hash(u.id, Math.floor(u.age / T.searchEvery)) * TAU
    return { x: lastSeen.x + Math.sin(a) * T.searchRadius, z: lastSeen.z - Math.cos(a) * T.searchRadius, chasing: false }
  }
  const dist = Math.hypot(target.x - v.x, target.z - v.z)
  const f = dirOf(target.heading)
  const behind = ((v.x - target.x) * f.x + (v.z - target.z) * f.z) * (target.speed < 0 ? -1 : 1) < 0
  if (u.role === 'flank' && behind && dist > T.flankMin && Math.abs(target.speed) > 3) {
    // 回り込み: 後ろにいるあいだは、主人公が数秒後にいる辺りへ先回りする（行く手に出たら正面から向かう）
    const lead = clamp(Math.abs(target.speed) * T.flankLead, T.flankMin, T.flankMax) * Math.sign(target.speed)
    return { x: target.x + f.x * lead, z: target.z + f.z * lead, chasing: false }
  }
  // 追う: 相手の少し先を狙って、横腹に当てに行く
  const lead = target.speed * clamp(dist / 30, 0, 1.1)
  return { x: target.x + f.x * lead, z: target.z + f.z * lead, chasing: true }
}

/** 塞ぐ役をやめて追い始めるか（主人公に抜かれた・触れられた・待ちくたびれた） */
function blockOver(u: PoliceUnit, v: VehicleState, target: PursuitTarget, seen: boolean): boolean {
  if (u.age > PURSUIT_TUNING.blockTime || (!seen && u.age > 10)) return true
  const dx = v.x - target.x
  const dz = v.z - target.z
  const dist = Math.hypot(dx, dz)
  if (dist < 7 && u.age > 1) return true
  const f = dirOf(target.heading)
  const ahead = (dx * f.x + dz * f.z) * (target.speed < 0 ? -1 : 1)
  return dist < 60 && ahead < -6
}

/**
 * 警察車両ぜんぶの役割と行き先を1歩ぶん進める。
 * seen は「警察から主人公が見えているか」。見えていなければ最後に見た場所（w.lastSeen）を捜す。
 */
export function planPursuit(
  w: WantedState,
  police: VehicleState[],
  target: PursuitTarget,
  seen: boolean,
  world: GtoWorld,
  dt: number,
): WantedState {
  const T = PURSUIT_TUNING
  const units: PoliceUnit[] = []
  for (const v of police) {
    const prev = w.units?.find((u) => u.id === v.id) ?? newUnit(v.id, roleFor(v, units), v)
    let u: PoliceUnit = { ...prev, age: prev.age + dt, replan: prev.replan - dt, reverse: Math.max(0, prev.reverse - dt) }

    if (u.role === 'block') {
      if (blockOver(u, v, target, seen)) u = { ...u, role: 'chase', replan: 0 }
      units.push(u)
      continue
    }

    // ---- 動けなくなったら下がって切り返す（主人公の横に止めているときは数えない） ----
    const gap = Math.hypot(target.x - v.x, target.z - v.z)
    const arresting = target.vehicleId === null ? gap < T.footStop + 3 : Math.abs(target.speed) < T.arrestSpeed && gap < T.arrestRange + 3
    const still = Math.abs(v.speed) < 0.8 && u.reverse <= 0 && !arresting
    u = { ...u, stuck: still ? u.stuck + dt : 0 }
    if (u.stuck > T.stuckTime) u = { ...u, stuck: 0, reverse: T.reverseTime }

    // ---- 行き先の引き直し（車両ごとに少しずらして、同じ歩に重ならないようにする） ----
    if (u.replan <= 0) {
      const goal = goalOf(u, v, target, seen, w.lastSeen)
      const dist = Math.hypot(goal.x - v.x, goal.z - v.z)
      const open = dist < T.directRange && world.segmentClear(v.x, v.z, goal.x, goal.z) >= 1
      const wp = open ? { wx: goal.x, wz: goal.z, direct: goal.chasing, corner: false } : routePoint(world, v, goal)
      u = { ...u, ...wp, replan: T.replan + (v.id % 5) * 0.04 }
    }
    units.push(u)
  }
  return { ...w, units }
}

// ----------------------------------------------------------------------------
// 毎歩の操作
// ----------------------------------------------------------------------------

/** 相手の行く手にいて、向かい合っているか */
function headOn(v: VehicleState, target: { x: number; z: number; speed?: number; heading?: number }): boolean {
  if (target.heading == null || Math.abs(target.speed ?? 0) < 4) return false
  const f = dirOf(target.heading)
  const ahead = ((v.x - target.x) * f.x + (v.z - target.z) * f.z) * ((target.speed ?? 0) < 0 ? -1 : 1)
  return ahead > 8 && Math.abs(angleDiff(v.heading, target.heading)) > 2
}

const STOP: VehicleControl = { throttle: 0, brake: 0, steer: 0, handbrake: true }

/** 役割を持たない車（単体のテストや、出た直後の1歩）の操作。相手へまっすぐ向かう */
function straightControl(v: VehicleState, target: { x: number; z: number }, world: GtoWorld): VehicleControl {
  const turn = angleDiff(v.heading, headingOf(target.x - v.x, target.z - v.z))
  const dist = Math.hypot(target.x - v.x, target.z - v.z)
  const f = dirOf(v.heading)
  const blocked = world.segmentClear(v.x, v.z, v.x + f.x * 7, v.z + f.z * 7) < 1
  if ((blocked && Math.abs(v.speed) < 3) || (Math.abs(turn) > 2.3 && dist < 14)) {
    return { throttle: 0, brake: 1, steer: clamp(-turn * 2, -1, 1), handbrake: false }
  }
  const throttle = dist < 9 ? 0.35 : Math.abs(turn) > 0.9 ? 0.5 : 1
  return { throttle, brake: 0, steer: clamp(turn * 1.8, -1, 1), handbrake: Math.abs(turn) > 1.4 && v.speed > 12 }
}

/**
 * 追う車の操作。wanted.units にその車の行き先があれば道沿いにそこへ向かい、
 * 曲がり角の手前で減速し、動けなければ下がって切り返す。主人公が止まっていれば横に止める。
 */
export function policeControl(
  v: VehicleState,
  target: { x: number; z: number; speed?: number; heading?: number; vehicleId?: number | null },
  world: GtoWorld,
  wanted?: WantedState,
): VehicleControl {
  const u = wanted?.units?.find((unit) => unit.id === v.id)
  if (!u) return straightControl(v, target, world)
  const T = PURSUIT_TUNING
  if (u.role === 'block') return STOP

  const turn = angleDiff(v.heading, headingOf(u.wx - v.x, u.wz - v.z))
  if (u.reverse > 0) return { throttle: 0, brake: 1, steer: clamp(-turn * 2, -1, 1), handbrake: false }

  // 主人公がそばで止まっている: ぶつけ続けずに止めて、捕まえに掛かる
  const toPlayer = Math.hypot(target.x - v.x, target.z - v.z)
  const onFoot = target.vehicleId === null
  if (onFoot ? toPlayer < T.footStop : Math.abs(target.speed ?? 99) < T.arrestSpeed && toPlayer < T.arrestRange) {
    return { throttle: 0, brake: v.speed > 0.5 ? 1 : 0, steer: 0, handbrake: Math.abs(v.speed) <= 0.5 }
  }

  const dist = Math.hypot(u.wx - v.x, u.wz - v.z)
  const sharp = Math.abs(turn)
  let limit = u.direct ? T.chaseSpeed : toPlayer > T.catchUpRange && !u.corner ? T.catchUp : T.cruise
  // 歩きの相手には、近づくほど速さを落として手前で止まれるようにする
  if (onFoot) limit = Math.min(limit, T.footApproach * 0.5 + toPlayer * 0.35)
  // 正面から向かうときは突っ込みすぎない（道を塞ぐように寄せる）
  if (u.direct && !onFoot && headOn(v, target)) limit = Math.min(limit, T.headOnSpeed)
  if (u.corner && dist < 18) limit = Math.min(limit, T.cornerSpeed + dist * 0.4)
  if (sharp > 0.5) limit = Math.min(limit, T.cornerSpeed)
  if (sharp > 1.2) limit = Math.min(limit, T.turnSpeed)
  // 前が壁で大きく向きを変えたいときは、下がりながら切り返す（空いていれば、そのまま小回りで折り返す）
  const f = dirOf(v.heading)
  const walled = world.segmentClear(v.x, v.z, v.x + f.x * 7, v.z + f.z * 7) < 1
  if (walled && sharp > 1.6 && Math.abs(v.speed) < 4) return { throttle: 0, brake: 1, steer: clamp(-turn * 2, -1, 1), handbrake: false }
  return {
    throttle: v.speed < limit ? 1 : 0,
    brake: v.speed > limit + 8 ? 1 : v.speed > limit + 3 ? 0.6 : 0,
    steer: clamp(turn * 1.8, -1, 1),
    handbrake: sharp > 1.4 && v.speed > 12,
  }
}
