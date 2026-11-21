// Grand Theft Outfit: 題名の画面のカメラ。
// 入口: titleCamera(t, spec)（t は題名の画面を出してからの秒。spec はエリアごとの弧で、省くと渋谷）
// 契約: 渋谷は、交差点の西北西の空から、交差点とその奥の駅の高層棟を見下ろし、同じ弧の上をゆっくり往復する。
//       駅のまわりを 1 周させると、同じ高さにある高層棟とクレーンの中を通り抜けてしまうので、回さない。
//       弧（lib/gto/areas.ts の title）は、エリアごとに、建物・クレーンに近づかず、見る先までの見通しも塞がれない範囲に
//       収めてある（__tests__/titleCamera.test.ts と areaShinjuku.test.ts が確かめる）。
import { AREAS, type TitleCameraSpec } from './areas'
import { DEG } from './math'

/** 渋谷の弧（これまでの書き出し名） */
export const TITLE_CAMERA: TitleCameraSpec = AREAS.shibuya.title

export interface TitleCamera {
  x: number
  y: number
  z: number
  /** 見る先 */
  tx: number
  ty: number
  tz: number
  fov: number
}

export function titleCamera(t: number, spec: TitleCameraSpec = TITLE_CAMERA): TitleCamera {
  const c = spec
  const cx = c.cx ?? 0
  const cz = c.cz ?? 0
  const a = (c.mid + c.swing * Math.sin(t * c.rate)) * DEG
  return { x: cx + Math.sin(a) * c.radius, y: c.height, z: cz + Math.cos(a) * c.radius, tx: cx, ty: c.lookY, tz: cz, fov: c.fov }
}
