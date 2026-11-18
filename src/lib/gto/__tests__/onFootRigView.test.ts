import { describe, expect, it } from 'vitest'
import { REST_RIG, RIG_DIM, rigGait } from '../onFootRig'
import { armJoints, easeGaitLevel, rearView, SHOULDER_SET } from '../onFootRigView'

const TAU = Math.PI * 2
const HALF = 0.115
const N = 32
const run = (phase: number, over: Partial<Parameters<typeof rigGait>[0]> = {}) => rigGait({ phase, moving: 1, run: 1, turn: 0, accel: 0, stride: 2.2, ...over })
const walk = (phase: number) => rigGait({ phase, moving: 1, run: 0, turn: 0, accel: 0, stride: 0.6 })
const phases = Array.from({ length: N }, (_, i) => (i / N) * TAU)

describe('onFootRigView: 関節を辿る', () => {
  it('立っているとき、腕は肩からほぼ真下へ下がる', () => {
    const j = armJoints(REST_RIG, 1, HALF)
    expect(j.shoulder.x).toBeCloseTo(HALF - SHOULDER_SET.in, 5)
    expect(j.shoulder.y).toBeCloseTo(RIG_DIM.hip + RIG_DIM.torso - SHOULDER_SET.down, 5)
    const len = Math.hypot(j.hand.x - j.shoulder.x, j.hand.y - j.shoulder.y, j.hand.z - j.shoulder.z)
    expect(len).toBeGreaterThan((RIG_DIM.upperArm + RIG_DIM.foreArm + RIG_DIM.hand) * 0.97)
    expect(j.hand.y).toBeLessThan(j.shoulder.y - 0.33)
    // 左右は鏡写し
    const r = armJoints(REST_RIG, -1, HALF)
    expect(r.hand.x).toBeCloseTo(-j.hand.x, 6)
    expect(r.hand.y).toBeCloseTo(j.hand.y, 6)
  })

  it('前へ倒れると肩が前へ出て、右へ傾くと右肩が下がる', () => {
    const lean = armJoints({ ...REST_RIG, lean: 0.4 }, 1, HALF)
    expect(lean.shoulder.z).toBeGreaterThan(0.08)
    const bank = rearView({ ...REST_RIG, bank: 0.2 }, HALF)
    expect(bank.r.shoulder.y).toBeLessThan(bank.l.shoulder.y - 0.03)
    expect(bank.shoulderTilt).toBeCloseTo(0.2, 1)
  })
})

describe('onFootRigView: 走りを背後のカメラから見た形', () => {
  it('どの瞬間も、片方の手が体の輪郭のずっと外にあり、肘も輪郭の外に出ている（腕が体側に貼り付かない）。歩きは出ない', () => {
    for (const ph of phases) {
      const v = rearView(run(ph), HALF)
      expect(Math.max(v.l.handOut, v.r.handOut)).toBeGreaterThan(HALF + 0.05)
      expect(Math.max(v.l.elbowOut, v.r.elbowOut)).toBeGreaterThan(HALF + 0.005)
      const w = rearView(walk(ph), HALF)
      expect(Math.max(w.l.elbowOut, w.r.elbowOut)).toBeLessThan(HALF + 0.02)
    }
  })

  it('両腕が同じ高さに揃って下がるコマが少ない（手の高さが左右で大きく違う = 前後に振っていると読める）', () => {
    let apart = 0
    for (const ph of phases) {
      const v = rearView(run(ph + 0.01), HALF)
      if (Math.abs(v.l.hand.y - v.r.hand.y) > 0.2) apart++
    }
    expect(apart).toBeGreaterThanOrEqual(N - 8)
  })

  it('引いた腕は伸ばし気味に外へ長く下がり、前へ振った腕は畳まれて、こぶしが肩の線より上・背中の輪郭の外に見える', () => {
    // 位相 0 は左足が前 = 右腕が前・左腕が後ろ
    const v = rearView(run(0), HALF)
    const back = v.l
    const front = v.r
    // 引いた腕: 肩から手までがほぼ1本に伸びて（折れが小さい）、手は胴の輪郭のずっと外・肩より 0.2 以上下
    expect(back.fold).toBeLessThan(0.5)
    expect(back.hand.y).toBeLessThan(back.shoulder.y - 0.2)
    expect(back.handOut).toBeGreaterThan(HALF + 0.06)
    // 前へ振った腕: 肘は引いた腕より内、こぶしは肩の線より上で、背中の輪郭（肩の半幅）の外に出る
    expect(front.elbowOut).toBeLessThan(back.elbowOut - 0.03)
    expect(front.handOut).toBeGreaterThan(HALF + 0.02)
    expect(front.hand.y).toBeGreaterThan(front.shoulder.y + 0.04)
    expect(front.hand.y).toBeGreaterThan(back.hand.y + 0.25)
  })

  it('左右の腕は互い違い: 片方は長く外へ下がり、片方は畳まれる。ほとんどの瞬間で形がはっきり違い、半周で入れ替わる', () => {
    let apart = 0
    for (const ph of phases) {
      const v = rearView(run(ph + 0.01), HALF)
      if (Math.abs(v.l.handOut - v.r.handOut) > 0.04 && Math.abs(v.l.fold - v.r.fold) > 0.5) apart++
      const o = rearView(run(ph + 0.01 + Math.PI), HALF)
      expect(o.l.handOut - o.r.handOut).toBeCloseTo(-(v.l.handOut - v.r.handOut), 2)
    }
    expect(apart).toBeGreaterThanOrEqual(N - 10)
  })

  it('接地のたびに肩の線が 10 度以上傾き、左右で逆になる。歩きは小さい', () => {
    const tilt = phases.map((ph) => rearView(run(ph), HALF).shoulderTilt)
    expect(Math.max(...tilt)).toBeGreaterThan(0.2)
    expect(Math.min(...tilt)).toBeLessThan(-0.2)
    // 1周のうち半分より多くのコマで、肩の線が 6 度より傾いている（水平に見えるコマが少ない）
    expect(tilt.filter((t) => Math.abs(t) > 0.1).length).toBeGreaterThan(N * 0.6)
    const calm = phases.map((ph) => Math.abs(rearView(walk(ph), HALF).shoulderTilt))
    expect(Math.max(...calm)).toBeLessThan(0.12)
  })

  it('肩のひねりで胴が細く見えすぎない（背中の幅が残り、張った肘が外に見える）', () => {
    for (const ph of phases) {
      const v = rearView(run(ph), HALF)
      expect(v.r.shoulder.x - v.l.shoulder.x).toBeGreaterThan(HALF * 2 * 0.8)
    }
  })

  it('曲がるときは体が内側へ大きく倒れる', () => {
    for (const ph of phases) {
      expect(rearView(run(ph, { turn: 1 }), HALF).shoulderTilt - rearView(run(ph), HALF).shoulderTilt).toBeGreaterThan(0.3)
      expect(rearView(run(ph, { turn: -1 }), HALF).shoulderTilt - rearView(run(ph), HALF).shoulderTilt).toBeLessThan(-0.3)
    }
  })
})

describe('onFootRigView: 背中の丸め', () => {
  it('走りは肩がすくんで上がる（歩きは上がらない）', () => {
    const flat = { ...run(0), hunch: 0 }
    expect(armJoints(run(0), 1, HALF).shoulder.y).toBeGreaterThan(armJoints(flat, 1, HALF).shoulder.y + 0.005)
    expect(walk(0).hunch ?? 0).toBe(0)
  })
})

describe('onFootRigView: 走りの姿勢を残す', () => {
  it('上がるのは速く、下がるのはゆっくり', () => {
    const up = easeGaitLevel(0, 1, 0.1)
    const down = easeGaitLevel(1, 0, 0.1)
    expect(up).toBeGreaterThan(0.7)
    expect(down).toBeGreaterThan(0.65)
    // 半秒止められても、走りの姿勢がまだ残っている
    let level = 1
    for (let i = 0; i < 30; i++) level = easeGaitLevel(level, 0, 1 / 60)
    expect(level).toBeGreaterThan(0.15)
    // 1.5 秒でほぼ抜ける
    for (let i = 0; i < 60; i++) level = easeGaitLevel(level, 0, 1 / 60)
    expect(level).toBeLessThan(0.02)
  })

  it('同じ値なら変わらず、dt が 0 でも壊れない', () => {
    expect(easeGaitLevel(0.5, 0.5, 0.1)).toBeCloseTo(0.5, 6)
    expect(easeGaitLevel(0.3, 1, 0)).toBeCloseTo(0.3, 6)
  })
})
