// Grand Theft Outfit [部品: outfit] ワードローブ（着替え画面）と、服を奪った瞬間のお知らせ。
// 入口: <GtoWardrobe engine spriteUrl touch />
// ・右上の服の値札の下に「着替え」のボタンを置く（キーボードは Q か Tab）。
// ・開いているあいだは街の時間を止める（engine.setPaused）。服を選んで決めると engine.wear で着替え、
//   閉じたあとに街の中で「くるりと回って替わる」演出が流れる（renderOutfitFx.ts）。
// ・服を奪って姿が替わった瞬間に、奪った服の値札を画面の右から出す。
// 並べ方と選ぶ位置の計算は lib/gto/outfit.ts の wardrobeModel / moveCursor。
// 撮影用: URL に wardrobe=<開く秒>[,<開いてから着替えるまでの秒>] を付けると自動で開いて着替える。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { moveCursor, outfitNotice, STEAL_BEAT, wardrobeModel, type OutfitNotice } from '../../lib/gto/outfit'
import type { OutfitState } from '../../lib/gto/types'
import { useI18n } from '../../lib/i18n'
import type { GtoEngine } from './engine'
import './gtoWardrobe.css'

type Props = { engine: GtoEngine; spriteUrl: (key: string) => string; touch: boolean }

/** お知らせを出しておく長さ（ミリ秒）と、消える動きの長さ */
const TOAST_MS = 2100
const TOAST_LEAVE_MS = 320
/** 撮影用の自動操作で、選ぶ位置を1つ進める間隔（ミリ秒） */
const AUTO_STEP_MS = 550

const HANGER_PATH =
  'M12 7.5V6Q12 4.6 13.3 4.3Q15 3.8 15 2.4Q15 0.8 12 0.8Q9.6 0.8 9.4 2.6M12 7.5L2 14.5Q0.8 15.5 1.4 16.8Q1.8 17.6 3 17.6H21Q22.2 17.6 22.6 16.8Q23.2 15.5 22 14.5Z'

const Hanger = () => (
  <svg viewBox="-1 -1 26 21" className="gtw-hanger" aria-hidden="true">
    <path d={HANGER_PATH} />
  </svg>
)

/** URL の wardrobe=<開く秒>[,<着替えるまでの秒>]（撮影用。無ければ null） */
function readAuto(): { openAt: number; wearAfter: number | null } | null {
  const query = new URLSearchParams(window.location.search)
  const hashQuery = window.location.hash.split('?')[1]
  if (hashQuery) new URLSearchParams(hashQuery).forEach((v, k) => query.set(k, v))
  const raw = query.get('wardrobe')
  if (raw == null) return null
  const [a, b] = raw.split(',').map(Number)
  if (!Number.isFinite(a)) return null
  return { openAt: a, wearAfter: Number.isFinite(b) ? b : null }
}

interface Toast extends OutfitNotice {
  leaving: boolean
}

export default function GtoWardrobe({ engine, spriteUrl, touch }: Props) {
  const { t } = useI18n()
  const [outfit, setOutfit] = useState<OutfitState | null>(null)
  const [onFoot, setOnFoot] = useState(true)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const auto = useMemo(readAuto, [])
  /** 自分で着替えた直後は、お知らせを出さない */
  const selfWear = useRef(false)
  const timers = useRef<number[]>([])
  const cursorRef = useRef(0)
  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current = [...timers.current, window.setTimeout(fn, ms)]
  }, [])
  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id)
    },
    [],
  )

  // ---- 状態を追う: 服が替わったらお知らせ、撮影用の自動オープン ----
  useEffect(() => {
    let last: OutfitState | null = null
    let foot = true
    let autoOpened = false
    return engine.subscribe(({ state }) => {
      const nowFoot = state.mode === 'foot' && !state.player.boarding
      if (nowFoot !== foot) {
        foot = nowFoot
        setOnFoot(nowFoot)
      }
      if (auto && !autoOpened && state.t >= auto.openAt) {
        autoOpened = true
        setOpen(true)
      }
      if (state.outfit === last) return
      const notice = last ? outfitNotice(last, state.outfit) : null
      last = state.outfit
      setOutfit(state.outfit)
      if (!notice) return
      if (selfWear.current || notice.kind !== 'steal') {
        selfWear.current = false
        return
      }
      // 服が飛んできて姿が替わる瞬間に合わせて出す
      later(() => {
        setToast({ ...notice, leaving: false })
        later(() => setToast((cur) => (cur && cur.at === notice.at ? { ...cur, leaving: true } : cur)), TOAST_MS)
        later(() => setToast((cur) => (cur && cur.at === notice.at ? null : cur)), TOAST_MS + TOAST_LEAVE_MS)
      }, STEAL_BEAT.land * 1000)
    })
  }, [engine, auto, later])

  // ---- 開閉: 開いているあいだは街の時間を止める ----
  useEffect(() => {
    engine.setPaused(open)
    return () => engine.setPaused(false)
  }, [engine, open])

  const model = useMemo(() => (outfit ? wardrobeModel(outfit, cursor) : null), [outfit, cursor])

  const openWardrobe = useCallback(() => {
    if (!outfit) return
    // 開いたときは、いま着ている服を選んでおく
    setCursor(Math.max(0, outfit.wardrobe.indexOf(outfit.wearing)))
    setOpen(true)
  }, [outfit])

  const wear = useCallback(
    (key: string) => {
      if (!outfit || key === outfit.wearing || !outfit.wardrobe.includes(key)) return
      selfWear.current = true
      engine.wear(key)
      setOpen(false)
    },
    [engine, outfit],
  )

  const columns = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return 1
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
  }, [])

  // ---- キーボード ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (!open) {
        if ((e.code === 'KeyQ' || e.code === 'Tab') && onFoot && outfit) {
          e.preventDefault()
          e.stopImmediatePropagation()
          openWardrobe()
        }
        return
      }
      // 開いているあいだのキーは、街の操作へ渡さない
      e.stopImmediatePropagation()
      const count = outfit?.wardrobe.length ?? 0
      const move = (dx: number, dy: number) => {
        e.preventDefault()
        setCursor((c) => moveCursor(c, dx, dy, count, columns()))
      }
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          return move(-1, 0)
        case 'ArrowRight':
        case 'KeyD':
          return move(1, 0)
        case 'ArrowUp':
        case 'KeyW':
          return move(0, -1)
        case 'ArrowDown':
        case 'KeyS':
          return move(0, 1)
        case 'Enter':
        case 'Space':
        case 'KeyE':
          e.preventDefault()
          if (model?.canWear) wear(model.selected)
          return
        case 'Escape':
        case 'KeyQ':
        case 'Tab':
          e.preventDefault()
          setOpen(false)
          return
        default:
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onFoot, outfit, model, openWardrobe, wear, columns])

  // ---- 撮影用: 開いたら選ぶ位置を順に送り、決めた秒で着替える ----
  useEffect(() => {
    if (!open || !auto || auto.wearAfter == null || !outfit) return
    const count = outfit.wardrobe.length
    const started = performance.now()
    const wearAt = auto.wearAfter * 1000
    const tick = window.setInterval(() => {
      const c = cursorRef.current
      if (performance.now() - started >= wearAt) {
        window.clearInterval(tick)
        wear(outfit.wardrobe[c] === outfit.wearing ? outfit.wardrobe[(c + 1) % count] : outfit.wardrobe[c])
        return
      }
      setCursor((c + 1) % count)
    }, AUTO_STEP_MS)
    return () => window.clearInterval(tick)
    // 開いた1回だけ仕掛ける（服の一覧は開いているあいだ変わらない）
  }, [open, auto])

  // 選んでいる服が見える所まで、一覧を送る
  useEffect(() => {
    if (!open) return
    gridRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [open, cursor])

  if (!outfit || !model) return null
  const rootClass = `gtw${touch ? ' is-touch' : ''}`
  return (
    <div className={rootClass}>
      {!open && onFoot && (
        <button type="button" className="gtw-open jp" onClick={openWardrobe} aria-label={t('ワードローブを開く')}>
          {!touch && <kbd className="mono">Q</kbd>}
          {t('着替え')}
        </button>
      )}

      {toast && !open && (
        <div className={`gtw-toast${toast.leaving ? ' is-leaving' : ''}`} key={toast.at} role="status">
          <span className="gtw-toast-burst" aria-hidden="true" />
          <div className="gtw-toast-tag">
            <img src={spriteUrl(toast.key)} alt="" draggable={false} />
          </div>
          <div className="gtw-toast-text">
            <b className="jp">{t('いただき！')}</b>
            <span className="mono">
              {toast.isNew && <i>NEW</i>}
              {t('手持ち {count}', { count: toast.count })}
            </span>
          </div>
        </div>
      )}

      {open && (
        <div className="gtw-screen" role="dialog" aria-modal="true" aria-label={t('ワードローブ')}>
          <header className="gtw-head">
            <small className="mono">WARDROBE</small>
            <h2 className="jp">{t('ワードローブ')}</h2>
            <span className="mono gtw-count">
              {model.count}
              <i> / {model.max}</i>
            </span>
            <button type="button" className="gtw-close jp" onClick={() => setOpen(false)}>
              {!touch && <kbd className="mono">Q</kbd>}
              {t('とじる')}
            </button>
          </header>

          <div className="gtw-body">
            <div className="gtw-preview">
              <div className="gtw-preview-tag" key={model.selected}>
                <img src={spriteUrl(model.selected)} alt="" draggable={false} />
              </div>
              <button type="button" className="gtw-wear jp" disabled={!model.canWear} onClick={() => wear(model.selected)}>
                {model.canWear ? (
                  <>
                    {!touch && <kbd className="mono">Enter</kbd>}
                    {t('これを着る')}
                  </>
                ) : (
                  t('着用中')
                )}
              </button>
            </div>

            <div className="gtw-rail">
              <div className="gtw-grid" ref={gridRef}>
                {model.items.map((item, i) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`gtw-item${item.selected ? ' is-selected' : ''}${item.wearing ? ' is-wearing' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}
                    aria-pressed={item.selected}
                    onClick={() => (item.selected && !item.wearing ? wear(item.key) : setCursor(i))}
                  >
                    <Hanger />
                    <img src={spriteUrl(item.key)} alt="" draggable={false} loading="lazy" />
                    {item.wearing && <em className="jp">{t('着用中')}</em>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
