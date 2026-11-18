// [部品: vehicle] 衝突の重さの応答: 当たった瞬間に車ごと跳ね、当たった反対側の輪が浮いて落ち、部品が落ちる。
import { describe, expect, it } from 'vitest'
import { crashKick, droppedParts, impactFromVelocity, hopPose, restCrashBody, stepCrashBody, VEHICLE_CRASH, wreckSag, type CrashBody } from '../vehicleCrash'
import { DENT, NO_DENTS } from '../vehicleDamage'

const DT = 1 / 60
const HALF_L = 2.3
const HALF_W = 0.9

/** 落ち着くまで進めて、いちばん大きかった角度と、掛かった秒を返す */
function settle(body: CrashBody, seconds = 3) {
  let b = body
  let tip = 0
  let lean = 0
  let rest = Infinity
  for (let i = 1; i <= seconds / DT; i++) {
    b = stepCrashBody(b, DT)
    if (Math.abs(b.tip) > Math.abs(tip)) tip = b.tip
    if (Math.abs(b.lean) > Math.abs(lean)) lean = b.lean
    if (rest === Infinity && b.tip === 0 && b.lean === 0 && b.tipVel === 0 && b.leanVel === 0) rest = i * DT
  }
  return { tip, lean, rest, end: b }
}

describe('gto vehicleCrash: 当たった瞬間の跳ね', () => {
  it('弱い当たりでは跳ねない', () => {
    expect(crashKick(restCrashBody(), VEHICLE_CRASH.hopFrom - 0.5, 0, HALF_L, HALF_L, HALF_W)).toEqual(restCrashBody())
  })

  it('正面から強く当たると尻が 0.25〜0.7m 浮き、1 秒以内に落ちて落ち着く', () => {
    const run = settle(crashKick(restCrashBody(), 20, 0, HALF_L, HALF_L, HALF_W))
    // tip は＋で尻が浮く（前の車軸が軸）
    const lift = Math.sin(run.tip) * 2.7
    expect(lift).toBeGreaterThan(0.25)
    expect(lift).toBeLessThan(0.7)
    expect(run.rest).toBeLessThan(1.3)
    expect(run.end).toEqual(restCrashBody())
  })

  it('後ろから当てられると鼻が浮く（向きが逆）', () => {
    const run = settle(crashKick(restCrashBody(), 16, 0, -HALF_L, HALF_L, HALF_W))
    expect(run.tip).toBeLessThan(-0.03)
  })

  it('右の側面に当たると左側の輪が浮き、左なら右が浮く（当たった反対側が浮く）', () => {
    const right = settle(crashKick(restCrashBody(), 14, HALF_W, 0, HALF_L, HALF_W))
    const left = settle(crashKick(restCrashBody(), 14, -HALF_W, 0, HALF_L, HALF_W))
    // lean は＋で右側が浮く
    expect(right.lean).toBeLessThan(-0.06)
    expect(left.lean).toBeGreaterThan(0.06)
    expect(Math.sin(Math.abs(right.lean)) * 1.56).toBeLessThan(0.6)
  })

  it('強いほど高く跳ね、上限を超えない', () => {
    const weak = settle(crashKick(restCrashBody(), 8, 0, HALF_L, HALF_L, HALF_W))
    const hard = settle(crashKick(restCrashBody(), 18, 0, HALF_L, HALF_L, HALF_W))
    expect(hard.tip).toBeGreaterThan(weak.tip * 1.5)
    let b = restCrashBody()
    for (let i = 0; i < 6; i++) b = crashKick(b, 40, HALF_W, HALF_L, HALF_L, HALF_W)
    const wild = settle(b)
    expect(Math.abs(wild.tip)).toBeLessThanOrEqual(VEHICLE_CRASH.tipMax + 1e-9)
    expect(Math.abs(wild.lean)).toBeLessThanOrEqual(VEHICLE_CRASH.leanMax + 1e-9)
  })

  it('落ちた輪は路面で 1 回小さく弾んでから止まる（路面の下へ潜らない）', () => {
    let b = crashKick(restCrashBody(), 20, 0, HALF_L, HALF_L, HALF_W)
    let landed = false
    let rebound = 0
    for (let i = 0; i < 180; i++) {
      const next = stepCrashBody(b, DT)
      expect(next.tip).toBeGreaterThanOrEqual(0)
      if (b.tip > 0 && next.tip === 0) landed = true
      if (landed) rebound = Math.max(rebound, next.tip)
      b = next
    }
    expect(landed).toBe(true)
    expect(rebound).toBeGreaterThan(0.002)
    expect(rebound).toBeLessThan(0.08)
  })

  it('渡した状態を書き換えない', () => {
    const b = Object.freeze(crashKick(restCrashBody(), 20, 0.5, HALF_L, HALF_L, HALF_W))
    expect(() => stepCrashBody(b, DT)).not.toThrow()
  })
})

describe('gto vehicleCrash: 車ごとの傾き（輪も一緒に浮く）', () => {
  it('浮いていない側の輪は路面に残る高さだけ、車の中心を持ち上げる', () => {
    const pose = hopPose({ tip: 0.2, tipVel: 0, lean: 0, leanVel: 0 }, 1.35, 0.78)
    // 前の車軸が軸: 中心は sin(0.2) × 1.35 だけ上がり、鼻が下がる（pitch は＋で鼻上がり）
    expect(pose.rise).toBeCloseTo(Math.sin(0.2) * 1.35, 5)
    expect(pose.pitch).toBeCloseTo(-0.2, 5)
    const side = hopPose({ tip: 0, tipVel: 0, lean: -0.15, leanVel: 0 }, 1.35, 0.78)
    expect(side.rise).toBeCloseTo(Math.sin(0.15) * 0.78, 5)
    expect(side.roll).toBeCloseTo(-0.15, 5)
    expect(hopPose(restCrashBody(), 1.35, 0.78)).toEqual({ pitch: 0, roll: 0, rise: 0 })
  })
})

describe('gto vehicleCrash: 落ちる部品', () => {
  const with_ = (i: number, d: number) => NO_DENTS.map((v, k) => (k === i ? d : v))

  it('鼻が深く潰れた瞬間に前のバンパーが 1 回だけ落ちる', () => {
    expect(droppedParts(undefined, with_(DENT.frontC, 0.2))).toEqual([])
    expect(droppedParts(with_(DENT.frontC, 0.2), with_(DENT.frontC, 0.7))).toEqual(['bumperFront'])
    expect(droppedParts(with_(DENT.frontC, 0.7), with_(DENT.frontC, 1))).toEqual([])
  })

  it('尻なら後ろのバンパー、側面ならホイールキャップが落ちる', () => {
    expect(droppedParts(undefined, with_(DENT.rearL, 0.8))).toEqual(['bumperRear'])
    expect(droppedParts(undefined, with_(DENT.left, 0.6))).toEqual(['hubcapLeft'])
    expect(droppedParts(undefined, with_(DENT.right, 0.6))).toEqual(['hubcapRight'])
  })
})

describe('gto vehicleCrash: 壊れた車の据わり', () => {
  it('無傷なら傾かない', () => {
    expect(wreckSag(undefined)).toEqual({ pitch: 0, roll: 0 })
  })

  it('鼻が潰れると鼻が下がり、潰れた角の側へ傾く', () => {
    const d = NO_DENTS.map((v, k) => (k === DENT.frontL ? 1 : k === DENT.frontC ? 0.6 : v))
    const sag = wreckSag(d)
    expect(sag.pitch).toBeLessThan(-0.01)
    // roll は＋で左へ傾く
    expect(sag.roll).toBeGreaterThan(0.01)
    expect(Math.abs(sag.pitch)).toBeLessThan(0.06)
  })
})

describe('gto vehicleCrash: 速度の急な変化から当たりを割り出す', () => {
  it('ふつうの加減速では当たりとみなさない', () => {
    expect(impactFromVelocity(0, -20, 0, -19.4, 0, HALF_L, HALF_W)).toBeNull()
  })

  it('北向きに走っていて急に止められたら、鼻に当たっている', () => {
    // 向き 0 は北（−z）
    const hit = impactFromVelocity(0, -20, 0, 4, 0, HALF_L, HALF_W)
    expect(hit?.impact).toBeCloseTo(24, 5)
    expect(hit?.lz).toBeCloseTo(HALF_L, 5)
    expect(Math.abs(hit?.lx ?? 9)).toBeLessThan(0.01)
  })

  it('止まっていて前へ押し出されたら尻に、右へ押されたら左の側面に当たっている', () => {
    expect(impactFromVelocity(0, 0, 0, -8, 0, HALF_L, HALF_W)?.lz).toBeCloseTo(-HALF_L, 5)
    const side = impactFromVelocity(0, 0, 7, 0, 0, HALF_L, HALF_W)
    expect(side?.lx).toBeCloseTo(-HALF_W, 5)
    expect(Math.abs(side?.lz ?? 9)).toBeLessThan(0.01)
  })
})
