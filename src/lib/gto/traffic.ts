// Grand Theft Outfit [部品: traffic-peds] 車の交通。
// 入口: spawnTraffic / stepTraffic / needsRespawn
// 契約: driver が 'traffic' の車だけを、道路グラフ（world.driveGraph）に沿って進める。
//       左側通行で車線を守り、角は丸く曲がる。信号（graph.ts）の赤と黄で停止線に止まり、
//       信号の無い交差点では格上の道の車に譲り、右折では対向の直進に譲る。前が詰まれば止まり、
//       停まったままの車はよけて通る。プレイヤーに奪われた車（driver が変わった車）には触らない。
//       車は主人公のいる道の「道なり」に優先して出す（同じ車線の前と対向車線に、流れる車が常に数台見える）。
//       通り過ぎた車・視界の外の遠い車は早めに出し直して、限られた台数を見える所へ回す。
import { getSignals, lampAt } from './graph'
import { angleDiff, approach, clamp, dirOf, dist2 } from './math'
import { cornerLen, cruiseOf, laneOffset, rankOf, routePoint, TRAFFIC_TUNING, turnBetween, type Hazard } from './trafficLane'
import { noteHazards } from './trafficSpawn'
import { yieldBack } from './trafficYield'
import type { GraphEdge, GtoWorld, RoadGraph, TrafficRoute, VehicleState } from './types'

export { laneOffset, routePoint, TRAFFIC_TUNING, turnBetween, type Hazard } from './trafficLane'
export { demoRoad, laneLeftOf, needsRespawn, spawnTraffic, type TrafficCenter } from './trafficSpawn'

/** 次の辺を選ぶ。直進と大きい道を選びやすく、引き返すのは行き止まりだけ。無ければ −1。keepOn なら、ほぼ道なりに進む（主人公の前を走る車列） */
function chooseNext(graph: RoadGraph, edge: GraphEdge, next: () => number, keepOn = false): number {
  const out = graph.nodes[edge.to].out
  const onward = out.filter((id) => id !== edge.rev)
  const pool = onward.length > 0 ? onward : out
  if (pool.length === 0) return -1
  const weights = pool.map((id) => {
    const e = graph.edges[id]
    const straight = Math.cos(turnBetween(edge, e) / 2) ** 2
    // 行き止まりへ入る辺は、ほとんど選ばない
    const deadEnd = graph.nodes[e.to].out.every((o) => o === e.rev)
    return (keepOn ? 0.02 + 3 * straight ** 6 : 0.4 + 3 * straight) * (e.kind === 'service' ? 0.2 : 1 + rankOf(e) * 0.25) * (deadEnd ? 0.03 : 1)
  })
  let roll = next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/** 止まる場所まで d m のとき、いま出してよい速さ */
const speedToStop = (d: number, decel = TRAFFIC_TUNING.comfort) => Math.sqrt(2 * decel * Math.max(0, d))

/** 次の辺と、その次の辺まで決めておく（短い辺が続く交差点で、入る前から曲がる先が分かる） */
function planAhead(graph: RoadGraph, route: TrafficRoute, next: () => number): TrafficRoute {
  const keepOn = route.pace != null
  let r = route
  if (r.next == null) r = { ...r, next: chooseNext(graph, graph.edges[r.edge], next, keepOn), next2: undefined }
  if (r.next2 == null && r.next != null && r.next >= 0) r = { ...r, next2: chooseNext(graph, graph.edges[r.next], next, keepOn) }
  return r
}

/**
 * 後ろから速い車（交通ではない車）が同じ車線で迫っているとき、横へ寄る幅 m（右が＋、寄らないなら 0）。
 * 追い付かれるまでの秒が短いときだけ寄り、横に並んでいるあいだは寄ったままでいる。道の端と中心線は越えない。
 */
function giveWayShift(v: VehicleState, edge: GraphEdge, hazards: Hazard[]): number {
  const T = TRAFFIC_TUNING
  const f = dirOf(v.heading)
  for (const h of hazards) {
    if (h.id < 0 || h.id === v.id || h.edge != null || h.parked || h.heading == null || h.speed == null) continue
    if (Math.abs(angleDiff(h.heading, v.heading)) > 0.5) continue
    const dx = h.x - v.x
    const dz = h.z - v.z
    const ahead = dx * f.x + dz * f.z
    // 自分がもう寄っているぶんを戻して、車線の上にいたとしての横のずれで決める
    const side = -dx * f.z + dz * f.x + (v.route?.swerve ?? 0)
    if (ahead > 7 || ahead < -T.giveWayRange || Math.abs(side) > T.giveWayClear) continue
    const closing = h.speed - v.speed
    // まだ後ろにいる車は、追い付かれそうなときだけ。横に並んだ車は、通り過ぎるまで
    if (ahead < -5 && (closing < 2.5 || (-ahead - 4.5) / closing > T.giveWayEta)) continue
    const off = laneOffset(edge, v.route?.lane ?? v.id)
    const leftRoom = off + edge.width / 2 - 0.9
    const rightRoom = (edge.rev >= 0 ? -1.2 : edge.width / 2 - 0.9) - off
    const left = side >= 0
    const need = T.giveWayClear + 0.1 - Math.abs(side)
    // 寄った先（隣の車線）に ほかの車がいるなら寄らない
    const open = (shift: number) => sideOpen(v, hazards, shift, h.id)
    if ((left ? leftRoom : rightRoom) >= need) return open(left ? -need : need) ? (left ? -need : need) : 0
    // 真後ろに付かれたときだけ、反対側へよけてもよい（斜め後ろの車の前は横切らない）
    const other = T.giveWayClear + 0.1 + Math.abs(side)
    if (Math.abs(side) < 0.5 && (left ? rightRoom : leftRoom) >= other) return open(left ? other : -other) ? (left ? other : -other) : 0
    // 空けきれない道でも、寄れるだけ寄る
    const room = left ? leftRoom : rightRoom
    if (room >= 1) return open(left ? -room : room) ? (left ? -room : room) : 0
    return 0
  }
  return 0
}

/** 道筋の上の、これから通る点（2m おき、look m 先まで。次の辺へ跨ぐ）。d はそこまでの道のり */
function pathAhead(graph: RoadGraph, route: TrafficRoute, id: number, look: number): { x: number; z: number; d: number }[] {
  const edge = graph.edges[route.edge]
  const nextE = route.next != null && route.next >= 0 ? graph.edges[route.next] : null
  const out: { x: number; z: number; d: number }[] = []
  for (let d = 2; d <= look; d += 2) {
    const s = route.s + d
    if (s <= edge.length) out.push({ ...routePoint(graph, { ...route, s }, id), d })
    else if (nextE && s - edge.length < nextE.length) out.push({ ...routePoint(graph, { edge: nextE.id, s: s - edge.length, cruise: route.cruise, prev: edge.id, lane: route.lane }, id), d })
    else break
  }
  return out
}

/** 同じ向きの後ろから、交通ではない車が ずっと速く迫っていて、数秒で追い付かれるか */
function rushedFromBehind(v: VehicleState, hazards: Hazard[]): boolean {
  const T = TRAFFIC_TUNING
  const f = dirOf(v.heading)
  for (const h of hazards) {
    if (h.id < 0 || h.id === v.id || h.edge != null || h.parked || h.heading == null || h.speed == null) continue
    const closing = h.speed - v.speed
    if (closing < T.rushClosing || Math.abs(angleDiff(h.heading, v.heading)) > 0.6) continue
    const dx = h.x - v.x
    const dz = h.z - v.z
    const ahead = dx * f.x + dz * f.z
    if (ahead > -2 || -ahead / closing > T.rushEta || Math.abs(-dx * f.z + dz * f.x) > 8) continue
    return true
  }
  return false
}

/** 辺の終点から、ほぼ真っ直ぐ進める辺（無ければ −1） */
function straightest(graph: RoadGraph, edge: GraphEdge): number {
  let best = -1
  let bend = 0.5
  for (const id of graph.nodes[edge.to].out) {
    if (id === edge.rev) continue
    const turn = Math.abs(turnBetween(edge, graph.edges[id]))
    if (turn < bend) {
      bend = turn
      best = id
    }
  }
  return best
}

/** 車線から横へ shift m ずれた所に、ほかの車（except は除く）がいないか */
function sideOpen(v: VehicleState, hazards: Hazard[], shift: number, except = -1): boolean {
  const f = dirOf(v.heading)
  for (const o of hazards) {
    if (o.id < 0 || o.id === v.id || o.id === except || o.parked) continue
    const ox = o.x - v.x
    const oz = o.z - v.z
    if (Math.abs(ox * f.x + oz * f.z) < 8 && Math.abs(-ox * f.z + oz * f.x + (v.route?.swerve ?? 0) - shift) < 2.5) return false
  }
  return true
}

/** 同じ車線のすぐ後ろから、交通ではない車が速く迫っているとき、合わせて上げる速さ m/s（迫られていなければ 0） */
function pushedPace(v: VehicleState, hazards: Hazard[]): number {
  const T = TRAFFIC_TUNING
  const f = dirOf(v.heading)
  let pace = 0
  for (const h of hazards) {
    if (h.id < 0 || h.id === v.id || h.edge != null || h.parked || h.heading == null || h.speed == null) continue
    if (h.speed < v.speed + 1.5 || Math.abs(angleDiff(h.heading, v.heading)) > 0.5) continue
    const dx = h.x - v.x
    const dz = h.z - v.z
    const ahead = dx * f.x + dz * f.z
    if (ahead > -3 || ahead < -T.pushRange || Math.abs(-dx * f.z + dz * f.x) > 2) continue
    pace = Math.max(pace, Math.min(T.pushMax, h.speed + 0.5))
  }
  return pace
}

/** 交通の車を1台、1歩進める。t は sim の経過秒（信号の色を決める） */
export function stepTraffic(
  v: VehicleState,
  world: GtoWorld,
  hazards: Hazard[],
  next: () => number,
  dt: number,
  t = 0,
): VehicleState {
  if (v.driver !== 'traffic' || !v.route) return v
  noteHazards(world, hazards)
  const T = TRAFFIC_TUNING
  const graph = world.driveGraph
  let edge = graph.edges[v.route.edge]
  if (!edge) return { ...v, route: null }
  let route: TrafficRoute = planAhead(graph, v.route, next)
  const nextE = route.next != null && route.next >= 0 ? graph.edges[route.next] : null
  const next2E = nextE && route.next2 != null && route.next2 >= 0 ? graph.edges[route.next2] : null
  const prevE = route.prev != null && route.prev >= 0 ? graph.edges[route.prev] : null
  const toNode = edge.length - route.s
  const bold = (route.wait ?? 0) > T.patience
  // 後ろから速い車（主人公や警察）が同じ車線で迫ってきたら、流れを上げて逃げる（寄る場所が無くても追突されにくい）
  let target = Math.max(route.cruise, pushedPace(v, hazards))
  let held = false

  // ---- 角は速さを落として曲がる ----
  const r = cornerLen(edge)
  if (nextE) {
    const sharp = clamp(Math.abs(turnBetween(edge, nextE)) / (Math.PI / 2), 0, 1)
    const vc = route.cruise + (Math.min(route.cruise, T.cornerSpeed) - route.cruise) * sharp
    target = Math.min(target, Math.sqrt(vc * vc + 2 * 2.2 * Math.max(0, toNode - r)))
    // 次の辺が短く、その先で曲がるなら、いまの辺から減速を始める
    if (next2E && nextE.length < T.shortEdge) {
      const sharp2 = clamp(Math.abs(turnBetween(nextE, next2E)) / (Math.PI / 2), 0, 1)
      const vc2 = route.cruise + (Math.min(route.cruise, T.cornerSpeed) - route.cruise) * sharp2
      target = Math.min(target, Math.sqrt(vc2 * vc2 + 2 * 2.2 * Math.max(0, toNode + nextE.length - cornerLen(nextE))))
    }
  } else {
    // 行き止まりは、端で止まる
    target = Math.min(target, speedToStop(toNode - 1) + 0.5)
  }
  if (prevE && route.s < r) {
    const sharp = clamp(Math.abs(turnBetween(prevE, edge)) / (Math.PI / 2), 0, 1)
    target = Math.min(target, route.cruise + (Math.min(route.cruise, T.cornerSpeed) - route.cruise) * sharp)
  }

  // ---- 信号: 赤と、止まれる黄では停止線で止まる ----
  const net = getSignals(world)
  let redNear = false
  const lineAhead = (dLine: number, junction: number, group: 0 | 1) => {
    const d = dLine - T.nose
    if (d < -1.2) return // もう停止線を越えている
    const lamp = lampAt(net, junction, group, t)
    if (lamp === 'green') return
    // 赤の列に並んでいるあいだ（先頭でなくても）は、待ちくたびれない
    if (d < T.redQueue) redNear = true
    if (lamp === 'yellow' && d < (v.speed * v.speed) / (2 * T.yellowBrake)) return
    target = Math.min(target, speedToStop(d - 0.3))
  }
  for (const st of net.stops[edge.id]) if (st.s >= route.s - 1) lineAhead(st.s - route.s, st.junction, st.group)
  // 先の辺の停止線（短い辺が続く所でも、手前から減速を始める）
  for (const st of net.ahead[edge.id]) if (st.via === route.next) lineAhead(st.s - route.s, st.junction, st.group)

  // 赤信号で止まっているあいだは、よけも割り込みもしない
  const atRed = target < 0.6

  // ---- 後ろから ずっと速い車（主人公や警察）が来ているあいだは、その前を横切って曲がらない（道なりの辺があれば、そちらへ） ----
  if (nextE && toNode < T.yieldDist && toNode > 3 && Math.abs(turnBetween(edge, nextE)) > 0.6 && rushedFromBehind(v, hazards)) {
    const onward = straightest(graph, edge)
    if (onward >= 0 && onward !== route.next) return stepTraffic({ ...v, route: { ...route, next: onward, next2: undefined } }, world, hazards, next, dt, t)
  }

  // ---- 交差点で譲る ----
  // 待つ場所をもう過ぎた車は、交差点の中では止まらずに抜ける（横向きのまま居座らない）
  if (nextE && !bold && toNode < T.yieldDist) {
    let stopAt: number | null = null
    const back = yieldBack(graph, net, v, edge, nextE, toNode, hazards)
    if (back != null) stopAt = toNode - back
    else if (next2E && nextE.length < T.shortEdge) {
      // 次の辺が短い（交差点の中の繋ぎ）なら、その先の交差点で譲るかも ここで決める
      const far = yieldBack(graph, net, v, nextE, next2E, toNode + nextE.length, hazards, edge.id)
      if (far != null) {
        // 繋ぎの辺の上で待てる長さがあれば そこで、無ければ手前の節の前で待つ
        const first = Math.abs(turnBetween(edge, nextE)) < 0.5 && nextE.length - far > 2 ? toNode + nextE.length - far : toNode - T.yieldBack
        stopAt = first
      }
    }
    if (stopAt != null && stopAt > -1) {
      target = Math.min(target, speedToStop(stopAt))
      held = true
    }
  }

  // ---- 前が詰まっていれば止まる。動かない物（停まった車、道に立つ人）は、待ってからよける ----
  const waited = route.wait ?? 0
  const turning = nextE != null && Math.abs(turnBetween(edge, nextE)) > 0.6
  const f = dirOf(v.heading)
  const look = T.lookBase + Math.max(0, v.speed) * T.lookPerSpeed
  let swerveTo = 0
  let parkedBlock = false
  const swerving = Math.abs(route.swerve ?? 0) > 0.05
  // 角を曲がっている最中は、真っ直ぐ前ではなく、これから通る曲線の上にある物だけを見る
  // （右折の途中で、対向車線で待っている車を「前にいる」と見て向かい合ったまま止まらない）
  const sharpNext = nextE != null && Math.abs(turnBetween(edge, nextE)) > 0.5 && toNode < r + look
  const sharpPrev = prevE != null && Math.abs(turnBetween(prevE, edge)) > 0.5 && route.s < r
  const path = sharpNext || sharpPrev ? pathAhead(graph, route, v.id, look) : null
  for (const h of hazards) {
    if (h.id === v.id) continue
    const dx = h.x - v.x
    const dz = h.z - v.z
    let ahead = dx * f.x + dz * f.z
    let side = -dx * f.z + dz * f.x
    if (path && !h.parked && dx * dx + dz * dz > 9) {
      const clear = h.id >= 0 ? 1.1 + h.r * 0.6 : 1.3
      const hit = path.find((q) => dist2(q.x, q.z, h.x, h.z) < clear * clear)
      if (!hit) continue
      ahead = hit.d + h.r
      side = 0
    }
    // 動かない物: 誰も乗っていない車と、しばらく待ってもどかない人
    const still = h.parked === true || (h.id < 0 && !redNear && (swerving || waited > T.swerveAfterPed))
    // 曲がる交差点の手前では、よけない（よけたまま交わる道の車線へはみ出して、待っている車に重なる）
    if (still && !atRed && (toNode > T.swerveNode || !turning) && Math.abs(ahead) < 11 && Math.abs(side) < 5 && (swerving || waited > T.swerveAfter)) {
      // いちど よけ始めたら、通り過ぎるまで同じ側へよけ続ける
      swerveTo = (swerving ? Math.sign(route.swerve ?? 0) : side >= 0.3 ? -1 : 1) * T.swerveWidth
    }
    const reach = h.parked ? 2 : h.id >= 0 ? 1.3 + h.r * 0.6 : 1.4
    const moving = h.speed != null && h.heading != null
    const rel = moving ? Math.abs(angleDiff(h.heading ?? 0, v.heading)) : 0
    const sameWay = moving && rel < 0.8
    // 同じ向きの交通の車と真横に重なったら（別の道から同じ車線へ同時に合流した）、番号の大きいほうが待って後ろへ入る
    // （相手が動いているときだけ。止まった車の横で待つと、互いに動けなくなる）
    if (sameWay && h.edge != null && h.id < v.id && (h.speed ?? 0) > 1 && ahead <= 0.5 && ahead > -3 && Math.abs(side) < 2.3) {
      target = Math.min(target, Math.max(0, (h.speed ?? 0) - 2))
    }
    if (ahead < 0.5 || ahead > look + h.r) continue
    if (Math.abs(side) >= reach) continue
    if (moving && !h.parked && !sameWay) {
      // 対向車は、右側をすれ違うなら邪魔にならない。細い道で正面から詰まったら、しびれを切らした側が抜ける（主人公や警察の車には突っ込まない）
      if (rel > 2.2 && (side > 0.4 || (bold && h.edge != null))) continue
      // 交差点の中で互いに塞ぎ合ったら、番号の若い車から先に抜ける（交通の車どうしだけ。主人公や警察の車は押しのけない）
      if (rel <= 2.2 && h.edge != null && (h.speed ?? 0) < 0.3 && (bold || (waited > 2 && v.id < h.id))) continue
    }
    const gap = ahead - h.r
    const lead = sameWay ? Math.max(0, h.speed ?? 0) * 0.7 : 0
    // 主人公や警察の車の後ろでは、背後のカメラに車体が被らないよう長めに空ける
    const behindPlayer = sameWay && h.id >= 0 && h.edge == null && !h.parked
    const allowed = speedToStop(gap - (h.parked ? T.parkedGap : behindPlayer ? T.playerGap : T.standGap)) + lead
    if (allowed < target) {
      target = allowed
      held = held || lead < 0.5
      if (h.parked) parkedBlock = true
    }
  }
  // 赤の列の中では待ちくたびれない。ただし停まったままの車に塞がれているなら、信号が近くても よける
  if (atRed || (redNear && !parkedBlock)) held = false
  // ---- 後ろから速い車（主人公や警察）が同じ車線で迫ってきたら、横へ寄って先に行かせる ----
  let yielding = false
  if (swerveTo === 0 && !atRed) {
    const give = giveWayShift(v, edge, hazards)
    if (give !== 0) {
      swerveTo = give
      yielding = true
      // 先に行かせているあいだは、その車の前を横切って曲がらない（道なりの辺があれば、そちらへ進む）
      if (turning && toNode > 3) {
        const onward = straightest(graph, edge)
        if (onward >= 0 && onward !== route.next) return stepTraffic({ ...v, route: { ...route, next: onward, next2: undefined } }, world, hazards, next, dt, t)
      }
    }
  }
  // よける先に走っている車がいるなら、いまの横ずれのまま待つ（隣の車線の車に寄っていかない）
  if (swerveTo !== 0 && !yielding && !sideOpen(v, hazards, swerveTo)) swerveTo = route.swerve ?? 0
  const swerveRate = (yielding ? T.giveWayRate : 1.4) * (Math.abs(v.speed) > 0.2 || swerveTo !== 0 ? 1 : 0)
  const swerve = approach(route.swerve ?? 0, swerveTo, swerveRate * dt)
  // よけている最中は、ゆっくり前へ出ながら横へずれる
  if (swerveTo !== 0 && !yielding && Math.abs(swerve) < Math.abs(swerveTo) - 0.4) target = Math.max(target, 1.2)

  const speed = approach(v.speed, target, (target < v.speed ? T.brake : T.accel) * dt)
  // 待たされた秒を数える。しびれを切らしたら、しばらく強気で進む
  let wait = route.wait ?? 0
  if (speed < 0.4 && held) wait = wait < T.patience && wait + dt >= T.patience ? T.patience + 4 : wait + dt
  else wait = Math.max(0, wait - dt * 1.5)

  // ---- 辺に沿って進む。終点に着いたら次の辺へ ----
  let s = route.s + speed * dt
  let cruise = route.cruise
  if (s >= edge.length) {
    // 行き止まり（地図の端の一方通行）に着いたら、道筋を手放して出し直してもらう
    if (!nextE) return { ...v, speed: 0, route: null }
    s -= edge.length
    const from = edge.id
    edge = nextE
    cruise = Math.min(cruiseOf(edge, v.id, next), route.pace ?? Infinity)
    route = planAhead(graph, { ...route, edge: edge.id, prev: from, next: route.next2, next2: undefined }, next)
  }
  route = { ...route, s, cruise, wait, swerve }
  const pos = routePoint(graph, route, v.id)
  const right = dirOf(pos.heading + Math.PI / 2)
  const x = pos.x + right.x * swerve
  const z = pos.z + right.z * swerve
  const turn = angleDiff(v.heading, pos.heading)
  const heading = v.heading + turn * (1 - Math.exp(-12 * dt))
  return {
    ...v,
    x,
    y: world.groundY(x, z),
    z,
    heading,
    speed,
    slip: 0,
    steer: clamp(turn * 2, -1, 1),
    yawRate: dt > 0 ? (heading - v.heading) / dt : 0,
    accel: dt > 0 ? (speed - v.speed) / dt : 0,
    route,
  }
}

/**
 * 撮影用のデモ運転が使う: 主人公の進路の上の、いちばん近い前の車までの間 m（車体の長さを引いた、おおよその隙間）。
 * world と t を渡すと、赤（と黄）の停止線も前の車と同じに扱う（信号を守って走れる）。前に何も無ければ Infinity。
 */
export function gapAhead(
  player: { x: number; z: number; heading: number; vehicleId?: number | null },
  vehicles: VehicleState[],
  world?: GtoWorld,
  t = 0,
): number {
  const f = dirOf(player.heading)
  let gap = Infinity
  for (const v of vehicles) {
    if (v.id === player.vehicleId) continue
    // 斜めや横向きの車（角を曲がっている途中の車）は、進路へはみ出す幅が広い
    const rel = angleDiff(player.heading, v.heading)
    const c = Math.abs(Math.cos(rel))
    const s = Math.abs(Math.sin(rel))
    const d = dirOf(v.heading)
    // 横切ってくる車は、少し先の位置でも見る（進路へ入ってくる前からブレーキを踏む）
    for (const ahead of s > 0.5 && v.speed > 1 ? [0, 0.7, 1.4] : [0]) {
      const dx = v.x + d.x * v.speed * ahead - player.x
      const dz = v.z + d.z * v.speed * ahead - player.z
      const front = dx * f.x + dz * f.z
      if (front <= 0 || front > 60) continue
      if (Math.abs(-dx * f.z + dz * f.x) > 1.1 + s * 2.2 + c * 0.9) continue
      gap = Math.min(gap, front - 2.2 - c * 2.2 - s * 0.9)
    }
  }
  if (!world) return gap
  // ---- 信号: 自分の向きの停止線が赤か黄なら、その手前までを間とみなす（もう越えた線は見ない） ----
  const net = getSignals(world)
  for (const list of net.stops) {
    for (const st of list) {
      if (st.via != null) continue
      const dx = st.x - player.x
      const dz = st.z - player.z
      const ahead = dx * f.x + dz * f.z
      if (ahead < TRAFFIC_TUNING.nose - 1.2 || ahead > 60 || Math.abs(-dx * f.z + dz * f.x) > 7) continue
      if (Math.abs(angleDiff(st.heading, player.heading)) > 0.6) continue
      if (lampAt(net, st.junction, st.group, t) === 'green') continue
      // もう交差点の中にいるなら、その交差点の停止線（別の入口の線）では止まらない
      const j = net.junctions[st.junction]
      if (Math.hypot(player.x - j.x, player.z - j.z) < Math.hypot(st.x - j.x, st.z - j.z) + 1) continue
      gap = Math.min(gap, ahead - TRAFFIC_TUNING.nose)
    }
  }
  return gap
}
