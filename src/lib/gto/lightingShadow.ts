// Grand Theft Outfit [部品: light] 太陽の影の落とし方。
// 入口: SHADOW_CAP / casterHeight / shadowLength / groundGrid / sampleGround
// 契約: 渋谷はビルが高く通りが狭いので、太陽をそのまま当てると路面が一日じゅうビルの陰になり、
//       車や街路樹の影も、日なたと陰の境目も出ない。そこで「影を落とす側」だけ、地面からの高さを上限で丸める
//       （屋根越しに日が差す街として扱う）。受ける側の形と明るさは変えない。
//       renderSky.ts が同じ式を影の描画（奥行きだけ描く材質）の頂点に入れる。片方を変えたらもう片方も変える。
import { clamp } from './math'
import type { TimeOfDay } from './types'

export interface ShadowCap {
  /** この高さ m までは、そのままの形で影を落とす（車・人・柱・街路樹の幹） */
  keep: number
  /** 影を落とす高さの上限 m。どんなに高いビルも、影はこの高さの建物ぶんまで */
  max: number
}

/** 時刻ごとの上限。夕方は光が低いので上限も低くし、ビルの影が通りの幅を超えないようにする */
export const SHADOW_CAP: Record<TimeOfDay, ShadowCap> = {
  day: { keep: 5, max: 9 },
  dusk: { keep: 4.5, max: 8.5 },
  night: { keep: 5, max: 9 },
}

/** 地面からの高さ h の点が、影を落とすときに使う高さ。keep までは同じ、そこから上は max へ滑らかに寄る */
export function casterHeight(h: number, cap: ShadowCap): number {
  if (h <= cap.keep) return h
  const span = Math.max(cap.max - cap.keep, 0.001)
  return cap.keep + span * (1 - Math.exp(-(h - cap.keep) / span))
}

/** 高さ h の物が平らな地面に落とす影の長さ m。dir は光の向き（x=東、y=上、z=南） */
export function shadowLength(h: number, dir: readonly [number, number, number], cap: ShadowCap): number {
  const flat = Math.hypot(dir[0], dir[2])
  return (casterHeight(h, cap) * flat) / Math.max(dir[1], 0.001)
}

/** 地面の高さの粗い格子（影の描画が、頂点の地面からの高さを知るために使う） */
export interface GroundGrid {
  x0: number
  z0: number
  stepX: number
  stepZ: number
  cols: number
  rows: number
  /** 行ごと（z の順）に並べた高さ m */
  data: number[]
}

/** 地図の範囲を cells × cells に切って、格子の点の地面の高さを取る */
export function groundGrid(groundY: (x: number, z: number) => number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, cells: number): GroundGrid {
  const n = Math.max(1, Math.floor(cells))
  const stepX = (bounds.maxX - bounds.minX) / n
  const stepZ = (bounds.maxZ - bounds.minZ) / n
  const data = Array.from({ length: (n + 1) * (n + 1) }, (_, i) => groundY(bounds.minX + (i % (n + 1)) * stepX, bounds.minZ + Math.floor(i / (n + 1)) * stepZ))
  return { x0: bounds.minX, z0: bounds.minZ, stepX, stepZ, cols: n + 1, rows: n + 1, data }
}

/** 格子から地面の高さを戻す（範囲の外は端の値） */
export function sampleGround(grid: GroundGrid, x: number, z: number): number {
  const fx = clamp((x - grid.x0) / grid.stepX, 0, grid.cols - 1.001)
  const fz = clamp((z - grid.z0) / grid.stepZ, 0, grid.rows - 1.001)
  const c = Math.floor(fx)
  const r = Math.floor(fz)
  const tx = fx - c
  const tz = fz - r
  const i = r * grid.cols + c
  const top = grid.data[i] * (1 - tx) + grid.data[i + 1] * tx
  const bottom = grid.data[i + grid.cols] * (1 - tx) + grid.data[i + grid.cols + 1] * tx
  return top * (1 - tz) + bottom * tz
}

/** 影の描画に渡す格子の細かさ（地図の一辺をこの数に切る） */
export const GROUND_CELLS = 48
