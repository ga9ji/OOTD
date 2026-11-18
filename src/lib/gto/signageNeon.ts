// Grand Theft Outfit [部品: signs] 看板を「光るもの」にするための配置: 看板を縁取るネオン管と、看板が落とす光の色・届く範囲。
// 入口: neonAccent(sign) / buildSignTubes(signs, detail) / signSpill(sign) / spillWeights(signs)
// 契約: signage.ts の Sign の配列から、看板1枚ごとの光の色（地と文字のうち色の濃いほうを、濃く明るくしたもの）と、
//       その色で看板を縁取る管（NeonTube、frame: true）を決める。描画（renderSigns.ts）は管と光を絵にするだけ。
//       看板の板は平らな面なので、縁の管が線として光り、同じ色が壁と路面に落ちることで「光っている」と読める。
import { dirOf } from './math'
import type { NeonTube, Sign, SignDetail } from './signage'
import { NEON_COLORS } from './signageCatalog'

type Rgb255 = [r: number, g: number, b: number]

const parse = (css: string): Rgb255 => {
  const n = Number.parseInt(css.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toCss = (c: Rgb255) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const saturationOf = (c: Rgb255) => (Math.max(...c) - Math.min(...c)) / Math.max(...c, 1)

/** これより色の薄い看板（白・黒・灰）は、決めたネオンの色を借りる */
const GRAY_SATURATION = 0.25
/** 光の色の彩度の下限（いちばん暗い成分を、明るい成分のこの割合まで下げる） */
const ACCENT_FLOOR = 0.24

const accentCache = new Map<string, string>()

/**
 * 看板が出す光の色（'#rrggbb'）。地と文字のうち色の濃いほうを選び、いちばん明るい成分を 255 まで上げ、
 * いちばん暗い成分を下げて濃くする。白と黒だけの看板は NEON_COLORS から番号で選ぶ。
 */
export function neonAccent(sign: Pick<Sign, 'bg' | 'fg' | 'design'>): string {
  const key = `${sign.bg}${sign.fg}${sign.design}`
  const hit = accentCache.get(key)
  if (hit) return hit
  const bg = parse(sign.bg)
  const fg = parse(sign.fg)
  // 色の濃さ × 明るさ で選ぶ（暗い茶色の地より、明るい色の文字を取る）
  const score = (c: Rgb255) => saturationOf(c) * (0.35 + Math.max(...c) / 255)
  const pick = score(bg) >= score(fg) ? bg : fg
  let out: string
  if (saturationOf(pick) < GRAY_SATURATION) {
    out = NEON_COLORS[sign.design % NEON_COLORS.length]
  } else {
    const hi = Math.max(...pick)
    const lo = Math.min(...pick)
    // lo..hi を ACCENT_FLOOR..1 に引き伸ばす（色相は変えない）。もともと濃い色はそのまま明るくするだけ
    const floor = Math.min(lo / hi, ACCENT_FLOOR)
    out = toCss(pick.map((v) => 255 * (floor + ((v - lo) / (hi - lo)) * (1 - floor))) as Rgb255)
  }
  accentCache.set(key, out)
  return out
}

/** 管を看板の面からどれだけ手前に浮かすか */
const TUBE_OUT = 0.1
/** 管を看板の縁からどれだけ外に置くか */
const TUBE_MARGIN = 0.09

/** 看板1枚を縁取る管。店の看板は上下（と左右）、袖看板は左右の縦、広告は上下 */
function tubesOf(s: Sign, detail: SignDetail): NeonTube[] {
  // 筆記体のネオン文字は、文字そのものが管なので縁取らない
  if (!s.lit || s.kind === 'rooftop' || s.kind === 'vision' || s.kind === 'neon') return []
  const n = dirOf(s.heading)
  const color = neonAccent(s)
  // 面に向かって右の向き
  const rx = -n.z
  const rz = n.x
  const cx = s.x + n.x * TUBE_OUT
  const cz = s.z + n.z * TUBE_OUT
  const hw = s.w / 2 + TUBE_MARGIN
  const hh = s.h / 2 + TUBE_MARGIN
  const base = { nx: n.x, nz: n.z, color, frame: true }
  const flat = (y: number): NeonTube => ({ ...base, x0: cx - rx * hw, z0: cz - rz * hw, x1: cx + rx * hw, z1: cz + rz * hw, y0: y, y1: y })
  const post = (side: number): NeonTube => ({ ...base, x0: cx + rx * hw * side, z0: cz + rz * hw * side, x1: cx + rx * hw * side, z1: cz + rz * hw * side, y0: s.y - hh, y1: s.y + hh })
  if (s.kind === 'blade') {
    // 袖看板は、軽量では縁取らない。PC でも3本に2本だけ（全部に付けると線が多すぎて形が読めない）
    if (detail !== 'full' || s.design % 3 === 0) return []
    return [post(-1), post(1)]
  }
  if (s.kind === 'fascia') {
    // 絵柄を3通りに散らす: ぐるりと囲む / 上下の2本 / 下の1本
    const style = detail === 'full' ? s.design % 3 : 2
    if (style === 0) return [flat(s.y + hh), flat(s.y - hh), post(-1), post(1)]
    if (style === 1) return [flat(s.y + hh), flat(s.y - hh)]
    return [flat(s.y - hh)]
  }
  // 壁面の大きな広告・縦長の広告
  return detail === 'full' ? [flat(s.y + hh), flat(s.y - hh)] : [flat(s.y - hh)]
}

/** 看板を縁取るネオン管（色は neonAccent）。軽量では店の看板の下の1本だけ */
export function buildSignTubes(signs: readonly Sign[], detail: SignDetail = 'full'): NeonTube[] {
  return signs.flatMap((s) => tubesOf(s, detail))
}

export interface SignSpill {
  /** 壁から道のほうへ届く距離 m */
  reach: number
  /** 壁に沿った幅の半分 m */
  half: number
  /** 光の強さの倍率（1 が店の看板） */
  power: number
}

/**
 * 看板が足元の路面に落とす光の範囲。店の看板は歩道から手前の車線まで、
 * 大きな広告とビジョンは道の反対側の車線まで（バーの実測: 建物の前面から 15〜20m）。
 */
export function signSpill(s: Pick<Sign, 'kind' | 'w' | 'h' | 'lit'>): SignSpill | null {
  if (!s.lit || s.kind === 'rooftop') return null
  if (s.kind === 'blade') return { reach: 5, half: 1.6, power: 0.55 }
  // 広告の板は夜は光らない（縁の管だけ）。足元を薄く染める程度
  if (s.kind === 'banner' || s.kind === 'billboard') return { reach: 8, half: s.w / 2 + 1, power: 0.3 }
  if (s.kind === 'fascia') return { reach: 14, half: s.w / 2 + 1.4, power: 1 }
  // 筆記体のネオン文字は板に遮られないぶん広く強く、道の反対側の車線まで染める
  if (s.kind === 'neon') return { reach: 18, half: s.w / 2 + 3, power: 0.9 }
  return { reach: 18, half: s.w / 2 + 3, power: 0.9 }
}

/** 光の重なりを数える升目の大きさ m */
export const SPILL_CELL = 6

/**
 * 看板ごとの「光を落とす強さの倍率」（0..1）。光は加算で重ねるので、袖看板が縦に 8 枚積まれた柱や、
 * 両側に店が並ぶ細い通りでは、そのまま足すと白く飛ぶ。升目ごとに、先に来た看板（主な看板が先頭）ほど強く、
 * 後から来た看板ほど弱くして、1つの升目の合計を 1.65 未満に抑える。灯の入っていない看板は 0。
 * x・z には「光が落ちる場所」（看板の前の路面）を渡すと、通りの両側の看板どうしも同じ升目で数えられる。
 * falloff は弱め方の強さ。路面の光の場は升目ごとに頭打ちにする（signageGlow.ts）ので、もっと緩く（1）して
 * 隣り合う店の光をどれも路面に届かせる。
 */
export function spillWeights(signs: readonly Pick<Sign, 'x' | 'z' | 'lit' | 'kind'>[], falloff = 2): number[] {
  const seen = new Map<string, number>()
  return signs.map((s) => {
    if (!s.lit || s.kind === 'rooftop') return 0
    const key = `${Math.floor(s.x / SPILL_CELL)},${Math.floor(s.z / SPILL_CELL)}`
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    return 1 / (1 + k) ** falloff
  })
}
