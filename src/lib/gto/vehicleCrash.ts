// Grand Theft Outfit [部品: vehicle] 衝突の重さの応答（車ごとの跳ねと、落ちる部品）。
// 入口: VEHICLE_CRASH / restCrashBody / crashKick / stepCrashBody / hopPose / droppedParts / wreckSag / impactFromVelocity
// 契約: 当たった強さ（m/s）と場所（車体の座標）から、車が輪ごと跳ね上がる角度を決める。
//       正面なら前の車軸を軸に尻が浮き、側面なら当たった側の輪を軸に反対側の輪が浮く。浮いた輪は重さで落ち、
//       路面で1回小さく弾んで止まる。車体のばね（vehicleAttitude.ts）とは別で、こちらは車輪も一緒に持ち上がる。
//       向きの約束: tip は＋で尻が浮く（−で鼻が浮く）。lean は＋で右側の輪が浮く（−で左側）。
import { clamp, dirOf } from './math'
import { DENT } from './vehicleDamage'

export const VEHICLE_CRASH = {
  /** これより弱い当たりでは跳ねない m/s、この強さで跳ねが最大になる m/s */
  hopFrom: 3.5,
  hopFull: 12,
  /** 1コマのあいだに速度がこれより変わったら「当たった」とみなす m/s（操作や路面では起きない大きさ） */
  detect: 3,
  /** 最大の当たりで付く回る速さ rad/s（前後・左右） */
  tipKick: 1.35,
  leanKick: 2.1,
  /** 正面に当たったときにも、左右どちらかへ付く揺れ（leanKick に対する割合。bias で向きを選ぶ） */
  frontLean: 0.45,
  /** 浮いた側が重さで落ちる強さ rad/s²（前後は車軸の間隔、左右は輪の間隔で決まる） */
  tipGravity: 6.2,
  leanGravity: 9,
  /** 浮く角度の上限 rad */
  tipMax: 0.2,
  leanMax: 0.22,
  /** 路面に落ちたときの弾み（速さの割合）と、これより遅ければ弾まずに止まる rad/s */
  land: 0.28,
  settle: 0.22,
  /** バンパーが落ちる端の凹み、ホイールキャップが落ちる側面の凹み */
  bumperAt: 0.5,
  hubcapAt: 0.4,
  /** 壊れた車の据わり: 鼻の凹み 1 あたりの鼻下がり rad、左右の凹みの差 1 あたりの傾き rad */
  sagPitch: 0.04,
  sagRoll: 0.035,
}

/** 車ごとの跳ね（輪も一緒に浮く）の状態 */
export interface CrashBody {
  tip: number
  tipVel: number
  lean: number
  leanVel: number
}

const REST: CrashBody = Object.freeze({ tip: 0, tipVel: 0, lean: 0, leanVel: 0 })
export const restCrashBody = (): CrashBody => ({ ...REST })

/**
 * 当たった瞬間の跳ねを足す。
 * @param impact 当たった強さ m/s
 * @param lx 当たった場所（車体の座標、右が＋）
 * @param lz 当たった場所（車体の座標、前が＋）
 * @param bias 正面・真後ろの当たりで、左右どちらへ揺れるか（−1..1。省くと当たった場所の左右だけで決まる）
 */
export function crashKick(body: CrashBody, impact: number, lx: number, lz: number, halfL: number, halfW: number, bias = 0): CrashBody {
  const t = VEHICLE_CRASH
  if (impact <= t.hopFrom) return body
  const k = Math.pow(clamp((impact - t.hopFrom) / (t.hopFull - t.hopFrom), 0, 1), 0.8)
  const u = clamp(lz / halfL, -1, 1)
  const s = clamp(lx / halfW, -1, 1)
  // 端に当たるほど前後に、側面に当たるほど左右に跳ねる
  const endOn = Math.abs(u) >= Math.abs(s) ? 1 : Math.abs(u)
  const sideOn = Math.abs(s) > Math.abs(u) ? 1 : Math.abs(s) * 0.85
  // 当たった側が止められ、反対側が浮く
  const leanDir = Math.abs(s) > 0.15 ? -Math.sign(s) * sideOn : clamp(bias, -1, 1) * t.frontLean
  return {
    ...body,
    tipVel: body.tipVel + Math.sign(u) * endOn * k * t.tipKick,
    leanVel: body.leanVel + leanDir * k * t.leanKick,
  }
}

/** 1つの軸を進める: 浮いた側が重さで落ち、路面（0）で小さく弾んで止まる */
function fall(angle: number, vel: number, gravity: number, max: number, dt: number): [number, number] {
  if (angle === 0 && vel === 0) return [0, 0]
  const t = VEHICLE_CRASH
  // どちら側が浮いているか（まだ浮いていなければ、これから浮く側）
  const side = angle !== 0 ? Math.sign(angle) : Math.sign(vel)
  const v = vel - side * gravity * dt
  const a = angle + v * dt
  if (a * side <= 0) {
    // 路面に落ちた: 速ければ同じ側へ小さく弾み、遅ければ止まる
    const back = -v * t.land
    return Math.abs(back) > t.settle ? [0, back] : [0, 0]
  }
  if (Math.abs(a) > max) return [side * max, 0]
  return [a, v]
}

/** 跳ねを dt 秒進める */
export function stepCrashBody(body: CrashBody, dt: number): CrashBody {
  const t = VEHICLE_CRASH
  const [tip, tipVel] = fall(body.tip, body.tipVel, t.tipGravity, t.tipMax, dt)
  const [lean, leanVel] = fall(body.lean, body.leanVel, t.leanGravity, t.leanMax, dt)
  return { tip, tipVel, lean, leanVel }
}

/**
 * 跳ねている車の置き方。浮いていない側の輪が路面に残るよう、車の中心を rise だけ持ち上げて傾ける。
 * pitch は＋で鼻上がり、roll は＋で右側が上がる（描画の車体と同じ向き）。halfBase・halfTrack は輪の前後・左右の間隔の半分 m
 */
export function hopPose(body: CrashBody, halfBase: number, halfTrack: number): { pitch: number; roll: number; rise: number } {
  if (body.tip === 0 && body.lean === 0) return { pitch: 0, roll: 0, rise: 0 }
  return {
    pitch: -body.tip,
    roll: body.lean,
    rise: Math.sin(Math.abs(body.tip)) * halfBase + Math.sin(Math.abs(body.lean)) * halfTrack,
  }
}

export type CrashPart = 'bumperFront' | 'bumperRear' | 'hubcapLeft' | 'hubcapRight'

/** 凹みが境目を越えた瞬間に落ちる部品（前の凹み → 今の凹み）。同じ部品は1回しか落ちない */
export function droppedParts(before: readonly number[] | undefined, after: readonly number[] | undefined): CrashPart[] {
  if (!after) return []
  const t = VEHICLE_CRASH
  const worst = (d: readonly number[] | undefined, zones: number[]) => (d ? Math.max(...zones.map((z) => d[z] ?? 0)) : 0)
  const crossed = (zones: number[], at: number) => worst(before, zones) < at && worst(after, zones) >= at
  const parts: CrashPart[] = []
  if (crossed([DENT.frontL, DENT.frontC, DENT.frontR], t.bumperAt)) parts.push('bumperFront')
  if (crossed([DENT.rearL, DENT.rearC, DENT.rearR], t.bumperAt)) parts.push('bumperRear')
  if (crossed([DENT.left], t.hubcapAt)) parts.push('hubcapLeft')
  if (crossed([DENT.right], t.hubcapAt)) parts.push('hubcapRight')
  return parts
}

/** 壊れた車の据わり: 潰れた鼻が下がり、潰れた角の側へ傾いたまま止まる（pitch は＋で鼻上がり、roll は＋で左へ傾く） */
export function wreckSag(dents: readonly number[] | undefined): { pitch: number; roll: number } {
  if (!dents) return { pitch: 0, roll: 0 }
  const t = VEHICLE_CRASH
  const front = Math.max(dents[DENT.frontL], dents[DENT.frontC], dents[DENT.frontR])
  const rear = Math.max(dents[DENT.rearL], dents[DENT.rearC], dents[DENT.rearR])
  const left = Math.max(dents[DENT.frontL], dents[DENT.rearL], dents[DENT.left])
  const right = Math.max(dents[DENT.frontR], dents[DENT.rearR], dents[DENT.right])
  return { pitch: (rear - front) * t.sagPitch, roll: (left - right) * t.sagRoll }
}

/**
 * 速度の急な変化から、当たった強さと場所を割り出す（描画が毎コマ呼ぶ。壁・柱・ほかの車のどれに当たっても同じ）。
 * 押された向きの反対側が、当たった場所になる。当たっていなければ null。
 * @param pvx 直前の速度（世界の x, z。m/s）
 * @param vx いまの速度
 * @returns impact は速度の変化 m/s、lx・lz は当たった場所（車体の座標。右が＋、前が＋）
 */
export function impactFromVelocity(pvx: number, pvz: number, vx: number, vz: number, heading: number, halfL: number, halfW: number): { impact: number; lx: number; lz: number } | null {
  const dx = vx - pvx
  const dz = vz - pvz
  const impact = Math.hypot(dx, dz)
  if (impact < VEHICLE_CRASH.detect) return null
  const f = dirOf(heading)
  const along = (dx * f.x + dz * f.z) / impact
  const across = (-dx * f.z + dz * f.x) / impact
  // 車体の縁まで伸ばす（長方形の縁に当たる点）
  const reach = 1 / Math.max(Math.abs(along), Math.abs(across), 1e-6)
  return { impact, lx: clamp(-across * reach, -1, 1) * halfW, lz: clamp(-along * reach, -1, 1) * halfL }
}
