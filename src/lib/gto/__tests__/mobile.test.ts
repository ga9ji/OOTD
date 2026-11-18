import { describe, expect, it } from 'vitest'
import {
  buildInput,
  dragStick,
  emptyTouch,
  stickVector,
  TOUCH_TUNING,
  touchAxes,
  steerSlide,
  touchButtons,
  touchLayout,
  visibleTouchButtons,
  type TouchButtonId,
} from '../input'
import { QUALITY } from '../quality'

const SCREENS: [string, number, number][] = [
  ['縦 390x844', 390, 844],
  ['横 844x390', 844, 390],
  ['小さい縦 320x568', 320, 568],
  ['小さい横 568x320', 568, 320],
  ['タブレット縦 820x1180', 820, 1180],
]

describe('gto mobile: スティック', () => {
  it('遊びの内側は 0、端で 1、半径より外は 1 に丸める', () => {
    const r = TOUCH_TUNING.stickRadius
    expect(stickVector(2, -2, r)).toEqual({ x: 0, y: 0, mag: 0 })
    const edge = stickVector(r, 0, r)
    expect(edge.x).toBeCloseTo(1, 5)
    expect(edge.mag).toBeCloseTo(1, 5)
    const far = stickVector(0, -r * 3, r)
    expect(far.y).toBeCloseTo(-1, 5)
    expect(far.mag).toBeCloseTo(1, 5)
  })

  it('遊びのすぐ外から滑らかに立ち上がる（段差がない）', () => {
    const r = TOUCH_TUNING.stickRadius
    const just = stickVector(r * (TOUCH_TUNING.stickDead + 0.01), 0, r)
    expect(just.mag).toBeGreaterThan(0)
    expect(just.mag).toBeLessThan(0.05)
    const half = stickVector(r * 0.57, 0, r)
    expect(half.mag).toBeGreaterThan(0.4)
    expect(half.mag).toBeLessThan(0.6)
  })

  it('指が半径より外へ出たら、台が指を追う（親指を戻す距離が伸びない）', () => {
    const r = 50
    const inside = dragStick({ x: 100, y: 100 }, { x: 130, y: 100 }, r)
    expect(inside.origin).toEqual({ x: 100, y: 100 })
    const outside = dragStick({ x: 100, y: 100 }, { x: 200, y: 100 }, r)
    expect(outside.origin.x).toBeCloseTo(150, 5)
    expect(outside.origin.y).toBeCloseTo(100, 5)
    expect(outside.vector.x).toBeCloseTo(1, 5)
    // 逆へ戻すと、すぐ反対に倒せる
    const back = dragStick(outside.origin, { x: 100, y: 100 }, r)
    expect(back.vector.x).toBeCloseTo(-1, 5)
  })
})

describe('gto mobile: スティックとペダルから移動量へ', () => {
  const stick = (x: number, y: number) => ({ x, y, mag: Math.min(1, Math.hypot(x, y)) })
  const pad = { stick: stick(0, 0), gas: false, brake: false, runHeld: false }

  it('徒歩: 上へ倒すと前進。倒し切ると走る。走るボタンでも走る', () => {
    const walk = touchAxes('foot', { ...pad, stick: stick(0.3, -0.6) })
    expect(walk).toEqual({ moveX: 0.3, moveY: 0.6, run: false })
    expect(touchAxes('foot', { ...pad, stick: stick(0, -1) }).run).toBe(true)
    expect(touchAxes('foot', { ...pad, stick: stick(0, -0.5), runHeld: true }).run).toBe(true)
  })

  it('運転: 前後はペダルだけ。スティックの上下では加減速しない', () => {
    const steer = touchAxes('drive', { ...pad, stick: stick(0.5, 1) })
    expect(steer.moveY).toBe(0)
    expect(steer.run).toBe(false)
    expect(touchAxes('drive', { ...pad, gas: true }).moveY).toBe(1)
    expect(touchAxes('drive', { ...pad, brake: true }).moveY).toBe(-1)
    // 両方踏んだらブレーキが勝つ
    expect(touchAxes('drive', { ...pad, gas: true, brake: true }).moveY).toBe(-1)
  })

  it('運転: ハンドルは中央付近が細かく、端で切り切る', () => {
    const small = touchAxes('drive', { ...pad, stick: stick(0.3, 0) }).moveX
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(0.3)
    expect(touchAxes('drive', { ...pad, stick: stick(1, 0) }).moveX).toBeCloseTo(1, 5)
    expect(touchAxes('drive', { ...pad, stick: stick(-1, 0) }).moveX).toBeCloseTo(-1, 5)
    expect(touchAxes('drive', { ...pad, stick: stick(-0.3, 0) }).moveX).toBeCloseTo(-small, 5)
  })

  it('タッチの値は buildInput でそのまま InputFrame になる', () => {
    const touch = { ...emptyTouch(), ...touchAxes('drive', { ...pad, stick: stick(1, 0), gas: true }), handbrake: true }
    const f = buildInput({ keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, touch, pad: null }, 1 / 60)
    expect(f).toMatchObject({ moveX: 1, moveY: 1, handbrake: true, run: false })
  })
})

describe('gto mobile: ボタンの配置', () => {
  it('運転と徒歩でボタンが切り替わる', () => {
    expect(touchButtons('drive').map((b) => b.id)).toEqual(['gas', 'brake', 'handbrake', 'horn', 'exit'])
    expect(touchButtons('foot').map((b) => b.id)).toEqual(['run', 'enter', 'steal', 'wardrobe'])
  })

  it('「乗る」と「降りる」は別の場所にある（連打で乗ってすぐ降りない）', () => {
    for (const [, w, h] of SCREENS) {
      const l = touchLayout(w, h)
      const enter = l.foot.find((b) => b.id === 'enter')
      const exit = l.drive.find((b) => b.id === 'exit')
      expect(enter && exit).toBeTruthy()
      if (enter && exit) expect(Math.hypot(enter.right - exit.right, enter.bottom - exit.bottom)).toBeGreaterThan(enter.r + exit.r)
    }
  })

  for (const [name, w, h] of SCREENS) {
    it(`${name}: 指で押せる大きさで、重ならず、親指が届く`, () => {
      const l = touchLayout(w, h)
      expect(l.landscape).toBe(w > h)
      for (const set of [l.drive, l.foot]) {
        for (const b of set) {
          // 直径 54px 以上（基準の画面では 60px 以上）
          expect(b.r * 2, b.id).toBeGreaterThanOrEqual(54)
          expect((b.r * 2) / l.scale, b.id).toBeGreaterThanOrEqual(60)
          // 画面の右下の角から親指が届く（中心まで 240px 以内。止まってから押す「降りる」だけは少し遠くてよい）
          expect(Math.hypot(b.right, b.bottom), b.id).toBeLessThanOrEqual((b.id === 'exit' ? 270 : 240) * l.scale)
          // 画面からはみ出さない
          expect(b.right - b.r, b.id).toBeGreaterThanOrEqual(8)
          expect(b.bottom - b.r, b.id).toBeGreaterThanOrEqual(20)
          // スティックの領域（左）に食い込まない
          expect(w - b.right - b.r, b.id).toBeGreaterThanOrEqual(l.zone.width)
        }
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            const a = set[i]
            const b = set[j]
            const gap = Math.hypot(a.right - b.right, a.bottom - b.bottom) - a.r - b.r
            // 隣のボタンとは指の幅の半分（20px）以上あける
            expect(gap, `${a.id}-${b.id}`).toBeGreaterThanOrEqual(20)
          }
        }
      }
      // いちばんよく使うボタンがいちばん大きい
      const size = (set: typeof l.drive, id: TouchButtonId) => set.find((b) => b.id === id)?.r ?? 0
      expect(size(l.drive, 'gas')).toBeGreaterThan(size(l.drive, 'exit'))
      expect(size(l.foot, 'run')).toBeGreaterThan(size(l.foot, 'steal'))
      // 主役（アクセル・ブレーキ・走る）は直径 64px 以上、脇役より一回り以上大きい
      expect(size(l.drive, 'gas') * 2).toBeGreaterThanOrEqual(72)
      expect(size(l.drive, 'brake') * 2).toBeGreaterThanOrEqual(64)
      expect(size(l.foot, 'run') * 2).toBeGreaterThanOrEqual(70)
      expect(size(l.drive, 'brake') - size(l.drive, 'horn')).toBeGreaterThanOrEqual(6)
    })

    it(`${name}: 運転の左右矢印は左下に並び、領域の中に収まる`, () => {
      const l = touchLayout(w, h)
      const s = l.steer
      expect(s.r * 2).toBeGreaterThanOrEqual(56)
      // 2つの矢印は重ならない
      expect(s.half * 2).toBeGreaterThanOrEqual(s.r * 2 + 6)
      expect(s.left - s.half - s.r).toBeGreaterThanOrEqual(8)
      expect(s.left + s.half + s.r).toBeLessThanOrEqual(l.zone.width)
      expect(s.bottom - s.r).toBeGreaterThanOrEqual(20)
      expect(s.bottom + s.r).toBeLessThanOrEqual(l.zone.height)
    })

    it(`${name}: スティックは左下の親指の位置にあり、領域の中に収まる`, () => {
      const l = touchLayout(w, h)
      expect(l.stick.r * 2).toBeGreaterThanOrEqual(96)
      expect(l.stick.left - l.stick.r).toBeGreaterThanOrEqual(12)
      expect(l.stick.bottom - l.stick.r).toBeGreaterThanOrEqual(20)
      expect(l.stick.left + l.stick.r).toBeLessThanOrEqual(l.zone.width)
      expect(l.stick.bottom + l.stick.r).toBeLessThanOrEqual(l.zone.height)
      expect(Math.hypot(l.stick.left, l.stick.bottom)).toBeLessThanOrEqual(200 * l.scale)
      // 領域は画面の半分を越えない（右は視点ドラッグに空ける）
      expect(l.zone.width).toBeLessThanOrEqual(w * 0.5)
    })
  }

  it('横持ちの「降りる」は右上の状態表示に掛からない高さにある', () => {
    const l = touchLayout(844, 390)
    // 右上の表示（時刻・所持金・手配・服の札）は上から 90px まで。そこから指1本ぶん以上あける
    for (const b of l.drive) expect(390 - b.bottom - b.r, b.id).toBeGreaterThanOrEqual(180)
  })
})

describe('gto mobile: その場面で使えるボタンだけを出す', () => {
  const ids = (mode: 'foot' | 'drive', ctx: Parameters<typeof visibleTouchButtons>[1]) => visibleTouchButtons(mode, ctx).map((b) => b.id)
  const none = { canEnter: false, canSteal: false, speed: 0 }

  it('徒歩: 「走る」と「着替え」はいつもあり、車のそばで「乗る」、着替えを奪える相手のそばで「奪う」が加わる', () => {
    expect(ids('foot', none)).toEqual(['run', 'wardrobe'])
    expect(ids('foot', { ...none, canEnter: true })).toEqual(['run', 'enter', 'wardrobe'])
    expect(ids('foot', { ...none, canSteal: true })).toEqual(['run', 'steal', 'wardrobe'])
    expect(ids('foot', { canEnter: true, canSteal: true, speed: 0 })).toEqual(['run', 'enter', 'steal', 'wardrobe'])
    // 運転中に「着替え」は出ない
    expect(ids('drive', none)).not.toContain('wardrobe')
  })

  it('徒歩: 行動のボタン（乗る・奪う・着替え）は「走る」のまわりに固まっていて、どれも指で押せる大きさ', () => {
    for (const [, w, h] of SCREENS) {
      const l = touchLayout(w, h)
      const run = l.foot.find((b) => b.id === 'run')
      expect(run).toBeTruthy()
      if (!run) continue
      for (const b of l.foot) {
        if (b.id === 'run') continue
        // 直径 58px 以上（基準の画面で）
        expect((b.r * 2) / l.scale, b.id).toBeGreaterThanOrEqual(58)
        // 「走る」に置いた親指を、手を持ち替えずに伸ばせる距離（中心どうし 150px 以内）
        expect(Math.hypot(b.right - run.right, b.bottom - run.bottom) / l.scale, b.id).toBeLessThanOrEqual(150)
      }
    }
  })

  it('横持ちの「着替え」は右上の状態表示に掛からない高さにある', () => {
    for (const [w, h] of [
      [844, 390],
      [568, 320],
    ]) {
      const l = touchLayout(w, h)
      for (const b of l.foot) expect(h - b.bottom - b.r, b.id).toBeGreaterThanOrEqual(120)
    }
  })

  it('運転: 止まっているときは「降りる」、走っているときは「サイドブレーキ」が出る', () => {
    expect(ids('drive', none)).toEqual(['gas', 'brake', 'horn', 'exit'])
    expect(ids('drive', { ...none, speed: 12 })).toEqual(['gas', 'brake', 'handbrake', 'horn'])
    expect(ids('drive', { ...none, speed: -9 })).toEqual(['gas', 'brake', 'handbrake', 'horn'])
  })

  it('運転: 境目の速さでは両方出ていて、ちらつかない（押そうとした瞬間に消えない）', () => {
    const both = ids('drive', { ...none, speed: 3 })
    expect(both).toContain('exit')
    expect(both).toContain('handbrake')
  })

  it('出し入れしても、残るボタンの位置は動かない', () => {
    const l = touchLayout(844, 390)
    const all = visibleTouchButtons('drive', { ...none, speed: 3 }, l)
    const slow = visibleTouchButtons('drive', none, l)
    for (const b of slow) expect(all.find((a) => a.id === b.id)).toEqual(b)
  })
})

describe('gto mobile: 左右矢印のハンドル', () => {
  it('矢印の真上で切り切り、2つの間は連続、外へ出ても 1 のまま', () => {
    expect(steerSlide(-40, 40).x).toBeCloseTo(-1, 5)
    expect(steerSlide(40, 40).x).toBeCloseTo(1, 5)
    expect(steerSlide(120, 40).x).toBeCloseTo(1, 5)
    expect(steerSlide(0, 40)).toEqual({ x: 0, y: 0, mag: 0 })
    const half = steerSlide(22, 40).x
    expect(half).toBeGreaterThan(0.3)
    expect(half).toBeLessThan(0.7)
    // 上下には倒れない
    expect(steerSlide(30, 40).y).toBe(0)
  })
})

describe('gto mobile: 軽量設定', () => {
  it('スマホは影・後処理・小物を省き、解像度と量を抑える', () => {
    const m = QUALITY.mobile
    expect(m.shadows).toBe(false)
    expect(m.post).toBe(false)
    expect(m.antialias).toBe(false)
    expect(m.pixelRatio).toBeLessThanOrEqual(1.5)
    expect(m.drawDistance).toBeLessThan(QUALITY.high.drawDistance)
    expect(m.maxVehicles).toBeGreaterThanOrEqual(8)
    expect(m.maxPeds).toBeGreaterThanOrEqual(16)
  })
})
