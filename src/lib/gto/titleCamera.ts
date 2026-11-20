// Grand Theft Outfit: 題名の画面のカメラ。
// 入口: titleCamera(t)（t は題名の画面を出してからの秒）
// 契約: 交差点の西北西の空から、交差点とその奥の駅の高層棟を見下ろし、同じ弧の上をゆっくり往復する。
//       駅のまわりを 1 周させると、同じ高さにある高層棟とクレーンの中を通り抜けてしまうので、回さない。
//       弧は、建物・クレーンに近づかず、交差点までの見通しも塞がれない範囲に収めてある（__tests__/titleCamera.test.ts が確かめる）。
import { DEG } from './math'

export const TITLE_CAMERA = {
  /** 交差点（原点）からの水平距離 m と、高さ m */
  radius: 150,
  height: 78,
  /** 弧の中心の方角（度。原点から見てカメラのある向き。南 0・東 90・北 180・西 270）と、左右へ振れる幅（度） */
  mid: 248,
  swing: 20,
  /** 往復の速さ（ラジアン/秒。1 往復は約 57 秒） */
  rate: 0.11,
  /** 見る先の高さ m と、縦の画角（度） */
  lookY: 14,
  fov: 50,
}

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

export function titleCamera(t: number): TitleCamera {
  const c = TITLE_CAMERA
  const a = (c.mid + c.swing * Math.sin(t * c.rate)) * DEG
  return { x: Math.sin(a) * c.radius, y: c.height, z: Math.cos(a) * c.radius, tx: 0, ty: c.lookY, tz: 0, fov: c.fov }
}
