// Grand Theft Outfit [部品: audio] 聞き比べ用の決まった場面（運転・街歩き・追跡・合図の一覧）。
// 入口: AUDIO_SCENES / buildScene(name)
// 契約: 場面は時刻だけで決まる（乱数なし）。地図もゲームの状態も要らないので、いつ書き出しても同じ波形になる。
//       場面を足すときは AUDIO_SCENES に1行足す。
import { clamp } from './math'
import {
  ambientCues,
  createAmbientClock,
  ENGINE_VOICE,
  idleEngine,
  quietFrame,
  skidAmount,
  stepEngine,
  type AudioCue,
  type AudioFrame,
  type CueType,
  type EngineSim,
} from './gtoAudioModel'
import type { VehicleKind } from './types'
import { VEHICLE_SPECS } from './vehicle'

export const SCENE_RATE = 60
const DT = 1 / SCENE_RATE
/** 左右1組ぶんの歩幅 m（足音の間合い。徒歩の部品と同じ並の値） */
const STRIDE = 1.5

export interface SceneStep {
  frame: AudioFrame
  cues: AudioCue[]
}

export interface AudioScene {
  name: string
  label: string
  seconds: number
  steps: SceneStep[]
}

/** 車の踏み方（その時刻の入力） */
interface Pedals {
  throttle: number
  brake: number
  /** 横滑りの速さ m/s（ハンドブレーキで振ったとき） */
  slip?: number
  /** その場で速さを掛ける（衝突で失速する） */
  hit?: number
}

/** 1回だけ鳴らす合図の予定 */
interface Timed {
  at: number
  type: CueType
  value?: number
  gain?: number
  pan?: number
}

interface Script {
  label: string
  seconds: number
  mode: 'foot' | 'drive'
  kind?: VehicleKind
  pedals?: (t: number) => Pedals
  /** 徒歩の速さ m/s */
  walk?: (t: number) => number
  /** 周りの様子（雑踏・交通・電車・信号・サイレンなど）を上書きする */
  around: (t: number) => Partial<AudioFrame>
  timed: Timed[]
}

const ramp = (t: number, t0: number, t1: number, a: number, b: number) => a + (b - a) * clamp((t - t0) / (t1 - t0), 0, 1)

function play(name: string, script: Script): AudioScene {
  const kind = script.kind ?? 'sedan'
  const spec = VEHICLE_SPECS[kind]
  const steps: SceneStep[] = []
  let engine: EngineSim = idleEngine()
  let clock = createAmbientClock()
  let speed = 0
  let stride = 0
  let beat = 0
  const total = Math.round(script.seconds * SCENE_RATE)
  for (let i = 0; i < total; i++) {
    const t = i * DT
    const cues: AudioCue[] = []
    let frame: AudioFrame = { ...quietFrame(t, script.mode), ...script.around(t) }

    if (script.mode === 'drive' && script.pedals) {
      const p = script.pedals(t)
      const v = speed / spec.maxSpeed
      const push = p.throttle * spec.accel * (1 - v * v)
      const drag = speed > 0 ? 0.25 + 0.0006 * speed * speed : 0
      const accel = speed > 0 || push > 0 ? push - p.brake * spec.brake - drag : 0
      const next = Math.max(0, speed + accel * DT) * (p.hit ?? 1)
      const felt = (next - speed) / DT
      speed = next
      const before = engine
      engine = stepEngine(engine, { speed, accel: clamp(felt, -20, 20), maxSpeed: spec.maxSpeed, maxAccel: spec.accel }, DT)
      if (engine.gear !== before.gear) cues.push({ type: 'shift', gain: 0.5 + engine.load * 0.5, pan: 0 })
      if (before.load > 0.55 && engine.load <= 0.55 && engine.shift === 0 && engine.rpm > 3600) cues.push({ type: 'pop', gain: 1, pan: 0, value: (i % 7) / 7 })
      frame = {
        ...frame,
        speed,
        skid: skidAmount(speed, p.slip ?? 0, felt, engine.load),
        engine: { on: 1, rpm: engine.rpm, load: engine.load, ...ENGINE_VOICE[kind] },
      }
    } else if (script.walk) {
      speed = script.walk(t)
      stride += (speed * DT) / STRIDE
      const now = Math.floor(stride * 2)
      if (now !== beat && speed > 0.3) cues.push({ type: 'step', gain: 1, pan: now % 2 ? 0.08 : -0.08, value: speed > 3 ? 1 : 0 })
      beat = now
      frame = { ...frame, speed }
    }

    for (const c of script.timed) {
      if (c.at >= t && c.at < t + DT) cues.push({ type: c.type, gain: c.gain ?? 1, pan: c.pan ?? 0, value: c.value })
    }
    const ambient = ambientCues(frame, clock)
    clock = ambient.clock
    steps.push({ frame, cues: [...cues, ...ambient.cues] })
  }
  return { name, label: script.label, seconds: script.seconds, steps }
}

const within = (t: number, a: number, b: number) => t >= a && t < b

const SCRIPTS: Record<string, Script> = {
  drive: {
    label: 'アイドル → 全開で加速（変速）→ アクセルを離す → 急ブレーキ → アイドル → クラクション',
    seconds: 16,
    mode: 'drive',
    pedals: (t) => ({ throttle: within(t, 2.5, 10) ? 1 : 0, brake: within(t, 11, 13.6) ? 1 : 0 }),
    around: (t) => ({ crowd: 0.15, traffic: 0.25, trafficPan: Math.sin(t * 0.7) * 0.6 }),
    timed: [{ at: 14.6, type: 'horn' }],
  },
  engine: {
    label: 'エンジンとタイヤだけ（街の音なし）: アイドル → 全開 → 離す → 急ブレーキ → 軽く踏んで流す',
    seconds: 20,
    mode: 'drive',
    pedals: (t) => ({ throttle: within(t, 2.5, 10) ? 1 : within(t, 14.5, 19) ? 0.35 : 0, brake: within(t, 11, 13.6) || t >= 19 ? 1 : 0 }),
    around: () => ({ bed: 0 }),
    timed: [],
  },
  walk: {
    label: '交差点へ歩く → 走る → 立ち止まって服を奪う → ミッションの合図',
    seconds: 18,
    mode: 'foot',
    walk: (t) => (within(t, 0.5, 7) ? 1.5 : within(t, 7, 11.5) ? 4.6 : 0),
    around: (t) => ({
      crowd: ramp(t, 0, 8, 0.25, 0.85),
      crowdPan: Math.sin(t * 0.4) * 0.3,
      traffic: 0.3,
      trafficPan: Math.sin(t * 0.9 + 1) * 0.7,
      signal: ramp(t, 0, 8, 0.2, 0.9),
      // 電車の通過（ゲームでは36秒周期の同じ形）
      train: clamp((t - 5) / 3, 0, 1) * clamp((16 - t) / 4, 0, 1) * 0.85,
      trainPan: ramp(t, 5, 16, -0.7, 0.7),
    }),
    timed: [
      { at: 12.3, type: 'steal' },
      { at: 14, type: 'missionStep' },
      { at: 15.5, type: 'missionDone' },
    ],
  },
  chase: {
    label: '手配される → サイレンが迫る → ハンドブレーキで曲がる → 衝突 → 2台目 → 大きな衝突 → 捕まる',
    seconds: 20,
    mode: 'drive',
    pedals: (t) => ({
      throttle: within(t, 0.5, 7) || within(t, 7.9, 16.4) ? 1 : 0,
      brake: t >= 16.4 ? 1 : within(t, 7, 7.8) ? 0.5 : 0,
      slip: within(t, 7, 7.9) ? 6.5 : 0,
      hit: within(t, 9.2, 9.2 + DT) ? 0.45 : within(t, 14.5, 14.5 + DT) ? 0.1 : 1,
    }),
    around: (t) => ({
      bed: 0.9,
      crowd: 0.3,
      panic: within(t, 8, 15) ? 0.6 : 0.1,
      traffic: 0.35,
      trafficPan: Math.sin(t * 1.3) * 0.8,
      wanted: t < 1 ? 0 : t < 11 ? 2 : 3,
      sirens: [
        t < 1 ? { gain: 0, pan: 0, pitch: 1 } : { gain: ramp(t, 1, 8, 0.1, 0.9), pan: Math.sin(t * 0.5) * 0.6, pitch: 1 + ramp(t, 1, 8, 0.03, 0) },
        t < 11 ? { gain: 0, pan: 0, pitch: 1 } : { gain: ramp(t, 11, 15, 0.1, 0.7), pan: -0.5, pitch: 1.02 },
      ],
    }),
    timed: [
      { at: 1, type: 'wantedUp', value: 2 },
      { at: 9.2, type: 'crash', value: 12 },
      { at: 11, type: 'wantedUp', value: 3 },
      { at: 12.4, type: 'hitPed', value: 14, pan: 0.3 },
      { at: 14.5, type: 'crash', value: 24 },
      { at: 17.8, type: 'busted' },
    ],
  },
  cues: {
    label: '合図の一覧（1.7 秒おきに全種類）',
    seconds: 44,
    mode: 'foot',
    around: () => ({ bed: 0.5 }),
    timed: (
      [
        ['missionStart'],
        ['missionStep', 1],
        ['missionDone', 1],
        ['missionFail'],
        ['steal'],
        ['enter'],
        ['exit'],
        ['carjack'],
        ['horn'],
        ['crash', 5],
        ['crash', 13],
        ['crash', 26],
        ['hitPed', 10],
        ['wantedUp', 1],
        ['wantedUp', 3],
        ['wantedClear'],
        ['busted'],
        ['farHorn', 0.3],
        ['shift'],
        ['pop', 0.4],
      ] as [CueType, number?][]
    )
      .map(([type, value], i): Timed => ({ at: 0.5 + i * 1.7, type, value }))
      .concat(
        // 足音（歩き4歩・走り4歩）、信号、線路の継ぎ目、雑踏の声
        [0, 1, 2, 3].map((i) => ({ at: 34.6 + i * 0.5, type: 'step' as const, value: 0, pan: i % 2 ? 0.08 : -0.08 })),
        [0, 1, 2, 3].map((i) => ({ at: 36.8 + i * 0.3, type: 'step' as const, value: 1, pan: i % 2 ? 0.08 : -0.08 })),
        [0, 1].map((i) => ({ at: 38.3 + i * 1.1, type: 'chirp' as const, value: i })),
        [0, 1, 2, 3].map((i) => ({ at: 40.4 + i * 0.54, type: 'clack' as const, value: i / 4 })),
        [0, 1, 2, 3, 4].map((i) => ({ at: 42.4 + i * 0.3, type: 'voice' as const, value: i / 5, pan: i * 0.3 - 0.6 })),
      ),
  },
}

export const AUDIO_SCENES: Record<string, { label: string; seconds: number }> = Object.fromEntries(
  Object.entries(SCRIPTS).map(([name, s]) => [name, { label: s.label, seconds: s.seconds }]),
)

/** 場面を 60Hz の音の様子の列にする */
export function buildScene(name: string): AudioScene {
  const script = SCRIPTS[name]
  if (!script) throw new Error(`音の場面がありません: ${name}`)
  return play(name, script)
}
