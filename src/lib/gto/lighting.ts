// Grand Theft Outfit [部品: light] 時刻ごとの光・空・色調のパラメータ。
// 入口: LIGHTING / lightingFor(time) / gradeColor / predictSurface / roadSheen / lampPools / spillColor（その場の光の置き方は lightingLocal.ts）
// 契約: 時刻（day / dusk / night）から、空・太陽・霧・露出・ブルーム・窓明かりの数字を返す。
//       描画（renderSky.ts）はこの数字を three に写すだけ。色は 0xRRGGBB。
//       色の方向: 昼＝青緑の空と暖色の地面（影は茶色）、夕＝橙と赤紫、夜＝青紫の地に橙の街灯とネオン。
//       gradeColor は renderSky.ts の GLSL（gradeGlsl）と同じ式。片方を変えたらもう片方も変える。
import type { StreetProp } from './map'
import { clamp, dirOf } from './math'
import type { TimeOfDay } from './types'

export type Rgb = [r: number, g: number, b: number]

/** 最後に掛ける色調。影と明部にそれぞれ色を乗せ、時刻ごとの色の方向を作る */
export interface GradeParams {
  /** 暗部に掛ける色（リニア、1 が無色） */
  shadowTint: Rgb
  /** 明部に掛ける色 */
  highlightTint: Rgb
  /** 1 未満で暗部を持ち上げる（路面を黒く沈ませない） */
  gamma: number
  saturation: number
  /** 画面の四隅を落とす量（0..1。ポストプロセスのある画質だけ） */
  vignette: number
}

/**
 * 大気のかすみ（空気の層）。遠くの物ほどこの色へ溶け、太陽の方を向くほど濃く明るい。
 * 太陽の側は color（光る霧）、反対側は backColor（沈んだ霧）で、その間を視線の向きでつなぐ。
 */
export interface ScatterParams {
  color: number
  /** 太陽と反対の側のかすみの色 */
  backColor: number
  /** かすみの色に掛ける明るさ（1 を超えると空が白く飛ぶ） */
  gain: number
  /** いちばん濃い所の濃さ（0..1。0 で掛けない） */
  strength: number
  /** 濃さが 63% に届く距離 m */
  length: number
  /** 太陽の方角への絞り（大きいほど太陽の近くだけ） */
  power: number
  /** 太陽と逆を向いても残る割合（0..1） */
  ambient: number
  /** 太陽の側の広がり（0 で太陽の前半球だけ。大きいほど横を向いても太陽の側が分かる） */
  wrap: number
  /** 空（地平線の近く）にも掛ける割合（0..1）。夜は 0 にして、沈んだ遠景を街明かりの空に浮かばせる */
  sky: number
}

/** 壁の発光（窓・店先）の整え方。renderSky.ts の GLSL（windowGlsl）と同じ式 */
export interface WindowLightParams {
  /** 電球色の窓と、蛍光灯の窓の色（リニア、掛ける色） */
  warm: Rgb
  cool: Rgb
  /** 蛍光灯の窓の割合（0..1） */
  coolShare: number
  /** 発光の上限（リニア）。これより明るい白い面は上限で止める */
  cap: number
  /** 窓ごと・面の中のむらの深さ（0..1。0 でべた塗り） */
  vary: number
}

export interface LightingParams {
  /** 空の天頂・地平線・地平線より下の色 */
  skyTop: number
  skyHorizon: number
  skyBottom: number
  /** 太陽（夜は月）の向き。x=東、y=上、z=南 */
  sunDir: [number, number, number]
  /**
   * 光と影を落とす向き（無ければ sunDir）。夕方は、空の太陽と同じ方位から少しだけ高く当てる。
   * 影は物の高さの2〜3倍に伸ばす（長い落ち影が太陽の向きを教える）。太陽そのままの低さだと影が長すぎて路面が全部陰になる
   */
  lightDir?: [number, number, number]
  sunColor: number
  sunIntensity: number
  /** 空に描く太陽の光芒の強さ（0 で描かない） */
  sunGlow: number
  /** 太陽の芯（白く飛ぶ円盤とそのすぐ外）の強さ。空の中でここがいちばん明るい点になる */
  sunCore: number
  /**
   * 路面の照り返しの強さ（0 で掛けない。ポストプロセスのある画質だけ）。
   * 上を向いた面が、鏡の向きにある空・太陽・看板の光を浅い角度ほど強く返す
   */
  roadGloss: number
  /** 太陽の方を向いたとき画面全体に掛かる逆光の強さ（0..1。ポストプロセスのある画質だけ） */
  sunVeil: number
  /**
   * 逆光のにじみの強さ（0 で掛けない。ポストプロセスのある画質だけ）。
   * 太陽の見えている方角で、空の光が建物の輪郭の上へあふれ、輪郭を飛ばす
   */
  sunShafts: number
  /** かすみの濃い所（遠景）の輪郭をぼかす半径（画素。0 でぼかさない） */
  hazeSoften: number
  /**
   * 上を向いた面（路面・歩道・車の屋根）の明るさの持ち上げ。暗い面ほど強く効き、白線のような明るい面はほとんど変えない。
   * 濃い色の舗装が、日なたでも陰でも黒い板にならず、落ち影の境目が読めるようにする。
   * gain はいちばん暗い所での上乗せ（倍率 − 1）、soft は明るい面で効きを弱める速さ
   */
  groundLift: { gain: number; soft: number }
  /** 天空光と地面からの照り返し */
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  fogColor: number
  /** 霧が掛かり始める距離と、霧で消える距離の割合（描画距離に対する 0..1） */
  fogNear: number
  fogFar: number
  /** トーンマッピングの露出 */
  exposure: number
  bloom: { strength: number; radius: number; threshold: number }
  grade: GradeParams
  /** 雲の量（0..1）と色 */
  clouds: number
  cloudColor: number
  /** 星の明るさ（0 で描かない） */
  stars: number
  /** 街の明かりが地平線近くの空を染める色と強さ */
  cityGlow: number
  cityGlowStrength: number
  /** 建物の窓明かりの強さ（0..1） */
  windowGlow: number
  /** 窓と店先の明かり（壁の発光）の整え方。街の部品の発光を、光の側で室内の灯りらしくする */
  windowLight: WindowLightParams
  /** 看板・ネオンの発光の強さ */
  neon: number
  /** 街灯とヘッドライトを点けるか */
  lampsOn: boolean
  /** 街灯の色と、路面にできる光だまりの強さ */
  lampColor: number
  lampPool: number
  /** 街灯の灯具のまわりに出る光の暈の強さ（0 で出さない）。空気が光って、灯りの位置が遠くからでも分かる */
  lampHalo: number
  /** ヘッドライトが路面に作る光だまりの強さ */
  headlightPool: number
  /** ネオン看板が路面を染める強さ */
  neonSpill: number
  scatter: ScatterParams
  /** 近くの街灯を本物の光源にするときの光度（0 で置かない） */
  lampLight: number
  /** 大型看板の光源の強さ（街灯の光度に掛ける。0 で置かない） */
  boardLight: number
  /** 店先（1階の光る帯）が歩道へこぼす明かりの色と強さ */
  shopSpillColor: number
  shopSpill: number
  /** 車の尾灯が後ろの路面を赤く染める強さ */
  tailPool: number
  /** 自分の車のヘッドライト（前の壁と車を照らす光源）の光度 */
  headBeam: number
}

export const LIGHTING: Record<TimeOfDay, LightingParams> = {
  day: {
    skyTop: 0x2f9fc4,
    skyHorizon: 0xa6dcd8,
    skyBottom: 0xa6dcd8,
    // 午後の太陽。南西の高い所から、通りに対して斜めに差す（通りの片側の壁が日なた、反対側が陰になり、影が路面を斜めに横切る）。
    // 影は物の高さの 0.9 倍
    sunDir: [-0.45, 0.74, 0.5],
    sunColor: 0xfff0d2,
    sunIntensity: 1.55,
    sunGlow: 0.7,
    sunCore: 1,
    roadGloss: 0.08,
    sunVeil: 0.05,
    sunShafts: 0.2,
    hazeSoften: 1.2,
    groundLift: { gain: 1.1, soft: 2 },
    hemiSky: 0xf0ede4,
    hemiGround: 0xb4a898,
    hemiIntensity: 0.72,
    fogColor: 0xa6dcd8,
    fogNear: 0.1,
    fogFar: 1,
    exposure: 1,
    bloom: { strength: 0.1, radius: 0.5, threshold: 1.05 },
    grade: { shadowTint: [1.2, 1, 0.74], highlightTint: [1, 0.995, 0.97], gamma: 0.84, saturation: 1.2, vignette: 0.16 },
    clouds: 0.45,
    cloudColor: 0xffffff,
    stars: 0,
    cityGlow: 0x000000,
    cityGlowStrength: 0,
    windowGlow: 0,
    windowLight: { warm: [1, 0.66, 0.34], cool: [0.52, 0.66, 0.82], coolShare: 0.28, cap: 0.3, vary: 0.55 },
    neon: 0.95,
    lampsOn: false,
    lampColor: 0xffb060,
    lampPool: 0,
    lampHalo: 0,
    headlightPool: 0,
    neonSpill: 0,
    scatter: { color: 0xd2ece4, backColor: 0x90cad0, gain: 1, strength: 0.66, length: 340, power: 3, ambient: 0.6, wrap: 0, sky: 1 },
    lampLight: 0,
    boardLight: 0,
    shopSpillColor: 0xffe2b0,
    shopSpill: 0,
    tailPool: 0,
    headBeam: 0,
  },
  dusk: {
    skyTop: 0x4a3f86,
    skyHorizon: 0xf0965a,
    skyBottom: 0xf0965a,
    // 太陽は道玄坂の先（西南西）の低い所。坂の下から見上げると、通りの奥の空に太陽が見える
    sunDir: [-0.95, 0.24, 0.11],
    // ほぼ同じ方位（少し南寄り）から 25°で差す（影は物の高さの 2.1 倍）。通りの軸から外すと、通り沿いの壁の片側に日が当たる
    lightDir: [-0.855, 0.423, 0.3],
    sunColor: 0xff8a3c,
    sunIntensity: 3.8,
    sunGlow: 1.1,
    sunCore: 3,
    // 照り返しは太陽の筋だけが残る強さ（強いと路面が濡れた鏡になり、落ち影が読めない）
    roadGloss: 0.22,
    // 膜は薄く。太陽の向きは、日なたと陰の差・長い影・路面の照り返しで見せる
    sunVeil: 0.05,
    sunShafts: 0.42,
    hazeSoften: 1.8,
    groundLift: { gain: 1.7, soft: 1.5 },
    // 陰の面は青紫の天空光だけで照らす（日なたの橙と、明るさだけでなく色相でも分かれる）
    hemiSky: 0x8478b4,
    hemiGround: 0x5a4250,
    hemiIntensity: 0.5,
    fogColor: 0xf0965a,
    fogNear: 0.08,
    fogFar: 0.9,
    exposure: 1,
    bloom: { strength: 0.2, radius: 0.45, threshold: 1.05 },
    grade: { shadowTint: [0.94, 0.9, 1.1], highlightTint: [1.05, 0.98, 0.88], gamma: 0.92, saturation: 1.15, vignette: 0.24 },
    clouds: 0.55,
    cloudColor: 0xffb48a,
    stars: 0,
    cityGlow: 0xff6a4a,
    cityGlowStrength: 0.15,
    windowGlow: 0.34,
    windowLight: { warm: [1, 0.66, 0.34], cool: [0.52, 0.66, 0.82], coolShare: 0.28, cap: 0.34, vary: 0.55 },
    neon: 1.12,
    lampsOn: true,
    lampColor: 0xffa550,
    lampPool: 0.16,
    lampHalo: 0.3,
    headlightPool: 0.22,
    neonSpill: 0.15,
    scatter: { color: 0xff9a3c, backColor: 0x5c4a80, gain: 1.2, strength: 0.9, length: 380, power: 4, ambient: 0.3, wrap: 0.2, sky: 1 },
    lampLight: 9,
    boardLight: 0.8,
    shopSpillColor: 0xffd9a0,
    shopSpill: 0.16,
    tailPool: 0.07,
    headBeam: 8,
  },
  night: {
    skyTop: 0x070b1e,
    skyHorizon: 0x2b2548,
    skyBottom: 0x2b2548,
    sunDir: [0.36, 0.78, -0.4],
    sunColor: 0x9db4e8,
    sunIntensity: 0.24,
    sunGlow: 0.25,
    sunCore: 0.35,
    roadGloss: 0.2,
    sunVeil: 0,
    sunShafts: 0,
    hazeSoften: 1.2,
    groundLift: { gain: 0.25, soft: 30 },
    hemiSky: 0x86a4e0,
    hemiGround: 0x0c0c1c,
    hemiIntensity: 0.34,
    fogColor: 0x2b2548,
    fogNear: 0.05,
    fogFar: 0.95,
    exposure: 1,
    bloom: { strength: 0.2, radius: 0.4, threshold: 1.08 },
    grade: { shadowTint: [0.9, 0.96, 1.18], highlightTint: [1.04, 1, 0.94], gamma: 0.78, saturation: 1.1, vignette: 0.3 },
    clouds: 0.3,
    cloudColor: 0x4a3f6a,
    stars: 0.8,
    cityGlow: 0xb04a8a,
    cityGlowStrength: 0.22,
    windowGlow: 0.22,
    windowLight: { warm: [1, 0.66, 0.34], cool: [0.52, 0.66, 0.82], coolShare: 0.28, cap: 0.3, vary: 0.55 },
    neon: 1.16,
    lampsOn: true,
    lampColor: 0xffa040,
    lampPool: 0.6,
    lampHalo: 0.6,
    headlightPool: 0.36,
    neonSpill: 0.28,
    // 夜のかすみは空より暗い。街灯から離れた遠くの路面と壁が沈み、灯りと看板だけが残る
    scatter: { color: 0x1a1634, backColor: 0x1a1634, gain: 1, strength: 0.7, length: 150, power: 1, ambient: 1, wrap: 0, sky: 0 },
    lampLight: 14,
    boardLight: 1.7,
    shopSpillColor: 0xffd9a0,
    shopSpill: 0.34,
    tailPool: 0.15,
    headBeam: 22,
  },
}

export const lightingFor = (time: TimeOfDay): LightingParams => LIGHTING[time]

/** HUD に出す時計の表示 */
export const CLOCK_TEXT: Record<TimeOfDay, string> = { day: '13:20', dusk: '17:40', night: '22:10' }

// ----------------------------------------------------------------------------
// 色調（renderSky.ts の GLSL と同じ式）
// ----------------------------------------------------------------------------

/**
 * 壁の発光（窓・店先）を室内の灯りらしく整える。emissive はリニアの発光、cellHash は窓1枚ごとの乱数（0..1）、
 * patch は面の中をゆっくり変わるむら（0..1）。白い板のまま光らせず、上限で止めて電球色か蛍光灯の色へ寄せる。
 */
export function windowLight(emissive: Rgb, L: LightingParams, cellHash: number, patch: number): Rgb {
  const w = L.windowLight
  const y = luma(emissive)
  if (y <= 0) return [0, 0, 0]
  const k = Math.min(y, w.cap) / y
  const tint = cellHash > 1 - w.coolShare ? w.cool : w.warm
  const level = 1 - w.vary * (1 - clamp(patch, 0, 1))
  return emissive.map((v, i) => v * k * tint[i] * level) as Rgb
}

/** 肩の曲線が効き始める明るさ。これより暗い色はそのまま画面に出る */
export const SHOULDER_KNEE = 0.7

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const luma = (c: Rgb) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
const smooth = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

export const hexToLinear = (hex: number): Rgb => [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)]

/** 明るい側だけを 1 未満へ丸める。暗い側は触らない（くり抜き写真の色を変えないため） */
export const shoulder = (x: number): number => {
  if (x <= SHOULDER_KNEE) return Math.max(0, x)
  const span = 1 - SHOULDER_KNEE
  return SHOULDER_KNEE + span * (1 - Math.exp(-(x - SHOULDER_KNEE) / span))
}

/** 上を向いた面の明るさに掛ける倍率。y は光を受けた面のリニアの明るさ（renderSky.ts の liftGlsl と同じ式） */
export const groundLift = (y: number, L: LightingParams): number => 1 + L.groundLift.gain / (1 + L.groundLift.soft * Math.max(0, y))

/** リニアの色に、露出・肩・暗部の持ち上げ・色乗せ・彩度を掛ける。返すのは画面に出す直前のリニア色 */
export function gradeColor(color: Rgb, L: LightingParams): Rgb {
  const g = L.grade
  const c = color.map((v) => shoulder(v * L.exposure)) as Rgb
  const t = smooth(luma(c) / 0.6)
  const tinted = c.map((v, i) => v ** g.gamma * (g.shadowTint[i] + (g.highlightTint[i] - g.shadowTint[i]) * t)) as Rgb
  const y = luma(tinted)
  return tinted.map((v) => clamp(y + (v - y) * g.saturation, 0, 1)) as Rgb
}

/**
 * 地の色 albedo の面が画面でどの色（0..255）になるかを、描画と同じ式で見積もる。
 * face: 'up' は路面、'side' は壁。sunlit なら太陽（月）が当たっている。emissive は自分で光る分（窓明かり）。
 */
export function predictSurface(L: LightingParams, albedo: number, face: 'up' | 'side', sunlit: boolean, emissive = 0): Rgb {
  const base = hexToLinear(albedo)
  const sky = hexToLinear(L.hemiSky)
  const ground = hexToLinear(L.hemiGround)
  const sun = hexToLinear(L.sunColor)
  const dir = L.lightDir ?? L.sunDir
  const len = Math.hypot(...dir) || 1
  const up = dir[1] / len
  // 壁は太陽の方位へ正対しているものとする
  const facing = face === 'up' ? Math.max(0, up) : Math.sqrt(Math.max(0, 1 - up * up))
  const hemiMix = face === 'up' ? 1 : 0.5
  const diffuse = base.map((a, i) => {
    const hemi = (ground[i] + (sky[i] - ground[i]) * hemiMix) * L.hemiIntensity
    const direct = sunlit ? sun[i] * L.sunIntensity * facing : 0
    return a * (hemi + direct)
  }) as Rgb
  const k = face === 'up' ? groundLift(luma(diffuse), L) : 1
  const lit = diffuse.map((v) => v * k + emissive) as Rgb
  return gradeColor(lit, L).map((v) => Math.round(linearToSrgb(v) * 255)) as Rgb
}

// ----------------------------------------------------------------------------
// 路面の照り返し（renderSky.ts の GLSL と同じ式）
// ----------------------------------------------------------------------------

/** 照り返す面とみなす法線の上向き成分の範囲（坂の路面は入り、壁は入らない） */
export const SHEEN_UP: readonly [min: number, max: number] = [0.9, 0.97]
/** 太陽の照り返しの広がり。[鏡の向きからの絞り, 重み] を2段（光の筋・広い照り）で重ねる */
export const SHEEN_LOBES: readonly (readonly [power: number, weight: number])[] = [
  [90, 2.2],
  [10, 0.35],
]

/** 面を見る角度による照り返しの割合。cosView は「視線と法線のなす角」の余弦（真上から見ると 1、すれすれで 0） */
export const roadFresnel = (cosView: number): number => 0.04 + 0.96 * (1 - clamp(cosView, 0, 1)) ** 3

/**
 * 路面が太陽を照り返す量（太陽の色に掛ける）。view はカメラから面へ向かう視線、normal は面の法線、sun は太陽の向き（どれも長さ 1）。
 * 太陽の真下の路面だけが光の筋になり、浅い角度で見る遠くほど強い。
 */
export function roadSheen(view: Rgb, normal: Rgb, sun: Rgb, gloss: number): number {
  if (gloss <= 0) return 0
  const flat = smooth((normal[1] - SHEEN_UP[0]) / (SHEEN_UP[1] - SHEEN_UP[0]))
  if (flat <= 0) return 0
  const vn = view[0] * normal[0] + view[1] * normal[1] + view[2] * normal[2]
  const mirror = view.map((v, i) => v - 2 * vn * normal[i])
  const c = Math.max(0, mirror[0] * sun[0] + mirror[1] * sun[1] + mirror[2] * sun[2])
  return gloss * flat * roadFresnel(-vn) * SHEEN_LOBES.reduce((sum, [power, weight]) => sum + weight * c ** power, 0)
}

// ----------------------------------------------------------------------------
// 街灯とネオンの光だまり
// ----------------------------------------------------------------------------

export interface LampPool {
  /** 光だまりの中心（柱から車道の側へ寄せた位置） */
  x: number
  z: number
  /** 光だまりの半径 m */
  radius: number
}

/** 灯具が柱から車道の側へ張り出す距離 m と、光だまりの半径 m。背の高い道路照明ほど広く照らす */
const LAMP_REACH: Record<string, [reach: number, radius: number]> = {
  'lamp-plain': [3.2, 9],
  'lamp-dogenzaka': [2.2, 5.5],
  'lamp-miyamasu': [2, 5.5],
  'lamp-koen': [1.8, 5.5],
  'lamp-center': [1.2, 5],
}

/**
 * 街具（map.ts の streetProps）のうち街灯の足元に、光だまりを置く場所を決める。
 * plain を false にすると、ふつうの道路照明（軽量設定では柱を描かない）を除く。
 */
export function lampPools(props: readonly Pick<StreetProp, 'kind' | 'x' | 'z' | 'heading'>[], plain: boolean): LampPool[] {
  return props.flatMap((p) => {
    const spec = LAMP_REACH[p.kind]
    if (!spec || (!plain && p.kind === 'lamp-plain')) return []
    // heading は車道の中心へ向く向き
    const d = dirOf(p.heading)
    return [{ x: p.x + d.x * spec[0], z: p.z + d.z * spec[0], radius: spec[1] }]
  })
}

const cssToLinear = (css: string): Rgb => {
  const hex = css.replace('#', '')
  const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join('') : hex
  const n = Number.parseInt(full, 16)
  return Number.isFinite(n) ? hexToLinear(n) : [1, 1, 1]
}

/** 看板の地色と文字色のうち、路面を染める光の色（鮮やかで明るい方）を選ぶ。明るさはそろえて返す */
export function spillColor(bg: string, fg: string): Rgb {
  const score = (c: Rgb) => {
    const hi = Math.max(...c)
    const lo = Math.min(...c)
    return (hi - lo) * 2 + hi * 0.5
  }
  const a = cssToLinear(bg)
  const b = cssToLinear(fg)
  const pick = score(a) >= score(b) ? a : b
  const hi = Math.max(...pick, 0.001)
  return pick.map((v) => v / hi) as Rgb
}
