// Grand Theft Outfit [部品: mobile] 入力の共通化。キーボード・マウス・ゲームパッド・タッチを InputFrame にそろえる。
// 入口: NO_INPUT / buildInput(raw, dt) / emptyTouch()
//       タッチ: stickVector / dragStick / steerSlide / touchAxes(mode, pad) / touchButtons(mode) /
//               visibleTouchButtons(mode, ctx) / touchLayout(w, h) / WARDROBE_KEY /
//               TOUCH_CAPTION / TOUCH_PAD_CAPTION / touchHint(mode, ctx, beat)
// 契約: DOM のイベントは描画側（components/gto）が集め、ここへは「いま押されているもの」を値で渡す。
//       ここは DOM に触れない純粋な変換なので、テストとデモ再生から同じ形で使える。
import { clamp } from './math'
import type { InputFrame, PlayMode } from './types'

export const NO_INPUT: InputFrame = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  run: false,
  handbrake: false,
  horn: false,
  lookBack: false,
  enter: false,
  steal: false,
}

/** タッチ操作の現在値（GtoTouchControls が更新する） */
export interface TouchInput {
  /** 左スティック（−1..1） */
  moveX: number
  moveY: number
  /** 前の1歩からの、右側ドラッグの移動量（px） */
  lookDX: number
  lookDY: number
  run: boolean
  handbrake: boolean
  horn: boolean
  /** 前の1歩から押されたか */
  enter: boolean
  steal: boolean
}

export const emptyTouch = (): TouchInput => ({
  moveX: 0,
  moveY: 0,
  lookDX: 0,
  lookDY: 0,
  run: false,
  handbrake: false,
  horn: false,
  enter: false,
  steal: false,
})

/** ゲームパッドの現在値（標準配置） */
export interface PadInput {
  axes: readonly number[]
  /** 押されているボタン */
  buttons: readonly boolean[]
  /** 前の1歩から新しく押されたボタン */
  pressed: readonly boolean[]
}

export interface RawInput {
  /** 押されているキー（KeyboardEvent.code） */
  keys: ReadonlySet<string>
  /** 前の1歩から新しく押されたキー */
  pressed: ReadonlySet<string>
  /** 前の1歩からのマウスドラッグの移動量（px） */
  mouseDX: number
  mouseDY: number
  touch: TouchInput
  pad: PadInput | null
}

/** 感度（ラジアン / px、ラジアン / 秒） */
export const INPUT_TUNING = {
  mouse: 0.0042,
  touch: 0.0058,
  keyLook: 2.2,
  padLook: 2.8,
  deadzone: 0.16,
}

const dead = (v: number) => (Math.abs(v) < INPUT_TUNING.deadzone ? 0 : v)
const has = (set: ReadonlySet<string>, ...codes: string[]) => codes.some((c) => set.has(c))

export function buildInput(raw: RawInput, dt: number): InputFrame {
  const k = raw.keys
  const pad = raw.pad
  const keyX = (has(k, 'KeyD', 'ArrowRight') ? 1 : 0) - (has(k, 'KeyA', 'ArrowLeft') ? 1 : 0)
  const keyY = (has(k, 'KeyW', 'ArrowUp') ? 1 : 0) - (has(k, 'KeyS', 'ArrowDown') ? 1 : 0)
  const padX = pad ? dead(pad.axes[0] ?? 0) : 0
  // パッドは左スティックの前後に加えて、トリガー（7=アクセル、6=ブレーキ）も使える
  const padY = pad ? -dead(pad.axes[1] ?? 0) + (pad.buttons[7] ? 1 : 0) - (pad.buttons[6] ? 1 : 0) : 0
  const keyLook = (has(k, 'KeyL') ? 1 : 0) - (has(k, 'KeyJ') ? 1 : 0)
  const keyTilt = (has(k, 'KeyI') ? 1 : 0) - (has(k, 'KeyK') ? 1 : 0)
  return {
    moveX: clamp(keyX + padX + raw.touch.moveX, -1, 1),
    moveY: clamp(keyY + padY + raw.touch.moveY, -1, 1),
    lookX:
      raw.mouseDX * INPUT_TUNING.mouse +
      raw.touch.lookDX * INPUT_TUNING.touch +
      keyLook * INPUT_TUNING.keyLook * dt +
      (pad ? dead(pad.axes[2] ?? 0) * INPUT_TUNING.padLook * dt : 0),
    lookY:
      -raw.mouseDY * INPUT_TUNING.mouse -
      raw.touch.lookDY * INPUT_TUNING.touch +
      keyTilt * INPUT_TUNING.keyLook * 0.6 * dt -
      (pad ? dead(pad.axes[3] ?? 0) * INPUT_TUNING.padLook * 0.6 * dt : 0),
    run: has(k, 'ShiftLeft', 'ShiftRight') || raw.touch.run || !!pad?.buttons[0],
    handbrake: has(k, 'Space') || raw.touch.handbrake || !!pad?.buttons[1],
    horn: has(k, 'KeyH') || raw.touch.horn || !!pad?.buttons[10],
    lookBack: has(k, 'KeyC') || !!pad?.buttons[11],
    enter: has(raw.pressed, 'KeyF', 'Enter') || raw.touch.enter || !!pad?.pressed[3],
    steal: has(raw.pressed, 'KeyE') || raw.touch.steal || !!pad?.pressed[2],
  }
}

// ----------------------------------------------------------------------------
// タッチ操作: スティックの計算と、ボタンの配置（画面の大きさから決まる純粋な値）
// ----------------------------------------------------------------------------

/** タッチ操作の調整値（px は基準の大きさ。画面に合わせて touchLayout が拡縮する） */
export const TOUCH_TUNING = {
  /** スティックを倒し切る半径 px */
  stickRadius: 56,
  /** 中心の遊び（半径に対する割合） */
  stickDead: 0.14,
  /** 徒歩でここまで倒すと走る */
  runAt: 0.92,
  /** ハンドルの曲線の指数（1 より大きいと中央が細かい） */
  steerCurve: 1.5,
}

export interface StickVector {
  /** 右が＋（−1..1） */
  x: number
  /** 画面の下が＋（−1..1） */
  y: number
  /** 倒した量（0..1） */
  mag: number
}

const STICK_REST: StickVector = { x: 0, y: 0, mag: 0 }

/** 中心からの指のずれ（px）を、遊びを除いた −1..1 の倒し量にする */
export function stickVector(dx: number, dy: number, radius: number, deadzone = TOUCH_TUNING.stickDead): StickVector {
  const len = Math.hypot(dx, dy)
  const raw = Math.min(1, len / Math.max(1, radius))
  if (raw <= deadzone) return STICK_REST
  const mag = (raw - deadzone) / (1 - deadzone)
  return { x: (dx / len) * mag, y: (dy / len) * mag, mag }
}

export interface Point {
  x: number
  y: number
}

/** 指が半径の外へ出たら台を引きずって追わせる。新しい台の位置と倒し量を返す */
export function dragStick(origin: Point, finger: Point, radius: number): { origin: Point; vector: StickVector } {
  const dx = finger.x - origin.x
  const dy = finger.y - origin.y
  const len = Math.hypot(dx, dy)
  const over = len - radius
  const next = over > 0 ? { x: origin.x + (dx / len) * over, y: origin.y + (dy / len) * over } : origin
  return { origin: next, vector: stickVector(finger.x - next.x, finger.y - next.y, radius) }
}

/** 運転の左右矢印。2つの矢印の中点からの横のずれ（px）をハンドルの量にする。half は中点から矢印の中心までの距離 */
export function steerSlide(dx: number, half: number): StickVector {
  const v = stickVector(dx, 0, half)
  // -0 を返さない（比較と表示が素直になる）
  return v.mag === 0 ? STICK_REST : { x: v.x, y: 0, mag: v.mag }
}

/** タッチで押さえている物 */
export interface TouchPad {
  stick: StickVector
  gas: boolean
  brake: boolean
  runHeld: boolean
}

/** スティックとペダルを、徒歩・運転それぞれの移動量にする */
export function touchAxes(mode: PlayMode, pad: TouchPad): Pick<TouchInput, 'moveX' | 'moveY' | 'run'> {
  if (mode === 'drive') {
    // 前後はペダルだけ。ハンドルを切る親指の上下で、勝手に加速や後退をしない
    const steer = Math.sign(pad.stick.x) * Math.abs(pad.stick.x) ** TOUCH_TUNING.steerCurve
    return { moveX: steer, moveY: pad.brake ? -1 : pad.gas ? 1 : 0, run: false }
  }
  return {
    moveX: pad.stick.x,
    moveY: pad.stick.y === 0 ? 0 : -pad.stick.y,
    run: pad.runHeld || pad.stick.mag >= TOUCH_TUNING.runAt,
  }
}

export type TouchButtonId = 'gas' | 'brake' | 'handbrake' | 'horn' | 'exit' | 'run' | 'enter' | 'steal' | 'wardrobe'

/** 着替え画面を開くキー（KeyboardEvent.code）。「着替え」ボタンは、このキーを押したことにして開く */
export const WARDROBE_KEY = 'KeyQ'

export interface TouchButtonDef {
  id: TouchButtonId
  /** 置き場所（1 が右下の角にいちばん近く、いちばん大きい） */
  slot: 1 | 2 | 3 | 4 | 5
  /** 押しているあいだ効く（false なら押した瞬間だけ） */
  hold: boolean
}

const DRIVE_BUTTONS: TouchButtonDef[] = [
  { id: 'gas', slot: 1, hold: true },
  { id: 'brake', slot: 2, hold: true },
  { id: 'handbrake', slot: 3, hold: true },
  { id: 'horn', slot: 4, hold: true },
  { id: 'exit', slot: 5, hold: false },
]
// 「乗る」は 2 番、「降りる」は 5 番。同じ場所に置かないので、連打しても乗ってすぐ降りない。「着替え」は 4 番
const FOOT_BUTTONS: TouchButtonDef[] = [
  { id: 'run', slot: 1, hold: true },
  { id: 'enter', slot: 2, hold: false },
  { id: 'steal', slot: 3, hold: false },
  { id: 'wardrobe', slot: 4, hold: false },
]

/** そのモードで出すボタン */
export const touchButtons = (mode: PlayMode): TouchButtonDef[] => (mode === 'drive' ? DRIVE_BUTTONS : FOOT_BUTTONS)

interface Slot {
  right: number
  bottom: number
  r: number
}

// 右下の角を中心に置く（基準の px。中心の、右端・下端からの距離と半径）。
// 主役（1・2 番）は大きく、脇役は小さく、どの2つも 20px 以上あける。徒歩は 1〜4 番、運転は 1〜5 番を使う。
// 徒歩は「走る」を角に置き、真上にいつもある「着替え」、左に「奪う」、斜め上に「乗る」。親指を伸ばすだけで全部に届く。
// いつもある2つ（走る・着替え）が右端に縦に並び、場面で出る2つ（奪う・乗る）がその左に加わる。
const SLOTS_PORTRAIT: Record<PlayMode, Record<TouchButtonDef['slot'], Slot>> = {
  foot: {
    1: { right: 62, bottom: 80, r: 42 },
    2: { right: 150, bottom: 186, r: 36 },
    3: { right: 162, bottom: 88, r: 36 },
    4: { right: 60, bottom: 186, r: 30 },
    5: { right: 0, bottom: 0, r: 0 },
  },
  drive: {
    1: { right: 58, bottom: 80, r: 42 },
    2: { right: 160, bottom: 68, r: 38 },
    3: { right: 126, bottom: 170, r: 30 },
    4: { right: 44, bottom: 182, r: 30 },
    5: { right: 44, bottom: 266, r: 30 },
  },
}
// 横持ちは高さが無く、右上に状態の表示があるので、5 番（降りる）は上ではなく左へ逃がす
const SLOTS_LANDSCAPE: Record<PlayMode, Record<TouchButtonDef['slot'], Slot>> = {
  foot: {
    1: { right: 64, bottom: 76, r: 42 },
    2: { right: 160, bottom: 178, r: 36 },
    3: { right: 172, bottom: 84, r: 36 },
    4: { right: 64, bottom: 180, r: 30 },
    5: { right: 0, bottom: 0, r: 0 },
  },
  drive: {
    1: { right: 62, bottom: 78, r: 42 },
    2: { right: 168, bottom: 68, r: 38 },
    3: { right: 132, bottom: 164, r: 30 },
    4: { right: 46, bottom: 172, r: 30 },
    5: { right: 260, bottom: 54, r: 30 },
  },
}

export interface PlacedButton extends TouchButtonDef, Slot {}

export interface TouchLayout {
  landscape: boolean
  /** 基準（短い辺 390px）に対する拡大率 */
  scale: number
  /** スティックの台の、待っているときの位置（中心の、左端・下端からの距離）と半径 */
  stick: { left: number; bottom: number; r: number }
  /** 運転の左右矢印（2つの中点の、左端・下端からの距離。half は中点から各矢印の中心まで、r は矢印の半径） */
  steer: { left: number; bottom: number; half: number; r: number }
  /** スティックを受ける領域（左下の角から） */
  zone: { width: number; height: number }
  drive: PlacedButton[]
  foot: PlacedButton[]
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** 画面の大きさ（CSS px）から、スティックとボタンの位置を決める。安全領域の余白は描画側で足す */
export function touchLayout(width: number, height: number): TouchLayout {
  const landscape = width > height
  const scale = clamp(Math.min(width, height) / 390, 0.9, 1.3)
  const slots = landscape ? SLOTS_LANDSCAPE : SLOTS_PORTRAIT
  const place = (defs: TouchButtonDef[], mode: PlayMode): PlacedButton[] =>
    defs.map((d) => {
      const s = slots[mode][d.slot]
      return { ...d, right: round1(s.right * scale), bottom: round1(s.bottom * scale), r: round1(s.r * scale) }
    })
  return {
    landscape,
    scale,
    stick: { left: round1(86 * scale), bottom: round1(96 * scale), r: round1(TOUCH_TUNING.stickRadius * scale) },
    steer: landscape
      ? { left: round1(106 * scale), bottom: round1(74 * scale), half: round1(46 * scale), r: round1(40 * scale) }
      : { left: round1(84 * scale), bottom: round1(76 * scale), half: round1(38 * scale), r: round1(33 * scale) },
    zone: { width: Math.round(width * (landscape ? 0.38 : 0.44)), height: Math.round(height * (landscape ? 0.55 : 0.4)) },
    drive: place(DRIVE_BUTTONS, 'drive'),
    foot: place(FOOT_BUTTONS, 'foot'),
  }
}

/** ボタンの出し分けに使う、いまの状況 */
export interface TouchContext {
  canEnter: boolean
  canSteal: boolean
  /** 車の速さ m/s（後退は負） */
  speed: number
}

/** 「降りる」を出す速さの上限と、「サイドブレーキ」を出す速さの下限（m/s）。重なりがあるので境目でちらつかない */
export const TOUCH_SHOW = { exitBelow: 4, handbrakeAbove: 2 }

const usable = (id: TouchButtonId, ctx: TouchContext): boolean => {
  const speed = Math.abs(ctx.speed)
  if (id === 'enter') return ctx.canEnter
  if (id === 'steal') return ctx.canSteal
  if (id === 'exit') return speed < TOUCH_SHOW.exitBelow
  if (id === 'handbrake') return speed > TOUCH_SHOW.handbrakeAbove
  return true
}

/** その場面で使えるボタンだけを返す。layout を渡すと位置つき（残るボタンの位置は変わらない） */
export function visibleTouchButtons(mode: PlayMode, ctx: TouchContext): TouchButtonDef[]
export function visibleTouchButtons(mode: PlayMode, ctx: TouchContext, layout: TouchLayout): PlacedButton[]
export function visibleTouchButtons(mode: PlayMode, ctx: TouchContext, layout?: TouchLayout): TouchButtonDef[] {
  const all = layout ? (mode === 'drive' ? layout.drive : layout.foot) : touchButtons(mode)
  return all.filter((b) => usable(b.id, ctx))
}

// ----------------------------------------------------------------------------
// タッチ操作: ボタンの名前と、場面ごとの操作の案内（文は日本語のキー。描画側が t() で訳す）
// ----------------------------------------------------------------------------

/** 絵の下に出す短い名前 */
export const TOUCH_CAPTION: Record<TouchButtonId, string> = {
  gas: 'アクセル',
  brake: 'ブレーキ',
  handbrake: 'サイドブレーキ',
  horn: '警笛',
  exit: '降りる',
  run: '走る',
  enter: '乗る',
  steal: '奪う',
  wardrobe: '着替え',
}
/** 左下の操作の名前（徒歩のスティックと、運転の左右矢印） */
export const TOUCH_PAD_CAPTION: Record<PlayMode, string> = { foot: '移動', drive: 'ハンドル' }

/** 案内に添える絵。ボタンの絵のほかに、スティック・視点のドラッグ・左右矢印 */
export type TouchHintIcon = TouchButtonId | 'stick' | 'look' | 'steer'

export interface TouchHintPart {
  /** 文の前に置く絵（そのボタンと同じ絵） */
  icon?: TouchHintIcon
  text: string
}

export interface TouchHint {
  /** 同じ案内かどうかを見分ける名前（変わったときだけ描き直す） */
  id: string
  parts: TouchHintPart[]
}

export interface TouchHintContext extends TouchContext {
  /** 手持ちの服の数 */
  outfits: number
}

/** 順送りの案内を次へ進める間隔（秒） */
export const TOUCH_HINT_BEAT = 5

const hint = (id: string, ...parts: TouchHintPart[]): TouchHint => ({ id, parts })
const HINT_ENTER: TouchHintPart = { icon: 'enter', text: 'でそばの車に乗る' }
const HINT_STEAL: TouchHintPart = { icon: 'steal', text: 'で目の前の人の服をいただく' }
const FOOT_HINTS: TouchHint[] = [
  hint('foot-move', { icon: 'stick', text: '画面の左側を触って動かす。大きく倒すと走る' }),
  hint('foot-look', { icon: 'look', text: '画面の右側をなぞって見回す' }),
  hint('foot-run', { icon: 'run', text: 'を押しているあいだ走る' }),
]
const HINT_WARDROBE = hint('foot-wardrobe', { icon: 'wardrobe', text: 'で手持ちの服に着替える' })
const HINT_STOPPED = hint('drive-stopped', { icon: 'gas', text: 'で進む' }, { icon: 'brake', text: 'で後退' }, { icon: 'exit', text: 'で降りる' })
const DRIVE_HINTS: TouchHint[] = [
  hint('drive-steer', { icon: 'steer', text: '矢印のあいだを滑らせると細かく曲がる' }),
  hint('drive-handbrake', { icon: 'handbrake', text: 'を押しながら曲がると後ろが滑る' }),
  hint('drive-brake', { icon: 'brake', text: 'で減速。止まると後退になる' }),
  hint('drive-horn', { icon: 'horn', text: 'で警笛を鳴らす' }),
]

/**
 * その場面で使える操作の意味を1行で返す。
 * いまだけ使えるボタン（乗る・奪う）が出ているときはその説明、ふだんは基本の操作を beat ごとに順送りする。
 * beat は経過秒を TOUCH_HINT_BEAT で割った整数。案内に出すボタンは、必ず画面に出ているボタン。
 */
export function touchHint(mode: PlayMode, ctx: TouchHintContext, beat: number): TouchHint {
  const turn = <T>(list: T[]): T => list[((Math.floor(beat) % list.length) + list.length) % list.length]
  if (mode === 'drive') return Math.abs(ctx.speed) > TOUCH_SHOW.handbrakeAbove ? turn(DRIVE_HINTS) : HINT_STOPPED
  if (ctx.canEnter && ctx.canSteal) return hint('foot-enter-steal', { icon: 'enter', text: 'で車に乗る' }, { icon: 'steal', text: 'で服をいただく' })
  if (ctx.canEnter) return hint('foot-enter', HINT_ENTER)
  if (ctx.canSteal) return hint('foot-steal', HINT_STEAL)
  return turn(ctx.outfits > 0 ? [...FOOT_HINTS, HINT_WARDROBE] : FOOT_HINTS)
}
