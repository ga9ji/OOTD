// Grand Theft Outfit [部品: audio] 鳴りっぱなしの音（エンジン・タイヤ・街・電車・サイレン）を組み立てる。
// 入口: createSynth(ctx, { lite, seed }) → apply(frame, at) / cue(cue, at) / output
// 契約: apply は「at 秒の時点の様子」を予約するだけ。実時間（AudioContext）でも書き出し（OfflineAudioContext）でも
//       同じ呼び方で同じ音になる。素材ファイルは使わない。
import { clamp, hash } from './math'
import { playCue } from './gtoAudioCues'
import { createKit, type KitOptions } from './gtoAudioKit'
import { ENGINE_TUNING, sirenHz, type AudioCue, type AudioFrame } from './gtoAudioModel'

export interface GtoSynth {
  /** 最終段。destination へつなぐ */
  output: GainNode
  apply: (frame: AudioFrame, at: number) => void
  cue: (cue: AudioCue, at: number) => void
}

/** 値を滑らかに追わせる時定数（秒）。60Hz で渡しても階段状に聞こえない長さ */
const GLIDE = 0.03

/** 雑踏の帯域（人の声が集まる高さ）と、それぞれの揺れの速さ */
const CROWD_BANDS: [freq: number, level: number, rateA: number, rateB: number][] = [
  [330, 1, 2.3, 0.7],
  [560, 0.9, 3.1, 1.1],
  [860, 0.7, 4.3, 0.9],
  [1350, 0.45, 5.2, 1.6],
  [2100, 0.25, 6.1, 1.3],
]

/** 話し声の母音の響き（2つの帯域の中心 Hz） */
const TALK_VOWELS: [number, number][] = [
  [720, 1150],
  [420, 1950],
  [360, 880],
  [540, 1700],
  [310, 2250],
]

/** エンジン1周期（クランク2回転）の波形。点火の倍音を強く、その間の倍音を弱く入れて「ばらつき」を作る */
function engineWave(ctx: BaseAudioContext, cyl: number, tilt: number): PeriodicWave {
  const count = 72
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  for (let k = 1; k <= count; k++) {
    const order = k / cyl
    const kind = Number.isInteger(order) ? 1 : Number.isInteger(order * 2) ? 0.45 : 0.18
    // 点火の基音だけが鳴ると単なる低い唸りになるので、基音は抑えて2〜4倍あたりに重心を置く
    const amp = kind * (order < 1 ? 0.5 : order === 1 ? 0.55 : Math.pow(order, -tilt))
    // 位相は倍音ごとに決まった値で散らす（とがった波形にしない）
    const phase = ((k * 2654435761) % 1000) / 1000 * Math.PI * 2
    real[k] = amp * Math.sin(phase)
    imag[k] = amp * Math.cos(phase)
  }
  return ctx.createPeriodicWave(real, imag)
}

/** やわらかく歪ませる曲線（倍音が増えて、エンジンのざらつきになる） */
function driveCurve(amount: number) {
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

export function createSynth(ctx: BaseAudioContext, opts: KitOptions): GtoSynth {
  const kit = createKit(ctx, opts)
  const gain = (value = 0) => {
    const g = ctx.createGain()
    g.gain.value = value
    return g
  }
  const filter = (type: BiquadFilterType, freq: number, q = 0.7, db = 0) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    f.gain.value = db
    return f
  }
  const osc = (type: OscillatorType, freq: number, wave?: PeriodicWave) => {
    const o = ctx.createOscillator()
    if (wave) o.setPeriodicWave(wave)
    else o.type = type
    o.frequency.value = freq
    o.start(0)
    return o
  }
  const glide = (param: AudioParam, value: number, at: number, tau = GLIDE) => param.setTargetAtTime(value, at, tau)

  // ---- エンジン: 点火の波形 2 本（踏んだ音・抜いた音）＋点火に合わせて脈打つ雑音 → 歪み → こもり → 排気の響き ----
  const waves = {
    3: { on: engineWave(ctx, 3, 0.5), off: engineWave(ctx, 3, 1.1) },
    4: { on: engineWave(ctx, 4, 0.5), off: engineWave(ctx, 4, 1.1) },
  }
  let cyl: 3 | 4 = 4
  const engOn = osc('custom', 7, waves[4].on)
  const engOff = osc('custom', 7, waves[4].off)
  const fire = osc('sine', 28)
  const engOnGain = gain()
  const engOffGain = gain()
  const rasp = gain()
  const raspDepth = gain()
  const raspBand = filter('bandpass', 900, 0.8)
  const shaper = ctx.createWaveShaper()
  shaper.curve = driveCurve(2.6)
  const engTone = filter('lowpass', 500, 0.9)
  const exhaustA = filter('peaking', 165, 1.3, 4)
  const exhaustB = filter('peaking', 470, 1.6, 4)
  const engOut = gain()
  engOn.connect(engOnGain).connect(shaper)
  engOff.connect(engOffGain).connect(shaper)
  kit.loop('white').connect(raspBand).connect(rasp).connect(shaper)
  fire.connect(raspDepth).connect(rasp.gain)
  // 点火そのもの（数十 Hz）は小さなスピーカーでは鳴らず、圧縮だけを動かすので切る。聞かせるのは倍音の側
  const engLowCut = filter('highpass', 75, 0.7)
  const engLowCut2 = filter('highpass', 75, 0.7)
  shaper.connect(engTone).connect(engLowCut).connect(engLowCut2).connect(exhaustA).connect(exhaustB).connect(engOut).connect(kit.steady)
  // ディーゼルのがらがら音（高い雑音が点火ごとに鳴る）
  const clatter = gain()
  const clatterDepth = gain()
  kit.loop('white').connect(filter('highpass', 1900)).connect(clatter).connect(engOut)
  fire.connect(clatterDepth).connect(clatter.gain)
  // 駆動系の唸り（速さに比例する細い音）
  const whine = osc('sine', 200)
  const whineGain = gain()
  whine.connect(whineGain).connect(engOut)

  // ---- タイヤと風 ----
  const roarTone = filter('lowpass', 200)
  const roar = gain()
  kit.loop('brown').connect(roarTone).connect(roar).connect(kit.steady)
  const windTone = filter('bandpass', 600, 0.6)
  const wind = gain()
  kit.loop('white').connect(windTone).connect(wind).connect(kit.steady)
  const skidSrc = kit.loop('white')
  // 鳴きの芯: ゴムが路面で震える音。雑音で音程を細かく揺らして、澄んだ笛にならないようにする
  const squealA = osc('sawtooth', 980)
  const squealB = osc('sawtooth', 1640)
  const squealJitter = gain(90)
  kit.loop('brown').connect(squealJitter)
  squealJitter.connect(squealA.frequency)
  squealJitter.connect(squealB.frequency)
  const squealGain = gain(0.05)
  const skidA = filter('bandpass', 980, 6)
  const skidB = filter('bandpass', 1640, 8)
  const skidHiss = filter('bandpass', 3200, 0.8)
  const skidHissGain = gain(0.2)
  const skid = gain()
  skidSrc.connect(skidA).connect(skid)
  skidSrc.connect(skidB).connect(skid)
  squealA.connect(squealGain)
  squealB.connect(squealGain)
  squealGain.connect(skidA)
  squealGain.connect(skidB)
  skidSrc.connect(skidHiss).connect(skidHissGain).connect(skid)
  kit.place(skid, 0.25, kit.steady)

  // ---- 街の地の音 ----
  const bed = gain()
  kit.loop('brown').connect(filter('lowpass', 240)).connect(bed).connect(kit.steady)
  const air = gain()
  kit.loop('white').connect(filter('bandpass', 900, 0.3)).connect(air).connect(kit.steady)

  // ---- 雑踏: 声の高さの帯域を、それぞれ別の速さで揺らす（大勢がばらばらに話している感じ） ----
  const crowdBus = gain(1)
  // 声の基音（100〜250Hz）は切る。遠くの人声は母音の響きだけが届く
  const crowdThin = filter('highpass', 280, 0.7)
  crowdBus.connect(crowdThin)
  const crowdPan = kit.place(crowdThin, 0.2, kit.steady)
  const crowdSrc = kit.loop('white')
  const bands = CROWD_BANDS.slice(0, opts.lite ? 3 : CROWD_BANDS.length).map(([freq, level, rateA, rateB], i) => {
    const g = gain()
    crowdSrc.connect(filter('bandpass', freq, 2.4)).connect(g).connect(crowdBus)
    return { g, level, rateA, rateB, phase: i * 1.7 }
  })

  // ---- 話し声: 声の高さの発振音を母音の響きに通し、音節の拍で鳴らす。言葉にはならない遠くの会話になる ----
  const talkers = Array.from({ length: opts.lite ? 2 : 5 }, (_, i) => {
    const source = osc('sawtooth', 150)
    const out = gain()
    const low = filter('bandpass', 600, 5)
    const high = filter('bandpass', 1400, 6)
    const highGain = gain(1.6)
    source.connect(low).connect(out)
    source.connect(high).connect(highGain).connect(out)
    out.connect(crowdBus)
    // 男女の声の高さを混ぜ、話す速さも人ごとに変える
    return { source, out, low, high, base: [118, 205, 142, 236, 168][i], rate: 3.3 + i * 0.47, phase: i * 0.37 }
  })

  // ---- 行き交う車 ----
  const trafficBus = gain(1)
  const trafficPan = kit.place(trafficBus, 0.15, kit.steady)
  const trafficHiss = gain()
  const trafficLow = gain()
  kit.loop('white').connect(filter('bandpass', 420, 0.6)).connect(trafficHiss).connect(trafficBus)
  kit.loop('brown').connect(filter('lowpass', 190)).connect(trafficLow).connect(trafficBus)

  // ---- 電車: 低い轟き・車体の風切り・車輪のきしみ ----
  const trainBus = gain(1)
  const trainPan = kit.place(trainBus, 0.3, kit.steady)
  const trainLow = gain()
  const trainMid = gain()
  const trainSqueal = gain()
  const squealTone = filter('bandpass', 2900, 6)
  kit.loop('brown').connect(filter('lowpass', 420)).connect(trainLow).connect(trainBus)
  const trainSrc = kit.loop('white')
  trainSrc.connect(filter('bandpass', 700, 0.8)).connect(trainMid).connect(trainBus)
  trainSrc.connect(squealTone).connect(trainSqueal).connect(trainBus)

  // ---- サイレン: 上がって下がる連続音。遠いほどこもる ----
  const sirens = Array.from({ length: opts.lite ? 1 : 2 }, (_, i) => {
    const main = osc('sawtooth', 500)
    const body = osc('square', 500)
    const bodyGain = gain(0.22)
    const tone = filter('lowpass', 1200, 0.9)
    const out = gain()
    main.connect(tone)
    body.connect(bodyGain).connect(tone)
    tone.connect(out)
    return { main, body, tone, out, pan: kit.place(out, 0.35, kit.steady), offset: i * 2.3, detune: i ? 0.965 : 1 }
  })

  const apply = (f: AudioFrame, at: number) => {
    const t = f.t
    const driving = f.mode === 'drive' ? 1 : 0
    const e = f.engine

    // ---- エンジン ----
    if (e.cyl !== cyl) {
      cyl = e.cyl
      engOn.setPeriodicWave(waves[cyl].on)
      engOff.setPeriodicWave(waves[cyl].off)
    }
    const rn = clamp((e.rpm - ENGINE_TUNING.idle) / (ENGINE_TUNING.redline - ENGINE_TUNING.idle), 0, 1)
    // アイドルは回転がわずかに揺れる（一定の音程だと機械的に聞こえる）
    const lump = (1 - rn) * (1 - rn)
    const rpm = e.rpm + lump * (Math.sin(t * 31) * 12 + Math.sin(t * 5.3) * 20 + Math.sin(t * 1.7) * 16)
    const cycle = (rpm / 120) * e.pitch
    glide(engOn.frequency, cycle, at)
    glide(engOff.frequency, cycle, at)
    glide(fire.frequency, cycle * cyl, at)
    glide(engOnGain.gain, (0.1 + 0.9 * e.load) * 0.55, at)
    glide(engOffGain.gain, (1 - e.load * 0.75) * 0.32, at)
    const raspLevel = (0.08 + 0.42 * e.load) * (0.35 + 0.65 * rn)
    glide(rasp.gain, raspLevel, at)
    glide(raspDepth.gain, raspLevel * 0.9, at)
    glide(raspBand.frequency, 520 + rn * 1900, at)
    glide(engTone.frequency, 320 + (800 + 3600 * e.load) * (0.3 + 0.7 * rn), at)
    glide(engOut.gain, e.on * (0.22 + 0.42 * e.load + 0.16 * rn) * 0.8, at, 0.05)
    const clatterLevel = e.clatter * (0.05 + 0.05 * e.load)
    glide(clatter.gain, clatterLevel, at)
    glide(clatterDepth.gain, clatterLevel * 0.9, at)
    glide(whine.frequency, 210 + f.speed * 34, at)
    glide(whineGain.gain, Math.min(1, f.speed / 22) * 0.02 * (0.3 + e.load), at)

    // ---- タイヤと風 ----
    const v = clamp(f.speed / 30, 0, 1)
    glide(roarTone.frequency, 160 + f.speed * 42, at)
    glide(roar.gain, driving * Math.pow(v, 1.4) * 0.3, at, 0.08)
    glide(windTone.frequency, 520 + f.speed * 45, at)
    glide(wind.gain, driving * v * v * 0.09, at, 0.08)
    const squealHzA = 980 * (1 + 0.1 * Math.sin(t * 9.1) + 0.16 * f.skid)
    const squealHzB = 1640 * (1 + 0.08 * Math.sin(t * 7.3 + 1) + 0.1 * f.skid)
    glide(skidA.frequency, squealHzA, at)
    glide(skidB.frequency, squealHzB, at)
    glide(squealA.frequency, squealHzA, at)
    glide(squealB.frequency, squealHzB, at)
    glide(skid.gain, Math.pow(f.skid, 1.2) * 2.4, at, 0.04)

    // ---- 街 ----
    // 車に乗っているあいだは外の音を少し引く（エンジンに場所を譲る）
    const outside = 1 - driving * 0.3
    glide(bed.gain, f.bed * outside * 0.1 * (0.85 + 0.15 * Math.sin(t * 0.23)), at, 0.3)
    glide(air.gain, f.bed * outside * 0.03, at, 0.3)
    for (const b of bands) {
      const wobble = 0.5 + 0.5 * Math.sin(t * b.rateA + b.phase) * Math.sin(t * b.rateB + b.phase * 2.1)
      glide(b.g.gain, f.crowd * outside * b.level * (0.3 + 0.7 * wobble) * (0.3 + f.panic * 0.3), at, 0.05)
    }
    talkers.forEach((k, i) => {
      const beat = t * k.rate + k.phase
      const syllable = Math.floor(beat)
      const within = beat - syllable
      // 3割は息継ぎで黙る。怯えているときは高く、切れ目なく
      const speaking = hash(syllable, i) < 0.7 + f.panic * 0.25
      const envelope = speaking ? Math.pow(Math.sin(Math.PI * within), 0.7) : 0
      const [f1, f2] = TALK_VOWELS[Math.floor(hash(syllable, i + 20) * TALK_VOWELS.length)]
      glide(k.source.frequency, k.base * (0.86 + 0.3 * hash(syllable, i + 10)) * (1 - 0.1 * within) * (1 + f.panic * 0.35), at, 0.015)
      glide(k.low.frequency, f1, at, 0.02)
      glide(k.high.frequency, f2, at, 0.02)
      glide(k.out.gain, f.crowd * outside * envelope * 0.55, at, 0.012)
    })
    if (crowdPan) glide(crowdPan.pan, f.crowdPan * 0.7, at, 0.2)
    glide(trafficHiss.gain, f.traffic * outside * 0.11, at, 0.15)
    glide(trafficLow.gain, f.traffic * outside * 0.2, at, 0.15)
    if (trafficPan) glide(trafficPan.pan, f.trafficPan, at, 0.2)
    glide(trainLow.gain, f.train * 0.3, at, 0.2)
    glide(trainMid.gain, f.train * 0.3, at, 0.2)
    glide(trainSqueal.gain, f.train * 0.06 * (0.5 + 0.5 * Math.sin(t * 1.9)), at, 0.1)
    glide(squealTone.frequency, 2900 + Math.sin(t * 0.8) * 350, at, 0.1)
    if (trainPan) glide(trainPan.pan, f.trainPan, at, 0.3)

    // ---- サイレン ----
    sirens.forEach((s, i) => {
      const voice = f.sirens[i]
      const hz = sirenHz(t, s.offset) * voice.pitch * s.detune
      glide(s.main.frequency, hz, at)
      glide(s.body.frequency, hz, at)
      glide(s.tone.frequency, 650 + 2300 * voice.gain, at, 0.1)
      glide(s.out.gain, Math.pow(voice.gain, 1.3) * 0.2, at, 0.15)
      if (s.pan) glide(s.pan.pan, voice.pan, at, 0.15)
    })
  }

  return { output: kit.output, apply, cue: (cue, at) => playCue(kit, cue, at) }
}
