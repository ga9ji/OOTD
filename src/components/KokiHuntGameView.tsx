import { useEffect, useRef, useState, type PointerEvent } from 'react'
import GameFullscreenButton from './GameFullscreenButton'
import { scrollGameToTop } from '../lib/gameFullscreen'
import { useI18n } from '../lib/i18n'
import {
  act, createBattle, FIELD, HUNTS, HUNT_TITLE, loadRecords, saveRecord, tickBattle,
  type Action, type Battle, type Hunt, type Point, type Signal,
} from '../lib/kokiHunt'
import { drawBattle, drawHuntIcon, KOKI_SPRITE, makeTerrain } from './kokiHuntArt'
import './kokiHunt.css'

const SPRITE_URL = `${import.meta.env.BASE_URL}cutouts/${KOKI_SPRITE}.webp`

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
const TOUCH_MOVES = [
  { key: 'ArrowUp', icon: '↑', label: '上へ移動' },
  { key: 'ArrowLeft', icon: '←', label: '左へ移動' },
  { key: 'ArrowDown', icon: '↓', label: '下へ移動' },
  { key: 'ArrowRight', icon: '→', label: '右へ移動' },
] as const
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
  const [hud, setHud] = useState(() => createBattle(hunt))
  const [paused, setPaused] = useState(false)
  const isPaused = useRef(false)
  const battle = useRef(hud)
  const canvas = useRef<HTMLCanvasElement>(null)
  const keys = useRef(new Map<string | number, string>())
  const completion = useRef(onComplete)

  useEffect(() => { completion.current = onComplete }, [onComplete])

  function movement(): Point {
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

  function togglePause() {
    isPaused.current = !isPaused.current
    keys.current.clear()
    setPaused(isPaused.current)
    if (!isPaused.current) canvas.current?.focus({ preventScroll: true })
  }

  function pressDirection(e: PointerEvent<HTMLButtonElement>, key: string) {
    if (isPaused.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    keys.current.set(e.pointerId, key)
  }

  function releaseDirection(e: PointerEvent<HTMLButtonElement>) {
    keys.current.delete(e.pointerId)
  }

  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const terrain = makeTerrain(hunt)
    const image = new Image()
    image.src = SPRITE_URL
    element.focus({ preventScroll: true })

    let frame = 0
    let previous = 0
    let lastHud = 0
    function paint(now: number) {
      const dt = previous > 0 ? Math.min((now - previous) / 1000, .04) : 0
      previous = now
      if (!isPaused.current && !document.hidden) battle.current = tickBattle(battle.current, movement(), dt)
      const current = battle.current
      drawBattle(ctx!, terrain, current, image)
      if (current.result) {
        completion.current(current)
        return
      }
      if (now - lastHud >= 80) {
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
    const clear = () => { keys.current.clear() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    frame = requestAnimationFrame(paint)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
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
          <button onClick={togglePause}>{t(paused ? '再開' : '一時停止')}</button>
          <button onClick={onExit}>{t('クエスト一覧')}</button>
        </div>
      </div>
      <div className="koki-hunt-meters">
        <Meter label="koki HP" value={hud.hp} max={100} kind="player" />
        <Meter label={t('スタミナ')} value={hud.stamina} max={100} kind="stamina" />
        <Meter label={`${t(hunt.name)} HP`} value={hud.monsterHp} max={hunt.hp} kind="monster" />
      </div>
      <canvas className="koki-hunt-field" ref={canvas} width={FIELD.width} height={FIELD.height} tabIndex={0} aria-label={t('狩猟フィールド')} aria-describedby="koki-hunt-controls" />
      <div className="koki-hunt-status" role="status" data-warning={warning} data-opening={opening}>{t(notice)}</div>
      <div className="koki-hunt-controls" id="koki-hunt-controls">
        <p>{t('移動 WASD / 矢印キー')}</p>
        <div className="koki-hunt-dpad">
          {TOUCH_MOVES.map((move) => (
            <button key={move.key} type="button" aria-label={t(move.label)} data-direction={move.key}
              disabled={paused}
              onPointerDown={(e) => pressDirection(e, move.key)}
              onPointerUp={releaseDirection}
              onPointerCancel={releaseDirection}
              onLostPointerCapture={releaseDirection}
            >{move.icon}</button>
          ))}
        </div>
        <div className="koki-hunt-strikes">
          {ACTIONS.map(({ action, label, key }) => (
            <button key={action} type="button" className={`koki-hunt-${action}`} disabled={paused} onClick={() => useAction(action)}>
              {t(label)} <kbd>{key}</kbd>
            </button>
          ))}
        </div>
      </div>
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
    <main className="koki-hunt">
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
