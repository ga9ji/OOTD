// Grand Theft Outfit: ゲームの心臓部。シミュレーション（lib/gto/sim.ts）を一定の刻みで進め、
// 描画部品（render*.ts）を毎フレーム更新する。入力（キーボード・マウス・ゲームパッド）もここで集める。
// 入口: createGtoEngine(options)
// [areas] 世界（エリア）は呼ぶ側が渡す。エリアを移るときは、このエンジンを捨てて、次の世界で作り直す
//         （progress() で所持金・服・達成した依頼を取り出し、次のエンジンの carry に渡す。場所・車・手配は持ち越さない）。
// 撮影ツール向けに window.__gto（ready・fps・状態の要約）を出す。
import * as THREE from 'three'
import { viewFov } from '../../lib/gto/camera'
import { demoInput } from '../../lib/gto/demo'
import type { GtoAudio, GtoAudioDebug } from '../../lib/gto/gtoAudio'
import { buildInput, emptyTouch, NO_INPUT, type PadInput, type TouchInput } from '../../lib/gto/input'
import { lightingFor } from '../../lib/gto/lighting'
import { areaDef } from '../../lib/gto/areas'
import { dirOf } from '../../lib/gto/math'
import { demoRoad, gapAhead, laneLeftOf } from '../../lib/gto/traffic'
import type { QualityPreset } from '../../lib/gto/quality'
import type { Launch } from '../../lib/gto/shot'
import { applySave, clearSave, hasProgress, loadSave, saveOf, saveSummary, storeSave, type GtoSave, type SaveSummary } from '../../lib/gto/save'
import { createGtoState, START_CASH, stepGto, viewOf, type GtoView } from '../../lib/gto/sim'
import { titleCamera } from '../../lib/gto/titleCamera'
import type { CheatId, GtoState, GtoWorld, SimConfig } from '../../lib/gto/types'
import { createWeatherClock, windDir, type WeatherView } from '../../lib/gto/weather'
import { createActorsRenderer } from './renderActors'
import { createCityRenderer } from './renderCity'
import { createMarkersRenderer } from './renderMarkers'
import { createSignsRenderer } from './renderSigns'
import { createSkyRenderer } from './renderSky'
import { createSpecialsRenderer } from './renderSpecials'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'
import { createVehiclesRenderer } from './renderVehicles'
import { createWeatherRenderer } from './renderWeather'

const STEP = 1 / 60
/** 1フレームで進める歩数の上限（処理落ちしても、ためこんで一気に進めない） */
const MAX_STEPS = 4
const FPS_WINDOW = 900

export interface UiFrame {
  state: GtoState
  view: GtoView
  weather: WeatherView
}

export interface EngineOptions {
  container: HTMLElement
  /** [areas] 遊ぶエリアの世界（lib/gto/map.ts の loadAreaWorld） */
  world: GtoWorld
  /** [areas] ほかのエリアから持ち越す進行（所持金・服・達成した依頼）。あれば端末の保存より優先し、題名の画面を挟まずに遊び始める */
  carry?: GtoSave | null
  /** [areas] 題名の画面を挟まずに遊び始める（ほかのエリアにいて「はじめから」を選び、渋谷へ戻って始め直すとき） */
  skipTitle?: boolean
  launch: Launch
  quality: QualityPreset
  outfitKeys: string[]
  spriteUrl: (key: string) => string
  spriteAspect: (key: string) => number
  audio: GtoAudio
}

export interface GtoEngine {
  world: GtoWorld
  /** 前回の進行を戻して始めたなら、そのあらまし（題名の画面の「つづきから」に出す）。最初からなら null */
  resumed: SaveSummary | null
  /** 題名の画面を終えて遊び始める。fresh なら保存した進行を消して、最初から */
  start: (opts?: { fresh?: boolean }) => void
  /** タッチ操作の現在値を差し替える（GtoTouchControls から呼ぶ） */
  setTouch: (patch: Partial<TouchInput>) => void
  /** 毎フレーム呼ばれる（HUD とミニマップ用）。戻り値で解除 */
  subscribe: (fn: (frame: UiFrame) => void) => () => void
  /** [outfit] 着替え画面を開いているあいだ、街の時間を止める（描画は続ける） */
  setPaused: (paused: boolean) => void
  /** [outfit] 次の1歩で、ワードローブのこの服に着替える */
  wear: (key: string) => void
  /** [cheats] 次の1歩で、スマホで通じた裏コードを効かせる */
  cheat: (id: CheatId) => void
  /** [areas] いまの進行（所持金・服・達成した依頼・いまいるエリア）。エリアを移るとき、次のエンジンへ渡す */
  progress: () => GtoSave
  /** [areas] エリアを移れるかを決めるための、いまの様子（手配度と、進行中の依頼があるか） */
  status: () => { wanted: number; onMission: boolean }
  /** 進行を端末へ残すか（撮影用の URL で始めたときは残さない） */
  persist: boolean
  dispose: () => void
}

interface DebugHandle {
  ready: boolean
  phase: 'title' | 'play'
  fps: () => { avg: number; low1: number; frames: number }
  resetFps: () => void
  snapshot: () => Record<string, unknown>
  /** 音の書き出し口（決まった場面や遊んでいる最中の音を WAV にする） */
  audio: GtoAudioDebug
}

declare global {
  interface Window {
    __gto?: DebugHandle
  }
}

const readPad = (prev: readonly boolean[]): PadInput | null => {
  const pad = (navigator.getGamepads?.() ?? []).find((p) => p != null)
  if (!pad) return null
  const buttons = pad.buttons.map((b) => b.pressed)
  return { axes: [...pad.axes], buttons, pressed: buttons.map((b, i) => b && !prev[i]) }
}

export function createGtoEngine(opts: EngineOptions): GtoEngine {
  const { container, launch, quality, audio, world } = opts
  const area = areaDef(world)
  const lighting = lightingFor(launch.time)
  const cfg: SimConfig = {
    maxVehicles: quality.maxVehicles,
    maxPeds: quality.maxPeds,
    // 住人の服は種類を絞る（テクスチャの枚数を抑える）。種が同じなら同じ顔ぶれになる
    outfitKeys: opts.outfitKeys.filter((_, i) => (i * 7 + launch.seed) % Math.max(1, Math.floor(opts.outfitKeys.length / quality.pedOutfits)) === 0),
  }

  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio))
  // 描画回数はポストプロセスの分も合わせて数えたいので、1フレームごとに自分で戻す
  renderer.info.autoReset = false
  const canvas = renderer.domElement
  canvas.className = 'gto-canvas'
  container.prepend(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, quality.drawDistance * 1.5)
  // ---- 天気（lib/gto/weather.ts）----
  // ふつうに遊ぶときは、開くたびに違う順番で移り変わる。撮影用の URL では、指定が無ければ晴れのまま（同じクエリなら同じ絵にする）
  const weatherFixed = launch.weather === 'random' ? null : (launch.weather ?? (launch.autostart ? 'clear' : null))
  const weatherSeed = launch.autostart || launch.weather != null ? launch.seed : Math.floor(Math.random() * 0x7fffffff)
  const weatherClock = createWeatherClock(weatherSeed, weatherFixed)
  let lastStrike: number | null = null
  let pending = 0
  const ctx: RenderCtx = {
    scene,
    camera,
    renderer,
    world,
    quality,
    lighting,
    time: launch.time,
    wind: windDir(weatherSeed),
    spriteUrl: opts.spriteUrl,
    spriteAspect: opts.spriteAspect,
    loading: { begin: () => pending++, end: () => pending-- },
  }
  const sky = createSkyRenderer(ctx)
  const parts: RenderPart[] = [
    sky,
    createCityRenderer(ctx),
    createSignsRenderer(ctx),
    createVehiclesRenderer(ctx),
    createSpecialsRenderer(ctx),
    createActorsRenderer(ctx),
    createMarkersRenderer(ctx),
    createWeatherRenderer(ctx),
  ]

  const freshState = () => createGtoState(world, cfg, { seed: launch.seed, mode: launch.mode, start: launch.start, stage: launch.demo?.stage, starterCar: launch.photo == null })
  let state = freshState()
  // ---- 進行の保存（lib/gto/save.ts）----
  // 題名の画面から普通に遊ぶときだけ、前回の進行を戻して、変わるたびに端末へ書く。
  // 撮影用の URL で始めたときは読まないし書かない（同じクエリなら同じ絵にするため。遊んでいる進行も汚さない）
  const persist = !launch.autostart
  // [areas] ほかのエリアから移ってきたときは、持ち越した進行で始める（端末の保存は読まない。題名の画面も挟まない）
  const carry = opts.carry ?? null
  const loaded = carry ?? (persist ? loadSave() : null)
  const resumed = !carry && loaded != null && hasProgress(loaded, START_CASH) ? saveSummary(loaded) : null
  if (loaded && (carry || resumed)) state = applySave(state, loaded, cfg.outfitKeys)
  // 着いたエリアを、すぐ端末へ残す（移った直後に閉じても、次はこのエリアから始まる）
  if (carry && persist) storeSave(saveOf(state, world.area))
  let kept = { cash: state.cash, outfit: state.outfit, done: state.mission.done }
  const keepProgress = () => {
    if (!persist || phase !== 'play') return
    if (state.cash === kept.cash && state.outfit === kept.outfit && state.mission.done === kept.done) return
    kept = { cash: state.cash, outfit: state.outfit, done: state.mission.done }
    storeSave(saveOf(state, world.area))
  }
  let phase: 'title' | 'play' = launch.autostart || carry || opts.skipTitle ? 'play' : 'title'
  let disposed = false
  let raf = 0
  let last = performance.now()
  let acc = 0
  let now = 0
  let frames = 0
  let drawn = { calls: 0, triangles: 0 }
  const createdAt = performance.now()

  // ---- 入力 ----
  const keys = new Set<string>()
  let pressed = new Set<string>()
  let mouseDX = 0
  let mouseDY = 0
  let touch: TouchInput = emptyTouch()
  // [outfit] 着替え画面: 時間を止める旗と、次の1歩で着替える服
  let paused = false
  let wearNext: string | null = null
  // [cheats] スマホで通じた裏コード（次の1歩で効かせる）
  let cheatNext: CheatId | null = null
  let padButtons: readonly boolean[] = []
  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])
  const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
  const onKeyDown = (e: KeyboardEvent) => {
    if (typing(e) || e.metaKey || e.ctrlKey) return
    if (phase === 'play' && GAME_KEYS.has(e.code)) e.preventDefault()
    if (!keys.has(e.code)) pressed.add(e.code)
    keys.add(e.code)
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
  const onBlur = () => keys.clear()
  // 画面のドラッグでカメラを回す。movementX は端末によって 0 になるので、前の位置との差を自分で取る
  let dragId: number | null = null
  let dragX = 0
  let dragY = 0
  const onPointerDown = (e: PointerEvent) => {
    if (dragId != null) return
    dragId = e.pointerId
    dragX = e.clientX
    dragY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return
    const dx = e.clientX - dragX
    const dy = e.clientY - dragY
    dragX = e.clientX
    dragY = e.clientY
    if (e.pointerType === 'touch') touch = { ...touch, lookDX: touch.lookDX + dx, lookDY: touch.lookDY + dy }
    else {
      mouseDX += dx
      mouseDY += dy
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === dragId) dragId = null
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  const nextInput = () => {
    if (phase === 'title') return NO_INPUT
    if (launch.demo) {
      const goal = viewOf(state).markers[0] ?? null
      const road = state.mode === 'drive' ? world.nearestRoad(state.player.x, state.player.z, true, 30) : null
      return demoInput(launch.demo, state.t, STEP, { x: state.player.x, z: state.player.z, camYaw: state.camera.yaw, goal, heading: state.player.heading, road, gap: state.mode === 'drive' ? gapAhead(state.player, state.vehicles, world, state.t) : undefined, lane: state.mode === 'drive' ? laneLeftOf(world, state.player.x, state.player.z, state.player.heading) : undefined, laneRoad: state.mode === 'drive' ? demoRoad(world, state.player.x, state.player.z, state.player.heading) : undefined, speed: state.player.speed })
    }
    const pad = readPad(padButtons)
    padButtons = pad?.buttons ?? []
    const input = buildInput({ keys, pressed, mouseDX, mouseDY, touch, pad }, STEP)
    // 1回使った「押した瞬間」と移動量は捨てる
    pressed = new Set()
    mouseDX = 0
    mouseDY = 0
    touch = { ...touch, lookDX: 0, lookDY: 0, enter: false, steal: false }
    return input
  }

  // ---- 画面の大きさ ----
  const resize = () => {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    sky.resize(w, h)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  // ---- カメラ ----
  const lookTarget = new THREE.Vector3()
  const placeCamera = () => {
    if (phase === 'title') {
      // 題名の画面では、交差点を見下ろす弧の上をゆっくり往復する（建物とクレーンを避けた弧。lib/gto/titleCamera.ts）
      const c = titleCamera(now, area.title)
      camera.position.set(c.x, c.y, c.z)
      camera.fov = c.fov
      camera.lookAt(c.tx, c.ty, c.tz)
    } else if (launch.photo) {
      const p = launch.photo
      const d = dirOf(p.heading)
      const y = world.groundY(p.x, p.z) + p.eye
      camera.position.set(p.x, y, p.z)
      camera.fov = p.fov
      lookTarget.set(p.x + d.x * Math.cos(p.pitch), y + Math.sin(p.pitch), p.z + d.z * Math.cos(p.pitch))
      camera.lookAt(lookTarget)
    } else {
      const c = state.camera
      camera.position.set(c.x, c.y, c.z)
      camera.fov = viewFov(c.fov, camera.aspect)
      camera.lookAt(c.tx, c.ty, c.tz)
    }
    camera.updateProjectionMatrix()
  }

  // ---- fps の計測 ----
  let frameMs: number[] = []
  const fps = () => {
    if (frameMs.length === 0) return { avg: 0, low1: 0, frames: 0 }
    const sorted = [...frameMs].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const worst = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
    return { avg: 1000 / (sum / sorted.length), low1: 1000 / worst, frames: sorted.length }
  }

  const listeners = new Set<(frame: UiFrame) => void>()
  const handle: DebugHandle = {
    ready: false,
    phase,
    fps,
    resetFps: () => {
      frameMs = []
    },
    audio: audio.debug,
    snapshot: () => ({
      t: state.t,
      area: world.area,
      mode: state.mode,
      player: { x: state.player.x, y: state.player.y, z: state.player.z, heading: state.player.heading, speed: state.player.speed },
      camera: { x: state.camera.x, y: state.camera.y, z: state.camera.z, yaw: state.camera.yaw },
      vehicles: state.vehicles.length,
      peds: state.peds.length,
      wanted: state.wanted.level,
      outfit: state.outfit.wearing,
      mission: state.mission.active?.id ?? null,
      done: state.mission.done,
      cash: state.cash,
      quality: quality.id,
      time: launch.time,
      weather: weatherClock.at(state.t).kind,
      demo: launch.demoName,
      drawCalls: drawn.calls,
      triangles: drawn.triangles,
    }),
  }
  window.__gto = handle

  const tick = (time: number) => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const ms = time - last
    last = time
    if (ms > 0 && ms < 1000) {
      frameMs.push(ms)
      if (frameMs.length > FPS_WINDOW) frameMs.shift()
    }
    const dt = Math.min(0.1, ms / 1000)
    now += dt
    acc += dt
    let steps = 0
    if (paused) acc = 0
    while (acc >= STEP && steps < MAX_STEPS) {
      const stepInput = nextInput()
      state = stepGto(state, wearNext || cheatNext ? { ...stepInput, ...(wearNext ? { wear: wearNext } : {}), ...(cheatNext ? { cheat: cheatNext } : {}) } : stepInput, world, cfg, STEP)
      wearNext = null
      cheatNext = null
      for (const e of state.events) audio.event(e)
      acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) acc = 0
    if (steps > 0) keepProgress()

    const view = viewOf(state)
    const weather = weatherClock.at(state.t)
    // 稲光が出た最初のフレームで、雷鳴を1回だけ鳴らす
    const thunder = weather.strike != null && weather.strike !== lastStrike ? 1 : 0
    lastStrike = weather.strike
    const frame: FrameInfo = { state, view, dt, now, weather, photo: launch.photo != null || phase === 'title' }
    placeCamera()
    for (const part of parts) part.update(frame)
    drawn = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
    renderer.info.reset()
    sky.render()
    const mine = state.vehicles.find((v) => v.id === state.player.vehicleId)
    audio.frame(state, world, { time: launch.time, phase, dt, lite: quality.id === 'mobile', rain: weather.rain, thunder })
    audio.update({
      mode: state.mode,
      speed: state.player.speed,
      accel: mine?.accel ?? 0,
      slip: mine?.slip ?? 0,
      stride: state.player.stride,
      wanted: phase === 'play' ? state.wanted.level : 0,
      time: launch.time,
    })
    for (const fn of listeners) fn({ state, view, weather })
    frames++
    handle.phase = phase
    // 数フレーム描いて、テクスチャも読み終えたら「絵が出そろった」とみなす
    if (!handle.ready && frames > 4 && (pending <= 0 || performance.now() - createdAt > 8000)) handle.ready = true
  }
  raf = requestAnimationFrame(tick)

  return {
    world,
    resumed,
    start: (opts) => {
      if (opts?.fresh && persist) {
        // 最初から: 保存を消して、始めの状態に戻す
        clearSave()
        state = freshState()
        kept = { cash: state.cash, outfit: state.outfit, done: state.mission.done }
        acc = 0
      }
      phase = 'play'
    },
    setTouch: (patch) => {
      touch = { ...touch, ...patch }
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    setPaused: (next) => {
      paused = next
      // 止めていた間に押されたキーとドラッグは、再開の1歩に持ち込まない
      pressed = new Set()
      mouseDX = 0
      mouseDY = 0
    },
    wear: (key) => {
      wearNext = key
    },
    cheat: (id) => {
      cheatNext = id
    },
    progress: () => saveOf(state, world.area),
    status: () => ({ wanted: state.wanted.level, onMission: state.mission.active != null }),
    persist,
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      for (const part of parts) part.dispose()
      renderer.dispose()
      canvas.remove()
      if (window.__gto === handle) delete window.__gto
    },
  }
}
