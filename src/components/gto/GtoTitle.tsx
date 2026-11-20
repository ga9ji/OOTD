// Grand Theft Outfit: 題名の画面とロゴ。
// ロゴは既存作品のロゴに似せない。書体は市販のフォントを使わず、このファイルで定義した
// 一筆書きの字形（4×6 の格子に描いた線）を、織りネーム（服のタグ）のように刺繍風に重ねる。
// 配色は生成り・藍・橙。
import { useState } from 'react'
import { yen } from '../../lib/gto/hud'
import type { SaveSummary } from '../../lib/gto/save'
import { useI18n } from '../../lib/i18n'

/** 一筆書きの字形。幅 4・高さ 6 の格子（I だけ幅 1） */
const GLYPHS: Record<string, { d: string; w: number }> = {
  G: { d: 'M4 1.3Q4 0 2.5 0H1.6Q0 0 0 1.6V4.4Q0 6 1.6 6H2.4Q4 6 4 4.4V3.2H2.2', w: 4 },
  R: { d: 'M0 6V0H2.6Q4 0 4 1.5Q4 3 2.6 3H0M2.2 3L4 6', w: 4 },
  A: { d: 'M0 6L2 0L4 6M0.8 4.1H3.2', w: 4 },
  N: { d: 'M0 6V0L4 6V0', w: 4 },
  D: { d: 'M0 0V6H2Q4 6 4 4V2Q4 0 2 0Z', w: 4 },
  T: { d: 'M0 0H4M2 0V6', w: 4 },
  H: { d: 'M0 0V6M4 0V6M0 3H4', w: 4 },
  E: { d: 'M4 0H0V6H4M0 3H3', w: 4 },
  F: { d: 'M4 0H0V6M0 3H3', w: 4 },
  O: { d: 'M1.6 0H2.4Q4 0 4 1.6V4.4Q4 6 2.4 6H1.6Q0 6 0 4.4V1.6Q0 0 1.6 0Z', w: 4 },
  U: { d: 'M0 0V4.4Q0 6 1.6 6H2.4Q4 6 4 4.4V0', w: 4 },
  I: { d: 'M0.5 0V6', w: 1 },
}

const INK = '#1c2748'
const CLOTH = '#f1e7d0'
const THREAD = '#ff6a2b'

/** 1行ぶんの文字を並べる。size は格子1目の大きさ */
function Word({ text, x, y, size, gap }: { text: string; x: number; y: number; size: number; gap: number }) {
  let cursor = 0
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      {[...text].map((ch, i) => {
        const glyph = GLYPHS[ch]
        const at = cursor
        cursor += (glyph?.w ?? 2) + gap
        if (!glyph) return null
        return (
          <g key={i} transform={`translate(${at} 0)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={glyph.d} stroke={INK} strokeWidth={1.25} />
            {/* 太い線の上に、刺繍の縫い目を重ねる */}
            <path d={glyph.d} stroke={CLOTH} strokeWidth={0.16} strokeDasharray="0.42 0.34" />
          </g>
        )
      })}
    </g>
  )
}

export function GtoLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 200" role="img" aria-label="Grand Theft Outfit">
      {/* 織りネームの布 */}
      <rect x="6" y="14" width="348" height="180" rx="10" fill={CLOTH} />
      <rect x="15" y="23" width="330" height="162" rx="5" fill="none" stroke={THREAD} strokeWidth="2.2" strokeDasharray="7 5" />
      {/* タグを吊るす穴とハンガーの鉤 */}
      <circle cx="180" cy="14" r="6.5" fill="#12172b" />
      <path d="M180 14V6Q180 0 187 0Q194 0 194 6" fill="none" stroke={THREAD} strokeWidth="3" strokeLinecap="round" />
      <Word text="GRAND" x={45} y={48} size={4.9} gap={1.3} />
      <Word text="THEFT" x={192} y={48} size={4.9} gap={1.3} />
      <rect x="44" y="94" width="272" height="3" fill={THREAD} />
      <Word text="OUTFIT" x={45} y={110} size={10.6} gap={1.3} />
    </svg>
  )
}

type Props = {
  /** 始める（前回の進行があれば、その続きから） */
  onStart: () => void
  /** 前回の進行を消して、最初から始める */
  onRestart: () => void
  /** 前回の進行のあらまし。無ければ null（「はじめる」だけを出す） */
  resumed: SaveSummary | null
  attribution: string
  touch: boolean
}

export default function GtoTitle({ onStart, onRestart, resumed, attribution, touch }: Props) {
  const { t } = useI18n()
  // 「はじめから」は進行を消すので、もう一度たしかめてから始める
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="gto-title">
      <GtoLogo className="gto-logo" />
      <p className="gto-title-lead jp">{t('渋谷を歩き、車を借り、服をいただく。')}</p>
      {!resumed ? (
        <button type="button" className="gto-start jp" onClick={onStart}>
          {t('はじめる')}
        </button>
      ) : confirming ? (
        <div className="gto-restart jp" role="group" aria-label={t('はじめから')}>
          <p>{t('いまの進行を消して、最初からはじめますか？')}</p>
          <div className="gto-restart-row">
            <button type="button" className="gto-start is-sub jp" onClick={onRestart}>
              {t('消してはじめる')}
            </button>
            <button type="button" className="gto-start is-sub jp" onClick={() => setConfirming(false)} autoFocus>
              {t('やめる')}
            </button>
          </div>
        </div>
      ) : (
        <div className="gto-resume jp">
          <div className="gto-restart-row">
            <button type="button" className="gto-start jp" onClick={onStart}>
              {t('つづきから')}
            </button>
            <button type="button" className="gto-start is-sub jp" onClick={() => setConfirming(true)}>
              {t('はじめから')}
            </button>
          </div>
          {/* 前回の進行: 所持金・手持ちの服・達成した依頼 */}
          <p className="gto-resume-note">
            <span className="mono">{yen(resumed.cash)}</span>
            <span>{t('服 {count}着', { count: resumed.outfits })}</span>
            <span>{t('依頼 {done}/{total}', { done: resumed.missions, total: resumed.missionTotal })}</span>
          </p>
        </div>
      )}
      <ul className="gto-help jp">
        {touch ? (
          <>
            <li>{t('左のスティックで移動・運転、画面のドラッグで見回す')}</li>
            <li>{t('右のボタンで 乗る／降りる・服をいただく・走る')}</li>
          </>
        ) : (
          <>
            <li>{t('WASD / 矢印キーで移動・運転、ドラッグで見回す')}</li>
            <li>{t('F 乗る／降りる　E 服をいただく　Shift 走る　Space サイドブレーキ')}</li>
          </>
        )}
        <li>{t('所持金・服・依頼の進み具合は、この端末に自動で保存されます')}</li>
      </ul>
      <p className="gto-credit">{attribution}</p>
    </div>
  )
}
