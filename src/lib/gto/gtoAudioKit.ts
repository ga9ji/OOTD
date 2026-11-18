// Grand Theft Outfit [部品: audio] WebAudio の道具箱（出口のバス・雑音の素・1回きりの音）。
// 入口: createKit(ctx, { lite, seed })
// 契約: AudioContext と OfflineAudioContext のどちらでも同じ音になる（乱数は種から作り、時刻は呼ぶ側が渡す）。
//       lite（スマホ）では残響を作らない。
import { rand } from './math'

export interface KitOptions {
  /** スマホ向けの軽い構成（残響なし・声部を減らす） */
  lite: boolean
  seed: number
}

export interface BurstSpec {
  at: number
  /** 雑音の種類（white: さらさら、brown: ごろごろ） */
  noise?: 'white' | 'brown'
  filter: BiquadFilterType
  f: number
  /** 鳴っている間にここまで滑らせる */
  f1?: number
  q?: number
  dur: number
  vol: number
  attack?: number
  pan?: number
  /** 残響へ送る量 0..1 */
  verb?: number
}

export interface ToneSpec {
  at: number
  wave: OscillatorType
  f: number
  f1?: number
  dur: number
  vol: number
  attack?: number
  pan?: number
  verb?: number
  /** 低域だけ通す（こもらせる）周波数 */
  lowpass?: number
}

export interface Kit {
  ctx: BaseAudioContext
  lite: boolean
  /** すべての音の出口（この先に圧縮と全体音量がある） */
  mix: GainNode
  /** 鳴りっぱなしの音（エンジン・街・サイレン）の出口。衝突の瞬間はここを一瞬下げて、当たりを際立たせる */
  steady: GainNode
  /** 鳴りっぱなしの音を depth（0..1）だけ一瞬引っ込める */
  duck: (at: number, depth: number) => void
  /** 最終段。呼ぶ側が destination へつなぐ */
  output: GainNode
  /** 0..1 の乱数（種から決まる） */
  random: () => number
  white: AudioBuffer
  brown: AudioBuffer
  /** 鳴りっぱなしの雑音 */
  loop: (kind: 'white' | 'brown') => AudioBufferSourceNode
  /** 左右に振ってから出口へつなぐ。戻り値の pan を動かす（使えない環境では null） */
  place: (node: AudioNode, verb?: number, into?: AudioNode) => StereoPannerNode | null
  burst: (spec: BurstSpec) => void
  tone: (spec: ToneSpec) => void
  /** 金属の鐘のような澄んだ音（合図に使う） */
  bell: (f: number, at: number, dur: number, vol: number, pan?: number) => void
}

const SILENT = 0.0001
/** 鳴りっぱなしの音の全体の大きさ（1回きりの音が上に乗る余地を残す） */
const STEADY_LEVEL = 0.5

export function createKit(ctx: BaseAudioContext, opts: KitOptions): Kit {
  let seed = opts.seed | 0
  const random = () => {
    const [v, next] = rand(seed)
    seed = next
    return v
  }

  const makeNoise = (seconds: number, brown: boolean) => {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const w = random() * 2 - 1
      if (brown) {
        last = (last + w * 0.045) * 0.992
        data[i] = last
      } else data[i] = w
    }
    if (brown) {
      // 低い雑音は種で大きさがぶれるので、実効値 0.25 にそろえる
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const scale = 0.25 / Math.sqrt(sum / data.length || 1)
      for (let i = 0; i < data.length; i++) data[i] *= scale
    }
    return buffer
  }
  const white = makeNoise(2, false)
  const brown = makeNoise(3, true)

  // ---- 出口: まとめ → 圧縮（大きな衝突でも割れないように）→ 全体音量 ----
  const mix = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -10
  comp.knee.value = 8
  comp.ratio.value = 6
  comp.attack.value = 0.003
  comp.release.value = 0.18
  const output = ctx.createGain()
  output.gain.value = 0.75
  // 聞こえない超低域は先に切る（圧縮がそこに反応して全体が沈まないように）
  const rumbleCut = ctx.createBiquadFilter()
  rumbleCut.type = 'highpass'
  rumbleCut.frequency.value = 32
  mix.connect(rumbleCut).connect(comp).connect(output)
  const steady = ctx.createGain()
  steady.gain.value = STEADY_LEVEL
  steady.connect(mix)
  const duck = (at: number, depth: number) => {
    steady.gain.setTargetAtTime(STEADY_LEVEL * (1 - Math.max(0, Math.min(0.85, depth))), at, 0.008)
    steady.gain.setTargetAtTime(STEADY_LEVEL, at + 0.14, 0.3)
  }

  // ---- 残響: ビルに囲まれた通りの短い響き（種から作る） ----
  let verb: ConvolverNode | null = null
  if (!opts.lite) {
    const seconds = 1.3
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c)
      let low = 0
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate
        // 最初の 20ms は空ける（直接音と分かれて聞こえる）。高い音ほど早く消える
        const envelope = t < 0.02 ? 0 : Math.exp(-(t - 0.02) * 4.6)
        low += ((random() * 2 - 1) - low) * (0.5 * Math.exp(-t * 2.5) + 0.08)
        data[i] = low * envelope
      }
    }
    verb = ctx.createConvolver()
    verb.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.55
    verb.connect(wet).connect(mix)
  }

  const loop = (kind: 'white' | 'brown') => {
    const src = ctx.createBufferSource()
    src.buffer = kind === 'white' ? white : brown
    src.loop = true
    src.start(0, random() * 1.5)
    return src
  }

  const send = (node: AudioNode, amount: number) => {
    if (!verb || amount <= 0) return
    const g = ctx.createGain()
    g.gain.value = amount
    node.connect(g).connect(verb)
  }

  const place = (node: AudioNode, verbAmount = 0, into: AudioNode = mix) => {
    send(node, verbAmount)
    if (typeof ctx.createStereoPanner !== 'function') {
      node.connect(into)
      return null
    }
    const panner = ctx.createStereoPanner()
    node.connect(panner).connect(into)
    return panner
  }

  /** 1回きりの音の出口（左右と残響を決めてつなぐ） */
  const oneShot = (node: AudioNode, pan = 0, verbAmount = 0) => {
    const panner = place(node, verbAmount)
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan))
  }

  const shape = (g: GainNode, at: number, attack: number, dur: number, vol: number) => {
    g.gain.setValueAtTime(SILENT, at)
    g.gain.exponentialRampToValueAtTime(Math.max(SILENT, vol), at + attack)
    // 終わりは −34dB まで下げてから切る（0 へ向けて指数で下げると、指定した長さの 1/4 ほどで聞こえなくなる）
    const end = at + Math.max(attack + 0.005, dur)
    g.gain.exponentialRampToValueAtTime(Math.max(SILENT, vol * 0.02), end)
    g.gain.linearRampToValueAtTime(0, end + 0.015)
  }

  const burst = (s: BurstSpec) => {
    if (s.vol <= 0.0005) return
    const buffer = s.noise === 'brown' ? brown : white
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = s.filter
    filter.frequency.setValueAtTime(s.f, s.at)
    if (s.f1) filter.frequency.exponentialRampToValueAtTime(s.f1, s.at + s.dur)
    filter.Q.value = s.q ?? 0.7
    const g = ctx.createGain()
    // 帯域を絞った雑音ほど小さくなるので、vol が「聞こえる大きさ」にそろうよう持ち上げる
    const q = s.q ?? 0.7
    const makeup = s.noise === 'brown' ? 2.4 : s.filter === 'bandpass' ? 2.2 * Math.sqrt(Math.max(0.5, q)) : 1.6
    shape(g, s.at, s.attack ?? 0.003, s.dur, s.vol * makeup)
    src.connect(filter).connect(g)
    oneShot(g, s.pan, s.verb)
    src.start(s.at, random() * (buffer.duration - 0.1))
    src.stop(s.at + s.dur + 0.03)
  }

  const tone = (s: ToneSpec) => {
    if (s.vol <= 0.0005) return
    const osc = ctx.createOscillator()
    osc.type = s.wave
    osc.frequency.setValueAtTime(s.f, s.at)
    if (s.f1) osc.frequency.exponentialRampToValueAtTime(s.f1, s.at + s.dur)
    const g = ctx.createGain()
    shape(g, s.at, s.attack ?? 0.006, s.dur, s.vol)
    if (s.lowpass) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = s.lowpass
      osc.connect(filter).connect(g)
    } else osc.connect(g)
    oneShot(g, s.pan, s.verb)
    osc.start(s.at)
    osc.stop(s.at + s.dur + 0.03)
  }

  const bell = (f: number, at: number, dur: number, vol: number, pan = 0) => {
    tone({ at, wave: 'sine', f, dur, vol, pan, verb: 0.5 })
    tone({ at, wave: 'sine', f: f * 2.01, dur: dur * 0.55, vol: vol * 0.32, pan, verb: 0.5 })
    tone({ at, wave: 'sine', f: f * 3.93, dur: dur * 0.25, vol: vol * 0.12, pan })
    tone({ at, wave: 'triangle', f: f * 0.5, dur: dur * 0.8, vol: vol * 0.22, pan })
  }

  return { ctx, lite: opts.lite, mix, steady, duck, output, random, white, brown, loop, place, burst, tone, bell }
}
