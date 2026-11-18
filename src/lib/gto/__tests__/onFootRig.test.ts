import { describe, expect, it } from 'vitest'
import { contactShade, elbowOffset, FOOT_TOE, footContacts, footTarget, legReach, REST_RIG, RIG_DIM, rigBoarding, rigGait, mixRig, solveLeg, type RigPose } from '../onFootRig'

const TAU = Math.PI * 2
const walk = (phase: number, over: Partial<Parameters<typeof rigGait>[0]> = {}) => rigGait({ phase, moving: 1, run: 0, turn: 0, accel: 0, stride: 0.6, ...over })
const run = (phase: number, over: Partial<Parameters<typeof rigGait>[0]> = {}) => walk(phase, { run: 1, stride: 2.2, ...over })

describe('onFootRig: 脚（足先を決めてから関節を解く）', () => {
  it('解いた関節から足先を辿ると、狙った位置に届く', () => {
    for (const [z, y, hip] of [
      [0.1, 0, 0.48],
      [-0.12, 0.05, 0.47],
      [0.2, 0.15, 0.4],
    ]) {
      const leg = solveLeg(z, y, hip)
      const at = legReach(leg, hip)
      expect(at.z).toBeCloseTo(z, 3)
      expect(at.y).toBeCloseTo(y, 3)
      // 膝は前へだけ曲がる
      expect(leg.bend).toBeGreaterThanOrEqual(0)
    }
  })

  it('届かない所を狙っても、脚は伸びきるだけで壊れない', () => {
    const leg = solveLeg(0.9, 0, 0.5)
    expect(Number.isFinite(leg.swing)).toBe(true)
    expect(leg.bend).toBeLessThan(0.2)
  })

  it('接地している足は、体が進んだぶんだけ後ろへ送られる（地面に対して止まっている）', () => {
    const stride = 0.9
    const duty = footTarget(0, 0, stride).duty
    const steps = 20
    for (let i = 0; i < steps - 1; i++) {
      const u0 = (duty * i) / steps
      const u1 = (duty * (i + 1)) / steps
      const a = footTarget(u0 * TAU, 0, stride)
      const b = footTarget(u1 * TAU, 0, stride)
      expect(a.y).toBe(0)
      // 位相が du 進むと体は stride×du 進む
      expect(a.z - b.z).toBeCloseTo(stride * (u1 - u0), 5)
    }
  })

  it('走りは両足が浮く瞬間があり、歩きは無い', () => {
    let walkAir = 0
    let runAir = 0
    for (let i = 0; i < 40; i++) {
      const ph = (i / 40) * TAU
      if (footTarget(ph, 0, 0.6).y > 0 && footTarget(ph + Math.PI, 0, 0.6).y > 0) walkAir++
      if (footTarget(ph, 1, 2.2).y > 0 && footTarget(ph + Math.PI, 1, 2.2).y > 0) runAir++
    }
    expect(walkAir).toBe(0)
    expect(runAir).toBeGreaterThan(4)
  })
})

describe('onFootRig: 歩きと走りの姿勢', () => {
  it('止まっていれば直立', () => {
    const p = rigGait({ phase: 1, moving: 0, run: 0, turn: 0, accel: 0, stride: 0.9 })
    expect(p.lean).toBe(0)
    expect(p.legL.swing).toBeCloseTo(p.legR.swing, 5)
  })

  it('腕は反対側の脚と一緒に前へ出る', () => {
    // 位相 0 は左足が前に着いた瞬間
    const p = walk(0)
    expect(p.legL.swing).toBeGreaterThan(p.legR.swing)
    expect(p.armR.swing).toBeGreaterThan(p.armL.swing)
    const q = walk(Math.PI)
    expect(q.armL.swing).toBeGreaterThan(q.armR.swing)
  })

  it('走りは歩きより、前傾が深く・肘が曲がり・腕の振りが大きく・足が高く上がる', () => {
    const span = (f: (ph: number) => number) => {
      const v = Array.from({ length: 16 }, (_, i) => f((i / 16) * TAU))
      return Math.max(...v) - Math.min(...v)
    }
    expect(run(0).lean).toBeGreaterThan(walk(0).lean + 0.15)
    expect(run(0).armR.bend).toBeGreaterThan(walk(0).armR.bend + 0.4)
    expect(run(0).armL.bend).toBeGreaterThan(walk(0).armL.bend + 0.4)
    expect(span((ph) => run(ph).armL.swing)).toBeGreaterThan(span((ph) => walk(ph).armL.swing) * 1.25)
    expect(span((ph) => run(ph).legL.bend)).toBeGreaterThan(span((ph) => walk(ph).legL.bend) * 1.3)
  })

  it('曲がる側へ体が傾き、頭もそちらを向く', () => {
    expect(run(1, { turn: 1 }).bank).toBeGreaterThan(0.15)
    expect(run(1, { turn: -1 }).bank).toBeLessThan(-0.15)
    expect(run(1, { turn: 1 }).headYaw).toBeLessThan(run(1, { turn: -1 }).headYaw)
    expect(Math.abs(run(1, { turn: 1 }).bank)).toBeGreaterThan(Math.abs(walk(1, { turn: 1 }).bank))
  })

  it('加速で前へ、急停止で後ろへ体が振れる', () => {
    expect(walk(1, { accel: 1 }).lean).toBeGreaterThan(walk(1).lean)
    expect(walk(1, { accel: -1 }).lean).toBeLessThan(walk(1).lean)
  })

  it('走りの腕: 後ろへ引いた腕は伸ばし気味に外・後ろへ、前へ振った腕は深く畳んで前腕を外へ開く（画面の上の形は onFootRigView.test.ts で確かめる）', () => {
    // 位相 0 は左足が前 = 右腕が前・左腕が後ろ
    const p = run(0)
    const back = elbowOffset(p.armL)
    const front = elbowOffset(p.armR)
    // 引いた肘は体の後ろ・外へ出る
    expect(back.out).toBeGreaterThan(0.07)
    expect(back.fwd).toBeLessThan(-0.07)
    // 前へ振った腕は肘が前へ出て、引いた腕ほど外へ張らない（左右が非対称）
    expect(front.fwd).toBeGreaterThan(0.08)
    expect(front.out).toBeLessThan(back.out - 0.02)
    // 引いた腕は伸ばし気味（45 度前後）、前の腕は 100 度以上畳み、前腕を外へ開く（こぶしが肩の外へ出る）
    expect(p.armL.bend).toBeLessThan(1)
    expect(p.armL.bend).toBeGreaterThan(0.5)
    expect(p.armR.bend).toBeGreaterThan(1.75)
    expect(p.armR.turn ?? 0).toBeLessThan(-0.6)
    // 前へ振った腕は、上腕を水平より上へは上げない
    expect(p.armR.swing).toBeLessThan(1.4)
    // 歩きは肘を張らない
    expect(elbowOffset(walk(0).armL).out).toBeLessThan(back.out - 0.02)
  })

  it('走りを真後ろから見ると、どの瞬間も片方の肘が体の輪郭の外へ張り出す（腕が体側に貼り付かない）。歩きは張らない', () => {
    let widest = 0
    for (let i = 0; i < 32; i++) {
      const p = run((i / 32) * TAU)
      const l = elbowOffset(p.armL).out
      const r = elbowOffset(p.armR).out
      expect(Math.max(l, r)).toBeGreaterThan(0.05)
      widest = Math.max(widest, l, r)
      expect(Math.max(elbowOffset(walk((i / 32) * TAU).armL).out, elbowOffset(walk((i / 32) * TAU).armR).out)).toBeLessThan(0.035)
    }
    expect(widest).toBeGreaterThan(0.085)
  })

  it('走りで振り出す脚は、後ろで畳んでから前へ運ぶ（膝を前へ高く上げた形のまま運ばない）', () => {
    let top = { y: 0, z: 0 }
    let high = 0
    for (let i = 0; i < 64; i++) {
      const p = run((i / 64) * TAU)
      // 腿は水平近くまでは上がらない
      expect(p.legL.swing).toBeLessThan(1.2)
      const at = legReach(p.legL, p.hip)
      if (at.y > top.y) top = at
      // 腿が前へ大きく上がっているコマ（膝が高い）は、1周の 1/4 より少ない
      if (p.legL.swing > 0.85) high++
    }
    // 足がいちばん高いのは、腰より後ろ（蹴り上げたかかと）
    expect(top.z).toBeLessThan(-0.03)
    expect(high).toBeLessThanOrEqual(16)
  })

  it('走りで接地している足は宙に浮かない: 着く瞬間は足裏が地面にあり、蹴り終わりはかかとが浮いてもつま先が地面に残る', () => {
    for (let i = 0; i < 64; i++) {
      const ph = (i / 64) * TAU
      if (footTarget(ph, 1, 2.2).air > 0) continue
      const p = run(ph)
      const at = legReach(p.legL, p.hip)
      // つま先の高さ（足先を下げたぶんだけ、くるぶしより低い）
      const toe = at.y - FOOT_TOE * Math.sin(p.legL.foot)
      expect(toe).toBeLessThan(0.015)
      expect(toe).toBeGreaterThan(-0.02)
    }
    expect(legReach(run(0).legL, run(0).hip).y).toBeLessThan(0.012)
    // 着くのは腰の少し前、蹴り終わるのは腰のずっと後ろ（地面を後ろへ蹴って進む）
    const duty = footTarget(0, 1, 2.2).duty
    expect(footTarget(0, 1, 2.2).z).toBeLessThan(0.14)
    expect(footTarget(duty * TAU - 0.01, 1, 2.2).z).toBeLessThan(-0.2)
  })

  it('走りの上下動は体の中で作る: 片足で踏んばる瞬間にいちばん低く、両足が浮く瞬間にいちばん高い', () => {
    let hi = { hip: 0, ph: 0 }
    let lo = { hip: 9, ph: 0 }
    for (let i = 0; i < 64; i++) {
      const ph = (i / 64) * TAU
      const hip = run(ph).hip
      if (hip > hi.hip) hi = { hip, ph }
      if (hip < lo.hip) lo = { hip, ph }
    }
    expect(footTarget(hi.ph, 1, 2.2).y > 0 && footTarget(hi.ph + Math.PI, 1, 2.2).y > 0).toBe(true)
    expect(footTarget(lo.ph, 1, 2.2).air === 0 || footTarget(lo.ph + Math.PI, 1, 2.2).air === 0).toBe(true)
    expect(hi.hip - lo.hip).toBeGreaterThan(0.04)
    // コマの間で腰が飛ばない
    for (let i = 0; i < 256; i++) expect(Math.abs(run(((i + 1) / 256) * TAU).hip - run((i / 256) * TAU).hip)).toBeLessThan(0.012)
  })

  it('足元の影のために、足裏の位置（前後・左右・高さ）を姿勢から辿れる', () => {
    // 位相 0 は左足が前に着いた瞬間
    const p = run(0)
    const f = footContacts(p, 0.05)
    expect(f.l.y).toBeLessThan(0.02)
    expect(f.l.z).toBeGreaterThan(0.05)
    expect(f.l.x).toBeGreaterThan(0)
    expect(f.r.x).toBeLessThan(0)
    // 右足は蹴ったあとで浮いている
    expect(run(0.6).legR.bend).toBeGreaterThan(0.5)
    expect(footContacts(run(0.6), 0.05).r.y).toBeGreaterThan(0.05)
    // 立っていれば両足とも真下で地面の上
    const rest = footContacts(REST_RIG, 0.05)
    expect(Math.abs(rest.l.z)).toBeLessThan(0.01)
    expect(rest.l.y).toBeCloseTo(0, 2)
  })

  it('足の真下の影は、足が地面にあるとき濃く小さく、上がるほど薄く広がり、高く上がれば消える', () => {
    const down = contactShade(0)
    const mid = contactShade(0.05)
    expect(down.opacity).toBe(1)
    expect(mid.opacity).toBeLessThan(down.opacity)
    expect(mid.opacity).toBeGreaterThan(0)
    expect(mid.scale).toBeGreaterThan(down.scale)
    expect(contactShade(0.3).opacity).toBe(0)
    expect(contactShade(-0.01).opacity).toBe(1)
  })

  it('走りは左右の腕が同じ形になる瞬間がほとんど無い（腕が入れ替わるのは一瞬）', () => {
    let same = 0
    for (let i = 0; i < 64; i++) {
      const p = run((i / 64) * TAU + 0.01)
      if (Math.abs(p.armL.swing - p.armR.swing) < 0.6) same++
    }
    expect(same).toBeLessThanOrEqual(6)
    // 歩きは振り子のまま（急に入れ替えない）
    const w0 = walk(Math.PI / 2 - 0.2)
    expect(Math.abs(w0.armL.swing - w0.armR.swing)).toBeLessThan(0.3)
  })

  it('走りは両脚が真下に揃って伸びる瞬間が無い（どの瞬間も片方の膝が畳まれている）', () => {
    // 蹴った足を畳みはじめる一瞬（1周の 1/32 ほど）だけは浅いが、それでも真っすぐにはならない
    let shallow = 0
    for (let i = 0; i < 64; i++) {
      const p = run((i / 64) * TAU)
      const fold = Math.max(p.legL.bend, p.legR.bend)
      expect(fold).toBeGreaterThan(0.5)
      if (fold < 0.9) shallow++
      // 畳んだ側の足裏は地面から離れている
      const high = Math.max(legReach(p.legL, p.hip).y, legReach(p.legR, p.hip).y)
      expect(high).toBeGreaterThan(0.06)
    }
    expect(shallow).toBeLessThanOrEqual(6)
  })

  it('走りは腕の振りに合わせて肩の線が傾く（引いた腕の側の肩が上がる）', () => {
    // 位相 0: 左腕が後ろ → 左肩が上がる = 右へ傾く（bank > 0）
    expect(run(0).bank).toBeGreaterThan(0.08)
    expect(run(Math.PI).bank).toBeLessThan(-0.08)
  })

  it('走りは上体を深く前へ倒し、肩を左右交互にひねり、足の運びで肩の線が傾く', () => {
    // 前傾は 15〜25 度。深すぎると、背後のカメラからは胴が縮んでしゃがんだように見える
    expect(run(0).lean).toBeGreaterThan(0.26)
    expect(run(0).lean).toBeLessThan(0.44)
    // 肩は大きくひねる（背後から、前へ振った側の肩が奥へ引っ込むのが見える）。背中の幅が残る範囲で（onFootRigView.test.ts）
    expect(run(0).twist).toBeGreaterThan(0.38)
    expect(run(Math.PI).twist).toBeLessThan(-0.38)
    expect(Math.abs(run(Math.PI / 2).bank)).toBeGreaterThan(0.1)
    expect(run(Math.PI / 2).bank).toBeCloseTo(-run((3 * Math.PI) / 2).bank, 5)
    // 頭は前へ突き出して下がり、背中が丸まって肩のあいだへ沈む。腰の線は肩の線と逆へ傾く。歩きは丸めない
    expect(run(0).lean + run(0).headPitch).toBeGreaterThan(0.6)
    // 丸めすぎると肩がいかって首が無くなり、胴が箱に見える（R16: 1 → 0.5）
    expect(run(0).hunch).toBeGreaterThan(0.35)
    expect(run(0).hunch).toBeLessThan(0.7)
    expect(walk(0).hunch).toBe(0)
    expect(walk(0).headPitch).toBeLessThan(0)
    expect((run(0).hipTilt ?? 0) * run(0).bank).toBeLessThan(0)
    expect(Math.abs(run(Math.PI / 2).hipTilt ?? 0)).toBeGreaterThan(0.1)
  })

  it('走りはしゃがまない: 腰は高いまま、接地のたびに上下し、支える脚は伸び、蹴った足のかかとは腰の近くまで上がる', () => {
    const hips = Array.from({ length: 32 }, (_, i) => run((i / 32) * TAU).hip)
    expect(Math.min(...hips)).toBeGreaterThan(RIG_DIM.hip - 0.065)
    expect(Math.max(...hips) - Math.min(...hips)).toBeGreaterThan(0.02)
    // 接地している脚の膝は深く曲がらない
    for (let i = 0; i < 32; i++) {
      const ph = (i / 32) * TAU
      if (footTarget(ph, 1, 2.2).air === 0) expect(run(ph).legL.bend).toBeLessThan(0.85)
    }
    // 蹴り上げ: 膝がいちばん曲がる瞬間、足裏は腰の高さの 6 割より上（膝より上）
    let best = run(0)
    for (let i = 0; i < 64; i++) {
      const p = run((i / 64) * TAU)
      if (p.legL.bend > best.legL.bend) best = p
    }
    expect(best.legL.bend).toBeGreaterThan(2.1)
    expect(legReach(best.legL, best.hip).y).toBeGreaterThan(RIG_DIM.hip * 0.5)
  })

  it('歩きは腕を伸ばし気味に小さく振り、足幅は走りのほうが狭い（一直線の上を走る）', () => {
    for (let i = 0; i < 8; i++) expect(walk((i / 8) * TAU).armL.bend).toBeLessThan(0.6)
    expect(run(1).legL.splay).toBeLessThan(walk(1).legL.splay)
  })

  it('速さに応じて姿勢が段々に変わる（歩き < 小走り < 全力）', () => {
    const at = (r: number) => walk(0, { run: r, stride: 0.6 + 1.6 * r })
    for (const [a, b] of [
      [0, 0.5],
      [0.5, 1],
    ]) {
      expect(at(b).lean).toBeGreaterThan(at(a).lean + 0.12)
      expect(at(b).twist).toBeGreaterThan(at(a).twist + 0.05)
      expect(elbowOffset(at(b).armL).out).toBeGreaterThan(elbowOffset(at(a).armL).out + 0.01)
    }
  })

  it('1周を8コマに切ると、どのコマも隣と姿勢が違う', () => {
    const key = (p: RigPose) => [p.armL.swing, p.armR.swing, p.legL.swing, p.legR.swing, p.legL.bend, p.legR.bend]
    for (const f of [walk, run]) {
      for (let i = 0; i < 8; i++) {
        const a = key(f((i / 8) * TAU))
        const b = key(f(((i + 1) / 8) * TAU))
        const diff = Math.max(...a.map((v, k) => Math.abs(v - b[k])))
        expect(diff).toBeGreaterThan(0.12)
      }
    }
  })
})

describe('onFootRig: 乗り降りの姿勢', () => {
  it('ドアを開けるときは片腕を前へ伸ばす', () => {
    // 手が届いた瞬間（DOOR_BEATS.openFrom）。前へ上げつつ、肘は輪郭の外へ張る（斜め後ろのカメラから見える）
    const p = rigBoarding('open', 0.35, 1)
    expect(Math.max(p.armL.swing, p.armR.swing)).toBeGreaterThan(0.6)
    expect(p.armL.splay).toBeGreaterThan(0.5)
  })

  it('座るときは片脚を上げて踏み入れ、腰を座面の高さへ落とす。座りきれば上体は起きている。降りるときはその逆回し', () => {
    const mid = rigBoarding('sit', 0.4, 1)
    const end = rigBoarding('sit', 1, 1, 0.3)
    expect(Math.max(mid.legL.bend, mid.legR.bend)).toBeGreaterThan(0.6)
    expect(end.hip).toBeCloseTo(0.3, 5)
    // 座りきったら前へ倒れていない（開口越しに、起きた上半身が見える）
    expect(end.lean).toBeLessThan(0.05)
    const out = rigBoarding('out', 0, 1, 0.3)
    expect(out.hip).toBeCloseTo(end.hip, 5)
    expect(rigBoarding('out', 1, 1).hip).toBeGreaterThan(RIG_DIM.hip - 0.02)
  })

  it('座る途中: 車の側の脚を車内へ開いて差し入れ、外の脚は地面に残る。座りきると両腿が前へ上がる', () => {
    // 右のドア（side=1）では、車の前を向いた体の左が車の側
    // 拍の半ば（腰が座席へ入っていくところ）
    const mid = rigBoarding('sit', 0.43, 1)
    expect(mid.legL.splay).toBeGreaterThan(mid.legR.splay - 0.2)
    expect(mid.legL.swing).toBeGreaterThan(mid.legR.swing + 0.3)
    expect(legReach(mid.legR, mid.hip).y).toBeLessThan(0.02)
    expect(mid.lean).toBeGreaterThan(0.25)
    const end = rigBoarding('sit', 1, 1)
    expect(end.hip).toBeLessThan(RIG_DIM.hip - 0.15)
    expect(end.legL.swing).toBeGreaterThan(1)
    expect(end.legR.swing).toBeGreaterThan(1)
    // 左のドアでは逆の脚
    const other = rigBoarding('sit', 0.43, -1)
    expect(other.legR.swing).toBeGreaterThan(other.legL.swing + 0.3)
  })

  it('腰は地面へしゃがまない: 車体の外にいるあいだ（slide の前）は、座面までの半分より下がらず、頭は座ったときの高さから身長の 1 割より下がらない（屋根をくぐるぶんだけ下げる）', () => {
    const seatHip = 0.3
    const headUp = (p: RigPose) => p.hip + (RIG_DIM.torso + RIG_DIM.neck + RIG_DIM.head / 2) * Math.cos(p.lean)
    const seated = headUp(rigBoarding('sit', 1, 1, seatHip))
    for (let i = 0; i <= 20; i++) {
      const p = rigBoarding('sit', i / 20, 1, seatHip)
      expect(p.hip).toBeGreaterThan(seatHip - 1e-6)
      expect(headUp(p)).toBeGreaterThan(seated - 0.1)
    }
    expect(rigBoarding('sit', 0.34, 1, seatHip).hip).toBeGreaterThan((RIG_DIM.hip + seatHip) / 2 - 0.01)
  })

  it('滑り込む途中は、上体を前へ深く倒し・車の側へ傾け・頭を下げる（脚が見えない画でも、屈んで入る姿が上半身だけで読める）', () => {
    const stand = rigBoarding('sit', 0, 1)
    // 拍の半ば（腰が座席へ入っていくところ）
    const mid = rigBoarding('sit', 0.43, 1)
    const end = rigBoarding('sit', 1, 1)
    expect(mid.lean).toBeGreaterThan(0.55)
    // 右のドアでは車は体の左。左へ傾く（bank は右が正）
    expect(mid.bank).toBeLessThan(-0.4)
    expect(mid.headPitch).toBeGreaterThan(0.3)
    expect(Math.abs(stand.lean)).toBeLessThan(0.05)
    expect(Math.abs(end.bank)).toBeLessThan(0.05)
    // 左のドアでは逆へ傾く
    expect(rigBoarding('sit', 0.43, -1).bank).toBeGreaterThan(0.4)
  })

  it('ドアを閉めるとき・開けるときは、座ったまま外の手をドアへ伸ばす', () => {
    // 手を伸ばしきった瞬間（DOOR_BEATS.shutFrom）と、引ききったとき
    const reach = rigBoarding('shut', 0.2, 1)
    const pulled = rigBoarding('shut', 1, 1)
    // 右のドアでは外の手は右手
    expect(reach.armR.splay).toBeGreaterThan(0.6)
    expect(pulled.armR.splay).toBeLessThan(0.1)
    expect(reach.hip).toBeCloseTo(pulled.hip, 5)
    expect(rigBoarding('unlatch', 1, 1).armR.splay).toBeGreaterThan(0.6)
    expect(rigBoarding('shut', 0.2, -1).armL.splay).toBeGreaterThan(0.6)
  })

  it('乗る途中を 1/8 秒刻みに切ると、どのコマも隣と姿勢が違う（腰・前傾・脚の上げ・脚の開き・腕のどれかが動いている）', () => {
    for (const phase of ['sit', 'out'] as const) {
      for (let i = 0; i < 7; i++) {
        const a = rigBoarding(phase, i / 8, 1)
        const b = rigBoarding(phase, (i + 1) / 8, 1)
        const moved = Math.abs(a.hip - b.hip) * 5 + Math.abs(a.lean - b.lean) + Math.abs(a.legL.swing - b.legL.swing) + Math.abs(a.legR.swing - b.legR.swing) + Math.abs(a.armL.swing - b.armL.swing) + Math.abs(a.armR.swing - b.armR.swing) + Math.abs(a.legL.splay - b.legL.splay) + Math.abs(a.legR.splay - b.legR.splay)
        expect(moved).toBeGreaterThan(0.04)
      }
    }
  })

  it('降りてドアを閉めるときは、ドアの縁に掛けていた外の腕を前（ドア）へ伸ばして押す', () => {
    const p = rigBoarding('leave', 0.5, 1)
    expect(p.armR.swing).toBeGreaterThan(0.6)
    expect(p.armR.swing).toBeGreaterThan(p.armL.swing + 0.3)
  })

  it('左右のドアで姿勢が鏡写しになる', () => {
    const r = rigBoarding('sit', 0.6, 1)
    const l = rigBoarding('sit', 0.6, -1)
    expect(r.armL.swing).toBeCloseTo(l.armR.swing, 5)
    expect(r.twist).toBeCloseTo(-l.twist, 5)
  })

  it('奪うときは両腕でつかんで後ろへ反る', () => {
    const p = rigBoarding('pull', 0.5, 1)
    expect(p.armL.swing).toBeGreaterThan(0.6)
    expect(p.armR.swing).toBeGreaterThan(0.6)
    expect(p.lean).toBeLessThan(0)
  })

  it('混ぜる: 0 は a、1 は b、途中はあいだ', () => {
    const b = rigBoarding('sit', 1, 1)
    expect(mixRig(REST_RIG, b, 0)).toBe(REST_RIG)
    expect(mixRig(REST_RIG, b, 1)).toBe(b)
    expect(mixRig(REST_RIG, b, 0.5).lean).toBeCloseTo(b.lean / 2, 5)
  })
})
