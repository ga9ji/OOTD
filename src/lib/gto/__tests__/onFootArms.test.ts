import { describe, expect, it } from 'vitest'
import { armGait, mixLimb, pickView, planarArm, projectArm, type ArmView } from '../onFootArms'
import { buildBackSprite } from '../spriteBack'

const TAU = Math.PI * 2
const BEHIND: ArmView = { rightX: 1, rightDepth: 0, fwdX: 0, fwdDepth: 1 }
const SIDE: ArmView = { rightX: 0, rightDepth: 1, fwdX: 1, fwdDepth: 0 }
const FRAME = { shoulderHalf: 0.11, armLen: 0.4 }

describe('gto onFootArms: 正面と後ろ姿の切り替え', () => {
  it('遠ざかるなら後ろ姿、こちらへ来るなら正面', () => {
    expect(pickView('front', 0.9)).toBe('back')
    expect(pickView('back', -0.9)).toBe('front')
  })
  it('真横の近くでは、いまの絵のまま（ちらつかない）', () => {
    expect(pickView('back', -0.1)).toBe('back')
    expect(pickView('front', 0.1)).toBe('front')
    // 乗り降りの動作中は、体が横を向いても後ろ姿のまま（1コマだけ正面の絵に替わらない）
    expect(pickView('back', -0.5, true)).toBe('back')
    expect(pickView('front', -0.5, true)).toBe('back')
  })
})

describe('gto onFootArms: 腕の振り', () => {
  it('止まっていれば腕は下がったまま左右対称', () => {
    const a = armGait(1.3, 0, 0)
    expect(a.l.swing).toBeCloseTo(0)
    expect(a.l.flex).toBe(a.r.flex)
    expect(a.l.flare).toBe(a.r.flare)
  })
  it('左右の腕は逆に振れ、走るほど大きく振って肘を畳む', () => {
    const walk = armGait(TAU / 4, 1, 0)
    const run = armGait(TAU / 4, 1, 1)
    expect(walk.l.swing).toBeCloseTo(-walk.r.swing)
    expect(walk.r.swing).toBeGreaterThan(0.3)
    expect(run.r.swing).toBeGreaterThan(walk.r.swing * 1.5)
    expect(run.r.flex).toBeGreaterThan(1.2)
    expect(run.l.flex).toBeGreaterThan(1.2)
  })
  it('後ろから見ると、振った腕は短く見え、手の高さが1歩ごとに上下する', () => {
    const ys = Array.from({ length: 16 }, (_, i) => projectArm(1, armGait((i / 16) * TAU, 1, 0).r, FRAME, BEHIND).wrist.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.04)
    const rest = projectArm(1, armGait(0, 0, 0).r, FRAME, BEHIND)
    expect(rest.wrist.y).toBeLessThan(-0.38)
    expect(rest.wrist.x).toBeGreaterThan(0.1)
  })
  it('走りで前へ振った腕は、前腕が体の向こう（奥）へ上がり、後ろへ引いた肘は手前に出る', () => {
    const fwd = projectArm(1, armGait(TAU / 4, 1, 1).r, FRAME, BEHIND)
    expect(fwd.wrist.depth).toBeGreaterThan(0.1)
    expect(fwd.wrist.y).toBeGreaterThan(fwd.elbow.y)
    const back = projectArm(1, armGait((TAU * 3) / 4, 1, 1).r, FRAME, BEHIND)
    expect(back.elbow.depth).toBeLessThan(-0.1)
    expect(back.wrist.y).toBeLessThan(back.elbow.y)
  })
  it('横から見ると、腕は進む向きへ前後に振れる', () => {
    const fwd = projectArm(1, armGait(TAU / 4, 1, 0).r, FRAME, SIDE)
    const back = projectArm(1, armGait((TAU * 3) / 4, 1, 0).r, FRAME, SIDE)
    expect(fwd.wrist.x).toBeGreaterThan(0.1)
    expect(back.wrist.x).toBeLessThan(-0.05)
  })
  it('面の中で伸ばした腕（ドアへ手を伸ばす）は、角度のぶん横へ出る', () => {
    const p = planarArm(1, 1.0, 0, FRAME, BEHIND)
    expect(p.wrist.x).toBeGreaterThan(0.11 + 0.3)
    const half = mixLimb(projectArm(1, armGait(0, 0, 0).r, FRAME, BEHIND), p, 0.5)
    expect(half.wrist.x).toBeGreaterThan(0.2)
    expect(half.wrist.x).toBeLessThan(p.wrist.x)
  })
})

/** 試験用の人型: 髪は黒、顔は肌色、上着は灰（前だけ白く開く）、ズボンは青。右手側（絵の左）に赤いかばん */
function figure() {
  const w = 60
  const h = 120
  const px = new Uint8ClampedArray(w * h * 4)
  const set = (x: number, y: number, c: number[]) => {
    const i = (y * w + x) * 4
    px[i] = c[0]
    px[i + 1] = c[1]
    px[i + 2] = c[2]
    px[i + 3] = 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 30
      if (y < 16) {
        if (Math.abs(dx) <= 6) set(x, y, y < 5 ? [20, 20, 20] : [220, 180, 150])
      } else if (y < 20) {
        if (Math.abs(dx) <= 3) set(x, y, [220, 180, 150])
      } else if (y < 62) {
        if (Math.abs(dx) <= 13) set(x, y, Math.abs(dx) <= 3 ? [250, 250, 250] : [120, 120, 120])
      } else if (Math.abs(dx) <= 11 && Math.abs(dx) >= 1) set(x, y, [40, 60, 160])
      if (y >= 50 && y < 70 && x >= 4 && x < 12) set(x, y, [200, 30, 30])
    }
  }
  return { px, w, h }
}

describe('gto spriteBack: 正面の写真から後ろ姿を作る', () => {
  const { px, w, h } = figure()
  const out = buildBackSprite(px, w, h)
  const at = (x: number, y: number) => Array.from(out.back.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

  it('顔は髪の色で塗りつぶされる', () => {
    const face = at(29, 10)
    expect(face[0]).toBeLessThan(60)
    expect(face[3]).toBe(255)
  })
  it('胴の前の開きは消えて、上着の色になる', () => {
    const chest = at(29, 40)
    expect(Math.abs(chest[0] - 120)).toBeLessThan(30)
    expect(chest[0]).toBeLessThan(200)
  })
  it('脚と、体の外の持ち物は写真のまま（左右は裏返る）', () => {
    expect(at(29 - 5, 100).slice(0, 3)).toEqual([40, 60, 160])
    // かばんは絵の左（x=4..11）から右（x=48..55）へ移る
    expect(at(52, 66).slice(0, 3)).toEqual([200, 30, 30])
    expect(at(8, 66)[3]).toBe(0)
  })
  it('抜けている所は抜けたまま', () => {
    expect(at(2, 30)[3]).toBe(0)
  })
  it('腕の絵は上が袖の色、先が肌の色で、腕を付ける位置が肩に来る', () => {
    const a = out.arm
    const pxAt = (u: number, v: number) => Array.from(a.data.slice((v * a.w + u) * 4, (v * a.w + u) * 4 + 4))
    const sleeve = pxAt(a.w / 2, 10)
    expect(Math.abs(sleeve[0] - 120)).toBeLessThan(25)
    const hand = pxAt(a.w / 2, a.h - 4)
    expect(hand[0]).toBeGreaterThan(180)
    expect(pxAt(0, a.h - 1)[3]).toBe(0)
    expect(out.rig.shoulderY).toBeGreaterThan(0.75)
    expect(out.rig.shoulderY).toBeLessThan(0.85)
    expect(Math.abs(out.rig.centerX)).toBeLessThan(0.05)
    expect(out.rig.shoulderHalf).toBeGreaterThan(0.08)
    expect(out.rig.armLen).toBeGreaterThan(0.33)
  })
})

describe('gto spriteBack: 写真の腕を落として、体の中心を見つける', () => {
  it('体の脇に下がった腕は切り落とされ、胴は肩幅の柱になる', () => {
    const w = 80
    const h = 120
    const px = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number, c: number[]) => px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
    // 人は絵の左寄り（中心 x=24）。腕は胴から1画素あけて外側に下がる
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - 24
        if (y < 16 && Math.abs(dx) <= 6) set(x, y, [30, 30, 30])
        else if (y >= 16 && y < 20 && Math.abs(dx) <= 3) set(x, y, [220, 180, 150])
        else if (y >= 20 && y < 62 && Math.abs(dx) <= 16) set(x, y, Math.abs(dx) >= 12 ? [220, 180, 150] : [90, 90, 200])
        else if (y >= 62 && Math.abs(dx) <= 10 && Math.abs(dx) >= 1) set(x, y, [40, 40, 40])
      }
    }
    const out = buildBackSprite(px, w, h)
    const alpha = (x: number, y: number) => out.back[(y * w + x) * 4 + 3]
    // 裏返すと中心は x=55。腕のあった所（中心から 15）は抜け、胴の中（中心から 6）は残る
    expect(alpha(55 + 15, 45)).toBe(0)
    expect(alpha(55 - 15, 45)).toBe(0)
    expect(alpha(55 + 6, 45)).toBe(255)
    // 体の中心は板の中心より右（後ろ姿の絵で）
    expect(out.rig.legX).toBeGreaterThan(0.12)
    expect(out.rig.centerX).toBeGreaterThan(0.12)
    // 半袖: 腕の絵の下のほうは肌の色
    const a = out.arm
    expect(a.data[(Math.round(a.h * 0.7) * a.w + a.w / 2) * 4]).toBeGreaterThan(150)
  })
})
