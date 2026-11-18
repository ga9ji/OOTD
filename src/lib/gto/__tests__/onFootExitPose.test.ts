// [onfoot] 第17ラウンド: 降りる → ドアを押して閉める → 腕を下ろす、のあいだ、腕が真横へ突き出た T 字や棒立ちの飛びが 1 コマも無い。
import { describe, expect, it } from 'vitest'
import { armJoints } from '../onFootRigView'
import { EXIT_HOLD, REST_RIG, RIG_DIM, rigBoarding, type RigPose } from '../onFootRig'

const SHOULDER_HALF = 0.13
const STEP = 0.02

/** 降りはじめ（座っている）から、押し終えて腕を下ろすまでの姿勢を細かく並べる */
const exitPoses = (side: 1 | -1): RigPose[] => {
  const list: RigPose[] = []
  for (let k = 0; k <= 1.0001; k += STEP) list.push(rigBoarding('out', k, side))
  for (let k = 0; k <= 1.0001; k += STEP) list.push(rigBoarding('leave', k, side))
  return list
}

describe('onFootRig: 降りる動きに T 字の硬直が無い', () => {
  it('立っているあいだ、どちらの手も肩の真横へ伸びきらない（肩から横へ身長の 2 割以上離れない）', () => {
    for (const side of [1, -1] as const) {
      for (const pose of exitPoses(side)) {
        // 座席の中（腰が低い）では、手はハンドルやドアにある。見るのは体が立ち上がってから
        if (pose.hip < RIG_DIM.hip - 0.08) continue
        for (const s of [1, -1] as const) {
          const j = armJoints(pose, s, SHOULDER_HALF)
          const reach = Math.abs(j.hand.x - j.shoulder.x)
          expect(reach).toBeLessThan(0.2)
          // 手は肩より下にある
          expect(j.hand.y).toBeLessThan(j.shoulder.y - 0.04)
        }
      }
    }
  })

  it('出きった瞬間（out の終わり）と、押しはじめ（leave の始まり）で腕の形がつながる', () => {
    const a = rigBoarding('out', 1, 1)
    const b = rigBoarding('leave', 0, 1)
    for (const key of ['swing', 'splay', 'bend'] as const) {
      expect(a.armR[key]).toBeCloseTo(b.armR[key], 2)
      expect(a.armR[key]).toBeCloseTo(EXIT_HOLD[key], 2)
    }
    expect(a.hip).toBeCloseTo(b.hip, 2)
  })

  it('並べた姿勢の隣どうしで、関節の角度が飛ばない', () => {
    for (const side of [1, -1] as const) {
      const list = exitPoses(side)
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1]
        const q = list[i]
        for (const arm of ['armL', 'armR'] as const) {
          expect(Math.abs(p[arm].swing - q[arm].swing)).toBeLessThan(0.16)
          expect(Math.abs(p[arm].splay - q[arm].splay)).toBeLessThan(0.16)
          expect(Math.abs(p[arm].bend - q[arm].bend)).toBeLessThan(0.16)
        }
        expect(Math.abs(p.lean - q.lean)).toBeLessThan(0.12)
        expect(Math.abs(p.hip - q.hip)).toBeLessThan(0.03)
      }
    }
  })

  it('押し終えたら、歩き出す前の楽な立ち姿（腕は体の横へ下りている）', () => {
    const done = rigBoarding('leave', 1, 1)
    for (const arm of [done.armL, done.armR]) {
      expect(Math.abs(arm.swing - REST_RIG.armL.swing)).toBeLessThan(0.05)
      expect(arm.splay).toBeLessThan(0.2)
    }
    expect(done.lean).toBeCloseTo(0, 2)
    expect(done.twist).toBeCloseTo(0, 2)
  })
})
