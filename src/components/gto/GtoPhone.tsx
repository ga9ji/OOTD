// Grand Theft Outfit [部品: cheats] 主人公のスマホ。番号を打って発信すると、裏コードが効く（lib/gto/cheats.ts）。
// 開き方: パソコンは P キーか右上の「スマホ」、スマホはミニマップの右下の隅の丸いボタン。どちらも、メニューの「スマホ」からも開く（PHONE_EVENT）。
// 開いているあいだは街の時間を止める（着替え画面と同じ）。通じたら一言を出して自分で閉じ、次の 1 歩で効く。
// 画面: 打った番号・メモ（番号と効き目の一覧。押すとその番号へ発信する）・テンキー。背の低い横長の画面では左右 2 列に分ける。
// [areas] ほかのエリアへの移動（のりかえ）はスマホではなく、メニューに置く（GtoMenuTravel）。
// キー: 数字で打つ、Backspace で 1 つ消す、Enter で発信、Esc か P で閉じる。開いているあいだのキーは街の操作へ渡さない。
// 見た目はこのゲームの配色（藍・生成り・橙）の架空の端末で、実在の機種や、ほかの作品の画面は写していない。
import { useCallback, useEffect, useRef, useState } from 'react'
import { CHEATS, dialPush, DIAL_MAX, findCheat } from '../../lib/gto/cheats'
import { useI18n } from '../../lib/i18n'
import type { GtoEngine } from './engine'
import './gtoPhone.css'

type Props = { engine: GtoEngine; touch: boolean }

/** スマホを開け閉めするキーと、メニューから開くときに舞台へ送る合図の名前 */
const PHONE_KEY = 'KeyP'
export const PHONE_EVENT = 'gto-phone'
/** 通じたあと閉じるまで・通じなかった一言を出しておく ms */
const DONE_MS = 750
const MISS_MS = 1300
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
/** 撮影用: ?gtoPhone=1 で開いた状態から始める */
const openAtStart = () => new URLSearchParams(window.location.search).get('gtoPhone') === '1'

interface Result {
  ok: boolean
  text: string
}

export default function GtoPhone({ engine, touch }: Props) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(openAtStart)
  const [digits, setDigits] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  const digitsRef = useRef('')
  useEffect(() => {
    digitsRef.current = digits
  }, [digits])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const close = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
    setDigits('')
    setResult(null)
  }, [])

  // 開いているあいだは街の時間を止める
  useEffect(() => {
    if (!open) return
    engine.setPaused(true)
    return () => engine.setPaused(false)
  }, [engine, open])

  // メニューの「スマホ」から開く
  useEffect(() => {
    const stage = rootRef.current?.parentElement
    if (!stage) return
    const onOpen = () => setOpen(true)
    stage.addEventListener(PHONE_EVENT, onOpen)
    return () => stage.removeEventListener(PHONE_EVENT, onOpen)
  }, [])

  /** 発信する。通じたら裏コードを渡して閉じ、通じなければ一言を出して打ち直しにする */
  const call = useCallback(
    (number: string) => {
      if (number === '') return
      window.clearTimeout(timer.current)
      const cheat = findCheat(number)
      setDigits(number)
      if (cheat) {
        engine.cheat(cheat.id)
        setResult({ ok: true, text: cheat.label })
        timer.current = window.setTimeout(close, DONE_MS)
        return
      }
      setResult({ ok: false, text: 'この番号は使われていません' })
      timer.current = window.setTimeout(() => {
        setDigits('')
        setResult(null)
      }, MISS_MS)
    },
    [engine, close],
  )

  const push = useCallback((key: string) => {
    setResult((cur) => (cur && !cur.ok ? null : cur))
    setDigits((cur) => dialPush(cur, key))
  }, [])
  const erase = useCallback(() => {
    setResult((cur) => (cur && !cur.ok ? null : cur))
    setDigits((cur) => cur.slice(0, -1))
  }, [])

  // ---- キーボード ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (!open) {
        // 着替え画面が開いているあいだは開かない
        if (e.code === PHONE_KEY && !e.repeat && !document.querySelector('.gtw-screen')) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }
        return
      }
      // 開いているあいだのキーは、街の操作へ渡さない
      e.stopPropagation()
      if (result?.ok) return
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1]
      if (digit) {
        e.preventDefault()
        push(digit)
      } else if (e.code === 'Backspace') {
        e.preventDefault()
        erase()
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault()
        call(digitsRef.current)
      } else if (e.code === 'Escape' || e.code === PHONE_KEY) {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, result, push, erase, call, close])

  const busy = result?.ok === true
  return (
    <div className={touch ? 'gtp is-touch' : 'gtp'} ref={rootRef}>
      {!open && (
        <button type="button" className="gtp-open jp" onClick={() => setOpen(true)} aria-label={t('スマホを開く')}>
          {touch ? (
            // スマホ: ミニマップの右下の隅に、端末の絵だけの丸いボタン
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" d="M8 2 H16 Q18 2 18 4 V20 Q18 22 16 22 H8 Q6 22 6 20 V4 Q6 2 8 2 Z M8 5 V17.5 H16 V5 Z M10.6 19 V20.4 H13.4 V19 Z" />
            </svg>
          ) : (
            <>
              <kbd className="mono">P</kbd>
              {t('スマホ')}
            </>
          )}
        </button>
      )}

      {open && (
        <div className="gtp-screen" role="dialog" aria-modal="true" aria-label={t('スマホ')}>
          <button type="button" className="gtp-veil" aria-label={t('とじる')} onClick={close} />
          <div className="gtp-phone jp">
            <header className="gtp-head">
              <small className="mono">URA CODE</small>
              <h2>{t('裏コード')}</h2>
              <button type="button" className="gtp-close" onClick={close}>
                {!touch && <kbd className="mono">Esc</kbd>}
                {t('とじる')}
              </button>
            </header>

            <div className="gtp-side">
              <output className={`gtp-display mono${digits ? '' : ' is-empty'}`} aria-live="polite">
                {digits || t('番号を打つ')}
              </output>
              <p className={`gtp-result${result ? (result.ok ? ' is-ok' : ' is-miss') : ''}`} role="status">
                {result ? (result.ok ? `${t('つながりました')}: ${t(result.text)}` : t(result.text)) : ' '}
              </p>
              <ul className="gtp-memo" aria-label={t('メモ')}>
                {CHEATS.map((c) => (
                  <li key={c.id}>
                    <button type="button" disabled={busy} onClick={() => call(c.code)}>
                      <b className="mono">{c.code}</b>
                      <span>
                        {t(c.label)}
                        {locale === 'ja' && <small>{c.reading}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="gtp-keys mono">
              {KEYS.map((k) => (
                <button type="button" key={k} disabled={busy || digits.length >= DIAL_MAX} onClick={() => push(k)}>
                  {k}
                </button>
              ))}
              <button type="button" className="is-erase jp" disabled={busy || digits === ''} onClick={erase} aria-label={t('ひと文字消す')}>
                <svg viewBox="0 0 28 20" aria-hidden="true">
                  <path d="M9 1.5 H25 Q26.5 1.5 26.5 3 V17 Q26.5 18.5 25 18.5 H9 L1.5 10 Z M13 6.5 L20 13.5 M20 6.5 L13 13.5" />
                </svg>
              </button>
              <button type="button" disabled={busy || digits.length >= DIAL_MAX} onClick={() => push('0')}>
                0
              </button>
              <button type="button" className="is-call jp" disabled={busy || digits === ''} onClick={() => call(digits)}>
                {t('発信')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
