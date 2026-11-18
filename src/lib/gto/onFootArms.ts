// Grand Theft Outfit [部品: onfoot] 後ろ姿の腕の動きと、正面・後ろ姿の切り替え（three/DOM なし）。
// 入口: pickView / armGait / projectArms / ARM_TUNING
// 契約: 腕は体の座標（右・上・前）で肩・肘・手首の3点を決め、見ている向きへ投影して板の上の位置にする。
//       返す x は板の右を正、y は上を正（どちらも身長を 1 とした長さ）、depth はカメラから遠ざかる向きが正。
//       描画側（renderActorArms.ts）は depth が正の所を体の板の後ろへ回して隠す。
import { clamp, lerp } from './math'

export type ActorView = 'front' | 'back'

/** 腕の振り（[歩き, 走り]）。角度はラジアン */
export const ARM_TUNING = {
  /** 肩の前後の振り幅、肘の曲げ、前へ振ったときに足す肘の曲げ、脇の開き */
  swing: [0.5, 0.85],
  flex: [0.3, 1.45],
  flexFwd: [0.25, 0.35],
  flare: [0.07, 0.24],
  /** 走りで前腕が体の前へ寄る量（前へ振ったとき） */
  cross: [0.05, 0.3],
  /** 立っているときの肘の曲げと脇の開き */
  restFlex: 0.1,
  restFlare: 0.05,
  /** 上腕が腕全体に占める割合 */
  upper: 0.47,
  /** 正面と後ろ姿を切り替える境目（cos）。行ったり来たりしないよう幅を持たせる */
  viewEdge: 0.2,
}

/**
 * 正面の絵と後ろ姿の絵のどちらを見せるか。
 * @param away 進む向きがカメラから遠ざかる度合い（cos。1 = 真後ろから見ている、−1 = こちらへ来る）
 * @param hold 乗り降りの動作中。カメラは車の斜め後ろに留まり、体だけが外へ向きを変えるので、後ろ姿のまま保つ
 *             （立ち上がる途中の1コマだけ正面の絵に替わらない）
 */
export function pickView(prev: ActorView, away: number, hold = false): ActorView {
  if (hold) return 'back'
  const e = ARM_TUNING.viewEdge
  if (prev === 'back') return away < -e ? 'front' : 'back'
  return away > e ? 'back' : 'front'
}

/** 片腕の関節の角度 */
export interface ArmAngles {
  /** 肩の前後の振り（前が正） */
  swing: number
  /** 肘の曲げ（前腕が前へ上がる向きが正） */
  flex: number
  /** 脇の開き（外が正） */
  flare: number
  /** 前腕が体の内側へ寄る量 */
  cross: number
}

export interface ArmPose {
  l: ArmAngles
  r: ArmAngles
}

/** 歩き・走りの腕。左腕は右脚と一緒に前へ出る（phase は gaitPose と同じ） */
export function armGait(phase: number, moving: number, run: number): ArmPose {
  const T = ARM_TUNING
  const m = clamp(moving, 0, 1)
  const at = (pair: number[]) => lerp(pair[0], pair[1], clamp(run, 0, 1))
  const s = Math.sin(phase)
  const one = (sn: number): ArmAngles => {
    const fwd = Math.max(0, sn)
    return {
      swing: m * at(T.swing) * sn,
      flex: lerp(T.restFlex, at(T.flex) + at(T.flexFwd) * fwd, m),
      flare: lerp(T.restFlare, at(T.flare), m),
      cross: m * at(T.cross) * fwd,
    }
  }
  return { l: one(-s), r: one(s) }
}

/** 見ている向き。体の右と前が、板の右へどれだけ向くか（x）と、カメラから遠ざかる向きへどれだけ向くか（depth） */
export interface ArmView {
  rightX: number
  rightDepth: number
  fwdX: number
  fwdDepth: number
}

export interface ArmPoint {
  x: number
  y: number
  depth: number
}

export interface ArmLimb {
  shoulder: ArmPoint
  elbow: ArmPoint
  wrist: ArmPoint
}

export interface ArmFrame {
  /** 肩の半幅と腕の長さ（身長に対する割合） */
  shoulderHalf: number
  armLen: number
}

/** 1本の腕の3点を板の上へ投影する（肩の高さを y=0 とする）。sign は左 −1・右 +1 */
export function projectArm(sign: 1 | -1, a: ArmAngles, frame: ArmFrame, view: ArmView): ArmLimb {
  const l1 = frame.armLen * ARM_TUNING.upper
  const l2 = frame.armLen - l1
  const at = (lat: number, up: number, fwd: number): ArmPoint => ({
    x: lat * view.rightX + fwd * view.fwdX,
    y: up,
    depth: lat * view.rightDepth + fwd * view.fwdDepth,
  })
  const sLat = sign * frame.shoulderHalf
  const cf = Math.cos(a.flare)
  const eLat = sLat + sign * Math.sin(a.flare) * l1
  const eUp = -Math.cos(a.swing) * cf * l1
  const eFwd = Math.sin(a.swing) * cf * l1
  const fore = a.swing + a.flex
  const wLat = eLat + sign * (Math.sin(a.flare) * 0.3 - a.cross) * l2
  const wUp = eUp - Math.cos(fore) * l2
  const wFwd = eFwd + Math.sin(fore) * l2
  return { shoulder: at(sLat, 0, 0), elbow: at(eLat, eUp, eFwd), wrist: at(wLat, wUp, wFwd) }
}

/** 板の面の中で腕を回した姿勢（乗り降りで手を伸ばすときなど）。arm は肩、fore は肘から先の回転 */
export function planarArm(sign: 1 | -1, arm: number, fore: number, frame: ArmFrame, view: ArmView): ArmLimb {
  const l1 = frame.armLen * ARM_TUNING.upper
  const l2 = frame.armLen - l1
  const sx = sign * frame.shoulderHalf * view.rightX
  const depth = sign * frame.shoulderHalf * view.rightDepth
  const ex = sx + Math.sin(arm) * l1
  const ey = -Math.cos(arm) * l1
  return {
    shoulder: { x: sx, y: 0, depth },
    elbow: { x: ex, y: ey, depth: depth - 0.02 },
    wrist: { x: ex + Math.sin(arm + fore) * l2, y: ey - Math.cos(arm + fore) * l2, depth: depth - 0.04 },
  }
}

const mixPoint = (a: ArmPoint, b: ArmPoint, t: number): ArmPoint => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), depth: lerp(a.depth, b.depth, t) })

/** 2つの腕の姿勢のあいだ */
export function mixLimb(a: ArmLimb, b: ArmLimb, t: number): ArmLimb {
  const k = clamp(t, 0, 1)
  if (k <= 0) return a
  if (k >= 1) return b
  return { shoulder: mixPoint(a.shoulder, b.shoulder, k), elbow: mixPoint(a.elbow, b.elbow, k), wrist: mixPoint(a.wrist, b.wrist, k) }
}
