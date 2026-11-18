// Grand Theft Outfit [部品: city] 遠くの目印になる高い塔。どの通りからでも、写真と同じ方角・同じ見かけの高さで見えるようにする。
// 入口: isSkylineTower(b) / sightTo(b, x, z, eyeY)
// 契約: three/DOM なし。塔は霧で消さず、描画距離の外でも輪郭を描く（renderCity.ts が材質を分ける）。
import type { MapBuilding } from './types'

/** これより高い建物は、遠くからの目印として扱う（m） */
export const SKYLINE_MIN_HEIGHT = 60

export const isSkylineTower = (b: MapBuilding): boolean => !b.roof && b.h >= SKYLINE_MIN_HEIGHT

export interface Sight {
  /** 方角（度。北 0・時計回り） */
  bearing: number
  /** 水平の距離 m */
  distance: number
  /** 頂部を見上げる角度（度） */
  elevation: number
}

/** 点 (x, z)・目の高さ eyeY から、建物の輪郭の中心と頂部がどう見えるか */
export function sightTo(b: MapBuilding, x: number, z: number, eyeY: number): Sight {
  const n = b.pts.length / 2
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += b.pts[i * 2] / n
    cz += b.pts[i * 2 + 1] / n
  }
  const dx = cx - x
  const dz = cz - z
  const distance = Math.hypot(dx, dz)
  const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
  const elevation = (Math.atan2(b.y + b.h - eyeY, distance || 1e-6) * 180) / Math.PI
  return { bearing, distance, elevation }
}
