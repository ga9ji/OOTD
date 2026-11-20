// Grand Theft Outfit [部品: hud-minimap] HUD。lib/gto/hud.ts の HudModel を並べるだけ。
// 配置: 常時出すのは画面の隅の3か所だけ。左下（スマホは左上）は丸いミニマップだけ。
//       右上に「時計・所持金・手配度」と着ている服の値札。
//       右下（スマホはミニマップの下）に、走りの計器を1枚にまとめる: 速度、その下に 向かう先までの距離 と 通りの名前。
//       台詞と目的は、要るときだけ下の中央に1枚の札で出る。画面の中央と主人公のまわりには常時表示を置かない。
//       「もどる・音・全画面」の列と出典は遊んでいるあいだ隠し、M キーかミニマップを押すと出る（GtoGameView の .gto-chrome を見せるだけ）。
// 手配度は星ではなくハンガーの数で見せる（服のゲームなので）。
import { useEffect, useRef, useState } from 'react'
import { hudModel, splitAccent, type HudModel, type HudTarget } from '../../lib/gto/hud'
import { CLOCK_TEXT } from '../../lib/gto/lighting'
import { missionCueModel, missionGauge } from '../../lib/gto/missions'
import type { TimeOfDay } from '../../lib/gto/types'
import { useI18n } from '../../lib/i18n'
import type { GtoEngine } from './engine'
import './gtoHud.css'

type Props = { engine: GtoEngine; time: TimeOfDay; spriteUrl: (key: string) => string; touch: boolean }

/** 文字の更新は毎フレームでなくてよい（6フレームに1回） */
const HUD_EVERY = 6
const WANTED_MAX = 5
/** メニュー（もどる・音・全画面・出典）を開け閉めするキーと、ミニマップから送る合図の名前 */
const MENU_KEY = 'KeyM'
export const MENU_EVENT = 'gto-menu'
/** 撮影用: ?gtoMenu=1 でメニューを開いた状態から始める */
const menuAtStart = () => new URLSearchParams(window.location.search).get('gtoMenu') === '1'
const HANGER_PATH =
  'M12 7.5V6Q12 4.6 13.3 4.3Q15 3.8 15 2.4Q15 0.8 12 0.8Q9.6 0.8 9.4 2.6M12 7.5L2 14.5Q0.8 15.5 1.4 16.8Q1.8 17.6 3 17.6H21Q22.2 17.6 22.6 16.8Q23.2 15.5 22 14.5Z'

const Hanger = ({ on }: { on: boolean }) => (
  <svg viewBox="-1 -1 26 21" className={on ? 'gto-hanger on' : 'gto-hanger'} aria-hidden="true">
    <path className="gto-hanger-edge" d={HANGER_PATH} />
    <path className="gto-hanger-line" d={HANGER_PATH} />
  </svg>
)

/** 向かう先への矢印と距離（矢印はカメラの向きから見た向きへ回る） */
const Target = ({ target }: { target: HudTarget }) => (
  <span className={`gto-target mono is-${target.kind}`}>
    <svg viewBox="0 0 16 16" style={{ transform: `rotate(${target.turn}rad)` }} aria-hidden="true">
      <path d="M8 1.5L13.5 13.5L8 10.6L2.5 13.5Z" />
    </svg>
    {target.dist}
  </span>
)

export default function GtoHud({ engine, time, spriteUrl, touch }: Props) {
  const { t, locale } = useI18n()
  const [hud, setHud] = useState<HudModel | null>(null)
  const [menu, setMenu] = useState(menuAtStart)
  const rootRef = useRef<HTMLDivElement>(null)

  // メニューの開け閉め。開いているあいだだけ、舞台に data-gto-menu を付けて上の操作列と出典を見せる
  useEffect(() => {
    const stage = rootRef.current?.parentElement
    if (!stage) return
    const toggle = () => setMenu((open) => !open)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === MENU_KEY && !e.repeat && !e.metaKey && !e.ctrlKey) toggle()
    }
    stage.addEventListener(MENU_EVENT, toggle)
    window.addEventListener('keydown', onKey)
    return () => {
      stage.removeEventListener(MENU_EVENT, toggle)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  useEffect(() => {
    const stage = rootRef.current?.parentElement
    if (!stage) return
    stage.dataset.gtoHud = menu ? 'menu' : 'play'
    return () => {
      delete stage.dataset.gtoHud
    }
  }, [menu])

  useEffect(() => {
    let last = ''
    let count = 0
    return engine.subscribe(({ state, view }) => {
      if (count++ % HUD_EVERY !== 0) return
      const next = hudModel(state, engine.world, {
        ...view,
        clock: CLOCK_TEXT[time],
        cue: missionCueModel(state.mission, state.t),
        gauge: missionGauge(state.mission),
      })
      const key = JSON.stringify(next)
      if (key === last) return
      last = key
      setHud(next)
    })
  }, [engine, time])

  if (!hud) return <div className="gto-hud" ref={rootRef} />
  const street = locale === 'ja' ? hud.street : hud.streetEn || hud.street
  const speed = hud.speedKmh != null && (
    <span className="gto-speed mono">
      {hud.speedKmh}
      <small>km/h</small>
    </span>
  )
  // 演出: 導入と手順の切り替わりは台詞、達成と失敗は結果の札
  const talk = hud.cue && hud.cue.line ? hud.cue : null
  const result = hud.cue && (hud.cue.kind === 'passed' || hud.cue.kind === 'failed') ? hud.cue : null
  const [before, accent, after] = splitAccent(t(hud.objective), hud.cue ? t(hud.cue.accent) : '')
  const wantedClass = `gto-wanted${hud.wanted > 0 ? ' is-hot' : ''}${hud.cooling ? ' is-cooling' : ''}`
  return (
    <div className={touch ? 'gto-hud is-touch' : 'gto-hud'} ref={rootRef}>
      {menu && <button type="button" className="gto-menu-veil" aria-label={t('閉じる')} onClick={() => setMenu(false)} />}
      <div className="gto-hud-status">
        <div className="gto-status-lines">
          <span className="gto-clock mono">{hud.clock}</span>
          <span className="gto-cash mono">{hud.cash}</span>
          <span className={wantedClass} role="img" aria-label={t('手配度 {level}', { level: hud.wanted })}>
            {Array.from({ length: WANTED_MAX }, (_, i) => (
              <Hanger key={i} on={hud.wanted > i} />
            ))}
          </span>
        </div>
        {hud.outfitKey && (
          <div className="gto-hud-outfit" key={hud.outfitKey}>
            <img src={spriteUrl(hud.outfitKey)} alt="" draggable={false} />
            <span className="mono">×{hud.wardrobeCount}</span>
          </div>
        )}
      </div>

      <div className="gto-hud-place">
        {!touch && hud.prompts.length > 0 && (
          <div className="gto-prompts jp">
            {hud.prompts.map((p) => (
              <span key={p.key}>
                <kbd className="mono">{p.key}</kbd>
                {t(p.label)}
              </span>
            ))}
          </div>
        )}
        {speed}
        {hud.altitude != null && (
          <span className="gto-altitude mono">
            {t('高度')} {hud.altitude}
            <small>m</small>
          </span>
        )}
        {(street || hud.target) && (
          <div className="gto-place-row">
            {hud.target && <Target target={hud.target} />}
            {street && (
              <span className="gto-street jp" key={street}>
                {street}
              </span>
            )}
          </div>
        )}
      </div>

      {hud.banner && (
        <p className="gto-banner jp" key={hud.banner}>
          {t(hud.banner)}
        </p>
      )}

      {result && (
        <div className={`gto-result jp is-${result.kind}${result.leaving ? ' is-leaving' : ''}`}>
          <small>{t(result.title)}</small>
          <b>{t(result.kind === 'passed' ? '達成' : '失敗')}</b>
          <span className={result.kind === 'passed' ? 'mono' : undefined}>{result.kind === 'passed' ? result.result : t(result.result)}</span>
          {result.extra && <em className="mono">{result.extra}</em>}
        </div>
      )}

      {(talk || hud.missionTitle) && (
        <div className="gto-hud-brief jp">
          <div className="gto-brief-card">
            {talk && (
              <p className={talk.leaving ? 'gto-talk is-leaving' : 'gto-talk'} key={talk.line}>
                <b>{t(talk.speaker)}</b>
                {t(talk.line)}
              </p>
            )}
            {hud.missionTitle && (
              <div className="gto-hud-mission" key={hud.objective}>
                <div className="gto-objective">
                  <b>{t(hud.missionTitle)}</b>
                  <span>
                    {before}
                    {accent && <mark>{accent}</mark>}
                    {after}
                  </span>
                  {hud.gauge && (
                    <span className={`gto-gauge is-${hud.gauge.kind}`}>
                      {t(hud.gauge.label)}
                      <i>
                        <u style={{ width: `${hud.gauge.value * 100}%` }} />
                      </i>
                      {hud.gauge.text && <span className="mono">{hud.gauge.text}</span>}
                      {hud.gauge.hint && <strong>{t(hud.gauge.hint)}</strong>}
                    </span>
                  )}
                </div>
                {hud.timeLeft && <span className={hud.hurry ? 'mono gto-timer is-hurry' : 'mono gto-timer'}>{hud.timeLeft}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {hud.bust > 0 && (
        <div className="gto-bust jp">
          {t('捕まる…')}
          <i>
            <b style={{ width: `${hud.bust * 100}%` }} />
          </i>
        </div>
      )}
    </div>
  )
}
