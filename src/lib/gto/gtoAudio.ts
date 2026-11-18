// Grand Theft Outfit [部品: audio] 音。素材ファイルは使わず、すべて WebAudio で合成する。
// 入口: createGtoAudio()
// 契約: 毎フレーム frame(state, world, info) でゲームの状態を、event(e) でその1歩で起きたことを受け取って鳴らす。
//       AudioContext はユーザー操作（unlock）で初めて起動するので、自動再生制限に抵触しない。
//       debug（window.__gto.audio）から、決まった場面や遊んでいる最中の音を OfflineAudioContext で WAV に書き出せる。
// 中身: gtoAudioModel（状態 → 音の様子）/ gtoAudioSynth（鳴りっぱなしの音）/ gtoAudioCues（1回きりの音）/
//       gtoAudioScenes（聞き比べ用の場面）/ gtoAudioWav（WAV）
import { createAudioMemo, deriveAudio, idleEngine, quietFrame, skidAmount, stepEngine, type AudioCue, type AudioFrame, type AudioMemo } from './gtoAudioModel'
import { AUDIO_SCENES, buildScene, SCENE_RATE } from './gtoAudioScenes'
import { createSynth, type GtoSynth } from './gtoAudioSynth'
import { audioStats, encodeWav, toBase64, type AudioStats } from './gtoAudioWav'
import type { GtoEvent, GtoState, GtoWorld, PlayMode, TimeOfDay } from './types'
import { VEHICLE_SPECS } from './vehicle'

/** 状態を丸ごと渡せない呼び出し元のための、最小限の様子（frame を呼んでいれば使わない） */
export interface AudioView {
  mode: PlayMode
  /** 前向きの速さ m/s */
  speed: number
  /** 前後加速度 m/s² */
  accel: number
  /** 横滑りの速さ m/s（タイヤの鳴き） */
  slip: number
  /** 歩行の位相 */
  stride: number
  wanted: number
  time: TimeOfDay
}

export interface AudioFrameInfo {
  time: TimeOfDay
  phase: 'title' | 'play'
  /** この描画フレームの秒 */
  dt: number
  /** スマホ向けの軽い構成にするか（quality.mobile） */
  lite?: boolean
}

export interface RenderOptions {
  lite?: boolean
  sampleRate?: number
}

export interface WavResult {
  name: string
  label: string
  sampleRate: number
  seconds: number
  /** 16bit ステレオの WAV（base64） */
  base64: string
  stats: AudioStats
  /** 記録の途中でゲームがやり直された回数（recordLive のみ。0 でなければ撮り直す） */
  restarts?: number
}

/** 撮影ツール向けの入口（window.__gto.audio） */
export interface GtoAudioDebug {
  /** 書き出せる場面の一覧 */
  scenes: () => { name: string; label: string; seconds: number }[]
  /** 決まった場面を WAV にする（何度書き出しても同じ波形） */
  renderScene: (name: string, opts?: RenderOptions) => Promise<WavResult>
  /** いま遊んでいる（またはデモ再生中の）音を seconds 秒ぶん記録して WAV にする */
  recordLive: (seconds: number, opts?: RenderOptions) => Promise<WavResult>
  /** 場面を書き出して、ブラウザで保存する */
  download: (name: string) => Promise<void>
  /** いま鳴らしている様子の要約 */
  state: () => Record<string, unknown>
}

export interface GtoAudio {
  unlock: () => void
  toggle: () => boolean
  muted: () => boolean
  update: (view: AudioView) => void
  /** 毎フレーム、ゲームの状態を渡す */
  frame: (state: GtoState, world: GtoWorld, info: AudioFrameInfo) => void
  event: (e: GtoEvent) => void
  close: () => void
  debug: GtoAudioDebug
}

interface TimedStep {
  at: number
  frame: AudioFrame
  cues: AudioCue[]
}

const SOUND_KEY = 'gto.sound'
const SEED = 20261117
/** 予約を少し先へ置く（処理が詰まっても音が途切れない） */
const LOOKAHEAD = 0.02

const readMuted = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === 'off'
  } catch {
    return false
  }
}

type AnyWindow = Window & { webkitAudioContext?: typeof AudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }

/** 音の様子の列を、実時間を待たずに WAV へ書き出す */
async function renderSteps(name: string, label: string, seconds: number, steps: readonly TimedStep[], opts: RenderOptions = {}): Promise<WavResult> {
  const w = window as AnyWindow
  const Ctor = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : w.webkitOfflineAudioContext
  if (!Ctor) throw new Error('この環境では音を書き出せません（OfflineAudioContext がありません）')
  const sampleRate = opts.sampleRate ?? 44100
  try {
    const ctx = new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate)
    const synth = createSynth(ctx, { lite: opts.lite ?? false, seed: SEED })
    synth.output.connect(ctx.destination)
    for (const step of steps) {
      synth.apply(step.frame, step.at)
      for (const cue of step.cues) synth.cue(cue, step.at)
    }
    const buffer = await ctx.startRendering()
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)]
    return { name, label, sampleRate, seconds, base64: toBase64(encodeWav(channels, sampleRate)), stats: audioStats(channels, sampleRate) }
  } catch (error) {
    throw new Error(`音の書き出しに失敗しました（${name}）: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function createGtoAudio(): GtoAudio {
  let ctx: AudioContext | null = null
  let synth: GtoSynth | null = null
  let master: GainNode | null = null
  let muted = readMuted()
  let lite = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  let memo: AudioMemo = createAudioMemo()
  let pending: GtoEvent[] = []
  let latest: AudioFrame = quietFrame()
  /** frame() で状態を受け取っているか（受け取っていれば update() は何もしない） */
  let framed = false
  let lastBeat = 0
  let viewEngine = idleEngine()
  let tick = 0
  let recorder: { t0: number; seconds: number; steps: TimedStep[]; done: (steps: TimedStep[]) => void } | null = null

  /** 記録を締めて、集まった分を書き出しへ渡す */
  const finishRecording = () => {
    if (!recorder) return
    const { done, steps } = recorder
    recorder = null
    done(steps)
  }

  const onVisibility = () => {
    if (!ctx) return
    // 画面を離れたら鳴らし続けない
    if (document.hidden) void ctx.suspend().catch(() => {})
    else if (!muted) void ctx.resume().catch(() => {})
  }

  const start = () => {
    if (ctx) return
    const Ctor = window.AudioContext ?? (window as AnyWindow).webkitAudioContext
    if (!Ctor) return
    try {
      ctx = new Ctor()
      synth = createSynth(ctx, { lite, seed: SEED })
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 1
      synth.output.connect(master).connect(ctx.destination)
      if (muted) void ctx.suspend().catch(() => {})
      document.addEventListener('visibilitychange', onVisibility)
    } catch {
      // 音が出せない端末でも、ゲームは続ける
      ctx = null
      synth = null
      master = null
    }
  }

  const emit = (frame: AudioFrame, cues: AudioCue[]) => {
    latest = frame
    if (recorder) {
      const at = (performance.now() - recorder.t0) / 1000
      if (at >= recorder.seconds) finishRecording()
      else recorder.steps.push({ at, frame, cues })
    }
    if (!ctx || !synth || muted || ctx.state !== 'running') return
    const at = ctx.currentTime + LOOKAHEAD
    // スマホでは鳴りっぱなしの音の更新を1フレームおきにする（耳では分からず、処理は半分になる）
    tick++
    if (!lite || tick % 2 === 0) synth.apply(frame, at)
    for (const cue of cues) synth.cue(cue, at)
  }

  const debug: GtoAudioDebug = {
    scenes: () => Object.entries(AUDIO_SCENES).map(([name, s]) => ({ name, ...s })),
    renderScene: (name, opts) => {
      const scene = buildScene(name)
      return renderSteps(name, scene.label, scene.seconds, scene.steps.map((s, i) => ({ at: i / SCENE_RATE, ...s })), { lite, ...opts })
    },
    recordLive: (seconds, opts) =>
      new Promise<TimedStep[]>((resolve) => {
        finishRecording()
        const mine = { t0: performance.now(), seconds, steps: [] as TimedStep[], done: resolve }
        recorder = mine
        // 描画が止まっていても（画面が裏にある・エラーで止まった）、集まった分で書き出す
        window.setTimeout(() => {
          if (recorder === mine) finishRecording()
        }, seconds * 1000 + 500)
      }).then(async (steps) => {
        const restarts = steps.filter((s, i) => i > 0 && s.frame.t < steps[i - 1].frame.t - 0.5).length
        return { ...(await renderSteps('live', '遊んでいる最中の音', seconds, steps, { lite, ...opts })), restarts }
      }),
    download: async (name) => {
      const result = await debug.renderScene(name)
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `gto-audio-${name}.wav`
      link.click()
      URL.revokeObjectURL(url)
    },
    state: () => ({
      running: ctx?.state ?? 'none',
      muted,
      lite,
      mode: latest.mode,
      rpm: Math.round(latest.engine.rpm),
      load: Number(latest.engine.load.toFixed(2)),
      engineOn: Number(latest.engine.on.toFixed(2)),
      gear: memo.engine.gear + 1,
      skid: Number(latest.skid.toFixed(2)),
      crowd: Number(latest.crowd.toFixed(2)),
      traffic: Number(latest.traffic.toFixed(2)),
      train: Number(latest.train.toFixed(2)),
      signal: Number(latest.signal.toFixed(2)),
      sirens: latest.sirens.map((s) => Number(s.gain.toFixed(2))),
    }),
  }

  return {
    unlock: () => {
      start()
      if (!muted) void ctx?.resume().catch(() => {})
    },
    toggle: () => {
      muted = !muted
      try {
        localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      } catch {
        // 保存できなくても音の切り替えは続ける
      }
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05)
        // 消音中は合成そのものを止める（電池を使わない）
        if (muted) void ctx.suspend().catch(() => {})
        else void ctx.resume().catch(() => {})
      }
      return muted
    },
    muted: () => muted,
    frame: (state, world, info) => {
      framed = true
      if (info.lite != null && !ctx) lite = info.lite
      // sim の出来事は event() で受けた分だけを使う（1フレームに複数歩・0歩のどちらでも、1回ずつ鳴る）
      const out = deriveAudio({ ...state, events: pending }, world, memo, info)
      pending = []
      memo = out.memo
      emit(out.frame, out.cues)
    },
    update: (view) => {
      if (framed) return
      // 状態を受け取れない呼び出し元向け: エンジンと足音だけを組み立てる
      const spec = VEHICLE_SPECS.sedan
      const driving = view.mode === 'drive'
      viewEngine = driving ? stepEngine(viewEngine, { speed: view.speed, accel: view.accel, maxSpeed: spec.maxSpeed, maxAccel: spec.accel }, 1 / 60) : idleEngine()
      const cues: AudioCue[] = pending.map((e) => ({ type: e.type, gain: 1, pan: 0, value: e.value }))
      pending = []
      const beat = Math.floor(view.stride * 2)
      if (!driving && beat !== lastBeat) cues.push({ type: 'step', gain: 1, pan: 0, value: 0 })
      lastBeat = beat
      const base = quietFrame(latest.t + 1 / 60, view.mode)
      emit(
        {
          ...base,
          bed: view.time === 'night' ? 0.7 : 1,
          speed: Math.abs(view.speed),
          skid: driving ? skidAmount(view.speed, view.slip, view.accel, viewEngine.load) : 0,
          engine: { ...base.engine, on: driving ? 1 : 0, rpm: viewEngine.rpm, load: viewEngine.load },
          sirens: [{ gain: view.wanted > 0 ? 0.3 : 0, pan: 0, pitch: 1 }, base.sirens[1]],
          wanted: view.wanted,
        },
        cues,
      )
    },
    event: (e) => {
      // 溜まりすぎないよう上限を置く（画面が止まっている間の分は捨てる）
      pending = [...pending, e].slice(-24)
    },
    close: () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      void ctx?.close().catch(() => {})
      ctx = null
      synth = null
      master = null
      // 記録中なら続ける（開発中の差し替えで画面が作り直されても、時間切れで必ず書き出しへ進む）
      memo = createAudioMemo()
      pending = []
    },
    debug,
  }
}
