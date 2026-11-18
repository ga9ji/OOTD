import { useEffect, useRef, useState, type PointerEvent } from 'react'
import GameFullscreenButton from './GameFullscreenButton'
import { scrollGameToTop } from '../lib/gameFullscreen'
import { useI18n } from '../lib/i18n'
import {
  act, createBattle, FIELD, HUNTS, HUNT_TITLE, joystickVector, loadRecords, PORTRAIT_FIELD,
  resizeBattlefield, saveRecord, tickBattle,
  type Action, type Battle, type Hunt, type Point, type Signal,
} from '../lib/kokiHunt'
import { drawBattle, drawHuntIcon, KOKI_SPRITE, makeTerrain } from './kokiHuntArt'
import './kokiHunt.css'

const SPRITE_URL = `${import.meta.env.BASE_URL}cutouts/${KOKI_SPRITE}.webp`
const PORTRAIT_QUERY = '(max-width: 700px) and (orientation: portrait)'

const MOVES: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
}
const MOVE_KEYS: Record<string, string> = {
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowLeft', KeyD: 'ArrowRight',
}
const ACTION_KEYS: Record<string, Action> = { KeyJ: 'slash', KeyK: 'heavy', Space: 'dodge' }
const ACTIONS = [
  { action: 'slash', label: '斬撃', key: 'J' },
  { action: 'heavy', label: '強撃', key: 'K' },
  { action: 'dodge', label: '回避', key: 'Space' },
] as const
type Stick = { pointer: number; center: Point; travel: number; vector: Point }
const SIGNALS: Record<Signal, string> = {
  slash: '斬撃が命中', heavy: '強撃が命中', miss: '間合いの外', dodge: '回避した', hurt: '攻撃を受けた', tired: 'スタミナ不足',
}
function formatTime(seconds: number) {
  const tenths = Math.round(seconds * 10)
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`
}

function HuntIcon({ hunt }: { hunt: Hunt }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawHuntIcon(ctx, hunt)
  }, [hunt])
  return <canvas ref={canvas} width={224} height={147} aria-hidden="true" />
}

function Meter({ label, value, max, kind }: { label: string; value: number; max: number; kind: string }) {
  const rounded = Math.ceil(value)
  return (
    <div className="koki-hunt-meter" data-kind={kind}>
      <span>{label} <b>{rounded}/{max}</b></span>
      <progress aria-label={label} max={max} value={rounded} />
    </div>
  )
}

function Arena({ hunt, onExit, onComplete }: { hunt: Hunt; onExit: () => void; onComplete: (battle: Battle) => void }) {
  const { t } = useI18n()
  const [initialField] = useState(() => window.matchMedia(PORTRAIT_QUERY).matches ? PORTRAIT_FIELD : FIELD)
  const [hud, setHud] = useState(() => createBattle(hunt, initialField))
  const [paused, setPaused] = useState(false)
  const isPaused = useRef(false)
  const battle = useRef(hud)
  const canvas = useRef<HTMLCanvasElement>(null)
  const keys = useRef(new Map<string, string>())
  const stick = useRef<Stick | null>(null)
  const stickZone = useRef<HTMLDivElement>(null)
  const completion = useRef(onComplete)

  useEffect(() => { completion.current = onComplete }, [onComplete])

  function movement(): Point {
    if (stick.current) return stick.current.vector
    const next = { x: 0, y: 0 }
    for (const key of new Set(keys.current.values())) {
      next.x += MOVES[key].x
      next.y += MOVES[key].y
    }
    return next
  }

  function useAction(action: Action) {
    if (isPaused.current || document.hidden) return
    battle.current = act(battle.current, action, movement())
  }

  function clearMovement() {
    keys.current.clear()
    const pointer = stick.current?.pointer
    stick.current = null
    const zone = stickZone.current
    if (!zone) return
    zone.style.removeProperty('--stick-x')
    zone.style.removeProperty('--stick-y')
    delete zone.dataset.active
    if (pointer !== undefined && zone.hasPointerCapture(pointer)) zone.releasePointerCapture(pointer)
  }

  function pause(next: boolean) {
    isPaused.current = next
    clearMovement()
    setPaused(next)
    if (!next) canvas.current?.focus({ preventScroll: true })
  }

  function moveStick(e: PointerEvent<HTMLDivElement>) {
    const active = stick.current
    if (!active || e.pointerId !== active.pointer) return
    const offset = { x: e.clientX - active.center.x, y: e.clientY - active.center.y }
    active.vector = joystickVector(offset, active.travel)
    e.currentTarget.style.setProperty('--stick-x', `${active.vector.x * active.travel}px`)
    e.currentTarget.style.setProperty('--stick-y', `${active.vector.y * active.travel}px`)
  }

  function grabStick(e: PointerEvent<HTMLDivElement>) {
    if (isPaused.current || stick.current || e.button !== 0) return
    e.preventDefault()
    const zone = e.currentTarget
    const rect = zone.getBoundingClientRect()
    stick.current = {
      pointer: e.pointerId,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      travel: rect.width * .27,
      vector: { x: 0, y: 0 },
    }
    zone.setPointerCapture(e.pointerId)
    zone.dataset.active = 'true'
    moveStick(e)
  }

  function releaseStick(e: PointerEvent<HTMLDivElement>) {
    if (stick.current?.pointer !== e.pointerId) return
    stick.current = null
    e.currentTarget.style.removeProperty('--stick-x')
    e.currentTarget.style.removeProperty('--stick-y')
    delete e.currentTarget.dataset.active
  }

  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const portrait = window.matchMedia(PORTRAIT_QUERY)
    let terrain = makeTerrain(hunt, battle.current.field)
    const image = new Image()
    image.src = SPRITE_URL
    element.focus({ preventScroll: true })

    let frame = 0
    let previous = 0
    let lastHud = 0
    let drawn: Battle | undefined
    let spriteReady = false
    function paint(now: number) {
      const dt = previous > 0 ? Math.min((now - previous) / 1000, .04) : 0
      previous = now
      if (!isPaused.current && !document.hidden) battle.current = tickBattle(battle.current, movement(), dt)
      const current = battle.current
      if (drawn !== current || spriteReady !== image.complete) {
        drawBattle(ctx!, terrain, current, image)
        drawn = current
        spriteReady = image.complete
      }
      if (current.result) {
        completion.current(current)
        return
      }
      if (!isPaused.current && now - lastHud >= 80) {
        lastHud = now
        setHud(current)
      }
      frame = requestAnimationFrame(paint)
    }
    const down = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const move = MOVE_KEYS[event.code]
      const action = ACTION_KEYS[event.code]
      if ((!move && !action) || isPaused.current) return
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      if (move) keys.current.set(event.code, move)
      if (action && !event.repeat) useAction(action)
    }
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code) }
    const onVisibility = () => {
      if (document.hidden) pause(true)
    }
    const onRotate = () => {
      const field = portrait.matches ? PORTRAIT_FIELD : FIELD
      battle.current = resizeBattlefield(battle.current, field)
      element.width = field.width
      element.height = field.height
      terrain = makeTerrain(hunt, field)
      setHud(battle.current)
      pause(true)
    }
    portrait.addEventListener('change', onRotate)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clearMovement)
    document.addEventListener('visibilitychange', onVisibility)
    frame = requestAnimationFrame(paint)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      portrait.removeEventListener('change', onRotate)
      window.removeEventListener('blur', clearMovement)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [hunt])

  const warning = hud.phase === 'windup' || hud.phase === 'strike'
  const opening = hud.phase === 'recover'
  const notice = paused ? '一時停止中' : warning ? '攻撃範囲から離れよう' : opening ? '反撃のチャンス' : hud.signal ? SIGNALS[hud.signal] : '間合いを詰めよう'

  return (
    <section className="koki-hunt-arena" data-hunt={hunt.id}>
      <div className="koki-hunt-arena-head">
        <div>
          <p className="koki-hunt-kicker">{t(hunt.place)}</p>
          <h1>{t(hunt.name)}</h1>
        </div>
        <div className="koki-hunt-arena-nav">
          <span className="koki-hunt-time">{formatTime(hud.elapsed)}</span>
          <button onClick={() => pause(!isPaused.current)}>{t(paused ? '再開' : '一時停止')}</button>
          <button onClick={onExit}>{t('クエスト一覧')}</button>
          <GameFullscreenButton className="koki-hunt-arena-fullscreen" />
        </div>
      </div>
      <div className="koki-hunt-meters">
        <Meter label="koki HP" value={hud.hp} max={100} kind="player" />
        <Meter label={t('スタミナ')} value={hud.stamina} max={100} kind="stamina" />
        <Meter label={`${t(hunt.name)} HP`} value={hud.monsterHp} max={hunt.hp} kind="monster" />
      </div>
      <div className="koki-hunt-board">
        <canvas className="koki-hunt-field" ref={canvas} width={initialField.width} height={initialField.height} tabIndex={0} aria-label={t('狩猟フィールド')} aria-describedby="koki-hunt-controls" />
        <div className="koki-hunt-controls" id="koki-hunt-controls">
          <p>{t('移動 WASD / 矢印キー')}</p>
          <div
            className="koki-hunt-stick"
            ref={stickZone}
            role="group"
            aria-label={t('移動')}
            aria-disabled={paused}
            onPointerDown={grabStick}
            onPointerMove={moveStick}
            onPointerUp={releaseStick}
            onPointerCancel={releaseStick}
            onLostPointerCapture={releaseStick}
          >
            <span className="koki-hunt-stick-knob" aria-hidden="true" />
          </div>
          <div className="koki-hunt-strikes">
            {ACTIONS.map(({ action, label, key }) => (
              <button key={action} type="button" className={`koki-hunt-${action}`} disabled={paused}
                onPointerDown={(event) => {
                  if (event.button === 0) useAction(action)
                }}
                onClick={(event) => {
                  // キーボード／支援技術のクリックだけ補完し、ポインターでは二重に発動させない。
                  if (event.detail === 0) useAction(action)
                }}
              >
                {t(label)} <kbd>{key}</kbd>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="koki-hunt-status" role="status" data-warning={!paused && warning} data-opening={!paused && opening}>{t(notice)}</div>
    </section>
  )
}

export default function KokiHuntGameView({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [hunt, setHunt] = useState<Hunt | null>(null)
  const [result, setResult] = useState<Battle | null>(null)
  const [records, setRecords] = useState(loadRecords)
  const [attempt, setAttempt] = useState(0)
  const resultHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (result) resultHeading.current?.focus({ preventScroll: true })
    scrollGameToTop()
  }, [hunt, result, attempt])

  function start(next: Hunt) {
    setHunt(next)
    setResult(null)
    setAttempt((current) => current + 1)
  }

  function finish(battle: Battle) {
    if (battle.result === 'won') setRecords(saveRecord(records, battle.hunt.id, battle.elapsed))
    setResult(battle)
  }

  return (
    <main className={hunt && !result ? 'koki-hunt koki-hunt--playing' : 'koki-hunt'}>
      <div className="koki-hunt-inner">
        <div className="game-nav koki-hunt-nav">
          <button className="game-back" onClick={onBack}>← {t('ゲーム選択にもどる')}</button>
          <GameFullscreenButton />
        </div>

        {!hunt && (
          <>
            <section className="koki-hunt-cover">
              <div>
                <p className="koki-hunt-kicker">{t('狩猟アクション')}</p>
                <h1>{t(HUNT_TITLE)}</h1>
                <p>{t('退勤後のkoki、ふたつの狩場へ。予兆を読んで回避し、獣が体勢を立て直す間に強撃を入れよう。')}</p>
              </div>
              <figure>
                <img src={SPRITE_URL} alt="" draggable={false} />
                <figcaption>koki</figcaption>
              </figure>
            </section>
            <section aria-labelledby="koki-hunt-quests" className="koki-hunt-quest-section">
              <h2 id="koki-hunt-quests">{t('クエスト一覧')}</h2>
              <div className="koki-hunt-quests">
                {HUNTS.map((quest) => {
                  const time = records[quest.id]
                  return (
                    <article key={quest.id} className="koki-hunt-quest" data-hunt={quest.id}>
                      <div className="koki-hunt-quest-art"><HuntIcon hunt={quest} /></div>
                      <div className="koki-hunt-quest-copy">
                        <p className="koki-hunt-kicker">{t(quest.place)}</p>
                        <h3>{t(quest.name)}</h3>
                        <p>{t(quest.telegraph)}</p>
                        <div className="koki-hunt-quest-actions">
                          <button className="koki-hunt-primary" onClick={() => start(quest)} aria-label={t('{name}の狩猟へ', { name: t(quest.name) })}>{t('狩猟へ')} <span aria-hidden="true">↗</span></button>
                          <small>{time ? t('最速 {time}', { time: formatTime(time) }) : t('未討伐')}</small>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {hunt && !result && <Arena key={attempt} hunt={hunt} onExit={() => setHunt(null)} onComplete={finish} />}

        {hunt && result && (
          <section className="koki-hunt-result" data-hunt={hunt.id}>
            <div className="koki-hunt-quest-art"><HuntIcon hunt={hunt} /></div>
            <div className="koki-hunt-result-copy">
              <p className="koki-hunt-kicker">{t(hunt.name)}</p>
              <h1 tabIndex={-1} ref={resultHeading}>{t(result.result === 'won' ? '討伐成功' : '力尽きた')}</h1>
              <p>{t(result.result === 'won' ? '討伐タイム {time}' : '経過時間 {time}', { time: formatTime(result.elapsed) })}</p>
              <p>{result.result === 'won' ? t('kokiの素材獲得：{material}', { material: t(hunt.id === 'cinder' ? '煤角の欠片' : '薄明の風切羽') }) : t(hunt.telegraph)}</p>
              <div className="koki-hunt-quest-actions">
                <button className="koki-hunt-primary" onClick={() => start(hunt)}>{t('再挑戦')}</button>
                <button className="koki-hunt-secondary" onClick={() => { setHunt(null); setResult(null) }}>{t('クエスト一覧')}</button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
