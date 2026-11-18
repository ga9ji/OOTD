import { useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import { createGtoAudio } from '../lib/gto/gtoAudio'
import { loadWorld } from '../lib/gto/map'
import { pickQuality } from '../lib/gto/quality'
import { parseLaunch } from '../lib/gto/shot'
import { useI18n } from '../lib/i18n'
import type { CutoutsFile } from '../lib/platform'
import GameFullscreenButton from './GameFullscreenButton'
import GtoHud from './gto/GtoHud'
import GtoMinimap from './gto/GtoMinimap'
import GtoTitle from './gto/GtoTitle'
import GtoTouchControls from './gto/GtoTouchControls'
import GtoWardrobe from './gto/GtoWardrobe'
import { createGtoEngine, type GtoEngine } from './gto/engine'
import './gto/gto.css'
import './gto/gtoWanted.css' // [wanted] 手配の印の大きさと色（gto.css のあとに読む）

// Grand Theft Outfit: 渋谷を舞台にした背後視点のオープンワールド。
// ルールと世界は lib/gto/（部品ごとに1ファイル）、3D の描画は components/gto/render*.ts、
// ここは画面の組み立て（題名 → 遊ぶ）と、HUD・ミニマップ・タッチ操作の配置だけを扱う。
// URL のクエリ（?gtoShot= &time= &quality= &hud= &seed= &mode= &demo=）で撮影用の状態を作れる（lib/gto/shot.ts）。

const cutouts = cutoutsJson as CutoutsFile
const outfitKeys = Object.keys(cutouts.sprites)
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`
const spriteAspect = (key: string) => {
  const s = cutouts.sprites[key]
  return s ? s.w / s.h : 0.4
}

/** クエリは ?a=b#/gto と #/gto?a=b のどちらに付いていても読む */
function readQuery(): URLSearchParams {
  const query = new URLSearchParams(window.location.search)
  const hashQuery = window.location.hash.split('?')[1]
  if (hashQuery) new URLSearchParams(hashQuery).forEach((v, k) => query.set(k, v))
  return query
}

type Props = { onBack: () => void }

export default function GtoGameView({ onBack }: Props) {
  const { t } = useI18n()
  const world = useMemo(() => loadWorld(), [])
  const launch = useMemo(() => parseLaunch(readQuery(), world), [world])
  const quality = useMemo(
    () =>
      pickQuality(launch.quality, {
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        shortSide: Math.min(window.innerWidth, window.innerHeight),
      }),
    [launch],
  )
  const touch = useMemo(() => window.matchMedia('(pointer: coarse)').matches || launch.quality === 'mobile', [launch])
  const audio = useMemo(() => createGtoAudio(), [])

  const stageRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<GtoEngine | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(launch.autostart)
  const [muted, setMuted] = useState(audio.muted())

  useEffect(() => {
    const container = stageRef.current
    if (!container) return
    let created: GtoEngine | null = null
    try {
      created = createGtoEngine({ container, launch, quality, outfitKeys, spriteUrl, spriteAspect, audio })
      setEngine(created)
    } catch {
      // WebGL が使えない端末では、遊べないことを伝える
      setFailed(true)
    }
    return () => {
      created?.dispose()
      setEngine(null)
    }
  }, [launch, quality, audio])
  useEffect(() => () => audio.close(), [audio])

  const start = () => {
    audio.unlock()
    engine?.start()
    setPlaying(true)
  }

  const showUi = launch.hud
  return (
    <main className="gto">
      <div className={launch.autostart ? 'gto-stage is-capture' : 'gto-stage'} ref={stageRef}>
        {failed && <p className="gto-failed jp">{t('この端末では3Dを表示できませんでした。')}</p>}

        {showUi && (
          <div className="gto-chrome">
            <button type="button" className="gto-chrome-btn jp" onClick={onBack}>
              ← {t('もどる')}
            </button>
            <button
              type="button"
              className="gto-chrome-btn mono"
              onClick={() => {
                audio.unlock()
                setMuted(audio.toggle())
              }}
              aria-label={t(muted ? 'サウンドをオン' : 'サウンドをオフ')}
            >
              {t(muted ? '音 OFF' : '音 ON')}
            </button>
            <GameFullscreenButton className="gto-fs" />
          </div>
        )}

        {engine && playing && showUi && (
          <>
            <GtoMinimap engine={engine} touch={touch} />
            <GtoHud engine={engine} time={launch.time} spriteUrl={spriteUrl} touch={touch} />
            {touch && <GtoTouchControls engine={engine} />}
            <GtoWardrobe engine={engine} spriteUrl={spriteUrl} touch={touch} />
          </>
        )}

        {engine && !playing && <GtoTitle onStart={start} attribution={world.map.meta.attribution} touch={touch} />}
        {playing && showUi && <p className="gto-credit corner">{world.map.meta.attribution}</p>}
      </div>
    </main>
  )
}
