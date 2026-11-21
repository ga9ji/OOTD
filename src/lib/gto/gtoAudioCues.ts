// Grand Theft Outfit [部品: audio] 1回きりの音の作り方（衝突・足音・ドア・服を奪う音・合図）。
// 入口: playCue(kit, cue, at)
// 契約: 素材ファイルなし。雑音の一吹き（burst）と発振音（tone / bell）の重ね合わせだけで作る。
//       旋律はこのゲームのために書いた短い動機で、既存の曲や効果音は写していない。
import type { AudioCue } from './gtoAudioModel'
import type { Kit } from './gtoAudioKit'

/** 合図に使う音の高さ（Hz）。ニ長調の五音 */
const N = { D3: 146.8, A3: 220, D4: 293.7, E4: 329.6, G4: 392, A4: 440, B4: 493.9, D5: 587.3, E5: 659.3, Fs5: 740, A5: 880, B5: 987.8, D6: 1174.7, E6: 1318.5, Fs6: 1480 }

/** 1回きりの音の全体の大きさ（鳴りっぱなしの音との釣り合い） */
const CUE_LEVEL = 1.4

/** 母音ごとの響きの山（声らしく聞かせる2つの帯域） */
const VOWELS: [number, number][] = [
  [720, 1150],
  [420, 1950],
  [360, 880],
  [540, 1700],
  [310, 2250],
]

/** 意味のない短い声（雑踏のひとこと・驚き）。言葉にはしない */
function voice(kit: Kit, at: number, vol: number, pan: number, seedValue: number, fear: number) {
  const { ctx } = kit
  const syllables = 1 + Math.floor(kit.random() * 3)
  const base = (120 + (seedValue % 1) * 130) * (1 + fear * 0.7)
  let t = at
  for (let i = 0; i < syllables; i++) {
    const dur = 0.09 + kit.random() * 0.14 + fear * 0.12
    const [f1, f2] = VOWELS[Math.floor(kit.random() * VOWELS.length)]
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const pitch = base * (0.9 + kit.random() * 0.25)
    osc.frequency.setValueAtTime(pitch, t)
    osc.frequency.exponentialRampToValueAtTime(pitch * (0.82 + kit.random() * 0.4), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.025)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    for (const [f, q, level] of [
      [f1, 3, 1],
      [f2, 4, 0.6],
    ]) {
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = f
      band.Q.value = q
      const lv = ctx.createGain()
      lv.gain.value = level
      osc.connect(band).connect(lv).connect(g)
    }
    const panner = kit.place(g, 0.35)
    if (panner) panner.pan.value = pan
    osc.start(t)
    osc.stop(t + dur + 0.03)
    t += dur + 0.02 + kit.random() * 0.05
  }
}

/** ドアの音。開ける「カチャ」と閉める「バム」 */
function door(kit: Kit, at: number, g: number, pan: number, slam: number) {
  kit.burst({ at, filter: 'bandpass', f: 2600, q: 3, dur: 0.035, vol: 0.07 * g, pan })
  kit.burst({ at: at + 0.02, filter: 'bandpass', f: 900, q: 2, dur: 0.05, vol: 0.05 * g, pan })
  const shut = at + 0.34
  kit.burst({ at: shut, noise: 'brown', filter: 'lowpass', f: 420, dur: 0.16, vol: 0.3 * g * slam, pan, verb: 0.3 })
  kit.tone({ at: shut, wave: 'sine', f: 105, f1: 58, dur: 0.14, vol: 0.35 * g * slam, pan })
  kit.burst({ at: shut, filter: 'bandpass', f: 1700, q: 1.5, dur: 0.04, vol: 0.05 * g * slam, pan })
}

/** ぶつかった音。強さ（m/s）で、鈍い当たり → 板金のつぶれ → ガラスまで重ねる */
function crash(kit: Kit, at: number, g: number, pan: number, impact: number) {
  const n = Math.max(0.22, Math.min(1, impact / 16))
  kit.duck(at, n * g * 0.7)
  kit.tone({ at, wave: 'sine', f: 120, f1: 36, dur: 0.22 + n * 0.25, vol: 0.7 * n * g, pan })
  kit.burst({ at, noise: 'brown', filter: 'lowpass', f: 700, f1: 180, dur: 0.2 + n * 0.25, vol: 0.7 * n * g, pan, verb: 0.4 })
  kit.burst({ at, filter: 'bandpass', f: 1500 + n * 1400, f1: 500, q: 0.8, dur: 0.2 + n * 0.45, vol: 1.0 * n * g, pan, verb: 0.4 })
  kit.burst({ at, filter: 'lowpass', f: 5000 + n * 3000, f1: 900, dur: 0.08 + n * 0.14, vol: 1.3 * n * g, pan })
  // 板金の鳴り（倍音が揃わない短い響きを数本）
  const rings = 2 + Math.round(n * 4)
  for (let i = 0; i < rings; i++) {
    const f = 380 + kit.random() * 2400
    kit.tone({ at: at + kit.random() * 0.05 * (i + 1), wave: 'triangle', f, f1: f * (0.93 + kit.random() * 0.05), dur: 0.06 + kit.random() * 0.22 * n, vol: 0.16 * n * g, pan, verb: 0.3 })
  }
  if (n > 0.5) {
    // ガラスが散る
    const bits = Math.round(6 + n * 12)
    for (let i = 0; i < bits; i++) {
      kit.tone({ at: at + 0.03 + kit.random() * 0.55, wave: 'sine', f: 2800 + kit.random() * 5200, dur: 0.02 + kit.random() * 0.05, vol: 0.05 * n * g, pan: pan + kit.random() * 0.5 - 0.25 })
    }
    kit.burst({ at: at + 0.02, filter: 'highpass', f: 5200, dur: 0.4, vol: 0.08 * n * g, pan })
    // 外れた部品が転がる
    kit.burst({ at: at + 0.35, filter: 'bandpass', f: 1900, q: 4, dur: 0.07, vol: 0.04 * g, pan })
    kit.burst({ at: at + 0.52, filter: 'bandpass', f: 2300, q: 4, dur: 0.05, vol: 0.025 * g, pan })
  }
}

function horn(kit: Kit, at: number, g: number, pan: number, far: boolean, variant: number) {
  const base = far ? 370 + Math.floor(variant * 3) * 28 : 415
  const dur = far ? 0.25 + variant * 0.4 : 0.34
  const lowpass = far ? 900 : 2600
  for (const [mul, level] of [
    [1, 1],
    [1.26, 0.8],
  ]) {
    kit.tone({ at, wave: 'sawtooth', f: base * mul, dur, vol: (far ? 0.06 : 0.3) * level * g, attack: 0.015, pan, verb: far ? 0.8 : 0.35, lowpass })
  }
}

/** 布が擦れる音 */
const swish = (kit: Kit, at: number, from: number, to: number, dur: number, vol: number, pan: number) => kit.burst({ at, filter: 'bandpass', f: from, f1: to, q: 1.4, dur, vol, attack: dur * 0.35, pan })

/** その合図を at 秒に鳴らす */
export function playCue(kit: Kit, cue: AudioCue, at: number): void {
  if (cue.gain < 0.01) return
  const g = cue.gain * CUE_LEVEL
  const pan = cue.pan
  const v = cue.value ?? 0
  switch (cue.type) {
    case 'step': {
      // かかとの硬い音と、靴底の低い音。1歩ごとに少しずつ違う
      const run = v > 0 ? 1 : 0
      const vary = 0.8 + kit.random() * 0.4
      kit.burst({ at, filter: 'bandpass', f: 1700 * vary, f1: 900, q: 1.3, dur: 0.04, vol: (0.08 + run * 0.04) * g, pan, verb: 0.2 })
      kit.burst({ at, noise: 'brown', filter: 'bandpass', f: 260 * vary, q: 0.8, dur: 0.06, vol: (0.07 + run * 0.05) * g, pan })
      kit.burst({ at: at + 0.045 - run * 0.02, filter: 'highpass', f: 3200, dur: 0.05, vol: (0.01 + run * 0.012) * g, attack: 0.02, pan })
      break
    }
    case 'enter':
      door(kit, at, g, pan, 1)
      // セルが回って掛かる
      for (let i = 0; i < 4; i++) kit.tone({ at: at + 0.52 + i * 0.085, wave: 'sawtooth', f: 62 + i * 5, dur: 0.07, vol: 0.2 * g, lowpass: 600, pan })
      kit.burst({ at: at + 0.52, filter: 'bandpass', f: 1300, q: 5, dur: 0.36, vol: 0.012 * g, attack: 0.05, pan })
      break
    case 'exit':
      door(kit, at, g, pan, 0.9)
      break
    case 'carjack':
      door(kit, at, g, pan, 1.15)
      swish(kit, at + 0.1, 700, 2200, 0.16, 0.05 * g, pan)
      voice(kit, at + 0.14, 0.4 * g, pan, 0.6, 0.8)
      kit.burst({ at: at + 0.24, noise: 'brown', filter: 'lowpass', f: 350, dur: 0.12, vol: 0.2 * g, pan })
      break
    case 'steal': {
      // 布を引く → ファスナー → 自分の物になった合図
      swish(kit, at, 500, 3200, 0.22, 0.1 * g, pan - 0.2)
      swish(kit, at + 0.2, 2800, 700, 0.2, 0.07 * g, pan + 0.2)
      for (let i = 0; i < 11; i++) kit.burst({ at: at + 0.1 + i * 0.017, filter: 'bandpass', f: 2600 + i * 260, q: 6, dur: 0.012, vol: 0.02 * g, pan })
      kit.bell(N.E6, at + 0.44, 0.35, 0.1 * g, -0.15)
      kit.bell(N.B5, at + 0.52, 0.5, 0.1 * g, 0.15)
      break
    }
    case 'crash':
      crash(kit, at, g, pan, v || 4)
      break
    case 'hitPed':
      kit.burst({ at, noise: 'brown', filter: 'lowpass', f: 520, dur: 0.16, vol: 0.3 * g, pan, verb: 0.2 })
      kit.tone({ at, wave: 'sine', f: 140, f1: 70, dur: 0.12, vol: 0.4 * g, pan })
      voice(kit, at + 0.05, 0.5 * g, pan, 0.8, 1)
      break
    case 'horn':
      horn(kit, at, g, pan, false, 0)
      break
    case 'farHorn':
      horn(kit, at, g, pan, true, v)
      break
    case 'wantedUp': {
      // 無線が開く雑音 → 低い2音の警告。手配度が高いほど1音増える
      kit.burst({ at, filter: 'bandpass', f: 2300, q: 2.5, dur: 0.11, vol: 0.05 * g, attack: 0.002 })
      kit.burst({ at: at + 0.13, filter: 'bandpass', f: 1800, q: 3, dur: 0.05, vol: 0.035 * g })
      const stabs = v >= 3 ? 3 : 2
      for (let i = 0; i < stabs; i++) {
        const t = at + 0.2 + i * 0.19
        kit.tone({ at: t, wave: 'sawtooth', f: i % 2 ? N.D3 * 1.06 : N.D3, dur: 0.3, vol: 0.34 * g, lowpass: 900, verb: 0.4 })
        kit.tone({ at: t, wave: 'square', f: (i % 2 ? N.D3 * 1.06 : N.D3) * 3, dur: 0.12, vol: 0.1 * g, lowpass: 1800 })
      }
      break
    }
    case 'wantedClear':
      swish(kit, at, 3200, 500, 0.6, 0.035 * g, 0)
      kit.bell(N.A4, at + 0.15, 0.6, 0.11 * g, -0.2)
      kit.bell(N.E5, at + 0.33, 0.9, 0.11 * g, 0.2)
      break
    case 'busted':
      // 手錠の歯が詰まっていく音 → 沈む3音
      for (let i = 0; i < 7; i++) kit.burst({ at: at + i * (0.05 - i * 0.004), filter: 'bandpass', f: 3100, q: 8, dur: 0.014, vol: 0.035 * g })
      kit.burst({ at: at + 0.3, filter: 'bandpass', f: 1500, q: 3, dur: 0.05, vol: 0.07 * g })
      ;[N.A3, N.A3 * 0.84, N.D3].forEach((f, i) => kit.tone({ at: at + 0.42 + i * 0.26, wave: 'sawtooth', f, f1: f * 0.97, dur: i === 2 ? 0.9 : 0.3, vol: 0.2 * g, lowpass: 800, verb: 0.5 }))
      break
    case 'missionStart':
      // 上へ開く3音と、下で支える1音
      kit.tone({ at, wave: 'triangle', f: N.D3, dur: 0.9, vol: 0.14 * g, verb: 0.4 })
      ;[N.D5, N.A5, N.E6].forEach((f, i) => kit.bell(f, at + i * 0.13, 0.7, 0.13 * g, i * 0.25 - 0.25))
      break
    case 'missionStep':
      kit.bell(N.A5, at, 0.3, 0.11 * g, -0.15)
      kit.bell(N.D6, at + 0.1, 0.55, 0.11 * g, 0.15)
      break
    case 'missionDone':
      ;[N.D5, N.Fs5, N.A5, N.D6, N.Fs6].forEach((f, i) => kit.bell(f, at + i * 0.1, 0.5, 0.12 * g, i * 0.2 - 0.4))
      ;[N.D4, N.A4, N.Fs5, N.D6].forEach((f) => kit.bell(f, at + 0.6, 1.5, 0.1 * g, 0))
      kit.burst({ at: at + 0.6, filter: 'highpass', f: 6000, dur: 0.9, vol: 0.03 * g, attack: 0.05, verb: 0.6 })
      break
    case 'missionFail':
      ;[N.G4, N.E4 * 0.944, N.D4 * 0.89].forEach((f, i) => kit.tone({ at: at + i * 0.2, wave: 'triangle', f, f1: f * 0.96, dur: i === 2 ? 0.9 : 0.28, vol: 0.2 * g, verb: 0.5 }))
      kit.burst({ at: at + 0.4, noise: 'brown', filter: 'lowpass', f: 200, dur: 0.5, vol: 0.2 * g })
      break
    case 'shot':
      // [cheats] 戦車の砲: 腹に響く低い破裂と、砲身の鳴り
      kit.burst({ at, noise: 'brown', filter: 'lowpass', f: 420, f1: 90, dur: 0.5, vol: 0.5 * g, pan, verb: 0.5 })
      kit.burst({ at, filter: 'bandpass', f: 1800, f1: 500, q: 0.8, dur: 0.09, vol: 0.2 * g, pan })
      kit.tone({ at, wave: 'sine', f: 95, f1: 42, dur: 0.45, vol: 0.4 * g, attack: 0.004, pan })
      break
    case 'blast':
      // [cheats] 着弾: 少し遅れて届く爆発と、ぱらぱら落ちる破片
      kit.burst({ at: at + 0.05, noise: 'brown', filter: 'lowpass', f: 700, f1: 110, dur: 0.9, vol: 0.55 * g, pan, verb: 0.7 })
      kit.burst({ at: at + 0.05, filter: 'bandpass', f: 2400, f1: 700, q: 0.7, dur: 0.16, vol: 0.16 * g, pan, verb: 0.4 })
      for (let i = 0; i < 4; i++) kit.burst({ at: at + 0.3 + i * 0.09 + kit.random() * 0.05, filter: 'highpass', f: 2600, dur: 0.04, vol: 0.03 * g, pan, verb: 0.5 })
      break
    case 'cheat':
      // [cheats] 裏コードが通じた: 電話の呼び出しのような 2 連の短い音と、上へ抜ける 1 音
      for (let i = 0; i < 2; i++) kit.tone({ at: at + i * 0.11, wave: 'square', f: N.A5, dur: 0.07, vol: 0.05 * g, attack: 0.005, lowpass: 2400 })
      kit.bell(N.E6, at + 0.26, 0.6, 0.11 * g, 0)
      break
    case 'shift':
      kit.burst({ at, noise: 'brown', filter: 'lowpass', f: 600, dur: 0.05, vol: 0.08 * g })
      kit.burst({ at: at + 0.01, filter: 'bandpass', f: 1900, q: 3, dur: 0.02, vol: 0.015 * g })
      break
    case 'pop':
      // アクセルを離したときの排気の破裂
      for (let i = 0; i < 2 + Math.floor(v * 2); i++) {
        const t = at + 0.08 + i * (0.07 + kit.random() * 0.06)
        kit.burst({ at: t, noise: 'brown', filter: 'lowpass', f: 900, dur: 0.05, vol: 0.2 * g, verb: 0.3 })
        kit.burst({ at: t, filter: 'bandpass', f: 1400, q: 1, dur: 0.025, vol: 0.05 * g })
      }
      break
    case 'chirp': {
      // 歩行者信号の誘導音（鳥の声を模した2種類の短い下降音）
      const high = v > 0
      for (let i = 0; i < 2; i++) {
        const t = at + i * (high ? 0.16 : 0.2)
        kit.tone({ at: t, wave: 'sine', f: high ? 3100 : 2300, f1: high ? 2100 : 1500, dur: high ? 0.09 : 0.13, vol: 0.13 * g, attack: 0.01, pan, verb: 0.5 })
      }
      break
    }
    case 'clack':
      // 線路の継ぎ目を2つの台車が越える
      for (let i = 0; i < 2; i++) {
        const t = at + i * 0.085
        kit.burst({ at: t, noise: 'brown', filter: 'lowpass', f: 260, dur: 0.09, vol: 0.3 * g, pan })
        kit.burst({ at: t, filter: 'bandpass', f: 800, q: 1.5, dur: 0.05, vol: 0.06 * g, pan })
        kit.burst({ at: t, filter: 'bandpass', f: 2100 + v * 600, q: 3, dur: 0.02, vol: 0.02 * g, pan, verb: 0.3 })
      }
      break
    case 'voice':
      voice(kit, at, 0.45 * g, pan, v, v >= 1 ? 0.8 : 0)
      break
    case 'thunder': {
      // 雷鳴。光ってから少し遅れて、裂ける音 → 低い轟きが転がって遠ざかる
      const t = at + 0.35 + v * 0.9
      kit.burst({ at: t, filter: 'bandpass', f: 1800, f1: 400, q: 0.6, dur: 0.35, vol: 0.28 * g, pan, verb: 0.6 })
      kit.burst({ at: t + 0.05, noise: 'brown', filter: 'lowpass', f: 320, f1: 70, dur: 2.6, vol: 0.8 * g, attack: 0.08, pan, verb: 0.7 })
      for (let i = 0; i < 3; i++) {
        kit.burst({ at: t + 0.5 + i * (0.45 + kit.random() * 0.3), noise: 'brown', filter: 'lowpass', f: 180 + kit.random() * 90, f1: 60, dur: 0.9, vol: (0.5 - i * 0.12) * g, attack: 0.12, pan: pan * 0.5, verb: 0.7 })
      }
      break
    }
  }
}
