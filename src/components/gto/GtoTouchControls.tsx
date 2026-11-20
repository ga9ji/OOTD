// Grand Theft Outfit [部品: mobile] スマホのタッチ操作。左下で動かし、右下のボタンで操作する。
// 徒歩: 左下はスティック（倒し切ると走る）。右下は「走る」を角に、行動のボタンをそのまわりに固める。
//       「着替え」（手持ちの数つき）は常に、「乗る」「奪う」は使える場面でだけ出る。
// 運転: 左下は左右の矢印（2つの間を滑らせると細かく切れる）。右下はアクセルとブレーキのペダル。
//       警笛は常に、サイドブレーキは走っているとき、「降りる」は止まりかけたときだけ出る。
// ボタンは文字ではなく絵。位置・大きさ・出し分けは lib/gto/input.ts（touchLayout / visibleTouchButtons / steerSlide）。
// 初見でも分かるよう、どのボタンにも絵の下に短い名前を出し、ミニマップの横に「いま使える操作の意味」を1行で出す
// （文は lib/gto/input.ts の touchHint。乗れる・奪えるときはそのボタンの説明に切り替わり、ふだんは基本の操作を順送りする）。
// ここは指の出来事を集めて engine.setTouch へ渡すだけ。カメラは、左下の領域とボタン以外の画面をドラッグして回す（engine 側で受ける）。
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  dragStick,
  steerSlide,
  touchCaption,
  TOUCH_HINT_BEAT,
  TOUCH_PAD_CAPTION,
  TOUCH_SHOW,
  WARDROBE_KEY,
  touchAxes,
  touchHint,
  touchLayout,
  visibleTouchButtons,
  type PlacedButton,
  type Point,
  type StickVector,
  type TouchButtonId,
  type TouchHintIcon,
  type TouchLayout,
  type TouchPad,
} from '../../lib/gto/input'
import type { PlayMode } from '../../lib/gto/types'
import { useI18n } from '../../lib/i18n'
import type { GtoEngine } from './engine'
import './gtoTouch.css'

/** 案内の帯の置き場所を見直す間隔（ms） */
const HINT_PLACE_MS = 400
const REST: StickVector = { x: 0, y: 0, mag: 0 }
const restPad = (): TouchPad => ({ stick: REST, gas: false, brake: false, runHeld: false })

/** いまの状況（ボタンの出し分け） */
interface Situation {
  mode: PlayMode
  canEnter: boolean
  canSteal: boolean
  /** 出し分けの境目だけを見分ける、粗い速さ（m/s） */
  speed: number
  /** 手持ちの服の数（「着替え」の札に出す） */
  outfits: number
  /** 案内の順送りの番号（数秒に1つ進む） */
  beat: number
  /** [cheats] 飛行機に乗っているか・飛んでいるか（上昇・下降のボタンに読み替える）、戦車に乗っているか（警笛が砲になる） */
  plane: boolean
  airborne: boolean
  tank: boolean
}

/** 速さを「止まりかけ・境目・走っている」の3段に丸める（毎フレーム描き直さないため） */
const speedBand = (speed: number): number => {
  const v = Math.abs(speed)
  if (v <= TOUCH_SHOW.handbrakeAbove) return 0
  return v < TOUCH_SHOW.exitBelow ? (TOUCH_SHOW.handbrakeAbove + TOUCH_SHOW.exitBelow) / 2 : TOUCH_SHOW.exitBelow
}

/** 押しているあいだ効くボタンが、どの値を動かすか */
type HoldId = Extract<TouchButtonId, 'gas' | 'brake' | 'handbrake' | 'horn' | 'run'>

// ---- ボタンの絵（48x48。塗りは currentColor、線は .gtt-line） ----
// [cheats] 飛行機に乗っているあいだ、サイドブレーキと警笛のボタンに重ねる絵（上昇・下降の矢印）は、この下の FLIGHT_ICONS
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    {children}
  </svg>
)
const CAR = 'M9 31 L13 20.5 Q14.2 17.5 17.5 17.5 H30.5 Q33.8 17.5 35 20.5 L39 31 V40 H33.5 V36.5 H14.5 V40 H9 Z M16 21 L13.8 27.5 H34.2 L32 21 Z M13 31.2 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0 Z M30.6 31.2 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0 Z'
const FLIGHT_ICONS: Partial<Record<TouchButtonId, ReactNode>> = {
  handbrake: (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 7 L41 27 H31 V41 H17 V27 H7 Z" />
    </svg>
  ),
  horn: (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 41 L7 21 H17 V7 H31 V21 H41 Z" />
    </svg>
  ),
}
// [cheats] 戦車に乗っているあいだ、警笛のボタンに重ねる絵（照準）
const TANK_ICONS: Partial<Record<TouchButtonId, ReactNode>> = {
  horn: (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fillRule="evenodd" d="M24 7 a17 17 0 1 0 0.01 0 Z M24 12 a12 12 0 1 1 -0.01 0 Z M22 3 H26 V17 H22 Z M22 31 H26 V45 H22 Z M3 22 H17 V26 H3 Z M31 22 H45 V26 H31 Z" />
      <circle cx="24" cy="24" r="3" />
    </svg>
  ),
}
const ICONS: Record<TouchButtonId, ReactNode> = {
  // 走る人
  run: (
    <Icon>
      <circle cx="30.5" cy="8.5" r="4.6" />
      <path className="gtt-line is-thick" d="M27 17 L21.5 28 M27 17.5 L34 22.5 L39.5 19 M25.5 17.5 L18 19 L14 25.5 M21.5 28 L29.5 33 L28.5 42.5 M21.5 28 L15.5 34.5 L7.5 34" />
    </Icon>
  ),
  // 車と、乗り込む向きの矢印
  enter: (
    <Icon>
      <path fillRule="evenodd" d={CAR} />
      <path className="gtt-line" d="M24 3.5 V12.5 M19.5 8.5 L24 13 L28.5 8.5" />
    </Icon>
  ),
  // 車と、外へ出る向きの矢印
  exit: (
    <Icon>
      <path fillRule="evenodd" d={CAR} />
      <path className="gtt-line" d="M24 13 V4 M19.5 8 L24 3.5 L28.5 8" />
    </Icon>
  ),
  // 服（着替えを奪う）
  steal: (
    <Icon>
      <path d="M17 7.5 L6.5 13.5 L10.5 22.5 L15 20.5 V41 H33 V20.5 L37.5 22.5 L41.5 13.5 L31 7.5 Q28.5 12.5 24 12.5 Q19.5 12.5 17 7.5 Z" />
    </Icon>
  ),
  // 洋服だんす（着替え）。扉2枚と取っ手
  wardrobe: (
    <Icon>
      <path fillRule="evenodd" d="M10 4 H38 Q42 4 42 8 V38 H38 V44 H32 V38 H16 V44 H10 V38 H6 V8 Q6 4 10 4 Z M22.6 8 V34 H25.4 V8 Z M16.2 18 V25 H19.4 V18 Z M28.6 18 V25 H31.8 V18 Z" />
    </Icon>
  ),
  // 縦長のペダル（アクセル）
  gas: (
    <Icon>
      <path fillRule="evenodd" d="M20 4 H28 Q32 4 32 8 V40 Q32 44 28 44 H20 Q16 44 16 40 V8 Q16 4 20 4 Z M19.5 12 V15 H28.5 V12 Z M19.5 19.5 V22.5 H28.5 V19.5 Z M19.5 27 V30 H28.5 V27 Z M19.5 34.5 V37.5 H28.5 V34.5 Z" />
    </Icon>
  ),
  // 横長のペダル（ブレーキ）
  brake: (
    <Icon>
      <path fillRule="evenodd" d="M11 13 H37 Q41 13 41 17 V31 Q41 35 37 35 H11 Q7 35 7 31 V17 Q7 13 11 13 Z M12.5 17.5 V30.5 H15.5 V17.5 Z M19.5 17.5 V30.5 H22.5 V17.5 Z M26.5 17.5 V30.5 H29.5 V17.5 Z M33.5 17.5 V30.5 H36.5 V17.5 Z" />
    </Icon>
  ),
  // 丸の中に P（サイドブレーキ）
  handbrake: (
    <Icon>
      <path className="gtt-line" d="M24 12.5 a11.5 11.5 0 1 0 0.010 0 Z M21 30.5 V17.5 H25 A3.8 3.8 0 0 1 25 25.1 H21 M7.5 12 A20 20 0 0 0 7.5 36 M40.5 12 A20 20 0 0 1 40.5 36" />
    </Icon>
  ),
  // らっぱと音の波（警笛）
  horn: (
    <Icon>
      <path d="M6 18.5 H14 L27 9.5 V38.5 L14 29.5 H6 Z" />
      <path className="gtt-line" d="M32.5 17.5 Q36.5 24 32.5 30.5 M37.5 12 Q45 24 37.5 36" />
    </Icon>
  ),
}
// 案内の帯に添える絵。ボタンはボタンと同じ絵、左下と視点のドラッグは専用の絵
const HINT_ICONS: Record<TouchHintIcon, ReactNode> = {
  ...ICONS,
  // スティック: 台とつまみ
  stick: (
    <Icon>
      <path className="gtt-line" d="M24 5 a19 19 0 1 0 0.010 0 Z" />
      <circle cx="29" cy="19" r="8" />
    </Icon>
  ),
  // 視点: 指先と左右の矢印
  look: (
    <Icon>
      <circle cx="24" cy="27" r="7.5" />
      <path className="gtt-line" d="M4 27 H12 M8.5 22 L3.5 27 L8.5 32 M44 27 H36 M39.500 22 L44.5 27 L39.500 32 M14 12 Q24 5 34 12" />
    </Icon>
  ),
  // ハンドル: 左右の矢印
  steer: (
    <Icon>
      <path d="M20 10 L5 24 L20 38 Z M28 10 L43 24 L28 38 Z" />
    </Icon>
  ),
}
/** 案内の絵の色。ボタンと同じ役割の色にして、どのボタンの話かを色でも結ぶ */
const HINT_TONE: Partial<Record<TouchHintIcon, string>> = { enter: 'is-accent', steal: 'is-accent', exit: 'is-exit', run: 'is-main', gas: 'is-main' }

const ARROW = (
  <Icon>
    <path d="M31 9.5 L13 24 L31 38.5 Z" strokeLinejoin="round" stroke="currentColor" strokeWidth="5" />
  </Icon>
)

/** 着替え画面を開く。開け閉めは outfit の部品が持っているので、キーを押したことにして頼む */
const openWardrobe = () => {
  for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: WARDROBE_KEY, bubbles: true, cancelable: true }))
}

const tick = () => {
  // 対応している端末だけ、押した手応えを短く返す
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(8)
}

export default function GtoTouchControls({ engine }: { engine: GtoEngine }) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLElement>(null)
  const arrowsRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<TouchLayout | null>(null)
  const [now, setNow] = useState<Situation>({ mode: 'foot', canEnter: false, canSteal: false, speed: 0, outfits: 0, beat: 0, plane: false, airborne: false, tank: false })
  const [held, setHeld] = useState<ReadonlySet<HoldId>>(new Set())

  // 指の動きは毎フレーム来るので、React の状態にせず ref に持ち、見た目は transform を直接書く
  const pad = useRef<TouchPad>(restPad())
  const modeRef = useRef<PlayMode>('foot')
  const drag = useRef<{ id: number; origin: Point } | null>(null)
  const layoutRef = useRef<TouchLayout | null>(null)

  // スティックを倒し切って走っているあいだは、「走る」ボタンも光らせて伝える
  const [autoRun, setAutoRun] = useState(false)
  const push = useCallback(() => {
    const axes = touchAxes(modeRef.current, pad.current)
    engine.setTouch(axes)
    setAutoRun(axes.run)
  }, [engine])

  /** スティックの台とつまみを置く。origin が null なら待機位置。運転中は、切っている側の矢印を光らせる */
  const paintStick = useCallback((origin: Point | null, vector: StickVector) => {
    const l = layoutRef.current
    if (!l) return
    if (modeRef.current === 'drive') {
      const arrows = arrowsRef.current
      if (!arrows) return
      arrows.dataset.steer = vector.x < 0 ? 'l' : vector.x > 0 ? 'r' : ''
      arrows.style.setProperty('--amt', String(Math.abs(vector.x)))
      return
    }
    const base = baseRef.current
    const knob = knobRef.current
    if (!base || !knob) return
    const at = origin ?? { x: l.stick.left, y: l.zone.height - l.stick.bottom }
    base.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`
    knob.style.transform = `translate3d(${vector.x * l.stick.r}px, ${vector.y * l.stick.r}px, 0)`
    base.classList.toggle('is-held', origin != null)
  }, [])

  // 画面の大きさから配置を決める（縦横の持ち替えにも追従する）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const next = touchLayout(root.clientWidth, root.clientHeight)
      layoutRef.current = next
      setLayout(next)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    paintStick(drag.current?.origin ?? null, pad.current.stick)
  }, [layout, now.mode, paintStick])

  // 徒歩と運転の切り替わり、乗れる・奪えるの変化だけを拾う
  useEffect(() => {
    let last = ''
    return engine.subscribe(({ state, view }) => {
      const speed = state.mode === 'drive' ? speedBand(state.player.speed) : 0
      const outfits = state.outfit.wardrobe.length
      const beat = Math.floor(state.t / TOUCH_HINT_BEAT)
      const plane = view.ride === 'plane'
      const airborne = view.altitude != null
      const tank = view.ride === 'tank'
      const key = `${state.mode}${view.canEnter ? 1 : 0}${view.canSteal ? 1 : 0}${speed}-${outfits}-${beat}${plane ? 'p' : ''}${airborne ? 'a' : ''}${tank ? 't' : ''}`
      if (key === last) return
      last = key
      if (modeRef.current !== state.mode) {
        // 左下もボタンも入れ替わるので、押しっぱなしだった物は離したことにする（指を動かせばまた効く）
        modeRef.current = state.mode
        pad.current = restPad()
        setHeld(new Set())
        const axes = touchAxes(state.mode, pad.current)
        engine.setTouch({ ...axes, handbrake: false, horn: false })
        setAutoRun(axes.run)
      }
      setNow({ mode: state.mode, canEnter: view.canEnter, canSteal: view.canSteal, speed, outfits, beat, plane, airborne, tank })
    })
  }, [engine])

  // 案内の帯はミニマップの横。横持ちでミッションの目的がそこに出ているあいだは、そのすぐ下へ下がる
  // （目的の箱は hud の部品の物なので、位置だけを読んで避ける。出入りは時々見れば足りる）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const place = () => {
      const brief = root.parentElement?.querySelector('.gto-hud-brief')
      const wide = root.clientWidth > root.clientHeight
      const top = brief && wide ? Math.round(brief.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 6) : null
      const next = top == null ? '' : `${top}px`
      if (root.style.getPropertyValue('--hint-top') !== next) {
        if (next) root.style.setProperty('--hint-top', next)
        else root.style.removeProperty('--hint-top')
      }
    }
    place()
    const timer = window.setInterval(place, HINT_PLACE_MS)
    return () => window.clearInterval(timer)
  }, [])
  // 画面を離れるときは入力を戻す
  useEffect(() => () => engine.setTouch({ moveX: 0, moveY: 0, run: false, handbrake: false, horn: false }), [engine])

  // ---- スティック ----
  const local = (e: ReactPointerEvent<HTMLDivElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  /** 運転中: 2つの矢印の中点からの横のずれでハンドルを切る */
  const steerAt = (at: Point) => {
    const l = layoutRef.current
    if (!l) return
    const vector = steerSlide(at.x - l.steer.left, l.steer.half)
    pad.current = { ...pad.current, stick: vector }
    paintStick(null, vector)
    push()
  }
  const stickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const origin = local(e)
    drag.current = { id: e.pointerId, origin }
    if (modeRef.current === 'drive') {
      tick()
      steerAt(origin)
      return
    }
    pad.current = { ...pad.current, stick: REST }
    paintStick(origin, REST)
    push()
  }
  const stickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const l = layoutRef.current
    if (!d || !l || d.id !== e.pointerId) return
    if (modeRef.current === 'drive') {
      steerAt(local(e))
      return
    }
    const next = dragStick(d.origin, local(e), l.stick.r)
    drag.current = { id: d.id, origin: next.origin }
    pad.current = { ...pad.current, stick: next.vector }
    paintStick(next.origin, next.vector)
    push()
  }
  const stickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    pad.current = { ...pad.current, stick: REST }
    paintStick(null, REST)
    push()
  }

  // ---- ボタン ----
  const setHold = (id: HoldId, on: boolean) => {
    setHeld((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
    if (id === 'handbrake' || id === 'horn') {
      engine.setTouch({ [id]: on })
      return
    }
    pad.current = { ...pad.current, [id === 'run' ? 'runHeld' : id]: on }
    push()
  }
  const holdProps = (id: HoldId) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      tick()
      setHold(id, true)
    },
    onPointerUp: () => setHold(id, false),
    onPointerCancel: () => setHold(id, false),
    onLostPointerCapture: () => setHold(id, false),
  })
  const tapProps = (id: TouchButtonId) => ({
    onPointerDown: () => {
      tick()
      if (id === 'wardrobe') openWardrobe()
      else engine.setTouch({ [id === 'steal' ? 'steal' : 'enter']: true })
    },
  })

  // 役割ごとの見た目: 主役（アクセル・走る）は明るい塗り、その場面だけの操作（乗る・奪う）は糸の色、ほかは暗い塗り
  // 「乗る」は車、「奪う」は服、「着替え」はたんす。色と形の両方で見分ける
  const face: Record<TouchButtonId, { label: string; cls: string }> = {
    gas: { label: t('アクセル'), cls: 'is-main' },
    brake: { label: t('ブレーキ'), cls: 'is-pedal' },
    handbrake: { label: t('サイドブレーキ'), cls: 'is-side' },
    horn: { label: t('警笛'), cls: 'is-side' },
    exit: { label: t('降りる'), cls: 'is-exit' },
    run: { label: t('走る'), cls: 'is-main' },
    enter: { label: t('乗る'), cls: 'is-accent' },
    steal: { label: t('奪う'), cls: 'is-accent' },
    wardrobe: { label: t('ワードローブを開く'), cls: 'is-tool' },
  }
  // [cheats] 乗っている裏コードの乗り物（ボタンの名前と絵を読み替える）
  const ride = now.plane ? 'plane' : now.tank ? 'tank' : null
  const button = (b: PlacedButton) => {
    const f = face[b.id]
    const style = { '--x': `${b.right}px`, '--y': `${b.bottom}px`, '--d': `${b.r * 2}px` } as CSSProperties
    const on = (b.hold && held.has(b.id as HoldId)) || (b.id === 'run' && autoRun)
    const handlers = b.hold ? holdProps(b.id as HoldId) : tapProps(b.id)
    return (
      <button key={b.id} type="button" className={`gtt-btn ${f.cls}${on ? ' is-held' : ''}`} style={style} aria-label={touchCaption(b.id, ride) === touchCaption(b.id) ? f.label : t(touchCaption(b.id, ride))} data-gtt={b.id} {...handlers}>
        {(now.plane ? FLIGHT_ICONS[b.id] : now.tank ? TANK_ICONS[b.id] : undefined) ?? ICONS[b.id]}
        {b.id === 'wardrobe' && now.outfits > 0 && <span className="gtt-count mono">{now.outfits}</span>}
        <span className="gtt-cap jp">{t(touchCaption(b.id, ride))}</span>
      </button>
    )
  }
  // 使える物だけを出す。押している最中のボタンは、条件を外れても指を離すまで残す
  const shown = (l: TouchLayout): PlacedButton[] => {
    const usable = new Set(visibleTouchButtons(now.mode, now, l).map((b) => b.id))
    return (now.mode === 'drive' ? l.drive : l.foot).filter((b) => usable.has(b.id) || held.has(b.id as HoldId))
  }
  const driving = now.mode === 'drive'
  const hint = touchHint(now.mode, now, now.beat)

  return (
    <div className="gtt" ref={rootRef} onContextMenu={(e) => e.preventDefault()} data-mode={now.mode}>
      {layout && (
        <>
          <div
            className="gtt-zone"
            style={{ width: layout.zone.width, height: layout.zone.height }}
            onPointerDown={stickDown}
            onPointerMove={stickMove}
            onPointerUp={stickUp}
            onPointerCancel={stickUp}
          >
            {driving ? (
              // key を分ける: スティックの台に直接書いた transform を、矢印が引き継がないよう作り直す
              <div
                key="arrows"
                className="gtt-arrows"
                ref={arrowsRef}
                style={{ '--x': `${layout.steer.left}px`, '--y': `${layout.steer.bottom}px`, '--d': `${layout.steer.r * 2}px`, '--half': `${layout.steer.half}px` } as CSSProperties}
              >
                <i className="gtt-arrow is-l">{ARROW}</i>
                <i className="gtt-arrow is-r">{ARROW}</i>
                <span className="gtt-cap jp">{t(TOUCH_PAD_CAPTION.drive)}</span>
              </div>
            ) : (
              <div key="stick" className="gtt-stick" ref={baseRef} style={{ '--d': `${layout.stick.r * 2}px` } as CSSProperties}>
                <i className="gtt-knob" ref={knobRef} />
                <span className="gtt-cap jp">{t(TOUCH_PAD_CAPTION.foot)}</span>
              </div>
            )}
          </div>
          {shown(layout).map(button)}
          {/* いま使える操作の意味を1行で。key を変えて、切り替わったことが目に入るよう出し直す */}
          <p className="gtt-hint jp" key={hint.id} role="status">
            {hint.parts.map((part) => (
              <span className="gtt-hint-part" key={part.text}>
                {part.icon && <i className={`gtt-hint-ico ${HINT_TONE[part.icon] ?? ''}`}>{HINT_ICONS[part.icon]}</i>}
                {t(part.text)}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  )
}
