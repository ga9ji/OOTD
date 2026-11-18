import { describe, expect, it } from 'vitest'
import { BOARD_TUNING } from '../onFoot'
import { boardingBodyPose, boardingProgress, gaitPose, mixPose, REST_POSE, type BodyPose } from '../onFootPose'

const TAU = Math.PI * 2
const keys = Object.keys(REST_POSE) as (keyof BodyPose)[]
const span = (f: (phase: number) => number) => {
  const vs = Array.from({ length: 32 }, (_, i) => f((i / 32) * TAU))
  return Math.max(...vs) - Math.min(...vs)
}

describe('gto onFootPose: 歩きと走りの姿勢', () => {
  it('止まっていれば直立のまま', () => {
    const p = gaitPose({ phase: 1.2, moving: 0, run: 0, side: 1 })
    for (const k of keys) expect(Math.abs(p[k])).toBeLessThan(1e-6)
  })

  it('横から見ると、脚は前後に開いて閉じ（交差しない）、腕は左右で逆に振れる', () => {
    const at = (phase: number) => gaitPose({ phase, moving: 1, run: 0, side: 1 })
    expect(span((ph) => at(ph).hipR)).toBeGreaterThan(0.35)
    for (let i = 0; i < 16; i++) {
      const q = at((i / 16) * TAU)
      // 右へ進むとき: 板の右半分が前脚（先が右へ）、左半分が後ろ脚（先が左へ）
      expect(q.hipR).toBeGreaterThanOrEqual(0)
      expect(q.hipL).toBeLessThanOrEqual(0)
      // 膝は後ろへ畳む（すねの先が左へ）。畳むのは片脚ずつ
      expect(q.kneeL).toBeLessThanOrEqual(0)
      expect(q.kneeR).toBeLessThanOrEqual(0)
      expect(Math.max(q.kneeL, q.kneeR)).toBeGreaterThan(-0.01)
    }
    const p = at(Math.PI / 2)
    expect(p.hipR).toBeGreaterThan(0.3)
    expect(p.hipL).toBeLessThan(-0.3)
    expect(p.armL).toBeLessThan(-0.2)
    expect(p.armR).toBeGreaterThan(0.2)
  })

  it('走りは歩きより脚も腕も大きく動き、膝が深く曲がり、上体が沈む', () => {
    const walk = (ph: number) => gaitPose({ phase: ph, moving: 1, run: 0, side: 1 })
    const run = (ph: number) => gaitPose({ phase: ph, moving: 1, run: 1, side: 1 })
    expect(span((ph) => run(ph).hipR)).toBeGreaterThan(span((ph) => walk(ph).hipR) * 1.4)
    expect(span((ph) => run(ph).kneeL)).toBeGreaterThan(span((ph) => walk(ph).kneeL) * 1.4)
    expect(span((ph) => run(ph).armL)).toBeGreaterThan(span((ph) => walk(ph).armL) * 1.4)
    expect(span((ph) => run(ph).drop)).toBeGreaterThan(span((ph) => walk(ph).drop))
  })

  it('後ろから見ると、脚は片方ずつ持ち上がり（同時には上がらない）、走りは肘を張って前へかがむ', () => {
    for (let i = 0; i < 16; i++) {
      const p = gaitPose({ phase: (i / 16) * TAU, moving: 1, run: 1, side: 0 })
      expect(Math.min(p.liftL, p.liftR)).toBeLessThan(0.02)
      expect(p.armL).toBeLessThan(-0.1)
      expect(p.armR).toBeGreaterThan(0.1)
      // 前腕は内側へ畳む
      expect(p.foreL).toBeGreaterThan(0.2)
      expect(p.foreR).toBeLessThan(-0.2)
      expect(p.hunch).toBeGreaterThan(0.05)
    }
    expect(span((ph) => gaitPose({ phase: ph, moving: 1, run: 1, side: 0 }).liftL)).toBeGreaterThan(0.25)
    expect(span((ph) => gaitPose({ phase: ph, moving: 1, run: 0, side: 0 }).liftL)).toBeGreaterThan(0.1)
  })

  it('向きが逆なら、脚の振りも逆になる', () => {
    const a = gaitPose({ phase: 1, moving: 1, run: 0.5, side: 1 })
    const b = gaitPose({ phase: 1, moving: 1, run: 0.5, side: -1 })
    expect(b.kneeL + b.kneeR).toBeCloseTo(-(a.kneeL + a.kneeR), 6)
    expect(Math.abs(a.kneeL + a.kneeR)).toBeGreaterThan(0.1)
    expect(b.armR).toBeCloseTo(-a.armR, 6)
  })
})

describe('gto onFootPose: 乗り降りの姿勢', () => {
  it('ドアを開けるときは、車の側の腕がドアへ伸びる', () => {
    const right = boardingBodyPose('open', 0.6, 1)
    expect(right.armR).toBeGreaterThan(0.7)
    expect(Math.abs(right.armL)).toBeLessThan(0.1)
    const left = boardingBodyPose('open', 0.6, -1)
    expect(left.armL).toBeLessThan(-0.7)
  })

  it('座るときは、まず車の側の脚を上げ、それから屈んで沈む', () => {
    const early = boardingBodyPose('sit', 0.35, 1)
    const late = boardingBodyPose('sit', 1, 1)
    expect(early.liftR).toBeGreaterThan(0.2)
    expect(early.drop).toBeLessThanOrEqual(late.drop)
    expect(late.drop).toBeGreaterThan(0.15)
    expect(late.hunch).toBeGreaterThan(0.25)
    expect(late.bend).toBeGreaterThan(0.3)
  })

  it('降りるときは屈んだ姿から立ち上がる', () => {
    const first = boardingBodyPose('out', 0, 1)
    const last = boardingBodyPose('out', 1, 1)
    expect(first.drop).toBeGreaterThan(0.15)
    expect(last.drop).toBeLessThan(0.02)
    expect(last.hunch).toBeLessThan(0.05)
  })

  it('奪うときは両腕で引っぱり、体を車と逆へ反らす', () => {
    const p = boardingBodyPose('pull', 0.5, 1)
    expect(p.armR).toBeGreaterThan(0.5)
    expect(p.armL).toBeGreaterThan(0.3)
    expect(p.bend).toBeLessThan(-0.15)
  })

  it('車が正面（奥）にあるときも、腕は動く（肘を張って前へ出す）', () => {
    const p = boardingBodyPose('open', 0.6, 0)
    expect(Math.abs(p.armR) + Math.abs(p.foreR)).toBeGreaterThan(0.8)
  })

  it('段階の進み具合は 0..1', () => {
    expect(boardingProgress({ phase: 'sit', vehicleId: 1, side: 1, t: BOARD_TUNING.sit / 2, jack: false })).toBeCloseTo(0.5, 6)
    expect(boardingProgress({ phase: 'open', vehicleId: 1, side: 1, t: 99, jack: false })).toBe(1)
  })

  it('mixPose は2つの姿勢のあいだを取る', () => {
    const a = boardingBodyPose('sit', 1, 1)
    const m = mixPose(REST_POSE, a, 0.5)
    expect(m.drop).toBeCloseTo(a.drop / 2, 6)
    expect(mixPose(REST_POSE, a, 0)).toEqual(REST_POSE)
  })
})
