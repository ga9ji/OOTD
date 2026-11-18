// Grand Theft Outfit: 部品が共通で使う小さな計算。状態は持たない。
import type { Flat } from './types'

export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 指数的に寄せる（フレームレートに依らない追従）。rate が大きいほど速い */
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  target + (cur - target) * Math.exp(-rate * dt)

/** 一定の速さで target へ寄せる */
export const approach = (cur: number, target: number, maxStep: number) =>
  cur < target ? Math.min(target, cur + maxStep) : Math.max(target, cur - maxStep)

/** 角度を −π..π に丸める */
export const wrapAngle = (a: number) => {
  const m = ((a + Math.PI) % TAU + TAU) % TAU
  return m - Math.PI
}

/** from から to へ最短で回る角度（−π..π） */
export const angleDiff = (from: number, to: number) => wrapAngle(to - from)

/** 向き → 進行方向の単位ベクトル。北が 0、時計回り */
export const dirOf = (heading: number) => ({ x: Math.sin(heading), z: -Math.cos(heading) })

/** 進行方向 → 向き */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, -dz)

export const dist2 = (ax: number, az: number, bx: number, bz: number) =>
  (ax - bx) * (ax - bx) + (az - bz) * (az - bz)

/** 種から 0..1 の乱数と次の種を返す（mulberry32）。状態を持たないので再現できる */
export function rand(seed: number): [value: number, next: number] {
  const next = (seed + 0x6d2b79f5) | 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

/** 1歩の中で続けて乱数を引くための小さな器。最後に seed を状態へ戻す */
export function rng(seed: number) {
  let s = seed
  return {
    next: () => {
      const [v, n] = rand(s)
      s = n
      return v
    },
    seed: () => s,
  }
}

/** 文字列や座標から決まった数を作る（建物ごとの色や看板の割り当てに使う） */
export function hash(...values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h ^= Math.round(v * 10) | 0
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** 折れ線の各頂点までの累積の長さ */
export function cumulative(pts: Flat): number[] {
  const cum = [0]
  for (let i = 2; i < pts.length; i += 2) {
    cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]))
  }
  return cum
}

/** 折れ線の始点から s 進んだ点と、その場所の向き */
export function pointAlong(pts: Flat, cum: number[], s: number): { x: number; z: number; heading: number } {
  const total = cum[cum.length - 1]
  const d = clamp(s, 0, total)
  let i = 1
  while (i < cum.length - 1 && cum[i] < d) i++
  const segLen = cum[i] - cum[i - 1] || 1
  const t = (d - cum[i - 1]) / segLen
  const ax = pts[(i - 1) * 2]
  const az = pts[(i - 1) * 2 + 1]
  const bx = pts[i * 2]
  const bz = pts[i * 2 + 1]
  return { x: lerp(ax, bx, t), z: lerp(az, bz, t), heading: headingOf(bx - ax, bz - az) }
}

/** 点から線分へのいちばん近い点 */
export function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) : 0
  const x = ax + dx * t
  const z = az + dz * t
  return { x, z, t, d2: dist2(px, pz, x, z) }
}

/** 点が多角形の中か */
export function pointInPolygon(pts: Flat, x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]
    const zi = pts[i + 1]
    const xj = pts[j]
    const zj = pts[j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** 多角形の辺の上で、点にいちばん近い場所 */
export function closestOnPolygon(pts: Flat, x: number, z: number) {
  let best = { x: pts[0], z: pts[1], d2: Infinity }
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const c = closestOnSegment(x, z, pts[j], pts[j + 1], pts[i], pts[i + 1])
    if (c.d2 < best.d2) best = c
  }
  return best
}
