import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import { AREAS } from '../lib/gto/areas'
import { createGtoAudio } from '../lib/gto/gtoAudio'
import { loadAreaWorld, loadWorld } from '../lib/gto/map'
import { pickQuality } from '../lib/gto/quality'
import { clearSave, loadSave, saveArea, type GtoSave } from '../lib/gto/save'
import { isCaptureQuery, launchArea, parseLaunch } from '../lib/gto/shot'
import type { AreaId, GtoWorld } from '../lib/gto/types'
import { useI18n } from '../lib/i18n'
import type { CutoutsFile } from '../lib/platform'
import GameFullscreenButton from './GameFullscreenButton'
import GameShareButton from './GameShareButton'
import GtoHud, { MENU_EVENT } from './gto/GtoHud'
import GtoMinimap from './gto/GtoMinimap'
import GtoPhone, { PHONE_EVENT } from './gto/GtoPhone'
import GtoTitle from './gto/GtoTitle'
import GtoTouchControls from './gto/GtoTouchControls'
import GtoWardrobe from './gto/GtoWardrobe'
import { createGtoEngine, type GtoEngine } from './gto/engine'
import './gto/gto.css'
import './gto/gtoWanted.css' // [wanted] 手配の印の大きさと色（gto.css のあとに読む）

// Grand Theft Outfit: 渋谷と新宿を舞台にした背後視点のオープンワールド。
// ルールと世界は lib/gto/（部品ごとに1ファイル）、3D の描画は components/gto/render*.ts、
// ここは画面の組み立て（題名 → 遊ぶ）と、HUD・ミニマップ・タッチ操作の配置だけを扱う。
// URL のクエリ（?gtoShot= &time= &quality= &hud= &seed= &mode= &demo= &area=）で撮影用の状態を作れる（lib/gto/shot.ts）。
//
// [areas] エリア（lib/gto/areas.ts）は地続きではない。一度に載せる街は 1 つだけで、移るときは
//   読み込みの画面を出す → いまの進行（所持金・服・達成した依頼）を取り出す → 次の地図を読む（渋谷のほかは、このとき初めて読む）
//   → 世界と描画（エンジン）を作り直して、進行を戻す、の順に進める。場所・乗っている車・手配度は持ち越さない。
//   題名の画面から始めるときは、保存した「いまいるエリア」で始まる。

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

/** 読み込みの画面を、絵が出てからも出しておく最短の ms（一瞬で消えると、何が起きたか分からない） */
const TRAVEL_MIN_MS = 700
/** 読み込みの画面が描かれるのを待つ上限 ms（これを過ぎたら、描かれていなくても読み込みを始める） */
const PAINT_WAIT_MS = 200
/** 新しい街を何フレーム描いたら、読み込みの画面を外すか */
const TRAVEL_SETTLE_FRAMES = 3

/** エリアを移っている最中の様子（読み込みの画面に出す） */
interface Travel {
  to: AreaId
  /** 移り始めた時刻（performance.now） */
  at: number
}

/** 撮影ツール向け: 直近のエリアの切り替えにかかった時間（ms）。load=地図の読み込み、build=世界と描画の組み立て、total=選んでから絵が出るまで */
export interface GtoTravelStat {
  to: AreaId
  load: number
  build: number
  total: number
}

declare global {
  interface Window {
    __gtoTravel?: GtoTravelStat
  }
}

type Props = { onBack: () => void }

export default function GtoGameView({ onBack }: Props) {
  const { t } = useI18n()
  const query = useMemo(() => readQuery(), [])
  // 最初のエリア: URL の指定 → （ふつうに遊ぶとき）保存した「いまいるエリア」 → 渋谷
  const [areaId, setAreaId] = useState<AreaId>(() => launchArea(query) ?? (isCaptureQuery(query) ? 'shibuya' : saveArea(loadSave())))
  // 渋谷の地図は同梱なので、すぐ世界にできる。ほかのエリアは読み込みを待つ
  const [world, setWorld] = useState<GtoWorld | null>(() => (areaId === 'shibuya' ? loadWorld() : null))
  const launch = useMemo(() => (world ? parseLaunch(query, world) : null), [query, world])
  const quality = useMemo(
    () =>
      pickQuality(query.get('quality'), {
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        shortSide: Math.min(window.innerWidth, window.innerHeight),
      }),
    [query],
  )
  const touch = useMemo(() => window.matchMedia('(pointer: coarse)').matches || query.get('quality') === 'mobile', [query])
  const audio = useMemo(() => createGtoAudio(), [])

  const stageRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<GtoEngine | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(() => isCaptureQuery(query))
  const [muted, setMuted] = useState(audio.muted())
  // [areas] エリアを移るあいだの持ち物: 読み込みの画面・持ち越す進行・題名を挟まない旗・時間の記録
  const [travel, setTravel] = useState<Travel | null>(null)
  const carryRef = useRef<GtoSave | null>(null)
  const skipTitleRef = useRef(false)
  const timing = useRef({ at: 0, loaded: 0 })

  // ---- エリアの地図を読んで、世界を差し替える ----
  useEffect(() => {
    if (world?.area === areaId) return
    let alive = true
    // 読み込みの画面が 1 回描かれてから、重い仕事（地図の読み込みと街の組み立て）を始める。
    // 画面が隠れていると描画の合図（rAF）は来ないので、少し待っても来なければ始める
    let begun = false
    const begin = () => {
      if (begun || !alive) return
      begun = true
      loadAreaWorld(areaId)
        .then((next) => {
          if (!alive) return
          timing.current.loaded = performance.now()
          setWorld(next)
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(begin))
    const timer = window.setTimeout(begin, PAINT_WAIT_MS)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [areaId, world])

  // ---- 世界ごとにエンジンを作り直す ----
  useEffect(() => {
    const container = stageRef.current
    if (!container || !world || !launch) return
    let created: GtoEngine | null = null
    try {
      const carry = carryRef.current
      const skipTitle = skipTitleRef.current
      carryRef.current = null
      skipTitleRef.current = false
      created = createGtoEngine({ container, world, carry, skipTitle, launch, quality, outfitKeys, spriteUrl, spriteAspect, audio })
      setEngine(created)
    } catch {
      // WebGL が使えない端末では、遊べないことを伝える
      setFailed(true)
    }
    return () => {
      created?.dispose()
      setEngine(null)
    }
  }, [world, launch, quality, audio])
  useEffect(() => () => audio.close(), [audio])

  // ---- 新しい街の絵が出たら、読み込みの画面を外す ----
  useEffect(() => {
    if (!travel || !engine || engine.world.area !== travel.to) return
    const built = performance.now()
    let frames = 0
    let timer = 0
    const stop = engine.subscribe(() => {
      if (++frames !== TRAVEL_SETTLE_FRAMES) return
      const now = performance.now()
      const { at, loaded } = timing.current
      window.__gtoTravel = { to: travel.to, load: Math.round(loaded - at), build: Math.round(built - loaded), total: Math.round(now - at) }
      timer = window.setTimeout(() => setTravel(null), Math.max(0, TRAVEL_MIN_MS - (now - travel.at)))
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [travel, engine])

  /** [areas] ほかのエリアへ移る。carry が null なら、進行を持ち越さず最初から（「はじめから」） */
  const travelTo = useCallback(
    (to: AreaId, carry: GtoSave | null) => {
      if (travel || to === areaId) return
      engine?.setPaused(true)
      carryRef.current = carry
      skipTitleRef.current = true
      timing.current = { at: performance.now(), loaded: 0 }
      setTravel({ to, at: performance.now() })
      setPlaying(true)
      setAreaId(to)
    },
    [travel, areaId, engine],
  )

  const start = (fresh = false) => {
    audio.unlock()
    if (fresh && engine && engine.world.area !== 'shibuya') {
      // 「はじめから」は、渋谷から。保存を消して、渋谷の街を読み直す
      if (engine.persist) clearSave()
      travelTo('shibuya', null)
      return
    }
    engine?.start({ fresh })
    setPlaying(true)
  }

  const showUi = launch?.hud ?? true
  const loading = travel != null || (!world && !failed)
  const loadingArea = travel?.to ?? areaId
  return (
    <main className="gto">
      <div className={launch?.autostart ? 'gto-stage is-capture' : 'gto-stage'} ref={stageRef}>
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
            {/* [cheats] 遊んでいるあいだのメニューから、主人公のスマホを開く（メニューは閉じる） */}
            {playing && (
              <button
                type="button"
                className="gto-chrome-btn jp"
                onClick={() => {
                  stageRef.current?.dispatchEvent(new Event(MENU_EVENT))
                  stageRef.current?.dispatchEvent(new Event(PHONE_EVENT))
                }}
              >
                {t('スマホ')}
              </button>
            )}
            {/* 共有は題名の画面だけ（ほかのゲームと同じく最初の画面に置く） */}
            {!playing && <GameShareButton game="gto" title="Grand Theft Outfit" fullscreen={false} />}
          </div>
        )}

        {engine && launch && playing && showUi && (
          <>
            <GtoMinimap engine={engine} touch={touch} />
            <GtoHud engine={engine} time={launch.time} spriteUrl={spriteUrl} touch={touch} />
            {touch && <GtoTouchControls engine={engine} />}
            <GtoWardrobe engine={engine} spriteUrl={spriteUrl} touch={touch} />
            <GtoPhone engine={engine} touch={touch} />
          </>
        )}

        {engine && world && !playing && (
          <GtoTitle onStart={() => start()} onRestart={() => start(true)} resumed={engine.resumed} attribution={world.map.meta.attribution} touch={touch} />
        )}
        {world && playing && showUi && <p className="gto-credit corner">{world.map.meta.attribution}</p>}

        {/* [areas] 読み込みの画面（エリアを移るあいだと、最初に渋谷でないエリアの地図を読むあいだ） */}
        {loading && (
          <div className="gto-travel jp" role="status" aria-live="polite">
            <small className="mono">{travel ? 'NOW TRAVELLING' : 'NOW LOADING'}</small>
            <strong>{t(travel ? '{place}へ移動中…' : '{place}を読み込み中…', { place: t(AREAS[loadingArea].name) })}</strong>
            <i aria-hidden="true" />
          </div>
        )}
      </div>
    </main>
  )
}
