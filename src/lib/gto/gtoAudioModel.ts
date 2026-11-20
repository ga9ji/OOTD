// Grand Theft Outfit [部品: audio] 音の「鳴らす前の計算」。WebAudio には触らない（vitest で確かめられる）。
// 入口: deriveAudio(state, world, memo, opts) … ゲームの状態 → その瞬間の音の様子（AudioFrame）と合図（AudioCue）
//       stepEngine … 速度と加速度から、変速つきの回転数と負荷を作る
//       ambientCues … 信号の誘導音・線路の継ぎ目・雑踏の声・遠くのクラクションの間合い
// 契約: どの関数も引数を書き換えない。覚え書き（AudioMemo）は新しい物を返す。
import { clamp, closestOnSegment, hash } from './math'
import type { GtoEventType, GtoState, GtoWorld, PlayMode, TimeOfDay, VehicleKind } from './types'
import { VEHICLE_SPECS } from './vehicle'

// ----------------------------------------------------------------------------
// エンジン
// ----------------------------------------------------------------------------

export const ENGINE_TUNING = {
  /** アイドル回転 rpm */
  idle: 850,
  redline: 6400,
  /** 各段で回し切ったときの速さ（最高速に対する割合） */
  gearTop: [0.2, 0.36, 0.55, 0.78, 1.04],
  /** 変速にかかる秒（この間は負荷が抜ける） */
  shiftTime: 0.24,
  /** 変速と変速の最短の間隔（秒） */
  shiftGap: 0.55,
  /** 回転の上がる/下がる速さの上限 rpm/s */
  rise: 9000,
  fall: 5200,
  fallInShift: 12000,
  /** 軽く踏んだとき/踏み切ったときに次の段へ上げる回転 */
  upLight: 3200,
  upFull: 6000,
  /** これを下回ったら段を下げる */
  down: 1700,
}

export interface EngineSim {
  /** 0 始まりの段 */
  gear: number
  rpm: number
  /** 0..1（踏んでいる度合い） */
  load: number
  /** 変速の残り秒 */
  shift: number
  /** 前の変速からの秒 */
  sinceShift: number
}

export interface EngineInput {
  /** 前向きの速さ m/s（後退は負） */
  speed: number
  /** 前後加速度 m/s² */
  accel: number
  maxSpeed: number
  maxAccel: number
}

export const idleEngine = (): EngineSim => ({ gear: 0, rpm: ENGINE_TUNING.idle, load: 0, shift: 0, sinceShift: 9 })

const wheelRpm = (gear: number, speed: number, maxSpeed: number) =>
  (ENGINE_TUNING.redline * 0.94 * Math.abs(speed)) / (maxSpeed * ENGINE_TUNING.gearTop[gear])

/** 加速度から「どれだけ踏んでいるか」を見積もる（sim は踏み込み量を状態に残さないため） */
export function estimateLoad(input: EngineInput): number {
  const push = input.speed < -0.5 ? -input.accel : input.accel
  if (push < -0.4) return 0
  const v = Math.abs(input.speed) / input.maxSpeed
  const avail = input.maxAccel * Math.max(0, 1 - v * v)
  return clamp((push + 0.6) / (avail + 0.6) - 0.07, 0, 1)
}

/** 回転数の模型を1歩進める */
export function stepEngine(prev: EngineSim, input: EngineInput, dt: number): EngineSim {
  const T = ENGINE_TUNING
  const wantLoad = estimateLoad(input)
  const last = T.gearTop.length - 1
  let gear = prev.gear
  let shift = Math.max(0, prev.shift - dt)
  let sinceShift = prev.sinceShift + dt

  if (shift === 0 && sinceShift > T.shiftGap) {
    const now = wheelRpm(gear, input.speed, input.maxSpeed)
    const up = T.upLight + (T.upFull - T.upLight) * prev.load
    const lower = gear > 0 ? wheelRpm(gear - 1, input.speed, input.maxSpeed) : Infinity
    let next = gear
    if (gear < last && now > up && input.speed > 0) next = gear + 1
    else if (gear > 0 && (now < T.down || (wantLoad > 0.85 && lower < T.redline * 0.8 && now < 2600))) next = gear - 1
    if (next !== gear) {
      gear = next
      shift = T.shiftTime
      sinceShift = 0
    }
  }

  const load = shift > 0 ? prev.load * Math.exp(-dt * 30) : prev.load + (wantLoad - prev.load) * (1 - Math.exp(-dt * (wantLoad > prev.load ? 14 : 9)))
  // 発進はクラッチが滑るぶん、踏むほど回転が先に上がる
  const slipRpm = T.idle + load * (gear === 0 ? 1500 : 350)
  const target = Math.min(T.redline, Math.max(slipRpm, wheelRpm(gear, input.speed, input.maxSpeed)))
  const maxUp = T.rise * dt
  const maxDown = (shift > 0 ? T.fallInShift : T.fall) * dt
  const rpm = clamp(target, prev.rpm - maxDown, prev.rpm + maxUp)
  return { gear, rpm, load, shift, sinceShift }
}

/** 車種ごとのエンジンの性格（気筒数・音程・ディーゼルのがらがら音） */
export const ENGINE_VOICE: Record<VehicleKind, { cyl: 3 | 4; pitch: number; clatter: number }> = {
  sedan: { cyl: 4, pitch: 1, clatter: 0 },
  kei: { cyl: 3, pitch: 1.12, clatter: 0.1 },
  taxi: { cyl: 4, pitch: 0.94, clatter: 0.15 },
  van: { cyl: 4, pitch: 0.82, clatter: 0.6 },
  police: { cyl: 4, pitch: 1.05, clatter: 0 },
  // [cheats] 戦車は低くがらがら、飛行機は高めに唸る
  tank: { cyl: 4, pitch: 0.6, clatter: 1 },
  plane: { cyl: 4, pitch: 1.3, clatter: 0.25 },
}

// ----------------------------------------------------------------------------
// サイレン・電車・信号（時刻だけで決まる）
// ----------------------------------------------------------------------------

export const SIREN_PERIOD = 6

/** 上がって下がる連続音の音程 Hz。offset は2台目をずらすための秒 */
export function sirenHz(t: number, offset: number): number {
  const p = (((t + offset) % SIREN_PERIOD) + SIREN_PERIOD) % SIREN_PERIOD
  const up = 2.6
  const shape = p < up ? 0.5 - 0.5 * Math.cos((p / up) * Math.PI) : 0.5 + 0.5 * Math.cos(((p - up) / (SIREN_PERIOD - up)) * Math.PI)
  return 420 + 430 * shape
}

const TRAIN_PERIOD = 36
const smooth = (x: number) => {
  const c = clamp(x, 0, 1)
  return c * c * (3 - 2 * c)
}

/** 電車が通っている度合い 0..1（36 秒に1本、11 秒かけて通る） */
export function trainPass(t: number): number {
  const p = ((t % TRAIN_PERIOD) + TRAIN_PERIOD) % TRAIN_PERIOD
  return smooth((p - 6) / 3) * smooth((17 - p) / 4)
}

const SIGNAL_PERIOD = 46
/** 歩行者信号が青（誘導音が鳴る）か */
export const signalOn = (t: number) => ((t % SIGNAL_PERIOD) + SIGNAL_PERIOD) % SIGNAL_PERIOD < 20

// ----------------------------------------------------------------------------
// 音の様子と合図
// ----------------------------------------------------------------------------

export interface SirenVoice {
  gain: number
  pan: number
  /** ドップラーの倍率 */
  pitch: number
}

export interface AudioFrame {
  /** 経過秒 */
  t: number
  mode: PlayMode
  /** 街の明るい時間ほど 1（夜は地の音を下げる） */
  bed: number
  engine: { on: number; rpm: number; load: number; cyl: 3 | 4; pitch: number; clatter: number }
  /** 速さ m/s（絶対値） */
  speed: number
  /** タイヤの鳴き 0..1 */
  skid: number
  crowd: number
  crowdPan: number
  /** 逃げ惑う人の度合い 0..1 */
  panic: number
  traffic: number
  trafficPan: number
  train: number
  trainPan: number
  /** 信号のある横断歩道の近さ 0..1 */
  signal: number
  sirens: [SirenVoice, SirenVoice]
  wanted: number
}

export type CueType = GtoEventType | 'step' | 'shift' | 'pop' | 'chirp' | 'clack' | 'voice' | 'farHorn'

export interface AudioCue {
  type: CueType
  /** 距離で決まる音量 0..1 */
  gain: number
  pan: number
  /** 強さや種類（衝突の速さ、走っているか、声の種類など）。voice は 1 以上で怯えた声 */
  value?: number
}

/** 周りで勝手に鳴る音の、次に鳴らす時刻 */
export interface AmbientClock {
  chirp: number
  clack: number
  voice: number
  horn: number
  /** 鳴らした回数（声や定位を散らす種） */
  n: number
}

export const createAmbientClock = (): AmbientClock => ({ chirp: 0, clack: 0, voice: 0.4, horn: 5, n: 0 })

const NO_SIREN: SirenVoice = { gain: 0, pan: 0, pitch: 1 }

export const quietFrame = (t = 0, mode: PlayMode = 'foot'): AudioFrame => ({
  t,
  mode,
  bed: 1,
  engine: { on: 0, rpm: ENGINE_TUNING.idle, load: 0, cyl: 4, pitch: 1, clatter: 0 },
  speed: 0,
  skid: 0,
  crowd: 0,
  crowdPan: 0,
  panic: 0,
  traffic: 0,
  trafficPan: 0,
  train: 0,
  trainPan: 0,
  signal: 0,
  sirens: [NO_SIREN, NO_SIREN],
  wanted: 0,
})

/** 信号の誘導音・線路の継ぎ目・雑踏の声・遠くのクラクションを、決まった間合いで出す */
export function ambientCues(frame: AudioFrame, clock: AmbientClock): { cues: AudioCue[]; clock: AmbientClock } {
  const cues: AudioCue[] = []
  let { chirp, clack, voice, horn, n } = clock
  const t = frame.t
  if (t >= chirp) {
    if (frame.signal > 0.04 && signalOn(t)) cues.push({ type: 'chirp', gain: frame.signal, pan: hash(n, 3) * 0.6 - 0.3, value: n % 2 })
    chirp = t + 1.1
    n++
  }
  if (t >= clack) {
    if (frame.train > 0.05) cues.push({ type: 'clack', gain: frame.train, pan: frame.trainPan, value: hash(n, 5) })
    clack = t + 0.52 + hash(n, 7) * 0.06
    n++
  }
  if (t >= voice) {
    if (frame.crowd > 0.12) {
      cues.push({ type: 'voice', gain: frame.crowd * (0.5 + hash(n, 11) * 0.5), pan: clamp(frame.crowdPan + hash(n, 13) * 1.4 - 0.7, -1, 1), value: hash(n, 17) * 0.99 + (frame.panic > 0.3 ? 1 : 0) })
    }
    voice = t + (1.5 - 1.2 * frame.crowd) * (0.6 + hash(n, 19) * 0.8)
    n++
  }
  if (t >= horn) {
    if (frame.traffic > 0.15) cues.push({ type: 'farHorn', gain: 0.4 + frame.traffic * 0.6, pan: hash(n, 23) * 1.6 - 0.8, value: hash(n, 29) })
    horn = t + 9 + hash(n, 31) * 14
    n++
  }
  return { cues, clock: { chirp, clack, voice, horn, n } }
}

// ----------------------------------------------------------------------------
// ゲームの状態 → 音
// ----------------------------------------------------------------------------

interface SlowScan {
  at: number
  railDist: number
  railPan: number
  signalDist: number
}

export interface AudioMemo {
  engine: EngineSim
  /** エンジンが掛かっている度合い 0..1 */
  engineOn: number
  /** 乗っている車（乗り換えたら回転をやり直す） */
  vehicleId: number | null
  /** 最後に足音を出した拍 */
  beat: number
  slow: SlowScan
  clock: AmbientClock
  /** 種類ごとの、次に鳴らしてよい時刻（壁をこすり続けても毎歩は鳴らさない） */
  quietUntil: Partial<Record<GtoEventType, number>>
}

/** 同じ種類の出来事を続けて鳴らさない間隔（秒）。ここに無い種類は毎回鳴らす */
export const CUE_GAP: Partial<Record<GtoEventType, number>> = { crash: 0.35, hitPed: 0.2, horn: 0.3 }

export const createAudioMemo = (): AudioMemo => ({
  engine: idleEngine(),
  engineOn: 0,
  vehicleId: null,
  beat: 0,
  slow: { at: -1, railDist: 999, railPan: 0, signalDist: 999 },
  clock: createAmbientClock(),
  quietUntil: {},
})

export interface DeriveOptions {
  time: TimeOfDay
  phase: 'title' | 'play'
  dt: number
}

interface Listener {
  x: number
  z: number
  yaw: number
}

/** 聞き手から見た距離と左右（右が＋） */
function locate(l: Listener, x: number, z: number): { dist: number; pan: number } {
  const dx = x - l.x
  const dz = z - l.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.5) return { dist, pan: 0 }
  const side = (dx * Math.cos(l.yaw) + dz * Math.sin(l.yaw)) / dist
  // 近い音は真ん中へ寄せる（背後カメラの足元の音が左右へ飛ばないように）
  return { dist, pan: clamp(side * Math.min(1, dist / 8) * 0.85, -1, 1) }
}

const falloff = (dist: number, ref: number) => 1 / (1 + (dist / ref) * (dist / ref))

const railCache = new WeakMap<GtoWorld, number[][]>()
/** 地上を走る線路の折れ線（地下鉄は聞こえないので除く） */
function railLines(world: GtoWorld): number[][] {
  const hit = railCache.get(world)
  if (hit) return hit
  const lines = world.map.rails.filter((r) => r.kind === 'rail').map((r) => r.pts)
  railCache.set(world, lines)
  return lines
}

function scanSlow(world: GtoWorld, l: Listener, at: number): SlowScan {
  let best = Infinity
  let bx = l.x
  let bz = l.z
  for (const pts of railLines(world)) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const c = closestOnSegment(l.x, l.z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3])
      const d = Math.hypot(c.x - l.x, c.z - l.z)
      if (d < best) {
        best = d
        bx = c.x
        bz = c.z
      }
    }
  }
  let signalDist = Infinity
  for (const c of world.map.crossings) {
    if (!c[2]) continue
    signalDist = Math.min(signalDist, Math.hypot(c[0] - l.x, c[1] - l.z))
  }
  return { at, railDist: Math.min(best, 999), railPan: locate(l, bx, bz).pan, signalDist: Math.min(signalDist, 999) }
}

const PLAYER_EVENTS: ReadonlySet<GtoEventType> = new Set<GtoEventType>(['enter', 'exit', 'steal', 'wantedUp', 'wantedClear', 'busted', 'missionStart', 'missionStep', 'missionDone', 'missionFail', 'cheat'])

/** タイヤが鳴く度合い（横滑り・ブレーキのロック・発進の空転） */
export function skidAmount(speed: number, slip: number, accel: number, load: number): number {
  const side = clamp((Math.abs(slip) - 1.5) / 5, 0, 1)
  const lock = Math.abs(speed) > 5 && accel < -10 ? clamp((-accel - 10) / 5, 0, 1) * 0.7 : 0
  const spin = load > 0.9 && Math.abs(speed) < 3.5 && accel > 5 ? 0.3 : 0
  return clamp(Math.max(side, lock, spin), 0, 1)
}

/** ゲームの状態から、この瞬間の音の様子と、鳴らす合図を作る */
export function deriveAudio(state: GtoState, world: GtoWorld, memo: AudioMemo, opts: DeriveOptions): { frame: AudioFrame; cues: AudioCue[]; memo: AudioMemo } {
  const l: Listener = { x: state.camera.x, z: state.camera.z, yaw: state.camera.yaw }
  const cues: AudioCue[] = []
  const car = state.vehicles.find((v) => v.id === state.player.vehicleId) ?? null
  const driving = state.mode === 'drive' && car != null

  // ---- エンジン ----
  const kind = car?.kind ?? 'sedan'
  const spec = VEHICLE_SPECS[kind]
  const fresh = car?.id !== memo.vehicleId
  const before = fresh ? idleEngine() : memo.engine
  const engine = car ? stepEngine(before, { speed: car.speed, accel: car.accel, maxSpeed: spec.maxSpeed, maxAccel: spec.accel }, opts.dt) : idleEngine()
  const engineOn = driving ? Math.min(1, (fresh ? 0 : memo.engineOn) + opts.dt / 0.5) : Math.max(0, memo.engineOn - opts.dt / 0.35)
  if (driving && engine.gear !== before.gear) cues.push({ type: 'shift', gain: 0.5 + engine.load * 0.5, pan: 0 })
  if (driving && before.load > 0.55 && engine.load <= 0.55 && engine.shift === 0 && engine.rpm > 3600) cues.push({ type: 'pop', gain: 1, pan: 0, value: hash(state.frame) })
  const voice = ENGINE_VOICE[kind]

  // ---- 足音 ----
  let beat = memo.beat
  if (!driving) {
    const now = Math.floor(state.player.stride * 2)
    if (now !== beat && state.player.speed > 0.3) cues.push({ type: 'step', gain: 1, pan: now % 2 ? 0.08 : -0.08, value: state.player.running ? 1 : 0 })
    beat = now
  }

  // ---- 周りの人と車 ----
  let crowdSum = 0
  let crowdSide = 0
  let panicSum = 0
  for (const p of state.peds) {
    const at = locate(l, p.x, p.z)
    if (at.dist > 45) continue
    const w = falloff(at.dist, 12)
    crowdSum += w
    crowdSide += w * at.pan
    if (p.mood === 'flee') panicSum += w
  }
  let trafficSum = 0
  let trafficSide = 0
  const police: { dist: number; pan: number; pitch: number }[] = []
  for (const v of state.vehicles) {
    if (v.id === car?.id) continue
    const at = locate(l, v.x, v.z)
    if (v.driver === 'police') {
      // 近づいてくる車は音程が上がる
      const toward = at.dist > 1 ? (-(v.x - l.x) * Math.sin(v.heading) + (v.z - l.z) * Math.cos(v.heading)) / at.dist : 0
      police.push({ dist: at.dist, pan: at.pan, pitch: 1 + clamp((toward * v.speed) / 340, -0.08, 0.08) })
    }
    if (at.dist > 60 || v.driver === 'none') continue
    const w = (0.25 + Math.abs(v.speed) / 12) * falloff(at.dist, 14)
    trafficSum += w
    trafficSide += w * at.pan
  }
  police.sort((a, b) => a.dist - b.dist)
  const chased = opts.phase === 'play' && state.wanted.level > 0
  const sirenOf = (i: number): SirenVoice => {
    if (!chased) return NO_SIREN
    const p = police[i]
    // 姿が見えなくても、手配中は遠くで1台鳴っている
    if (!p) return i === 0 ? { gain: 0.05 + state.wanted.level * 0.01, pan: 0, pitch: 1 } : NO_SIREN
    return { gain: clamp(0.08 + falloff(p.dist, 40) * 0.92, 0, 1), pan: p.pan, pitch: p.pitch }
  }

  // ---- 線路と信号（探すのは 0.25 秒に1回） ----
  const slow = state.t - memo.slow.at > 0.25 || state.t < memo.slow.at ? scanSlow(world, l, state.t) : memo.slow

  const frame: AudioFrame = {
    t: state.t,
    mode: state.mode,
    bed: opts.time === 'night' ? 0.7 : opts.time === 'dusk' ? 0.9 : 1,
    engine: { on: engineOn, rpm: engine.rpm, load: engine.load, ...voice },
    speed: Math.abs(car ? car.speed : state.player.speed),
    skid: driving && car ? skidAmount(car.speed, car.slip, car.accel, engine.load) : 0,
    crowd: clamp(1 - Math.exp(-crowdSum / 2.5), 0, 1),
    crowdPan: crowdSum > 0 ? clamp(crowdSide / crowdSum, -1, 1) : 0,
    panic: clamp(panicSum / 2, 0, 1),
    traffic: clamp(1 - Math.exp(-trafficSum), 0, 1),
    trafficPan: trafficSum > 0 ? clamp(trafficSide / trafficSum, -1, 1) : 0,
    train: clamp(trainPass(state.t) * (0.06 + falloff(slow.railDist, 55) * 0.94), 0, 1),
    trainPan: slow.railPan,
    signal: clamp(falloff(slow.signalDist, 22), 0, 1),
    sirens: [sirenOf(0), sirenOf(1)],
    wanted: opts.phase === 'play' ? state.wanted.level : 0,
  }

  // ---- sim の出来事 ----
  let quietUntil = memo.quietUntil
  // 同じ歩に重なった衝突は、いちばん強い1つだけを鳴らす
  const events = [...state.events].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  for (const e of events) {
    const gap = CUE_GAP[e.type]
    if (gap != null) {
      const until = quietUntil[e.type]
      if (until != null && state.t < until && state.t > until - gap - 0.001) continue
      quietUntil = { ...quietUntil, [e.type]: state.t + gap }
    }
    const at = PLAYER_EVENTS.has(e.type) ? { dist: 0, pan: 0 } : locate(l, e.x, e.z)
    cues.push({ type: e.type, gain: clamp(falloff(at.dist, 28), 0, 1), pan: at.pan, value: e.value })
  }
  const ambient = ambientCues(frame, memo.clock)
  return {
    frame,
    cues: [...cues, ...ambient.cues],
    memo: { engine, engineOn, vehicleId: car?.id ?? null, beat, slow, clock: ambient.clock, quietUntil },
  }
}
