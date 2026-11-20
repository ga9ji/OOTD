// Grand Theft Outfit: ゲームの心臓部。シミュレーション（lib/gto/sim.ts）を一定の刻みで進め、
// 描画部品（render*.ts）を毎フレーム更新する。入力（キーボード・マウス・ゲームパッド）もここで集める。
// 入口: createGtoEngine(options)
// 撮影ツール向けに window.__gto（ready・fps・状態の要約）を出す。
import * as THREE from 'three'
import { viewFov } from '../../lib/gto/camera'
import { demoInput } from '../../lib/gto/demo'
import type { GtoAudio, GtoAudioDebug } from '../../lib/gto/gtoAudio'
import { buildInput, emptyTouch, NO_INPUT, type PadInput, type TouchInput } from '../../lib/gto/input'
import { lightingFor } from '../../lib/gto/lighting'
import { loadWorld } from '../../lib/gto/map'
import { dirOf } from '../../lib/gto/math'
import { demoRoad, gapAhead, laneLeftOf } from '../../lib/gto/traffic'
import type { QualityPreset } from '../../lib/gto/quality'
import type { Launch } from '../../lib/gto/shot'
import { createGtoState, stepGto, viewOf, type GtoView } from '../../lib/gto/sim'
import { titleCamera } from '../../lib/gto/titleCamera'
import type { GtoState, GtoWorld, SimConfig } from '../../lib/gto/types'
import { createActorsRenderer } from './renderActors'
import { createCityRenderer } from './renderCity'
import { createMarkersRenderer } from './renderMarkers'
import { createSignsRenderer } from './renderSigns'
import { createSkyRenderer } from './renderSky'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'
import { createVehiclesRenderer } from './renderVehicles'

const STEP = 1 / 60
/** 1フレームで進める歩数の上限（処理落ちしても、ためこんで一気に進めない） */
const MAX_STEPS = 4
const FPS_WINDOW = 900

export interface UiFrame {
  state: GtoState
  view: GtoView
}

export interface EngineOptions {
  container: HTMLElement
  launch: Launch
  quality: QualityPreset
  outfitKeys: string[]
  spriteUrl: (key: string) => string
  spriteAspect: (key: string) => number
  audio: GtoAudio
}

export interface GtoEngine {
  world: GtoWorld
  /** 題名の画面を終えて遊び始める */
  start: () => void
  /** タッチ操作の現在値を差し替える（GtoTouchControls から呼ぶ） */
  setTouch: (patch: Partial<TouchInput>) => void
  /** 毎フレーム呼ばれる（HUD とミニマップ用）。戻り値で解除 */
  subscribe: (fn: (frame: UiFrame) => void) => () => void
  /** [outfit] 着替え画面を開いているあいだ、街の時間を止める（描画は続ける） */
  setPaused: (paused: boolean) => void
  /** [outfit] 次の1歩で、ワードローブのこの服に着替える */
  wear: (key: string) => void
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
  const { container, launch, quality, audio } = opts
  const world = loadWorld()
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
  let pending = 0
  const ctx: RenderCtx = {
    scene,
    camera,
    renderer,
    world,
    quality,
    lighting,
    time: launch.time,
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
    createActorsRenderer(ctx),
    createMarkersRenderer(ctx),
  ]

  let state = createGtoState(world, cfg, { seed: launch.seed, mode: launch.mode, start: launch.start, stage: launch.demo?.stage, starterCar: launch.photo == null })
  let phase: 'title' | 'play' = launch.autostart ? 'play' : 'title'
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
      const c = titleCamera(now)
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
      state = stepGto(state, wearNext ? { ...stepInput, wear: wearNext } : stepInput, world, cfg, STEP)
      wearNext = null
      for (const e of state.events) audio.event(e)
      acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) acc = 0

    const view = viewOf(state)
    const frame: FrameInfo = { state, view, dt, now, photo: launch.photo != null || phase === 'title' }
    placeCamera()
    for (const part of parts) part.update(frame)
    drawn = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
    renderer.info.reset()
    sky.render()
    const mine = state.vehicles.find((v) => v.id === state.player.vehicleId)
    audio.frame(state, world, { time: launch.time, phase, dt, lite: quality.id === 'mobile' })
    audio.update({
      mode: state.mode,
      speed: state.player.speed,
      accel: mine?.accel ?? 0,
      slip: mine?.slip ?? 0,
      stride: state.player.stride,
      wanted: phase === 'play' ? state.wanted.level : 0,
      time: launch.time,
    })
    for (const fn of listeners) fn({ state, view })
    frames++
    handle.phase = phase
    // 数フレーム描いて、テクスチャも読み終えたら「絵が出そろった」とみなす
    if (!handle.ready && frames > 4 && (pending <= 0 || performance.now() - createdAt > 8000)) handle.ready = true
  }
  raf = requestAnimationFrame(tick)

  return {
    world,
    start: () => {
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
