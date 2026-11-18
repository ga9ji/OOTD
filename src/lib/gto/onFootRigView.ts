// Grand Theft Outfit [部品: onfoot] 関節のある体を、背後のカメラから見た形へ辿る（three/DOM なし）。
// 入口: armJoints / rearView / easeGaitLevel / SHOULDER_SET / REAR_PITCH
// 契約: 姿勢（onFootRig の RigPose）から肩・肘・手の位置を、描画（renderActorPuppet.ts）と同じ回し方で辿る。
//       体の座標は「+x が左・+y が上・+z が前」、長さは身長を 1 とする。
//       rearView は、斜め上の背後から見下ろした画面の上の位置（x は画面の右 = 体の右、y は画面の上）。
//       走りの姿勢は横からではなく、この画面の上の形（肘が輪郭の外へ出るか、左右が互い違いか）で確かめる。
import { clamp } from './math'
import { armTurn, HUNCH_SET, RIG_DIM, type ArmPose, type RigPose } from './onFootRig'

/** 肩の付け根: 肩の端から内へ寄せる量と、肩の線から下げる量（描画と同じ値を使う） */
export const SHOULDER_SET = { in: 0.012, down: 0.035 }

/** 背後のカメラが見下ろす角度の目安（ラジアン）。徒歩のカメラはおよそこの角度で主人公を見る */
export const REAR_PITCH = 0.3

type V3 = readonly [number, number, number]

const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)]
const rotY = (v: V3, a: number): V3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)]
const rotZ = (v: V3, a: number): V3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

export interface Joint3 {
  x: number
  y: number
  z: number
}

export interface ArmJoints {
  shoulder: Joint3
  elbow: Joint3
  /** 手の先 */
  hand: Joint3
}

const toJoint = (v: V3): Joint3 => ({ x: v[0], y: v[1], z: v[2] })

/**
 * 腕1本の肩・肘・手の先（体の座標。足元が原点）。
 * @param side 左 +1・右 −1
 * @param shoulderHalf 肩の半幅（身長に対する割合）
 */
export function armJoints(pose: RigPose, side: 1 | -1, shoulderHalf: number): ArmJoints {
  const arm: ArmPose = side === 1 ? pose.armL : pose.armR
  // 胴: 前傾 → 傾き → ひねり（three の YXZ）。腰は肩と逆へ少し回る
  const torso = (v: V3): V3 => rotY(rotY(rotX(rotZ(v, pose.bank), pose.lean), pose.twist * 1.35), -pose.twist * 0.35)
  // 肩: 前腕を内へ向けるねじり → 前後の振り → 脇の開き（three の ZXY）
  const shoulder = (v: V3): V3 => rotZ(rotX(rotY(v, -side * armTurn(arm)), -arm.swing), side * arm.splay)
  const base: V3 = [side * (shoulderHalf - SHOULDER_SET.in), RIG_DIM.torso - SHOULDER_SET.down + (pose.hunch ?? 0) * HUNCH_SET.shoulderUp, 0]
  const elbowLocal: V3 = [0, -RIG_DIM.upperArm, 0]
  const handLocal = add(elbowLocal, rotX([0, -(RIG_DIM.foreArm + RIG_DIM.hand), 0], -arm.bend))
  const lift = (v: V3): V3 => add(torso(add(base, shoulder(v))), [0, pose.hip, 0])
  return { shoulder: toJoint(add(torso(base), [0, pose.hip, 0])), elbow: toJoint(lift(elbowLocal)), hand: toJoint(lift(handLocal)) }
}

export interface Point2 {
  x: number
  y: number
}

export interface RearArm {
  shoulder: Point2
  elbow: Point2
  hand: Point2
  /** 肘が体の中心線からどれだけ外にあるか（画面の上。正が外） */
  elbowOut: number
  handOut: number
  /** 画面の上で、上腕と前腕がなす折れ（ラジアン。0 はまっすぐ） */
  fold: number
  /** 画面の上の前腕（肘から手の先）の長さ */
  foreLen: number
}

export interface RearView {
  l: RearArm
  r: RearArm
  /** 肩の線の傾き（ラジアン。正は画面の右の肩が下がる） */
  shoulderTilt: number
}

/**
 * 斜め上の背後から見た腕の形。
 * @param pitch カメラが見下ろす角度（ラジアン）
 */
export function rearView(pose: RigPose, shoulderHalf: number, pitch: number = REAR_PITCH): RearView {
  const flat = (j: Joint3): Point2 => ({ x: -j.x, y: j.y * Math.cos(pitch) + j.z * Math.sin(pitch) })
  const one = (side: 1 | -1): RearArm => {
    const j = armJoints(pose, side, shoulderHalf)
    const shoulder = flat(j.shoulder)
    const elbow = flat(j.elbow)
    const hand = flat(j.hand)
    const ux = elbow.x - shoulder.x
    const uy = elbow.y - shoulder.y
    const fx = hand.x - elbow.x
    const fy = hand.y - elbow.y
    const foreLen = Math.hypot(fx, fy)
    const upLen = Math.hypot(ux, uy)
    const fold = foreLen > 1e-4 && upLen > 1e-4 ? Math.acos(clamp((ux * fx + uy * fy) / (upLen * foreLen), -1, 1)) : 0
    return { shoulder, elbow, hand, elbowOut: -side * elbow.x, handOut: -side * hand.x, fold, foreLen }
  }
  const l = one(1)
  const r = one(-1)
  return { l, r, shoulderTilt: Math.atan2(l.shoulder.y - r.shoulder.y, r.shoulder.x - l.shoulder.x) }
}

/** 走りの姿勢が抜ける速さ（1/s）。上がるのは速く、下がるのはゆっくり */
export const GAIT_HOLD = { rise: 14, fall: 3.2 }

/**
 * 走りの度合い・動いている度合いをなめらかにする。人にぶつかって一瞬止められても、走りの姿勢がすぐ棒立ちへ戻らない
 * （速さが落ちても、しばらくは前傾と腕の構えが残る）。
 */
export function easeGaitLevel(prev: number, want: number, dt: number): number {
  const rate = want > prev ? GAIT_HOLD.rise : GAIT_HOLD.fall
  return prev + (want - prev) * (1 - Math.exp(-rate * Math.max(0, dt)))
}
