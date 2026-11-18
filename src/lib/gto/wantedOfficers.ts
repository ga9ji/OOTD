// Grand Theft Outfit [部品: wanted] 徒歩の警官。
// 入口: officersWanted / spawnOfficer / stepOfficer / officerDone（外からは wanted.ts 経由で使う）
// 契約: 警官は PedState（cop: true）として住人と同じ並びに入る。通行人の動き（pedestrians.ts）は通さず、
//       ここで主人公（見失っていれば最後に見た場所）へ走らせる。触れられると捕まる判定は wanted.ts。
import { pickEdgeNear } from './graph'
import { angleDiff, approach, clamp, dirOf, headingOf, pointAlong } from './math'
import type { GtoEvent, GtoWorld, PedState, PlayMode, VehicleState } from './types'

/** 手触りを決める数字 */
export const OFFICER_TUNING = {
  /** 走る速さ m/s（主人公の全力 6.2 より少し遅い。走り続ければ振り切れる） */
  runSpeed: 5.5,
  accel: 14,
  turnRate: 7,
  radius: 0.32,
  strideLength: 1.5,
  /** 手配度ごとの人数（歩きの主人公に対して） */
  onFoot: [0, 1, 2, 3, 4, 4],
  /** 車を止めた主人公を囲みに降りてくる人数の上限 */
  atStop: 2,
  /** 車がこの速さより遅ければ「止まっている」 */
  stopSpeed: 3,
  /** 止まった警察車両から降りてくる距離 m と、その車の速さの上限 */
  dismountRange: 45,
  dismountSpeed: 3,
  /** 車が無いとき、主人公からこの距離の歩道に出す */
  spawnMin: 26,
  spawnMax: 60,
  /** はねられて倒れている秒 */
  downTime: 5,
  hitSpeed: 3,
  /** 追う相手がいなくなってから引き上げるまでの秒と、主人公からこれより離れたら消す距離 */
  lingerTime: 6,
  despawn: 140,
}

/** その手配度で出しておく徒歩の警官の数。車で走っているあいだは出さない */
export function officersWanted(level: number, mode: PlayMode, playerSpeed: number): number {
  const T = OFFICER_TUNING
  const lv = clamp(Math.round(level), 0, 5)
  if (lv === 0) return 0
  if (mode === 'foot') return T.onFoot[lv]
  return Math.abs(playerSpeed) < T.stopSpeed ? Math.min(lv, T.atStop) : 0
}

/** 徒歩の警官を1人出す。近くに止まった警察車両があればその脇に、無ければ（主人公が歩きのときだけ）少し離れた歩道に */
export function spawnOfficer(
  world: GtoWorld,
  id: number,
  center: { x: number; z: number },
  police: VehicleState[],
  outfitKeys: string[],
  next: () => number,
  mode: PlayMode = 'foot',
): PedState | null {
  const T = OFFICER_TUNING
  if (outfitKeys.length === 0) return null
  // 制服なので、全員が同じ1着（手持ちの並びの最後）を着る
  const outfitKey = outfitKeys[outfitKeys.length - 1]
  const base = { id, speed: 0, outfitKey, mood: 'walk' as const, timer: 0, route: null, stride: next(), cop: true as const }

  const cars = police.filter(
    (v) => Math.abs(v.speed) < T.dismountSpeed && Math.hypot(v.x - center.x, v.z - center.z) < T.dismountRange,
  )
  if (cars.length > 0) {
    const car = cars[Math.floor(next() * cars.length) % cars.length]
    const f = dirOf(car.heading)
    // 運転席側と助手席側のどちらかへ降りる
    const side = next() < 0.5 ? 1 : -1
    const at = world.resolveCircle(car.x - f.z * 1.7 * side, car.z + f.x * 1.7 * side, T.radius)
    if (!world.insideBuilding(at.x, at.z)) {
      return { ...base, x: at.x, y: world.groundY(at.x, at.z), z: at.z, heading: headingOf(center.x - at.x, center.z - at.z) }
    }
  }
  // 車に乗った相手を囲むのは、そばに止めた警察車両から降りた警官だけ
  if (mode === 'drive') return null
  const found = pickEdgeNear(world.walkGraph, center.x, center.z, T.spawnMin, T.spawnMax, next)
  if (!found) return null
  const p = pointAlong(found.edge.pts, found.edge.cum, found.s)
  if (world.insideBuilding(p.x, p.z)) return null
  return { ...base, x: p.x, y: world.groundY(p.x, p.z), z: p.z, heading: headingOf(center.x - p.x, center.z - p.z) }
}

/** 警官をはねうる、走っている車 */
export interface OfficerThreat {
  x: number
  z: number
  r: number
  speed: number
}

/** 壁を避ける向きの候補（まっすぐ → 少し左右 → 大きく左右） */
const DODGE = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]

/**
 * 警官を1歩進める。target があればそこへ走り、null（手配が消えた）なら立ち止まって引き上げを待つ。
 * 車にはねられると倒れ、hitPed（ref: 'cop'）を出す。
 */
export function stepOfficer(
  p: PedState,
  target: { x: number; z: number } | null,
  world: GtoWorld,
  threats: OfficerThreat[],
  dt: number,
): { ped: PedState; events: GtoEvent[] } {
  const T = OFFICER_TUNING
  if (p.mood === 'stunned') {
    const timer = p.timer - dt
    return { ped: timer > 0 ? { ...p, timer, speed: 0 } : { ...p, mood: 'walk', timer: 0, speed: 0 }, events: [] }
  }
  for (const th of threats) {
    if (th.speed < T.hitSpeed) continue
    if (Math.hypot(p.x - th.x, p.z - th.z) < th.r + T.radius) {
      return {
        ped: { ...p, mood: 'stunned', timer: T.downTime, speed: 0 },
        events: [{ type: 'hitPed', x: p.x, z: p.z, value: th.speed, ref: 'cop' }],
      }
    }
  }
  if (!target) {
    // 追う相手がいない: 止まって、timer で引き上げまでの秒を数える
    return { ped: { ...p, speed: approach(p.speed, 0, T.accel * dt), timer: p.timer + dt }, events: [] }
  }

  const dist = Math.hypot(target.x - p.x, target.z - p.z)
  const wish = headingOf(target.x - p.x, target.z - p.z)
  // 目の前が建物なら、空いている向きへ逸れる
  let go = wish
  for (const off of DODGE) {
    const d = dirOf(wish + off)
    const reach = Math.min(3, dist)
    if (world.segmentClear(p.x, p.z, p.x + d.x * reach, p.z + d.z * reach) >= 1) {
      go = wish + off
      break
    }
  }
  // 相手のすぐそばでは詰めすぎない（重ならない）
  const goal = dist < 0.9 ? 0 : T.runSpeed
  const speed = approach(p.speed, goal, T.accel * dt)
  const heading = p.heading + clamp(angleDiff(p.heading, go), -T.turnRate * dt, T.turnRate * dt)
  const d = dirOf(heading)
  const res = world.resolveCircle(p.x + d.x * speed * dt, p.z + d.z * speed * dt, T.radius)
  const moved = Math.hypot(res.x - p.x, res.z - p.z)
  return {
    ped: { ...p, x: res.x, y: world.groundY(res.x, res.z), z: res.z, heading, speed, timer: 0, stride: p.stride + moved / T.strideLength },
    events: [],
  }
}

/** この警官を片付けてよいか（遠く離れた・手配が消えてしばらく経った） */
export function officerDone(p: PedState, center: { x: number; z: number }, level: number): boolean {
  if (Math.hypot(p.x - center.x, p.z - center.z) > OFFICER_TUNING.despawn) return true
  return level === 0 && p.timer >= OFFICER_TUNING.lingerTime && p.mood !== 'stunned'
}
