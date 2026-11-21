// Grand Theft Outfit [部品: weather] 天気。晴れ・くもり・雨・雷雨・霧が、遊んでいるあいだに勝手に移り変わる。
// 入口: createWeatherClock(seed, fixed) → at(t) / weatherLook(time, view) / parseWeather(text)
// 契約: 天気は「種と経過秒」だけで決まる（状態を持たないので、同じ種なら同じ移り変わりになる）。
//       ここは量（雲・雨・霧・風・路面の濡れ・稲光）を 0..1 で返すだけ。空と光への写し方は weatherLook が決め、
//       描画（renderSky.ts / renderWeather.ts）と音（gtoAudio）はその数字を読む。遊びのルール（sim.ts）には触らない。
import { clamp, rand } from './math'
import type { TimeOfDay } from './types'

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog'

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog']

/** HUD に出す名前（翻訳の鍵） */
export const WEATHER_LABEL: Record<WeatherKind, string> = { clear: '晴れ', cloudy: 'くもり', rain: '雨', storm: '雷雨', fog: '霧' }

/** 天気ごとの量（0..1） */
interface Amounts {
  /** 雲が空を覆う割合 */
  overcast: number
  rain: number
  fog: number
  wind: number
  /** 稲光の出やすさ */
  storm: number
}

const AMOUNTS: Record<WeatherKind, Amounts> = {
  clear: { overcast: 0, rain: 0, fog: 0, wind: 0.1, storm: 0 },
  cloudy: { overcast: 0.75, rain: 0, fog: 0.1, wind: 0.3, storm: 0 },
  rain: { overcast: 0.95, rain: 0.6, fog: 0.3, wind: 0.45, storm: 0 },
  storm: { overcast: 1, rain: 1, fog: 0.4, wind: 1, storm: 1 },
  fog: { overcast: 0.6, rain: 0, fog: 1, wind: 0.05, storm: 0 },
}

/** 1つの天気が続く秒数の幅。数分の遊びの中で 2〜3 回は変わる長さ */
const DURATION: Record<WeatherKind, readonly [min: number, max: number]> = {
  clear: [60, 110],
  cloudy: [45, 80],
  rain: [55, 95],
  storm: [40, 70],
  fog: [45, 75],
}

/** 次の天気の出やすさ。同じ天気は続けない（変わったことが分かるように）。晴れからいきなり雷雨にはならない */
const NEXT: Record<WeatherKind, readonly (readonly [kind: WeatherKind, weight: number])[]> = {
  clear: [
    ['cloudy', 0.6],
    ['rain', 0.25],
    ['fog', 0.15],
  ],
  cloudy: [
    ['clear', 0.4],
    ['rain', 0.4],
    ['storm', 0.1],
    ['fog', 0.1],
  ],
  rain: [
    ['clear', 0.35],
    ['cloudy', 0.35],
    ['storm', 0.3],
  ],
  storm: [
    ['rain', 0.6],
    ['cloudy', 0.3],
    ['clear', 0.1],
  ],
  fog: [
    ['clear', 0.5],
    ['cloudy', 0.4],
    ['rain', 0.1],
  ],
}

/** 最初の天気の出やすさ */
const FIRST: readonly (readonly [kind: WeatherKind, weight: number])[] = [
  ['clear', 0.5],
  ['cloudy', 0.2],
  ['rain', 0.15],
  ['fog', 0.1],
  ['storm', 0.05],
]

/** 前の天気から移り変わるのに掛ける秒 */
export const WEATHER_BLEND = 14
/** 降り始めてから路面が濡れきるまでの秒と、止んでから乾ききるまでの秒 */
const WET_SECONDS = 10
const DRY_SECONDS = 80
/** 稲光を置く時間の刻み（秒）と、1つの稲光が見えている秒 */
const STRIKE_SLOT = 6.5
const STRIKE_SECONDS = 0.6

export interface WeatherView {
  /** いまの天気（移り変わりの途中は、向かっている先） */
  kind: WeatherKind
  overcast: number
  rain: number
  fog: number
  wind: number
  /** 路面の濡れ（雨より遅れて増え、止んだあともしばらく残る） */
  wet: number
  /** 稲光の明るさ 0..1 */
  flash: number
  /** 稲光が出ているあいだ、その稲光の番号（雷鳴を1回だけ鳴らすため）。出ていなければ null */
  strike: number | null
}

interface Segment {
  index: number
  kind: WeatherKind
  /** 前の天気（最初の区間は自分と同じ） */
  from: WeatherKind
  start: number
  end: number
  /** 区間の始まりでの路面の濡れ */
  wet: number
}

/** 種・番号・用途から決まる 0..1 の数（番号が1つ違えば、まったく別の数になる） */
const roll = (seed: number, a: number, b: number) => rand((seed + Math.imul(a + 1, 0x9e3779b1) + Math.imul(b + 1, 0x85ebca6b)) | 0)[0]

const pick = (table: readonly (readonly [WeatherKind, number])[], value: number): WeatherKind => {
  const total = table.reduce((sum, [, w]) => sum + w, 0)
  let left = value * total
  for (const [kind, weight] of table) {
    left -= weight
    if (left < 0) return kind
  }
  return table[table.length - 1][0]
}

const smooth = (x: number) => {
  const c = clamp(x, 0, 1)
  return c * c * (3 - 2 * c)
}

const rains = (kind: WeatherKind) => AMOUNTS[kind].rain > 0

/** 区間の中の時刻での路面の濡れ */
const wetAt = (seg: Segment, t: number) => {
  const dt = Math.max(0, t - seg.start)
  return rains(seg.kind) ? Math.min(1, seg.wet + dt / WET_SECONDS) : Math.max(0, seg.wet - dt / DRY_SECONDS)
}

function segmentAfter(seed: number, prev: Segment | null): Segment {
  const index = prev ? prev.index + 1 : 0
  const kind = prev ? pick(NEXT[prev.kind], roll(seed, index, 1)) : pick(FIRST, roll(seed, 0, 1))
  const [min, max] = DURATION[kind]
  const start = prev ? prev.end : 0
  const from = prev ? prev.kind : kind
  // 最初から雨なら、路面も最初から濡れている
  return { index, kind, from, start, end: start + min + (max - min) * roll(seed, index, 2), wet: prev ? wetAt(prev, prev.end) : rains(kind) ? 1 : 0 }
}

/** 稲光の明るさ（2度光る）。dt は光り始めてからの秒 */
const flashShape = (dt: number) => (dt < 0 || dt >= STRIKE_SECONDS ? 0 : Math.max(Math.exp(-dt * 12), dt >= 0.14 ? 0.8 * Math.exp(-(dt - 0.14) * 9) : 0))

function lightning(seed: number, t: number, storm: number): Pick<WeatherView, 'flash' | 'strike'> {
  if (storm <= 0.3 || t < 0) return { flash: 0, strike: null }
  const slot = Math.floor(t / STRIKE_SLOT)
  // 4回に1回は光らない（間合いをそろえない）
  if (roll(seed, slot, 3) > 0.75) return { flash: 0, strike: null }
  const dt = t - (slot + roll(seed, slot, 4) * 0.8) * STRIKE_SLOT
  if (dt < 0 || dt >= STRIKE_SECONDS) return { flash: 0, strike: null }
  return { flash: flashShape(dt) * storm, strike: slot }
}

function viewOf(seed: number, seg: Segment, t: number): WeatherView {
  const a = AMOUNTS[seg.from]
  const b = AMOUNTS[seg.kind]
  const k = smooth((t - seg.start) / WEATHER_BLEND)
  const mix = (key: keyof Amounts) => a[key] + (b[key] - a[key]) * k
  return { kind: seg.kind, overcast: mix('overcast'), rain: mix('rain'), fog: mix('fog'), wind: mix('wind'), wet: wetAt(seg, t), ...lightning(seed, t, mix('storm')) }
}

export interface WeatherClock {
  /** 経過秒 t の天気。時刻は戻ってもよい（最初からやり直したとき） */
  at: (t: number) => WeatherView
}

/**
 * 天気の時計を作る。fixed を渡すと、その天気のまま変わらない（撮影用。同じクエリなら同じ絵にする）。
 * 渡さなければ、種から決まる順番と長さで移り変わる。
 */
export function createWeatherClock(seed: number, fixed: WeatherKind | null = null): WeatherClock {
  if (fixed) {
    const still: Segment = { index: 0, kind: fixed, from: fixed, start: 0, end: Infinity, wet: rains(fixed) ? 1 : 0 }
    return { at: (t) => viewOf(seed, still, Math.max(0, t)) }
  }
  // いまいる区間を覚えておき、時刻が進んだ分だけ先へ送る（毎回最初から数え直さない）
  let seg = segmentAfter(seed, null)
  return {
    at: (time) => {
      const t = Math.max(0, time)
      if (t < seg.start) seg = segmentAfter(seed, null)
      while (t >= seg.end) seg = segmentAfter(seed, seg)
      return viewOf(seed, seg, t)
    },
  }
}

/** URL の &weather= を読む。random は「移り変わる」、知らない語と指定なしは null */
export function parseWeather(text: string | null | undefined): WeatherKind | 'random' | null {
  if (text === 'random') return 'random'
  return WEATHER_KINDS.find((k) => k === text) ?? null
}

// ----------------------------------------------------------------------------
// 天気 → 空と光
// ----------------------------------------------------------------------------

/** くもった空の色（時刻ごと）。晴れの色（lighting.ts）から、雲の量だけこちらへ寄せる */
export interface WeatherTone {
  skyTop: number
  skyHorizon: number
  cloud: number
  /** 霧と、遠くがかすむ先の色 */
  fog: number
  /** くもり空からの天空光の色 */
  hemi: number
  /** くもると天空光が増える割合（直射が減る分を、空全体の明るさが少し埋める） */
  hemiBoost: number
  /** 雨粒の明るさ */
  drop: number
  /** 濡れた路面の照り返しの上乗せ */
  wetGloss: number
}

export const WEATHER_TONES: Record<TimeOfDay, WeatherTone> = {
  day: { skyTop: 0x8e9aa3, skyHorizon: 0xb9c2c6, cloud: 0xa9b1b6, fog: 0xc4ccce, hemi: 0xc9d2d8, hemiBoost: 0.45, drop: 0.9, wetGloss: 0.5 },
  dusk: { skyTop: 0x4b4658, skyHorizon: 0x8a7068, cloud: 0x6e6068, fog: 0x9a8478, hemi: 0x8a86a0, hemiBoost: 0.8, drop: 0.7, wetGloss: 0.5 },
  night: { skyTop: 0x0b0d16, skyHorizon: 0x1d1c2a, cloud: 0x1c1b28, fog: 0x34304a, hemi: 0x7f93c0, hemiBoost: 0.1, drop: 0.45, wetGloss: 0.7 },
}

/** 天気を空と光に写すときの数字。色は「晴れの色から tone の色へどれだけ寄せるか」の割合で持つ */
export interface WeatherLook {
  tone: WeatherTone
  /** 空・雲・霧・天空光の色をくもりの色へ寄せる割合（0..1） */
  gray: number
  /** 太陽（月）の直射・光芒・逆光に掛ける倍率 */
  sun: number
  /** 天空光に掛ける倍率（稲光の分は入れない） */
  hemi: number
  /** 稲光が天空光へ足す強さ */
  flash: number
  /** 雲の量（0..1。晴れの量 baseClouds から 1 へ寄せる割合） */
  clouds: number
  /** 星に掛ける倍率 */
  stars: number
  /** 霧が掛かり始める距離・消える距離に掛ける倍率 */
  fogNear: number
  fogFar: number
  /** 天気のかすみのいちばん濃い所の濃さ（0..1）と、濃さが 63% に届く距離 m */
  haze: number
  hazeLength: number
  /** 色を抜く割合（0..1） */
  desaturate: number
  /** ブルームに掛ける倍率（雨と霧の中では灯りがにじむ） */
  bloom: number
  /** 路面の照り返しの上乗せと、濡れた路面が周りの景色まで写す割合（0..1） */
  gloss: number
  mirror: number
  /** 濡れた路面を暗くする割合（0..1） */
  wetDark: number
}

/** 天気の量を、空と光の数字に直す */
export function weatherLook(time: TimeOfDay, w: WeatherView): WeatherLook {
  const tone = WEATHER_TONES[time]
  const o = clamp(w.overcast, 0, 1)
  const f = clamp(w.fog, 0, 1)
  const r = clamp(w.rain, 0, 1)
  const wet = clamp(w.wet, 0, 1)
  return {
    tone,
    gray: Math.max(o, f),
    sun: (1 - 0.88 * o) * (1 - 0.5 * f),
    hemi: (1 + tone.hemiBoost * o) * (1 - 0.18 * r),
    flash: w.flash * 1.4,
    clouds: o,
    stars: (1 - o) * (1 - f),
    fogNear: 1 - 0.85 * f,
    fogFar: 1 - 0.62 * f,
    haze: clamp(0.92 * f + 0.2 * r, 0, 0.95),
    hazeLength: 420 - 330 * f,
    desaturate: 0.35 * o,
    bloom: 1 + 0.6 * r + 0.8 * f,
    gloss: tone.wetGloss * wet,
    mirror: 0.6 * wet,
    wetDark: 0.22 * wet,
  }
}

/** 風で雨が流れる向き（東・南の成分。長さ 1）。種で決まり、遊んでいるあいだは変わらない */
export function windDir(seed: number): [x: number, z: number] {
  const a = roll(seed, 0, 5) * Math.PI * 2
  return [Math.cos(a), Math.sin(a)]
}
