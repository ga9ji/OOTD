// Grand Theft Outfit [部品: vehicle] 四輪のサスペンション。
// 入口: VEHICLE_SUSPENSION / wheelOffsets / groundFit / restSuspension / stepSuspension / wheelCompression
// 契約: 四輪それぞれの接地点の路面の高さだけを受け取り、車輪1つずつの高さと、その上にばねで乗る車体の
//       高さ・傾きを返す。車輪は路面にすぐ付き、車体は遅れて付いて少し行き過ぎる。だから縁石に片輪が乗ると
//       その輪だけが車体へ沈み込み、箱ごと斜めに倒れない。描画（renderVehicles.ts）はこれに旋回のロール
//       （vehicleAttitude.ts）を足して形にする。
//       車輪の順: 前左・前右・後左・後右。向きの約束は vehicleAttitude.ts と同じ（pitch ＋で鼻が上、roll ＋で左へ傾く）。
import { clamp } from './math'

/** サスペンションを決める数字 */
export const VEHICLE_SUSPENSION = {
  /** 車輪が路面の高さへ付く速さ（1/s）。0.05 秒でほぼ付く */
  wheelFollow: 45,
  /** 車体のばね（強さと減衰）。0.3 秒で付き、1 割ほど行き過ぎて戻る */
  spring: 130,
  damping: 13,
  /** 車輪が車体へ沈み込める量 m と、車体から下へ伸びられる量 m */
  bump: 0.11,
  droop: 0.13,
  /** 車体が路面に沿う傾きの上限 rad */
  tiltMax: 0.2,
}

export type WheelHeights = [frontLeft: number, frontRight: number, rearLeft: number, rearRight: number]

/** サスペンションの状態 */
export interface Suspension {
  /** 車輪の接地面の高さ（世界の y） */
  wheelY: WheelHeights
  /** 車体（四輪の真ん中）の高さと傾き、その速さ */
  y: number
  yVel: number
  pitch: number
  pitchVel: number
  roll: number
  rollVel: number
}

/** 車輪の位置（車体の座標。右が ＋x、前が −z）。track は左右の車輪の間隔 */
export function wheelOffsets(wheelbase: number, track: number): [x: number, z: number][] {
  const hx = track / 2
  const hz = wheelbase / 2
  return [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ]
}

/** 四輪の下の路面に当てはめた面（高さと傾き） */
export function groundFit(h: WheelHeights, wheelbase: number, track: number): { y: number; pitch: number; roll: number } {
  const front = (h[0] + h[1]) / 2
  const rear = (h[2] + h[3]) / 2
  const left = (h[0] + h[2]) / 2
  const right = (h[1] + h[3]) / 2
  return {
    y: (front + rear) / 2,
    pitch: Math.atan2(front - rear, wheelbase),
    roll: Math.atan2(right - left, track),
  }
}

const limitTilt = (a: number) => clamp(a, -VEHICLE_SUSPENSION.tiltMax, VEHICLE_SUSPENSION.tiltMax)

/** 路面に落ち着いた状態（車を置いた瞬間） */
export function restSuspension(h: WheelHeights, wheelbase: number, track: number): Suspension {
  const fit = groundFit(h, wheelbase, track)
  return { wheelY: [h[0], h[1], h[2], h[3]], y: fit.y, yVel: 0, pitch: limitTilt(fit.pitch), pitchVel: 0, roll: limitTilt(fit.roll), rollVel: 0 }
}

/** 車体の、車輪 i の真上の高さ（車輪が沈み込みも伸びもしていないときの接地面の高さ） */
function cornerY(y: number, pitch: number, roll: number, i: number, wheelbase: number, track: number): number {
  const [x, z] = wheelOffsets(wheelbase, track)[i]
  return y - Math.tan(pitch) * z + Math.tan(roll) * x
}

/** 車輪 i が車体へ沈み込んでいる量 m（＋で沈み込み、−で伸び） */
export function wheelCompression(s: Suspension, i: number, wheelbase: number, track: number): number {
  return s.wheelY[i] - cornerY(s.y, s.pitch, s.roll, i, wheelbase, track)
}

/** dt 秒進める。h は四輪の接地点の路面の高さ */
export function stepSuspension(s: Suspension, h: WheelHeights, wheelbase: number, track: number, dt: number): Suspension {
  const tune = VEHICLE_SUSPENSION
  const fit = groundFit(h, wheelbase, track)
  const follow = 1 - Math.exp(-tune.wheelFollow * dt)
  const wheels = s.wheelY.map((y, i) => y + (h[i] - y) * follow)

  // 車体は路面の面をばねで追う
  const spring = (pos: number, vel: number, target: number): [number, number] => {
    const nextVel = vel + ((target - pos) * tune.spring - vel * tune.damping) * dt
    return [pos + nextVel * dt, nextVel]
  }
  const [y0, yVel0] = spring(s.y, s.yVel, fit.y)
  const [pitch0, pitchVel] = spring(s.pitch, s.pitchVel, limitTilt(fit.pitch))
  const [roll0, rollVel] = spring(s.roll, s.rollVel, limitTilt(fit.roll))
  const pitch = limitTilt(pitch0)
  const roll = limitTilt(roll0)

  // 沈み込みの限界を超えた輪は車体を持ち上げる（底づき）
  const over = Math.max(0, ...wheels.map((w, i) => w - cornerY(y0, pitch, roll, i, wheelbase, track) - tune.bump))
  const y = y0 + over
  const yVel = over > 0 ? Math.max(0, yVel0) : yVel0
  // 伸びの限界を超えた輪は路面から離れる
  const wheelY = wheels.map((w, i) => Math.max(w, cornerY(y, pitch, roll, i, wheelbase, track) - tune.droop)) as WheelHeights

  return { wheelY, y, yVel, pitch, pitchVel, roll, rollVel }
}
