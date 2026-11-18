// Grand Theft Outfit [部品: signs] 看板とネオン管が、路面・人・車に落とす光。
// 入口: buildGlowEmitters(world, signs, tubes) / buildGlowField(world, emitters, cell) / sampleGlow(field, x, z) / tintFactor(color, s)
// 契約: 看板1枚・軒の管1本を「壁際の光源」（GlowEmitter）にし、街ぜんたいの光を升目の場（GlowField）に足し込む。
//       光は光源の直下（壁際）がいちばん明るく、道のほうへ距離で落ち、横の縁はなだらかに消える（色面にしない）。
//       色は看板の色より彩度を抑え、重なった所は色相を保ったまま上限で頭打ちにする。
//       描画（renderSignsGlow.ts）は、この場を路面に落とし、同じ場をその場所に立つ人と車にも被せる。
import { hexToLinear, type Rgb } from './lighting'
import { clamp } from './math'
import { wallNormalOf, type NeonTube, type Sign } from './signage'
import { neonAccent, signSpill, spillWeights } from './signageNeon'
import type { GtoWorld } from './types'

/** 壁際の光源。起点 (ox, oz) から壁の外向き (nx, nz) へ光を落とす */
export interface GlowEmitter {
  ox: number
  oz: number
  nx: number
  nz: number
  /** 壁に沿った幅の半分 m */
  half: number
  /** 明るさが半分になる距離 m（高い所の看板ほど遠くまで明るい） */
  d0: number
  /** 光が届く距離 m（向かいの建物までで切る） */
  reach: number
  /** 光の色（リニア、いちばん明るい成分が 1。彩度は抑えてある） */
  color: Rgb
  /** 強さ（1 が店の看板1枚の壁際） */
  power: number
}

export const GLOW_TUNING = {
  /** 光の色を白へ寄せる割合（彩度を抑える） */
  whiten: 0.26,
  /** 升目の明るさの上限（重なってもここで頭打ち） */
  cap: 2.4,
  /** 壁の裏側へにじませる距離 m（壁際の升目が暗く欠けないようにする。ここで 0 まで下がる） */
  behind: 4,
  /** 届く距離のこの割合から先を、0 へなだらかに消す */
  fadeFrom: 0.55,
  /** 光源の高さから d0 を決める倍率と範囲 */
  d0PerHeight: 0.7,
  d0Min: 2.2,
  d0Max: 5,
  /** 軒の管: 1つの光源にする長さの上限・届く距離・強さ・これより高い管は路面を染めない */
  tubeSegment: 8,
  tubeReach: 11,
  tubePower: 0.8,
  tubeMaxHeight: 7,
  /** 同じ升目に重なる光源の弱め方（spillWeights の falloff）。場は升目ごとに頭打ちにするので緩くてよい */
  overlapFalloff: 1,
  /** これより弱い光源は捨てる */
  minPower: 0.08,
}

const smooth = (t: number) => {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

/**
 * 光源 e の光が、壁から道のほうへ d m・壁に沿って lat m ずれた路面に届く割合（0..1）。
 * 壁際の中央が 1。距離は 1 / (1 + (d/d0)²) で落ち、届く距離で 0。横はガウスで消え、離れるほど少し広がる。
 */
export function emitterFalloff(e: Pick<GlowEmitter, 'half' | 'd0' | 'reach'>, d: number, lat: number): number {
  const T = GLOW_TUNING
  if (d <= -T.behind || d >= e.reach) return 0
  if (d < 0) return (1 + d / T.behind) * Math.exp(-((lat / (e.half * 0.72 + 0.5)) ** 2))
  const along = (1 / (1 + (d / e.d0) ** 2)) * (1 - smooth((d - e.reach * T.fadeFrom) / (e.reach * (1 - T.fadeFrom))))
  const sigma = e.half * 0.72 + 0.5 + d * 0.22
  return along * Math.exp(-((lat / sigma) ** 2))
}

/** 路面に落とす光の色（リニア）。看板の光の色を白へ寄せて彩度を抑える（色相は保つ） */
export function glowColor(css: string): Rgb {
  const c = hexToLinear(Number.parseInt(css.slice(1), 16))
  const hi = Math.max(c[0], c[1], c[2], 1e-6)
  const w = GLOW_TUNING.whiten
  return [c[0] / hi + (1 - c[0] / hi) * w, c[1] / hi + (1 - c[1] / hi) * w, c[2] / hi + (1 - c[2] / hi) * w]
}

/** 色相を保ったまま、いちばん明るい成分が cap を超えないように丸める（弱い光はほぼそのまま） */
export function softCap(c: Rgb, cap: number): Rgb {
  const hi = Math.max(c[0], c[1], c[2])
  if (hi <= 0) return [0, 0, 0]
  const k = 1 / (1 + hi / cap)
  return [c[0] * k, c[1] * k, c[2] * k]
}

/** 壁際から道のほうへ、建物に当たるまでの距離（最大 reach）。すぐ前が建物なら 0 */
function openReach(world: Pick<GtoWorld, 'insideBuilding'>, ox: number, oz: number, nx: number, nz: number, reach: number): number {
  if (world.insideBuilding(ox + nx * 3.5, oz + nz * 3.5)) return 0
  for (let d = 5; d < reach; d += 2.5) {
    if (world.insideBuilding(ox + nx * d, oz + nz * d)) return d
  }
  return reach
}

/** 看板1枚の光源（重なりの弱め weight を掛ける前） */
function signEmitter(world: GtoWorld, s: Sign): GlowEmitter | null {
  const spill = signSpill(s)
  if (!spill) return null
  const n = wallNormalOf(s)
  // 袖看板は壁から突き出しているので、付け根（壁際）から測る
  const inset = s.kind === 'blade' ? s.w / 2 + 0.2 : 0
  const ox = s.x - n.x * inset
  const oz = s.z - n.z * inset
  const open = openReach(world, ox, oz, n.x, n.z, spill.reach)
  if (open <= 0) return null
  // 細い通りでは向かいの建物までしか届かない。両側の店の光が重なるので、通りが細いほど弱める
  const narrow = Math.max(0.2, (open / spill.reach) ** 2)
  const T = GLOW_TUNING
  const height = s.y - world.groundY(ox, oz)
  return {
    ox,
    oz,
    nx: n.x,
    nz: n.z,
    half: spill.half,
    d0: clamp(height * T.d0PerHeight, T.d0Min, T.d0Max),
    reach: Math.min(spill.reach, open + 1),
    color: glowColor(neonAccent(s)),
    power: spill.power * narrow,
  }
}

/** 軒の管1本の光源（長い管は tubeSegment ごとに割る）。縦の管・屋上の縁の管・看板を縁取る管は路面を染めない */
function tubeEmitters(world: GtoWorld, t: NeonTube): GlowEmitter[] {
  const T = GLOW_TUNING
  const len = Math.hypot(t.x1 - t.x0, t.z1 - t.z0)
  if (t.frame || len < 0.01) return []
  const mx = (t.x0 + t.x1) / 2
  const mz = (t.z0 + t.z1) / 2
  if (t.y0 - world.groundY(mx, mz) > T.tubeMaxHeight) return []
  const count = Math.max(1, Math.round(len / T.tubeSegment))
  const color = glowColor(t.color)
  return Array.from({ length: count }, (_, i): GlowEmitter | null => {
    const f = (i + 0.5) / count
    const ox = t.x0 + (t.x1 - t.x0) * f
    const oz = t.z0 + (t.z1 - t.z0) * f
    const open = openReach(world, ox, oz, t.nx, t.nz, T.tubeReach)
    if (open <= 0) return null
    const narrow = Math.max(0.2, (open / T.tubeReach) ** 2)
    return { ox, oz, nx: t.nx, nz: t.nz, half: len / count / 2, d0: T.d0Min, reach: Math.min(T.tubeReach, open + 1), color, power: T.tubePower * narrow }
  }).filter((e): e is GlowEmitter => e != null)
}

/**
 * 灯の入った看板と軒の管を、路面を染める光源にする。
 * 縦に積んだ袖看板や両側に店が並ぶ通りは、後から来た看板ほど弱くする（spillWeights）。
 */
export function buildGlowEmitters(world: GtoWorld, signs: readonly Sign[], tubes: readonly NeonTube[]): GlowEmitter[] {
  const raw = signs.map((s) => signEmitter(world, s))
  const weights = spillWeights(
    signs.map((s, i) => {
      const e = raw[i]
      return { kind: s.kind, lit: s.lit && e != null, x: e ? e.ox + e.nx * e.reach * 0.4 : s.x, z: e ? e.oz + e.nz * e.reach * 0.4 : s.z }
    }),
    GLOW_TUNING.overlapFalloff,
  )
  const fromSigns = raw.flatMap((e, i) => (e && e.power * weights[i] >= GLOW_TUNING.minPower ? [{ ...e, power: e.power * weights[i] }] : []))
  return [...fromSigns, ...tubes.flatMap((t) => tubeEmitters(world, t))]
}

/** 街ぜんたいの光の場。升目の角ごとに RGB（リニア）を持つ */
export interface GlowField {
  x0: number
  z0: number
  cell: number
  cols: number
  rows: number
  /** cols × rows × 3 */
  data: Float32Array
}

/** 光源を升目の場に足し込み、升目ごとに上限で丸める */
export function buildGlowField(world: Pick<GtoWorld, 'bounds'>, emitters: readonly GlowEmitter[], cell: number): GlowField {
  const { minX, maxX, minZ, maxZ } = world.bounds
  const cols = Math.ceil((maxX - minX) / cell) + 1
  const rows = Math.ceil((maxZ - minZ) / cell) + 1
  const data = new Float32Array(cols * rows * 3)
  const T = GLOW_TUNING
  for (const e of emitters) {
    // 光の届く範囲（壁の裏 behind から reach まで、横はガウスの裾まで）を囲む升目だけを回る
    const side = (e.half * 0.8 + 0.6 + e.reach * 0.3) * 2.3
    const tx = -e.nz
    const tz = e.nx
    const xs = [-T.behind, e.reach].flatMap((d) => [-side, side].map((l) => e.ox + e.nx * d + tx * l))
    const zs = [-T.behind, e.reach].flatMap((d) => [-side, side].map((l) => e.oz + e.nz * d + tz * l))
    const c0 = clamp(Math.floor((Math.min(...xs) - minX) / cell), 0, cols - 1)
    const c1 = clamp(Math.ceil((Math.max(...xs) - minX) / cell), 0, cols - 1)
    const r0 = clamp(Math.floor((Math.min(...zs) - minZ) / cell), 0, rows - 1)
    const r1 = clamp(Math.ceil((Math.max(...zs) - minZ) / cell), 0, rows - 1)
    for (let r = r0; r <= r1; r++) {
      const dz = minZ + r * cell - e.oz
      for (let c = c0; c <= c1; c++) {
        const dx = minX + c * cell - e.ox
        const f = emitterFalloff(e, dx * e.nx + dz * e.nz, dx * tx + dz * tz) * e.power
        if (f < 0.002) continue
        const i = (r * cols + c) * 3
        data[i] += e.color[0] * f
        data[i + 1] += e.color[1] * f
        data[i + 2] += e.color[2] * f
      }
    }
  }
  for (let i = 0; i < data.length; i += 3) {
    const hi = Math.max(data[i], data[i + 1], data[i + 2])
    if (hi <= 0) continue
    const k = 1 / (1 + hi / T.cap)
    data[i] *= k
    data[i + 1] *= k
    data[i + 2] *= k
  }
  return { x0: minX, z0: minZ, cell, cols, rows, data }
}

/** 場の (x, z) の光の色（双一次補間）。範囲の外は 0 */
export function sampleGlow(field: GlowField, x: number, z: number): Rgb {
  const fx = (x - field.x0) / field.cell
  const fz = (z - field.z0) / field.cell
  if (!(fx >= 0 && fz >= 0 && fx <= field.cols - 1 && fz <= field.rows - 1)) return [0, 0, 0]
  const c = Math.min(Math.floor(fx), field.cols - 2)
  const r = Math.min(Math.floor(fz), field.rows - 2)
  const u = fx - c
  const v = fz - r
  const at = (cc: number, rr: number, k: number) => field.data[(rr * field.cols + cc) * 3 + k]
  const mixAt = (k: number) => (at(c, r, k) * (1 - u) + at(c + 1, r, k) * u) * (1 - v) + (at(c, r + 1, k) * (1 - u) + at(c + 1, r + 1, k) * u) * v
  return [mixAt(0), mixAt(1), mixAt(2)]
}

/**
 * 「染める」ための数字。看板の光は足すだけだと、白いシャッターや明るい歩道では白っぽくなるだけで色が乗らない。
 * そこで下の色に倍率を掛け、光の色の成分は保ち、補色の成分は落とす（白い面が看板の色そのものになる）。
 * 描画は 下の色 ×（光の色 × boost × s ＋（1 − cut × s））の1回の合成で行う（シェーダも同じ式）。
 */
export const TINT_TUNING = {
  /** 補色の成分を落とす割合（s = 1 のとき） */
  cut: 0.8,
  /**
   * 光の色の成分に足し戻す割合。cut より少しだけ大きくする（光の色の成分はほぼそのまま、1.1 倍まで）。
   * 明るさは加算の側で出す。ここで何倍にもすると、街灯や前照灯の光だまりまで倍になってブルームで白い玉になる。
   */
  boost: 0.9,
  /** s の上限（下の模様を残す） */
  max: 0.9,
}

/** 下の色に掛ける倍率。color は光の色（色相だけを使う）、s は光の強さ（0..TINT_TUNING.max に丸める） */
export function tintFactor(color: Rgb, s: number): Rgb {
  const hi = Math.max(color[0], color[1], color[2])
  if (hi <= 0 || s <= 0) return [1, 1, 1]
  const T = TINT_TUNING
  const k = Math.min(s, T.max)
  const f = (c: number) => 1 - T.cut * k + (c / hi) * T.boost * k
  return [f(color[0]), f(color[1]), f(color[2])]
}
