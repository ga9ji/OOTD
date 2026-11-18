// Grand Theft Outfit [部品: onfoot] 関節のある体（頭・胴・上腕/前腕・腿/すね）の姿勢を決める。
// 入口: rigGait / rigBoarding / rigSeat / mixRig / solveLeg / legReach / elbowOffset / footTarget / REST_RIG / RIG_DIM
// 契約: 長さは身長を 1 とした割合、角度はラジアン。体の座標は「前・上・左」。three/DOM なし。
//       脚は「足先をどこへ置くか」を先に決めてから腿と膝の角度を解く。接地している足先は、体が進んだぶんだけ
//       後ろへ送るので、地面に対して止まって見える（板が滑って見えない）。
//       腕は反対側の脚と一緒に振り、速さ（走りの度合い）で肘を畳み、前傾を深くし、曲がる側へ体を倒す。
//       描画は src/components/gto/renderActorPuppet.ts がこの角度をそのまま関節へ入れる。
import { clamp, lerp } from './math'
import { beat, DOOR_BEATS, SEAT_BEATS, SEAT_OUTSIDE_DROP } from './onFoot'
import type { BoardingPhase } from './types'

/** 体の寸法（身長に対する割合） */
export const RIG_DIM = {
  /** 立っているときの脚の付け根の高さ */
  hip: 0.53,
  thigh: 0.247,
  shin: 0.247,
  /** くるぶしの高さ（足の厚み） */
  ankle: 0.036,
  /** 左右の脚の付け根の間隔の半分 */
  hipHalf: 0.045,
  /** 胴（脚の付け根から肩まで）と首・頭 */
  torso: 0.275,
  neck: 0.035,
  head: 0.135,
  /** 腕は肩から指先まで身長の 4 割（下ろした指先が腿の中ほどへ届く。短いと寸詰まりの人形に見える） */
  upperArm: 0.18,
  foreArm: 0.165,
  hand: 0.055,
}

/** 腕1本。swing=前へ振る（負は後ろ）、splay=脇を開く、bend=肘を曲げる（前腕が前へ上がる） */
export interface ArmPose {
  swing: number
  splay: number
  bend: number
  /** 前腕を体の内へ向ける量（肩のねじり）。省くと肘の曲げから決まる（armTurn） */
  turn?: number
}

/** 肘を曲げたとき、前腕を内へ向ける量の既定（後ろから見て、肘が外へ張り、手が腰の前へ来る「く」の字になる） */
export const ARM_FORE_IN = 0.85

/** 前腕を内へ向ける量。姿勢が指定していなければ、肘を曲げるほど内へ向ける */
export const armTurn = (p: ArmPose): number => p.turn ?? ARM_FORE_IN * Math.min(1, p.bend / 1.2)

/** 脚1本。swing=腿を前へ上げる、bend=膝を曲げる（すねが後ろへ畳まれる）、foot=足先を下げる（つま先立ち） */
export interface LegPose {
  swing: number
  bend: number
  foot: number
  /** 足を外へ開く（足幅） */
  splay: number
}

/** 体の姿勢 */
export interface RigPose {
  /** 脚の付け根の高さ（膝を曲げるほど低い） */
  hip: number
  /** 胴: 前傾（負は反る）・右への傾き・左へのひねり（右肩が前へ出る） */
  lean: number
  bank: number
  twist: number
  /** 頭: 胴に対してうつむく・左を向く */
  headPitch: number
  headYaw: number
  /**
   * 背中の丸め 0..1（省くと 0）。肩がすくんで上がり、首が縮んで頭が肩の線へ沈む。
   * 斜め上の背後から見ると、胴の前傾は見下ろす角度に打ち消されて直立と同じ長さに写るので、
   * 「前へ倒れている」ことは頭が肩に隠れる量で読ませる
   */
  hunch?: number
  /** 腰の線の傾き（省くと 0。正は右の腰が下がる）。走りでは肩の線と逆へ傾ける */
  hipTilt?: number
  armL: ArmPose
  armR: ArmPose
  legL: LegPose
  legR: LegPose
}

/** 背中を丸めきったとき（hunch=1）に、首の付け根が下がる量・前へ出る量・肩の付け根が上がる量（身長に対する割合） */
export const HUNCH_SET = { neckDrop: 0.05, neckFwd: 0.02, shoulderUp: 0.022 }

const REST_ARM: ArmPose = { swing: 0.03, splay: 0.07, bend: 0.14 }
const REST_LEG: LegPose = { swing: 0, bend: 0, foot: 0, splay: 0.02 }

export const REST_RIG: RigPose = {
  hip: RIG_DIM.hip,
  lean: 0,
  bank: 0,
  twist: 0,
  headPitch: 0,
  headYaw: 0,
  armL: REST_ARM,
  armR: REST_ARM,
  legL: REST_LEG,
  legR: REST_LEG,
}

/** 歩き・走りの振りの大きさ（[歩き, 走り]） */
export const RIG_TUNING = {
  /** 接地している割合（1周のうち）と、接地中に足先が前後へ動く半幅の上限 */
  duty: [0.6, 0.36],
  reach: [0.2, 0.22],
  /** 接地の範囲を後ろへずらす量（走りは腰の少し前に着き、腰のずっと後ろまで蹴る） */
  stanceBack: [0, 0.11],
  /**
   * 走りで接地している割合の下限。歩幅が脚の届く幅より広いと接地が一瞬になり、ほとんどのコマで両脚を畳んで
   * 宙に浮いた（しゃがんで跳ねた）姿になるので、全力では接地を長く取る。そのぶん足先は地面より少し遅く
   * 後ろへ送られる（前後の向きのずれなので、背後のカメラからは見えない）。歩きは 0 = 地面に対して止まる
   */
  dutyMin: [0, 0.4],
  /** 振り出す足の高さの山の鋭さ（走りは、蹴った直後と着く直前は足が低く脚が伸びて見え、真ん中だけ高く畳む） */
  liftSharp: [0.8, 0.9],
  /** 振り出す足の高さと、蹴り上げてかかとが後ろへ上がる量 */
  lift: [0.05, 0.2],
  /** 足がいちばん高くなる時期（1 で振り出しの真ん中。小さいほど早く、着く前に脚が長く伸びる） */
  liftEarly: [1, 0.62],
  /**
   * 振り出した足が前へ戻りはじめる遅れ（1 で遅れなし。大きいほど、蹴った足が後ろに残ったまま畳まれてから前へ出る）。
   * 走りは「かかとを後ろへ蹴り上げた形」を長く見せ、膝を前へ高く上げたまま運ぶ形（もも上げ）を短くする
   */
  swingLate: [1, 1.25],
  kick: [0.3, 1.5],
  /**
   * 腰の落とし（膝のゆとり）。走りでしゃがんで見えないよう、走りでも腰は高いまま保つ。
   * bob は接地のたびの沈み（踏んばる瞬間に沈み、両足が浮く瞬間に戻る）。
   * reachEase は「接地している脚が届くまで腰を下げる」ときに、腰より後ろにある足先の距離を割り引く倍率
   * （走りは蹴り終わりで腰を下げず、かかとが浮いてつま先だけが地面に残る。腰より前に着く足には必ず届かせる）
   */
  crouch: [0.012, 0.008],
  bob: [0, 0.036],
  reachEase: [1, 0.35],
  /** 両足が浮くあいだに体が浮く高さ（体ごと持ち上げず、腰の高さで作る。接地した足は地面に残る） */
  hop: [0, 0.042],
  /**
   * 歩きの腕: 上腕の振りの大きさ・構え・肘の曲げ（基本と、前へ振ったときの上乗せ）・脇の開き（基本と、後ろへ引いたときの上乗せ）。
   * 伸ばし気味に小さく振る
   */
  walkArm: { swing: 0.42, bias: 0.02, bend: 0.3, pump: 0.2, splay: 0.1, splayBack: 0.05 },
  /**
   * 走りの腕（全力）。後ろへ引ききった形（back）と、前へ振りきった形（front）のあいだを行き来する。
   * swing は世界の鉛直から測った上腕の角度（前が正）で、胴の前傾ぶんは rigGait が足す。
   * 斜め上の背後から見ると、後ろへ引いた上腕も真下へ下がった腕も同じ「下向きの棒」に写り、前後の振りは読めない。
   * そこで走りは左右をはっきり非対称にする:
   *   back  … 腕を伸ばし気味に外・後ろへ引き、手が腰より下・胴の輪郭のずっと外まで下がる（長い1本の腕に写る）
   *   front … 上腕を前へ振り上げて肘を深く畳み、前腕を外へ開く。こぶしが肩の線より上・肩の外に出る（背後からも見える）
   * 片方は長く下へ、片方は短く畳んでこぶしが肩の上、と高さがはっきり違い、半周ごとに入れ替わるので、前後に大きく振っていると読める
   * （R15 まで: 前の腕が胴に隠れ、後ろの腕も肘を張って畳んでいたので「両肘を曲げたまま脇に固定」に見えた）
   */
  runArm: {
    back: { swing: -0.95, splay: 0.7, bend: 0.75, turn: 0.3 },
    front: { swing: 0.6, splay: 0.45, bend: 1.9, turn: -1.0 },
  },
  /** 走りの腕: 前後が入れ替わる速さ（大きいほど、左右が同じ形になる瞬間が短い） */
  armSnap: 6,
  /** 腕の振りに合わせた肩の線の傾き（引いた腕の側の肩が上がる） */
  shrug: [0.02, 0.2],
  /** 胴: 前傾・加減速での振れ・ひねり・旋回での傾き・足の運びでの左右の揺れ（肩の線の傾き） */
  lean: [0.08, 0.42],
  leanAccel: 0.5,
  twist: [0.2, 0.46],
  bank: [0.24, 0.36],
  sway: [0.06, 0.26],
  /** 足幅（脚を外へ開く角度） */
  stance: [0.07, 0.04],
  /** 頭: 前傾を打ち消す割合（走りは打ち消しきらず、肩のあいだへ沈む）と、曲がる側を見る量 */
  headLevel: [0.55, 0.4],
  /** 走りで頭を前へ突き出して下げる量（ラジアン）・背中の丸め（RigPose.hunch）・腰の線を肩と逆へ傾ける割合 */
  headDown: [0, 0.55],
  hunch: [0, 0.5],
  hipCounter: [0.3, 0.9],
  headTurn: 0.45,
}

/** 座るときの屈み: 屋根をくぐるあいだの胴の前傾・車の側への傾き・うつむき（ラジアン）。腰の高さは座席の高さ（rigSeat の seatHip）で決まる。
 *  脚が画面の外でも、上半身だけで「屈んで入る」と読める深さにする */
export const SEAT_RIG = { lean: 0.72, bank: 0.52, head: 0.4 }

/** くるぶしからつま先までの長さ（かかとが浮いたとき、つま先が地面に届く角度を出す。描画の足の長さと同じ） */
export const FOOT_TOE = 0.08

/** 膝が曲がる上限（かかとが尻に着く手前） */
const KNEE_MAX = 2.55

const smooth = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

/** 足先の位置から、腿と膝の角度を解く。z=付け根から前へ、y=地面からの足裏の高さ、hip=付け根の高さ */
export function solveLeg(z: number, y: number, hip: number, foot = 0): LegPose {
  const { thigh, shin, ankle } = RIG_DIM
  const down = Math.max(0.02, hip - y - ankle)
  const far = clamp(Math.hypot(z, down), Math.abs(thigh - shin) + 0.01, (thigh + shin) * 0.999)
  const inner = Math.acos(clamp((thigh * thigh + shin * shin - far * far) / (2 * thigh * shin), -1, 1))
  const lead = Math.acos(clamp((thigh * thigh + far * far - shin * shin) / (2 * thigh * far), -1, 1))
  return { swing: Math.atan2(z, down) + lead, bend: Math.PI - inner, foot, splay: 0.02 }
}

/** 関節の角度から足裏の位置を辿る（solveLeg の逆。テストと接地の確認に使う） */
export function legReach(leg: LegPose, hip: number): { z: number; y: number } {
  const { thigh, shin, ankle } = RIG_DIM
  const lower = leg.swing - leg.bend
  return {
    z: thigh * Math.sin(leg.swing) + shin * Math.sin(lower),
    y: hip - thigh * Math.cos(leg.swing) - shin * Math.cos(lower) - ankle,
  }
}

/** 肩から見た肘の位置（身長に対する割合）。out=体の外へ、drop=下へ、fwd=前へ。描画（renderActorPuppet の肩の回し方）と同じ順で辿る */
export function elbowOffset(arm: ArmPose): { out: number; drop: number; fwd: number } {
  const hang = RIG_DIM.upperArm * Math.cos(arm.swing)
  return { out: hang * Math.sin(arm.splay), drop: hang * Math.cos(arm.splay), fwd: RIG_DIM.upperArm * Math.sin(arm.swing) }
}

/**
 * 足裏の位置（体の座標。x=左、z=前、y=地面からの高さ。身長に対する割合）。足元の影を足の真下へ置くのに使う。
 * @param hipHalf 左右の脚の付け根の間隔の半分
 */
export function footContacts(pose: RigPose, hipHalf: number = RIG_DIM.hipHalf): { l: { x: number; y: number; z: number }; r: { x: number; y: number; z: number } } {
  const one = (leg: LegPose, side: 1 | -1) => {
    const at = legReach(leg, pose.hip)
    return { x: side * (hipHalf + Math.sin(leg.splay) * Math.max(0, pose.hip - at.y)), y: at.y, z: at.z }
  }
  return { l: one(pose.legL, 1), r: one(pose.legR, -1) }
}

/** 足の真下の影が消える足裏の高さ（身長に対する割合） */
export const CONTACT_FADE = 0.14

/** 足の真下の影の濃さ 0..1 と大きさの倍率。足裏が地面にあるとき濃く小さく、上がるほど薄く広がる */
export function contactShade(y: number): { opacity: number; scale: number } {
  const k = clamp(y / CONTACT_FADE, 0, 1)
  return { opacity: (1 - k) * (1 - k), scale: 1 + 0.6 * k }
}

export interface FootTarget {
  /** 付け根から前へ・地面からの高さ */
  z: number
  y: number
  /** 接地している割合（この歩幅と速さでの値） */
  duty: number
  /** 振り出しの進み具合 0..1（接地中は 0） */
  air: number
}

/**
 * 足先の行き先。位相 0 でその足が前に着き、接地のあいだは体の進みと同じ速さで後ろへ送られ、
 * 離れたら弧を描いて前へ戻る。歩幅が広い（速い）ほど接地の割合が減り、両足が浮く瞬間ができる。
 * @param stride 左右1組ぶんの歩幅（身長に対する割合）
 */
export function footTarget(phase: number, run: number, stride: number): FootTarget {
  const T = RIG_TUNING
  const r = clamp(run, 0, 1)
  const want = lerp(T.duty[0], T.duty[1], r)
  const half = Math.min((want * stride) / 2, lerp(T.reach[0], T.reach[1], r))
  const duty = Math.max(stride > 0 ? clamp((2 * half) / stride, 0.05, 0.95) : want, lerp(T.dutyMin[0], T.dutyMin[1], r))
  const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1
  const back = lerp(T.stanceBack[0], T.stanceBack[1], r)
  if (u < duty) return { z: half - back - Math.min(stride, (2 * half) / duty) * u, y: 0, duty, air: 0 }
  const t = (u - duty) / (1 - duty)
  // 前へ戻る: 出だしはゆっくり（蹴り上げ）、後半で前へ伸びる
  const e = 0.5 - 0.5 * Math.cos(Math.PI * t ** lerp(T.swingLate[0], T.swingLate[1], r))
  return { z: -half - back + 2 * half * e, y: lerp(T.lift[0], T.lift[1], r) * Math.sin(Math.PI * t ** lerp(T.liftEarly[0], T.liftEarly[1], r)) ** lerp(T.liftSharp[0], T.liftSharp[1], r), duty, air: t }
}

export interface GaitInput {
  /** 歩いた距離の位相（ラジアン）。2π で左右1組。0 は左足が前に着いた瞬間 */
  phase: number
  /** 動いている度合い 0..1 と、走りの度合い 0..1 */
  moving: number
  run: number
  /** 曲がっている度合い −1..1（正は右へ） */
  turn: number
  /** 加減速 −1..1（正は加速） */
  accel: number
  /** 左右1組ぶんの歩幅（身長に対する割合） */
  stride: number
}

/** 歩き・走りの1瞬の姿勢 */
export function rigGait(g: GaitInput): RigPose {
  const m = clamp(g.moving, 0, 1)
  if (m <= 0) return REST_RIG
  const T = RIG_TUNING
  const r = clamp(g.run, 0, 1)
  const at = (pair: number[]) => lerp(pair[0], pair[1], r)
  const turn = clamp(g.turn, -1, 1)
  const stride = Math.max(0.1, g.stride)

  const fl = footTarget(g.phase, r, stride)
  const fr = footTarget(g.phase + Math.PI, r, stride)
  // 腰の高さ: 接地している脚が届く高さまで下げる（脚が開くと沈み、揃うと上がる）
  const full = (RIG_DIM.thigh + RIG_DIM.shin) * 0.995
  const ease = at(T.reachEase)
  const limit = (f: FootTarget) => {
    if (f.y > 0) return Infinity
    const z = f.z * m * (f.z < 0 ? ease : 1)
    return RIG_DIM.ankle + Math.sqrt(Math.max(0.01, full * full - z * z))
  }
  // 走りの上下動: 接地の真ん中（片足で踏んばる瞬間）でいちばん沈み、両足が浮くあいだは弧を描いて浮く
  const bob = at(T.bob) * (0.5 + 0.5 * Math.cos(2 * (g.phase - Math.PI * fl.duty)))
  const gap = 0.5 - fl.duty
  // 離れたばかりの足から数えた、宙にいる時間の進み具合（0..1。どちらかが接地していれば 0 高さ）
  const flightOf = (f: FootTarget, other: FootTarget) => {
    if (gap <= 0.001 || f.air <= 0 || other.air <= 0) return 0
    const t = (f.air * (1 - f.duty)) / gap
    return t < 1 ? Math.sin(Math.PI * t) : 0
  }
  const hop = at(T.hop) * Math.max(flightOf(fl, fr), flightOf(fr, fl))
  const hip = Math.min(RIG_DIM.hip - (at(T.crouch) + bob) * m, limit(fl), limit(fr)) + hop * m
  const leg = (f: FootTarget): LegPose => {
    // 離れた直後はかかとを後ろへ蹴り上げ、つま先が下を向く
    // 走りは離れてすぐ畳み、膝が前へ出るまで畳んだまま運ぶ（両足が浮く瞬間にも、後ろの足が上がっている）
    const early = f.air > 0 ? smooth(f.air / 0.12) * (1 - smooth((f.air - 0.4) / 0.4)) : 0
    const late = f.air > 0 ? Math.sin(Math.PI * Math.min(1, f.air * 1.6)) * (1 - f.air) : 0
    const kick = lerp(late, early, r)
    const solved = solveLeg(f.z * m, f.y * m, hip)
    const extra = kick * at(T.kick) * m
    // 接地している足に脚が届かないぶん（蹴り終わり）は、かかとを浮かせてつま先を地面に残す
    const short = f.air > 0 ? 0 : Math.max(0, legReach(solved, hip).y)
    const tiptoe = Math.asin(Math.min(1, short / FOOT_TOE))
    return { swing: solved.swing + extra * 0.25, bend: Math.min(solved.bend + extra, KNEE_MAX), foot: Math.max(kick * 0.7 * m, tiptoe), splay: lerp(0.02, at(T.stance), m) }
  }

  const lean = m * at(T.lean) + clamp(g.accel, -1, 1) * T.leanAccel
  // 腕は反対側の脚と一緒に。c>0 は左足が前
  const c = Math.cos(g.phase)
  const arm = (sign: number): ArmPose => {
    // 走りは腕を素早く入れ替える（左右が同じ形で並ぶ瞬間を短くする）。歩きは振り子のまま
    const raw = -sign * c
    const fwd = lerp(raw, Math.tanh(T.armSnap * raw) / Math.tanh(T.armSnap), r)
    const W = T.walkArm
    const walkBend = W.bend + W.pump * fwd
    const k = 0.5 + 0.5 * fwd
    const B = T.runArm.back
    const F = T.runArm.front
    // 走りの上腕は世界の鉛直から測る（胴が前へ倒れたぶんを足して、前傾しても肘の位置が変わらないようにする）
    const swing = lerp(W.bias + W.swing * fwd, lerp(B.swing, F.swing, k) + lean, r)
    const splay = lerp(W.splay + W.splayBack * Math.max(0, -fwd), lerp(B.splay, F.splay, k), r)
    const bend = lerp(walkBend, lerp(B.bend, F.bend, k), r)
    const turn = lerp(armTurn({ swing: 0, splay: 0, bend: walkBend }), lerp(B.turn, F.turn, k), r)
    return {
      swing: lerp(REST_ARM.swing, swing, m),
      splay: lerp(REST_ARM.splay, splay, m),
      bend: lerp(REST_ARM.bend, bend, m),
      turn: lerp(armTurn(REST_ARM), turn, m),
    }
  }
  const twist = m * at(T.twist) * c
  // 足の運びと腕の振りで傾く肩の線（旋回の倒れは含めない）。腰の線はこれと逆へ傾く
  const roll = m * (-at(T.sway) * Math.sin(g.phase) + at(T.shrug) * c)
  return {
    hip,
    lean,
    // 曲がる側へ倒れ、足の運びでも体重が左右へ移る
    bank: m * turn * at(T.bank) + roll,
    twist,
    headPitch: m * at(T.headDown) - lean * at(T.headLevel),
    headYaw: -turn * T.headTurn * m - twist * 0.7,
    hunch: m * at(T.hunch),
    hipTilt: -roll * at(T.hipCounter),
    armL: arm(1),
    armR: arm(-1),
    legL: leg(fl),
    legR: leg(fr),
  }
}

/** 車の前の側（ドアの蝶番の側）の手足を lead、反対を trail として書いた姿勢を左右へ割り振る */
interface SidedRig {
  hip?: number
  lean?: number
  bank?: number
  twist?: number
  headPitch?: number
  headYaw?: number
  armLead?: ArmPose
  armTrail?: ArmPose
  legLead?: LegPose
  legTrail?: LegPose
}

const sided = (leadLeft: boolean, p: SidedRig): RigPose => {
  const s = leadLeft ? 1 : -1
  const hip = p.hip ?? RIG_DIM.hip
  const stand = solveLeg(0, 0, hip)
  const lead = p.legLead ?? stand
  const trail = p.legTrail ?? stand
  return {
    hip,
    lean: p.lean ?? 0,
    bank: -s * (p.bank ?? 0),
    twist: s * (p.twist ?? 0),
    headPitch: p.headPitch ?? 0,
    headYaw: s * (p.headYaw ?? 0),
    armL: (leadLeft ? p.armLead : p.armTrail) ?? REST_ARM,
    armR: (leadLeft ? p.armTrail : p.armLead) ?? REST_ARM,
    legL: leadLeft ? lead : trail,
    legR: leadLeft ? trail : lead,
  }
}

/** 車の側（in）と外の側（out）の手足で書いた姿勢を左右へ割り振る。体は車の前を向いている前提 */
interface InOutRig {
  hip: number
  lean: number
  /** 車の側への傾き・ひねり・首の向き */
  bank: number
  twist: number
  headPitch?: number
  headYaw: number
  armIn: ArmPose
  armOut: ArmPose
  legIn: LegPose
  legOut: LegPose
}

/** inLeft: 車が体の左にある（右のドアを使い、車の前を向いている） */
const inOut = (inLeft: boolean, p: InOutRig): RigPose => {
  const s = inLeft ? 1 : -1
  return {
    hip: p.hip,
    lean: p.lean,
    bank: -s * p.bank,
    twist: s * p.twist,
    headPitch: p.headPitch ?? 0,
    headYaw: s * p.headYaw,
    armL: inLeft ? p.armIn : p.armOut,
    armR: inLeft ? p.armOut : p.armIn,
    legL: inLeft ? p.legIn : p.legOut,
    legR: inLeft ? p.legOut : p.legIn,
  }
}

/** 座りきった脚（腿は前へ水平より少し上がり、すねは斜め前へ伸びて足元へ。足裏は車の床の高さで、車体の下へはみ出さない） */
const SEATED_LEG: LegPose = { swing: 1.75, bend: 0.7, foot: 0, splay: 0.06 }

/** 座りきって、ハンドルへ置いた外の手（rigSeat の乗るときの式の終わりと同じ値） */
const WHEEL_ARM: ArmPose = { swing: 1.1, splay: 0.15, bend: 0.75, turn: 0.3 }

/** 座りきったときの脚の付け根の高さの既定（身長に対する割合）。描画は車種の座席の高さから出して渡す */
export const SEAT_HIP = 0.3

/** 頭の中心が脚の付け根からどれだけ上にあるか（身長に対する割合。上体を起こしているとき） */
export const HEAD_ABOVE_HIP = RIG_DIM.torso + RIG_DIM.neck + RIG_DIM.head / 2

/**
 * 座る動きの1瞬（t=0 でドアの外に立ち、1 で座りきる。降りるときは逆に辿る）。拍は onFoot の SEAT_BEATS と同じ:
 *   step  … 開口の前へ踏み込みながら体を車の前へ向け、外の手を開いたドアの上の縁へ掛ける。車の側の足が浮く
 *   duck  … 腰を座面の高さへ落としはじめ、上体を屋根の下へ傾ける（頭は窓の高さ。地面へはしゃがまない）
 *   slide … 車の側の脚を車内へ差し入れ、腰を座席へ送る。外の脚は地面に残って開く
 *   tuck  … 外の脚を引き込んで両腿が前へ上がり、上体を起こして両手をハンドルへ
 * @param seatHip 座りきったときの脚の付け根の高さ（身長に対する割合）
 */
export function rigSeat(t: number, inLeft: boolean, seatHip = SEAT_HIP, hold: ArmPose = DOOR_HOLD): RigPose {
  const a = beat(t, SEAT_BEATS.step)
  const duck = beat(t, SEAT_BEATS.duck)
  const slide = beat(t, SEAT_BEATS.slide)
  const tuck = beat(t, SEAT_BEATS.tuck)
  // 腰: 車体の外では座面までの 1/3 ほどだけ落とし、残りは座席へ入りながら落とす（onFoot の seatSink と同じ割り振り）
  const hip = RIG_DIM.hip - 0.015 * a * (1 - slide) - (RIG_DIM.hip - seatHip) * (SEAT_OUTSIDE_DROP * duck + (1 - SEAT_OUTSIDE_DROP) * slide)
  // 車の側の脚: 踏み込みで浮かせ、車の側へ開いて差し入れ、座った形へ
  const enter = smooth((slide - 0.0) / 0.7)
  const lift = Math.sin(Math.PI * clamp(a * 0.5 + duck * 0.5, 0, 1))
  const stepIn = solveLeg(0.1 * a, 0.09 * lift, hip, 0.2 * lift)
  const legIn = mixLeg(stepIn, SEATED_LEG, Math.max(enter, 0.55 * duck))
  // 外の脚: 地面に残って踏んばり（腰が沈むぶん膝が曲がる）、腰が車内へ動くぶん外へ開く。最後に引き込む
  const planted = solveLeg(-0.03 * a + 0.04 * duck, 0, hip)
  const legOut = mixLeg({ ...planted, splay: 0.04 + 0.7 * slide }, SEATED_LEG, tuck)
  // 屈み: 腰を落とすのと一緒に深まり、腰が座席へ入るころから起こしはじめる（頭が屋根の縁をくぐって、窓の高さへ戻る）
  const bow = duck * (1 - beat(t, SEAT_BEATS.rise))
  return inOut(inLeft, {
    hip,
    // 屋根をくぐるあいだだけ前へ倒し、座ったら背もたれへ少し反る
    lean: 0.08 * a * (1 - tuck) + SEAT_RIG.lean * bow - 0.02 * tuck,
    bank: SEAT_RIG.bank * bow,
    twist: 0.2 * duck * (1 - slide),
    headPitch: 0.06 * a * (1 - tuck) + SEAT_RIG.head * bow,
    headYaw: 0.3 * duck * (1 - tuck),
    // 車の側の手は車内（ハンドル）へ伸ばす
    armIn: { swing: 0.4 * a + 0.6 * duck + 0.15 * tuck, splay: 0.1 + 0.1 * duck, bend: 0.4 * a + 0.2 * duck + 0.2 * tuck },
    // 外の手は、開けたときから開いたドアの縁に掛けたまま（DOOR_HOLD）踏み込み、座りきったらハンドルへ。
    // 降りるときは逆に辿るので、立ち上がったとき手はドアの縁にあり、そのまま押して閉める動きへ続く
    armOut:
      hold === DOOR_HOLD
        ? {
            swing: lerp(DOOR_HOLD.swing, 0.65, a) + 0.1 * duck + 0.35 * tuck,
            splay: lerp(DOOR_HOLD.splay, 0.9, a) + 0.1 * slide - 0.85 * tuck,
            bend: lerp(DOOR_HOLD.bend, 0.3, a) + 0.35 * duck + 0.1 * tuck,
            turn: 0.3 * tuck,
          }
        : // 降りるとき（逆に辿る）: ハンドルから離した手は、肘を曲げたまま体の前を通ってドアの内張りへ。腕を横へ伸ばしきる瞬間がない
          mixArm(hold, WHEEL_ARM, tuck),
    legIn: { ...legIn, splay: legIn.splay + 0.45 * Math.sin(Math.PI * clamp(enter, 0, 1)) },
    legOut,
  })
}

/**
 * ドアの外に立って、開いたドアの縁に外の手を掛けた腕（開け終わり・踏み込みはじめ・降りて立った瞬間に共通の形）。
 * カメラは斜め後ろにいるので、前へ伸ばした腕は胴に隠れて見えない。開いたドアの縁は体の斜め外にあるので、
 * 腕は外へ大きく開いて（splay）輪郭の外へ出す。前への振り（swing）を大きくすると splay が効かなくなるので控えめにする
 */
const DOOR_HOLD: ArmPose = { swing: 0.55, splay: 1.05, bend: 0.45, turn: 0 }
/** 閉じたドアの取っ手へ伸ばした、車の側の腕。取っ手は体の斜め前・車の側にあるので、脇を車の側へ開いて輪郭の外（車体の前）に見せる */
/**
 * 降りるときの外の腕。開いたドアの内張りに、肘を曲げた手を腰の高さで添える（腕を真横へ伸ばさない）。
 * 乗るときの DOOR_HOLD をそのまま逆に辿ると、立ち上がった体の横へ腕が水平に突き出て T 字に固まって見えた（R16）。
 * 立ち上がる → 添えた手で押す → 下ろす、のあいだ、肘は曲がったまま体の前を通る
 */
export const EXIT_HOLD: ArmPose = { swing: 0.6, splay: 0.36, bend: 0.95, turn: 0.15 }
/** 降りてドアを押しきった外の腕: 肘を軽く残して体の前へ伸ばす（肩の高さまでは上げない） */
export const EXIT_PUSHED: ArmPose = { swing: 1.0, splay: 0.06, bend: 0.4, turn: 0.1 }
const DOOR_REACH: ArmPose = { swing: 0.75, splay: 0.95, bend: 0.75, turn: 0.2 }

/**
 * 座ったまま、外の手でドアを扱う。
 * @param grip 手をドアへ伸ばした度合い 0..1（0 はハンドルに置いたまま）
 * @param far  ドアの開き具合 0..1（手はドアに付いていく。1 で外へ伸ばしきり、0 で手元へ引ききる）
 */
function rigSeatDoor(grip: number, far: number, inLeft: boolean, seatHip: number): RigPose {
  const base = rigSeat(1, inLeft, seatHip)
  const onDoor: ArmPose = { swing: 0.75 - 0.2 * far, splay: 0.95 * far - 0.05, bend: 0.3 + 0.9 * (1 - far) }
  const wheel = inLeft ? base.armR : base.armL
  const arm = mixArm(wheel, onDoor, grip)
  const s = inLeft ? 1 : -1
  const lean = { ...base, bank: base.bank + s * 0.16 * far * grip, headYaw: base.headYaw - s * 0.35 * far * grip }
  return inLeft ? { ...lean, armR: arm } : { ...lean, armL: arm }
}

const mixArm = (a: ArmPose, b: ArmPose, k: number): ArmPose => ({ swing: lerp(a.swing, b.swing, k), splay: lerp(a.splay, b.splay, k), bend: lerp(a.bend, b.bend, k), turn: lerp(armTurn(a), armTurn(b), k) })
const mixLeg = (a: LegPose, b: LegPose, k: number): LegPose => ({ swing: lerp(a.swing, b.swing, k), bend: lerp(a.bend, b.bend, k), foot: lerp(a.foot, b.foot, k), splay: lerp(a.splay, b.splay, k) })

/**
 * 乗り降りの段階ごとの姿勢。体は車のほうを向いている（降りるときは車に背を向けている）前提。
 * @param k その段階の進み具合 0..1
 * @param side 使うドアの側（1=車の右、−1=左、0=後ろ）
 * @param seatHip 座りきったときの脚の付け根の高さ（身長に対する割合）
 */
export function rigBoarding(phase: BoardingPhase, k: number, side: 1 | -1 | 0, seatHip = SEAT_HIP): RigPose {
  // 車の右のドアへ向いて立つと、車の前は右手の側。降りるときは背を向けているので逆
  const facingCar = phase !== 'out' && phase !== 'leave' && phase !== 'unlatch'
  const leadLeft = (side === -1) === facingCar

  switch (phase) {
    case 'open': {
      // 取っ手へ手を伸ばし、引いて開けるあいだ片足を引いて体を反らす
      // 手が届くまで（openFrom）ドアは動かない。そこから先、引く手と同じ進み具合でドアが開く（onFoot の boardingPose と同じ区間）
      const go = smooth(k / DOOR_BEATS.openFrom)
      const pull = smooth((k - DOOR_BEATS.openFrom) / (1 - DOOR_BEATS.openFrom))
      // 引くあいだ膝を落として構える（開いたドアの脇で棒立ちにならない。そのまま屈んで踏み込む動きへ続く）
      const hip = RIG_DIM.hip - 0.015 * go - 0.04 * pull
      return sided(leadLeft, {
        hip,
        lean: 0.26 * go - 0.2 * pull,
        twist: -0.5 * go + 0.3 * pull,
        headPitch: 0.1 * go,
        // 車の側の手で取っ手をつかんで引き、開いてくるドアの縁を外の手で受ける。開ききったら、外の手を縁に掛けている（DOOR_HOLD）。
        // 前へ伸ばしただけの腕は斜め後ろのカメラから胴に隠れるので、どちらの腕も輪郭の外へ開いて見せる
        armTrail: mixArm(mixArm(REST_ARM, DOOR_REACH, go), { swing: -0.15, splay: 0.3, bend: 0.9 }, pull),
        armLead: mixArm(REST_ARM, DOOR_HOLD, pull),
        legTrail: solveLeg(0.07 * go - 0.2 * pull, 0, hip),
        legLead: solveLeg(-0.05 * go, 0, hip),
      })
    }
    case 'pull': {
      // 両腕で運転手をつかみ、足を前後に開いて踏んばり、反って引く
      const yank = Math.sin(clamp(k, 0, 1) * Math.PI)
      const hip = RIG_DIM.hip - 0.03 - 0.035 * yank
      return sided(leadLeft, {
        hip,
        lean: 0.14 - 0.42 * yank,
        twist: 0.12 * yank,
        headPitch: 0.15,
        armLead: { swing: 1.15 - 0.3 * yank, splay: 0.15, bend: 0.35 + 0.95 * yank },
        armTrail: { swing: 1.05 - 0.3 * yank, splay: 0.2, bend: 0.4 + 0.9 * yank },
        legLead: solveLeg(0.1, 0, hip),
        legTrail: solveLeg(-0.13 - 0.04 * yank, 0, hip),
      })
    }
    case 'sit':
      return rigSeat(k, side !== -1, seatHip)
    case 'out':
      return rigSeat(1 - k, side !== -1, seatHip, EXIT_HOLD)
    case 'leave': {
      // ドアの横に立ち、内張りに添えていた外の手（EXIT_HOLD）でそのまま押して閉める。
      // 手を掛け直す（pushFrom まで）→ 腕を伸ばしながら車の側へ体をひねって押しきる（pushTo まで。ドアも同じ区間で閉まる）→ 腕を下ろす
      const shove = smooth((k - DOOR_BEATS.pushFrom) / (DOOR_BEATS.pushTo - DOOR_BEATS.pushFrom))
      const done = smooth((k - DOOR_BEATS.pushTo) / (1 - DOOR_BEATS.pushTo))
      const live = 1 - done
      const hip = RIG_DIM.hip - 0.03 * shove * live
      // 押しきった腕（EXIT_PUSHED）: 肘を軽く残して前へ伸び、閉まるドアを追って体の内（車の側）へ寄る
      return inOut(side !== -1, {
        hip,
        lean: 0.2 * shove * live,
        twist: 0.22 * shove * live,
        bank: 0.08 * shove * live,
        headYaw: 0.3 * live,
        armOut: mixArm(mixArm(EXIT_HOLD, EXIT_PUSHED, shove), REST_ARM, done),
        armIn: { swing: REST_ARM.swing - 0.35 * shove * live, splay: 0.12, bend: REST_ARM.bend + 0.25 * shove * live },
        // 押す側（外）の足を半歩前へ踏み出して体重を乗せる
        legOut: solveLeg(0.12 * shove * live, 0, hip),
        legIn: solveLeg(-0.07 * shove * live, 0, hip),
      })
    }
    case 'shut':
      // 座ったまま、外の手を開いたドアへ伸ばし（shutFrom まで）、引いて閉める（ドアと同じ区間）
      return rigSeatDoor(smooth(k / DOOR_BEATS.shutFrom), 1 - smooth((k - DOOR_BEATS.shutFrom) / (1 - DOOR_BEATS.shutFrom)), side !== -1, seatHip)
    case 'unlatch':
      // 座ったまま、外の手をドアへ当て（unlatchFrom まで）、押して開ける（ドアと同じ区間）
      return rigSeatDoor(smooth(k / DOOR_BEATS.unlatchFrom), smooth((k - DOOR_BEATS.unlatchFrom) / (1 - DOOR_BEATS.unlatchFrom)), side !== -1, seatHip)
    case 'approach':
      return REST_RIG
  }
}

/** 2つの姿勢のあいだ（t=0 で a、1 で b） */
export function mixRig(a: RigPose, b: RigPose, t: number): RigPose {
  const k = clamp(t, 0, 1)
  if (k <= 0) return a
  if (k >= 1) return b
  return {
    hip: lerp(a.hip, b.hip, k),
    lean: lerp(a.lean, b.lean, k),
    bank: lerp(a.bank, b.bank, k),
    twist: lerp(a.twist, b.twist, k),
    headPitch: lerp(a.headPitch, b.headPitch, k),
    headYaw: lerp(a.headYaw, b.headYaw, k),
    hunch: lerp(a.hunch ?? 0, b.hunch ?? 0, k),
    hipTilt: lerp(a.hipTilt ?? 0, b.hipTilt ?? 0, k),
    armL: mixArm(a.armL, b.armL, k),
    armR: mixArm(a.armR, b.armR, k),
    legL: mixLeg(a.legL, b.legL, k),
    legR: mixLeg(a.legR, b.legR, k),
  }
}
