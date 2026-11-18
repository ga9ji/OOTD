// Grand Theft Outfit [部品: onfoot] 体の姿勢（関節の角度）を決める。
// 入口: gaitPose / boardingBodyPose / boardingProgress / mixPose / REST_POSE
// 契約: くり抜きスプライトは1枚の板だが、描画側（renderActorGait.ts）が板を「脚2本・腕2本・胴」に分けて
//       紙人形のように曲げる。ここはその関節の角度だけを決める（three/DOM なし）。
//       角度はスプライトの面の中での回転（ラジアン）。正の角度は、ぶら下がった手足の先を板の右（+x）へ振る。
//       side / toward も板の右を正とする（板を裏返しているときは描画側で符号を合わせてから渡す）。
import { clamp, lerp } from './math'
import { beat, BOARD_TUNING, outProgress, pushProgress, SEAT_BEATS } from './onFoot'
import type { Boarding, BoardingPhase } from './types'

/** 体の姿勢。すべて 0 が直立 */
export interface BodyPose {
  /** 脚の付け根の振り（左・右） */
  hipL: number
  hipR: number
  /** 膝の曲げ（すねの回転） */
  kneeL: number
  kneeR: number
  /** 脚を畳んで足が上がる割合 0..1（奥行き方向の動きを、短く見えることで表す） */
  liftL: number
  liftR: number
  /** 肩の振りと、肘から先の曲げ */
  armL: number
  armR: number
  foreL: number
  foreR: number
  /** 腰から上の横への傾き */
  bend: number
  /** 腰から上が縮む割合 0..1（前かがみを後ろ・前から見た姿） */
  hunch: number
  /** 腰が沈む高さ（身長に対する割合）。膝が曲がる */
  drop: number
  /** 体の幅が縮む割合 0..1（体をひねって横を向く） */
  twist: number
}

export const REST_POSE: BodyPose = {
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  liftL: 0,
  liftR: 0,
  armL: 0,
  armR: 0,
  foreL: 0,
  foreR: 0,
  bend: 0,
  hunch: 0,
  drop: 0,
  twist: 0,
}

/** 歩き・走りの振りの大きさ（[歩き, 走り]）。批評で「体が動いていない」と言われないよう大きめに取る */
export const POSE_TUNING = {
  /** 横から見た脚の振り・膝の曲げ・腕の振り・肘の曲げ */
  hip: [0.36, 0.52],
  knee: [0.8, 1.55],
  arm: [0.4, 0.9],
  elbow: [0.25, 1.15],
  /** 横から見たときも、振り出す脚は少し畳む */
  sideLift: [0.03, 0.1],
  /** 後ろ・前から見た足の上がり、すねの内振り、足幅、肘の張り、肘の畳み */
  rearLift: [0.22, 0.38],
  rearKnee: [0.18, 0.32],
  rearStance: [0.02, 0.07],
  rearFlare: [0.1, 0.32],
  rearElbow: [0.45, 1.3],
  rearPump: [0.1, 0.14],
  /** 上体: 左右の揺れ・前かがみ・接地の沈み */
  sway: [0.05, 0.07],
  hunch: [0.02, 0.11],
  dip: [0.022, 0.036],
}

export interface GaitInput {
  /** 歩いた距離の位相（ラジアン）。2π で左右1組 */
  phase: number
  /** 動いている度合い 0..1 */
  moving: number
  /** 走りの度合い 0..1 */
  run: number
  /** 進む向きが板の右へどれだけ向いているか −1..1（0 は奥か手前へ） */
  side: number
}

const smooth = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

/** 歩き・走りの1瞬の姿勢 */
export function gaitPose(g: GaitInput): BodyPose {
  const m = clamp(g.moving, 0, 1)
  if (m <= 0) return REST_POSE
  const T = POSE_TUNING
  const at = (pair: number[]) => lerp(pair[0], pair[1], clamp(g.run, 0, 1))
  const side = clamp(g.side, -1, 1)
  const depth = 1 - Math.abs(side)
  const s = Math.sin(g.phase)
  const c = Math.cos(g.phase)

  // 横から見た脚: 1枚の板では左右の脚を見分けられないので、板の「前の側の半分」を前脚、後ろの側を後ろ脚として
  // 開いて閉じる（交差させない）。膝を畳むのは、脚が揃う瞬間をまたいで後ろ脚→前脚へ受け渡す。
  const fore = side >= 0 ? 1 : -1
  const open = Math.abs(s)
  const opening = s * c > 0
  // 後ろ・前から見た脚: 左右の脚が片方ずつ畳まれて足が上がる
  const leg = (sign: number, cs: number) => {
    const front = sign === fore
    const flexSide = (front === opening ? Math.abs(c) : 0) ** 0.8
    const flexRear = Math.max(0, cs) ** 0.8
    return {
      hip: m * (Math.abs(side) * fore * (front ? 1 : -1) * at(T.hip) * open + depth * sign * at(T.rearStance)),
      knee: m * (-side * flexSide * at(T.knee) - depth * sign * flexRear * at(T.rearKnee)),
      lift: m * (Math.abs(side) * flexSide * at(T.sideLift) + depth * flexRear * at(T.rearLift)),
    }
  }
  const l = leg(-1, c)
  const r = leg(1, -c)

  // 腕は交互に振る。後ろから見ると、肘を外へ張って前腕を畳み、交互に引く
  const arm = (sign: number, sn: number) => ({
    arm: m * (-side * at(T.arm) * sn + depth * sign * (at(T.rearFlare) + at(T.rearPump) * sn)),
    fore: m * (side * at(T.elbow) * (0.8 - 0.2 * sn) - depth * sign * at(T.rearElbow) * (0.6 + 0.4 * sn)),
  })
  const al = arm(-1, s)
  const ar = arm(1, -s)

  return {
    hipL: l.hip,
    hipR: r.hip,
    kneeL: l.knee,
    kneeR: r.knee,
    liftL: l.lift,
    liftR: r.lift,
    armL: al.arm,
    armR: ar.arm,
    foreL: al.fore,
    foreR: ar.fore,
    // 体重は接地している脚の側へ寄る
    bend: m * depth * at(T.sway) * s,
    hunch: m * depth * at(T.hunch),
    // 歩きは脚が開ききった瞬間（両足が着いている）にいちばん沈み、走りは逆に、片足で踏んばる瞬間に沈む
    drop: m * at(T.dip) * (0.5 - 0.5 * Math.cos(g.phase * 2) * (1 - 2 * clamp(g.run, 0, 1))),
    twist: 0,
  }
}

/** 段階の進み具合 0..1 */
export function boardingProgress(b: Boarding): number {
  const B = BOARD_TUNING
  const span: Record<BoardingPhase, number> = {
    approach: B.approachTimeout,
    open: B.open,
    pull: B.pull,
    sit: B.sit,
    shut: B.shut,
    unlatch: B.unlatch,
    out: B.out,
    leave: B.leave,
  }
  // 外へ出る段階は、最初に座ったままの間がある（onFoot の outProgress）
  if (b.phase === 'out') return outProgress(b.t)
  return clamp(b.t / span[b.phase], 0, 1)
}

/**
 * 姿勢を決める段階と進み具合。ほぼ段階そのままだが、
 *   out の後半（体が出きったあと）は「ドアを押して閉める」姿勢（leave の 0→1）、
 *   歩ける段階（leave）は押し終えて腕を下ろした姿（leave の 1）を読む
 */
export function boardingAct(b: Boarding): { phase: BoardingPhase; k: number } {
  if (b.phase === 'out' && b.t > BOARD_TUNING.out) return { phase: 'leave', k: pushProgress(b.t) }
  if (b.phase === 'leave') return { phase: 'leave', k: 1 }
  return { phase: b.phase, k: boardingProgress(b) }
}

/** 車の側（near）と反対側（far）で書いた姿勢を、板の左右へ割り振る */
interface SidedPose {
  hipNear?: number
  hipFar?: number
  kneeNear?: number
  kneeFar?: number
  liftNear?: number
  liftFar?: number
  armNear?: number
  armFar?: number
  foreNear?: number
  foreFar?: number
  bend?: number
  hunch?: number
  drop?: number
  twist?: number
}

const sided = (n: 1 | -1, p: SidedPose): BodyPose => {
  const pick = (near: number | undefined, far: number | undefined, right: boolean) => ((n === 1) === right ? near : far) ?? 0
  return {
    hipL: pick(p.hipNear, p.hipFar, false),
    hipR: pick(p.hipNear, p.hipFar, true),
    kneeL: pick(p.kneeNear, p.kneeFar, false),
    kneeR: pick(p.kneeNear, p.kneeFar, true),
    liftL: pick(p.liftNear, p.liftFar, false),
    liftR: pick(p.liftNear, p.liftFar, true),
    armL: pick(p.armNear, p.armFar, false),
    armR: pick(p.armNear, p.armFar, true),
    foreL: pick(p.foreNear, p.foreFar, false),
    foreR: pick(p.foreNear, p.foreFar, true),
    bend: p.bend ?? 0,
    hunch: p.hunch ?? 0,
    drop: p.drop ?? 0,
    twist: p.twist ?? 0,
  }
}

/**
 * 乗り降りの段階ごとの姿勢。
 * @param k その段階の進み具合 0..1
 * @param toward 車が板の右にどれだけあるか −1..1（0 は車が奥か手前。そのときは腕を畳んで前へ出す）
 */
export function boardingBodyPose(phase: BoardingPhase, k: number, toward: number): BodyPose {
  const n: 1 | -1 = toward >= 0 ? 1 : -1
  const c = Math.abs(clamp(toward, -1, 1))
  const d = 1 - c
  // ドアへ伸ばした腕: 横にあれば水平近くまで上げ、奥にあれば肘を張って前腕を畳む
  const reachArm = n * (1.05 * c + 0.5 * d)
  const reachFore = -n * 1.1 * d

  // 座る動き（降りるときは逆再生）: まず車の側の脚を上げて踏み入れ、それから屈んで滑り込む
  const seat = (t: number): SidedPose => {
    const a = beat(t, SEAT_BEATS.step)
    const duck = beat(t, SEAT_BEATS.duck)
    return {
      hipNear: n * 0.55 * a * c,
      kneeNear: -n * 0.5 * a * c,
      liftNear: 0.38 * a * (1 - 0.3 * duck),
      hipFar: n * 0.3 * duck * c,
      liftFar: 0.3 * duck,
      armNear: reachArm * (1 - 0.55 * duck),
      foreNear: reachFore,
      armFar: n * 0.4 * a * c,
      bend: n * (0.2 * a + 0.32 * duck) * c,
      hunch: 0.1 * a + 0.42 * duck,
      drop: 0.05 * a + 0.3 * duck,
      twist: 0.25 * duck,
    }
  }

  switch (phase) {
    case 'open': {
      // 取っ手へ手を伸ばし、引いて開けるあいだ体を少し反らす
      const reach = smooth(k / 0.35)
      const pull = smooth((k - 0.35) / 0.65)
      return sided(n, {
        armNear: reachArm * reach,
        foreNear: reachFore * reach,
        bend: n * c * (0.1 * reach - 0.2 * pull),
        hunch: 0.07 * reach * d,
        drop: 0.025 * reach,
        hipNear: n * 0.12 * reach * c,
      })
    }
    case 'pull': {
      // 両腕で運転手をつかみ、足を開いて踏んばり、車と逆へ引く
      const yank = Math.sin(clamp(k, 0, 1) * Math.PI)
      return sided(n, {
        armNear: reachArm,
        foreNear: reachFore,
        armFar: n * 0.75 * c - n * 0.45 * d,
        foreFar: n * 1.0 * d,
        hipNear: n * 0.28,
        hipFar: -n * 0.22,
        bend: -n * c * (0.1 + 0.28 * yank) + n * 0.06 * d * yank,
        hunch: 0.1 * d + 0.08 * yank,
        drop: 0.05 + 0.06 * yank,
      })
    }
    case 'sit':
      return sided(n, seat(k))
    case 'out':
      return sided(n, seat(1 - k))
    case 'leave': {
      // 降りたら、ドアを押して閉める
      const push = 1 - smooth(k)
      return sided(n, { armNear: reachArm * 0.85 * push, foreNear: reachFore * push, bend: n * 0.08 * c * push })
    }
    case 'approach':
    case 'shut':
    case 'unlatch':
      return REST_POSE
  }
}

/** 2つの姿勢のあいだ（t=0 で a、1 で b） */
export function mixPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
  const k = clamp(t, 0, 1)
  if (k <= 0) return a
  if (k >= 1) return b
  return {
    hipL: lerp(a.hipL, b.hipL, k),
    hipR: lerp(a.hipR, b.hipR, k),
    kneeL: lerp(a.kneeL, b.kneeL, k),
    kneeR: lerp(a.kneeR, b.kneeR, k),
    liftL: lerp(a.liftL, b.liftL, k),
    liftR: lerp(a.liftR, b.liftR, k),
    armL: lerp(a.armL, b.armL, k),
    armR: lerp(a.armR, b.armR, k),
    foreL: lerp(a.foreL, b.foreL, k),
    foreR: lerp(a.foreR, b.foreR, k),
    bend: lerp(a.bend, b.bend, k),
    hunch: lerp(a.hunch, b.hunch, k),
    drop: lerp(a.drop, b.drop, k),
    twist: lerp(a.twist, b.twist, k),
  }
}
