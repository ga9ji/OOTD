// Grand Theft Outfit [部品: traffic-peds] 歩行者。
// 入口: spawnPed / stepPed / needsPedRespawn
// 契約: 通行人を歩道のグラフ（world.walkGraph）に沿って歩かせる。信号のある横断歩道は青を待って
//       一斉に渡り（スクランブルは歩行者だけの時間に全方向）、迫ってくる車からは横へ飛びのき、
//       近くで騒ぎがあれば逃げ、車にはねられたら飛ばされて倒れる。スクランブル交差点の近くでは
//       人を交差点の周りに集める。服（outfitKey）の中身は outfit.ts が書き換える。
import { crowdSpot, getSignals, pickEdgeNear, walkAt, type SignalNet } from './graph'
import { angleDiff, approach, clamp, dirOf, dist2, hash, headingOf, pointAlong } from './math'
import type { GraphEdge, GtoEvent, GtoWorld, PedState, RoadGraph } from './types'

/** 手触りを決める数字 */
export const PED_TUNING = {
  spawnMin: 14,
  spawnMax: 95,
  despawn: 130,
  walkMin: 1.1,
  walkMax: 1.7,
  fleeSpeed: 4.6,
  /** 騒ぎに気づく距離 m と、逃げ続ける秒 */
  scareRange: 20,
  fleeTime: 5,
  /** はねられて倒れている秒 */
  downTime: 4,
  /** 車がこの速さ以上で触れたら、はねられる m/s */
  hitSpeed: 3,
  /** はねられて飛ばされる速さ（車の速さに掛ける）と、地面で止まるまでの減速 m/s² */
  throwScale: 0.7,
  throwDrag: 9,
  radius: 0.32,
  strideLength: 1.4,
  /** 飛びのく: 車の進路の先をいちばん長くて何秒ぶん見るか、横へ逃げる秒と速さ m/s */
  dodgeAhead: 1.3,
  dodgeTime: 1.1,
  dodgeSpeed: 5.2,
  /** 点滅や赤になってしまった横断歩道を、急いで渡りきる速さの倍率 */
  hurry: 1.8,
  /** 信号待ちで、角から下がって立つ幅 m（人だかりの奥行き） */
  waitDepth: 4.5,
  /** ぶつけられた車から降りる運転手: 車の中心から右へ出る幅 m と、逃げ続ける秒 */
  bailSide: 1.5,
  bailTime: 7,
  /** 人が集まる場所（スクランブル）: 主人公がこの距離より近ければ、人をそこへ寄せる m */
  crowdNear: 150,
  /** 集める範囲の半径 m と、出す人のうちそこへ回す割合 */
  crowdRadius: 38,
  crowdShare: 0.72,
  /** 集めているあいだは、主人公からこれより離れた人を出し直す m */
  crowdDespawn: 70,
}

function placeOn(world: GtoWorld, edgeId: number, s: number, side: number) {
  const edge = world.walkGraph.edges[edgeId]
  const p = pointAlong(edge.pts, edge.cum, s)
  const f = dirOf(p.heading)
  const x = p.x - f.z * side
  const z = p.z + f.x * side
  return { x, y: world.groundY(x, z), z, heading: p.heading }
}

const halfWidth = (edge: GraphEdge) => Math.max(0.3, edge.width / 2 - 0.4)

/** 主人公が人の集まる場所の近くにいるか */
function crowdFor(world: GtoWorld, center: { x: number; z: number }) {
  const spot = crowdSpot(world)
  if (!spot) return null
  return dist2(center.x, center.z, spot.x, spot.z) < PED_TUNING.crowdNear * PED_TUNING.crowdNear ? spot : null
}

/** 集まる場所の周りの辺を選ぶ。主人公から minD より近い所には出さない（目の前に湧かせない） */
function pickCrowdEdge(world: GtoWorld, spot: { x: number; z: number }, center: { x: number; z: number }, minD: number, next: () => number) {
  const net = getSignals(world)
  let best: { edge: GraphEdge; s: number } | null = null
  let bestD2 = Infinity
  for (let i = 0; i < 8; i++) {
    const found = pickEdgeNear(world.walkGraph, spot.x, spot.z, 0, PED_TUNING.crowdRadius, next, 80)
    if (!found) break
    // 信号のある横断歩道の上には出さない（赤で車道に立たせない）
    if (net.cross[found.edge.id]) continue
    const p = pointAlong(found.edge.pts, found.edge.cum, found.s)
    if (dist2(p.x, p.z, center.x, center.z) < minD * minD) continue
    // 2つ引けたら、交差点に近いほうを採る（角に人が溜まる）
    const d2 = dist2(p.x, p.z, spot.x, spot.z)
    if (best && d2 >= bestD2) return best
    if (best) return found
    best = found
    bestD2 = d2
  }
  return best
}

/** 中心の周りの歩道に、通行人を1人出す */
export function spawnPed(
  world: GtoWorld,
  id: number,
  center: { x: number; z: number },
  outfitKeys: string[],
  next: () => number,
  minD = PED_TUNING.spawnMin,
  maxD = PED_TUNING.spawnMax,
): PedState | null {
  if (outfitKeys.length === 0) return null
  const spot = crowdFor(world, center)
  const net = getSignals(world)
  let found = spot && next() < PED_TUNING.crowdShare ? pickCrowdEdge(world, spot, center, minD, next) : null
  if (!found) {
    for (let i = 0; i < 3 && !found; i++) {
      const c = pickEdgeNear(world.walkGraph, center.x, center.z, minD, maxD, next)
      if (c && !net.cross[c.edge.id]) found = c
    }
  }
  if (!found) return null
  const side = (next() * 2 - 1) * Math.min(halfWidth(found.edge), 3)
  const pos = placeOn(world, found.edge.id, found.s, side)
  const pace = PED_TUNING.walkMin + next() * (PED_TUNING.walkMax - PED_TUNING.walkMin)
  return {
    id,
    ...pos,
    speed: pace,
    outfitKey: outfitKeys[Math.floor(next() * outfitKeys.length)],
    mood: 'walk',
    timer: 0,
    route: { edge: found.edge.id, s: found.s, side, pace },
    stride: next(),
  }
}

/**
 * ぶつけられて道筋を外れた車の運転手。ドア（ふつうは右ハンドルの右）の外に出て、ぶつけた相手（from）から離れる向きへ走って逃げる。
 * sim.ts が、交通の車が弾かれたときに呼ぶ。
 */
export function bailOut(
  world: GtoWorld,
  car: { x: number; z: number; heading: number },
  id: number,
  outfitKey: string,
  from: { x: number; z: number },
): PedState {
  const T = PED_TUNING
  const right = dirOf(car.heading + Math.PI / 2)
  // 相手が右から当たってきたときだけ、左のドアから出る（降りた途端に はねられない）
  const fromSide = (from.x - car.x) * right.x + (from.z - car.z) * right.z
  const side = fromSide > 0.8 ? -T.bailSide : T.bailSide
  const out = world.resolveCircle(car.x + right.x * side, car.z + right.z * side, T.radius)
  // 人ごとに少し向きを散らす
  const heading = headingOf(out.x - from.x, out.z - from.z) + (hash(id, 5) - 0.5) * 0.6
  return {
    id,
    x: out.x,
    y: world.groundY(out.x, out.z),
    z: out.z,
    heading,
    speed: T.fleeSpeed,
    outfitKey,
    mood: 'flee',
    timer: T.bailTime,
    route: null,
    stride: 0,
  }
}

/** 遠くへ行った人は出し直す。人を集めているあいだは、早めに出し直して交差点の人波を保つ */
export function needsPedRespawn(p: PedState, center: { x: number; z: number }, world?: GtoWorld): boolean {
  const d2 = dist2(p.x, p.z, center.x, center.z)
  if (d2 > PED_TUNING.despawn * PED_TUNING.despawn) return true
  if (!world || p.mood !== 'walk' || !p.route) return false
  const spot = crowdFor(world, center)
  if (!spot) return false
  // 人ごとに少しずらして、同じ瞬間にまとめて消えないようにする
  const limit = PED_TUNING.crowdDespawn + hash(p.id, 7) * 20
  return d2 > limit * limit && dist2(p.x, p.z, spot.x, spot.z) > PED_TUNING.crowdRadius * PED_TUNING.crowdRadius
}

/** 通行人が避けるべき動く物（走っている車） */
export interface PedThreat {
  x: number
  z: number
  r: number
  speed: number
  /** 車の進む向き（あれば、進路の先にいる人が横へ飛びのく） */
  heading?: number
}

/** 次の辺を選ぶ。引き返さず、横断歩道を少し選びやすくする（交差点で人が渡る） */
function chooseNext(graph: RoadGraph, net: SignalNet, edge: GraphEdge, next: () => number): number {
  const out = graph.nodes[edge.to].out
  const onward = out.filter((id) => id !== edge.rev)
  const pool = onward.length > 0 ? onward : out
  if (pool.length === 0) return -1
  const weights = pool.map((id) => (net.cross[id] && net.junctions[net.cross[id].junction].scramble ? 4 : net.isCrossing[id] ? 2.2 : 1))
  let roll = next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/** 通行人を1人、1歩進める。events は直前の1歩で起きたこと、t は sim の経過秒（信号の色を決める） */
export function stepPed(
  ped: PedState,
  world: GtoWorld,
  threats: PedThreat[],
  events: GtoEvent[],
  next: () => number,
  dt: number,
  t = 0,
): { ped: PedState; events: GtoEvent[] } {
  const T = PED_TUNING
  const out: GtoEvent[] = []
  let p = ped

  // ---- 車にはねられる: 車の進む向きへ飛ばされて倒れる ----
  if (p.mood !== 'stunned') {
    for (const th of threats) {
      if (th.speed < T.hitSpeed) continue
      if (dist2(p.x, p.z, th.x, th.z) < (th.r + T.radius) * (th.r + T.radius)) {
        out.push({ type: 'hitPed', x: p.x, z: p.z, value: th.speed, ref: String(p.id) })
        const away = headingOf(p.x - th.x, p.z - th.z)
        const heading = th.heading != null ? th.heading + clamp(angleDiff(th.heading, away), -0.7, 0.7) : away
        return { ped: { ...p, mood: 'stunned', timer: T.downTime, heading, speed: th.speed * T.throwScale }, events: out }
      }
    }
  }

  if (p.mood === 'stunned') {
    const timer = p.timer - dt
    if (timer <= 0) return { ped: { ...p, mood: 'flee', timer: T.fleeTime, speed: T.fleeSpeed }, events: out }
    if (p.speed <= 0) return { ped: { ...p, timer, speed: 0 }, events: out }
    // 飛ばされた勢いで地面を滑って止まる
    const d = dirOf(p.heading)
    const res = world.resolveCircle(p.x + d.x * p.speed * dt, p.z + d.z * p.speed * dt, T.radius)
    const speed = res.hit ? 0 : Math.max(0, p.speed - T.throwDrag * dt)
    return { ped: { ...p, x: res.x, y: world.groundY(res.x, res.z), z: res.z, timer, speed }, events: out }
  }

  // ---- 騒ぎから逃げる ----
  let scare: { x: number; z: number } | null = null
  for (const e of events) {
    if (e.type !== 'steal' && e.type !== 'carjack' && e.type !== 'crash' && e.type !== 'hitPed') continue
    if (e.ref === String(p.id)) continue
    if (dist2(p.x, p.z, e.x, e.z) < T.scareRange * T.scareRange) scare = e
  }
  if (scare) {
    const away = headingOf(p.x - scare.x, p.z - scare.z) + (hash(p.id, 5) - 0.5) * 0.9
    return { ped: { ...p, mood: 'flee', timer: T.fleeTime * (0.7 + hash(p.id, 9) * 0.6), heading: away, speed: T.fleeSpeed }, events: out }
  }

  // ---- 迫ってくる車から、進路の横へ飛びのく（向きを決めたら、下の「逃げる」でそのまま動く） ----
  for (const th of threats) {
    if (th.speed < 2.5) continue
    const dx = p.x - th.x
    const dz = p.z - th.z
    if (th.heading == null) {
      if (th.speed > 5 && dx * dx + dz * dz < 36) p = { ...p, mood: 'flee', timer: T.dodgeTime, heading: headingOf(dx, dz), speed: T.dodgeSpeed }
      continue
    }
    const f = dirOf(th.heading)
    const ahead = dx * f.x + dz * f.z
    const side = -dx * f.z + dz * f.x
    // 気づく早さは人によって違う（5人に1人ほどは直前まで気づかない。遅い車ならそれでも間に合い、速い車にははねられる）
    const notice = T.dodgeAhead * Math.max(0.08, hash(p.id, 19) * 1.25 - 0.25)
    if (ahead < -1 || ahead > th.r + 1 + th.speed * notice || Math.abs(side) > th.r + 1.1) continue
    // 進路のどちら側にいるかで逃げる向きを決める（真ん中なら人ごとに決まった側へ）
    const sign = Math.abs(side) > 0.25 ? Math.sign(side) : hash(p.id, 11) < 0.5 ? -1 : 1
    p = { ...p, mood: 'flee', timer: Math.max(p.timer, T.dodgeTime), heading: th.heading + sign * (Math.PI / 2 - 0.25), speed: T.dodgeSpeed }
  }

  const pace = p.route?.pace ?? clamp(p.speed, T.walkMin, T.walkMax)

  if (p.mood === 'flee') {
    const timer = p.timer - dt
    const d = dirOf(p.heading)
    const res = world.resolveCircle(p.x + d.x * p.speed * dt, p.z + d.z * p.speed * dt, T.radius)
    // 壁に当たったら、壁沿いへ向きを変える
    const heading = res.hit ? p.heading + (next() < 0.5 ? 1.2 : -1.2) : p.heading
    const moved = Math.hypot(res.x - p.x, res.z - p.z)
    const base = { ...p, x: res.x, y: world.groundY(res.x, res.z), z: res.z, heading, stride: p.stride + moved / T.strideLength }
    if (timer > 0) return { ped: { ...base, timer }, events: out }
    return { ped: { ...base, mood: 'walk', timer: 0, speed: pace }, events: out }
  }

  // ---- ふつうに歩く ----
  if (!p.route) return { ped: p, events: out }
  const graph = world.walkGraph
  let edge = graph.edges[p.route.edge]
  if (!edge) return { ped: { ...p, route: null }, events: out }
  const goal = placeOn(world, edge.id, p.route.s, p.route.side)
  const off = Math.hypot(goal.x - p.x, goal.z - p.z)
  if (off > 1.2) {
    // 逃げたあとは、もとの道筋まで歩いて戻る
    const heading = headingOf(goal.x - p.x, goal.z - p.z)
    const d = dirOf(heading)
    const res = world.resolveCircle(p.x + d.x * pace * dt, p.z + d.z * pace * dt, T.radius)
    // 建物に阻まれて戻れないなら、その場から道筋へ戻す
    const stuck = res.hit && Math.hypot(res.x - p.x, res.z - p.z) < pace * dt * 0.3
    const x = stuck ? goal.x : res.x
    const z = stuck ? goal.z : res.z
    return {
      ped: { ...p, x, y: world.groundY(x, z), z, heading, speed: pace, stride: p.stride + (pace * dt) / T.strideLength },
      events: out,
    }
  }

  const net = getSignals(world)
  let route = p.route.next == null ? { ...p.route, next: chooseNext(graph, net, edge, next) } : p.route
  // 渡っている途中で点滅・赤になったら、急いで渡りきる
  const onCross = net.cross[edge.id]
  const crossing = onCross ? walkAt(net, onCross.junction, onCross.group, t) : null
  const remaining = edge.length - route.s
  let speed = crossing && (!crossing.walk || crossing.left * pace < remaining) ? pace * T.hurry : pace

  // 次が信号のある横断歩道なら、角から少し下がった所で青を待つ
  const nextId = route.next ?? -1
  const ahead = nextId >= 0 ? net.cross[nextId] : null
  if (ahead && !ahead.fromInRoad) {
    const w = walkAt(net, ahead.junction, ahead.group, t)
    const need = graph.edges[nextId].length / (pace * T.hurry)
    // 青になっても、人ごとに少しずつ遅れて歩き出す
    const go = w.walk && !w.flash && w.left > need + hash(p.id, 13) * 0.8
    const standAt = Math.max(0, edge.length - 0.4 - hash(p.id, 17) * Math.min(T.waitDepth, edge.length * 0.5))
    if (!go && route.s + speed * dt >= standAt) {
      if (route.s >= standAt - 0.05) {
        // 立ち止まって、渡る先のほうを向く
        const face = pointAlong(graph.edges[nextId].pts, graph.edges[nextId].cum, 0.5).heading
        const heading = p.heading + angleDiff(p.heading, face) * (1 - Math.exp(-4 * dt))
        return { ped: { ...p, heading, speed: 0, route }, events: out }
      }
      speed = Math.max(0, (standAt - route.s) / dt)
    }
  }

  let s = route.s + speed * dt
  if (s >= edge.length) {
    if (nextId < 0) return { ped: { ...p, speed: 0, route }, events: out }
    s -= edge.length
    edge = graph.edges[nextId]
    route = { ...route, edge: edge.id, next: chooseNext(graph, net, edge, next) }
  }
  const half = halfWidth(edge)
  const side = approach(route.side, clamp(route.side, -half, half), dt)
  const pos = placeOn(world, edge.id, s, side)
  return {
    ped: {
      ...p,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      heading: p.heading + angleDiff(p.heading, pos.heading) * (1 - Math.exp(-8 * dt)),
      speed,
      route: { ...route, s, side, pace },
      stride: p.stride + (speed * dt) / T.strideLength,
    },
    events: out,
  }
}
