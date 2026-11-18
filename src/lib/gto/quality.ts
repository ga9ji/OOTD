// Grand Theft Outfit [部品: mobile] 画質プリセット。PC は画質優先、スマホは 60fps を保つ軽量設定。
// 入口: QUALITY / pickQuality(requested, device)
// 契約: 描画とシミュレーションの「量」を決める数字だけを持つ。各描画部品はここの値を読む。
import type { QualityId } from './types'

export interface QualityPreset {
  id: QualityId
  /** devicePixelRatio の上限 */
  pixelRatio: number
  antialias: boolean
  shadows: boolean
  shadowMapSize: number
  /** ブルームなどのポストプロセスを掛けるか */
  post: boolean
  /** 見える距離 m（これより先は霧で消える） */
  drawDistance: number
  /** 地面のメッシュの格子の間隔 m */
  terrainStep: number
  maxVehicles: number
  maxPeds: number
  /** 住人に使う出勤服の種類の数（テクスチャの枚数） */
  pedOutfits: number
  /** 看板の最大数 */
  maxSigns: number
  /** 建物の壁の窓テクスチャの解像度 */
  facadeTexture: number
  /** 街灯などの小物を置くか */
  props: boolean
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  high: {
    id: 'high',
    pixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    post: true,
    drawDistance: 900,
    terrainStep: 5,
    maxVehicles: 26,
    maxPeds: 70,
    pedOutfits: 40,
    maxSigns: 240,
    facadeTexture: 512,
    props: true,
  },
  mobile: {
    id: 'mobile',
    // 影も後処理も無いので 1.5 まで上げても軽い（1.25 では斜めの線の段々が目立った）
    pixelRatio: 1.5,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    post: false,
    drawDistance: 420,
    terrainStep: 10,
    maxVehicles: 10,
    maxPeds: 22,
    pedOutfits: 14,
    maxSigns: 96,
    facadeTexture: 256,
    props: false,
  },
}

export interface DeviceHint {
  /** 主な入力が指（pointer: coarse）か */
  coarsePointer: boolean
  /** 画面の短い辺（CSS px） */
  shortSide: number
}

/** URL で指定があればそれを、無ければ端末から決める */
export function pickQuality(requested: string | null | undefined, device: DeviceHint): QualityPreset {
  if (requested === 'high' || requested === 'mobile') return QUALITY[requested]
  return device.coarsePointer || device.shortSide < 520 ? QUALITY.mobile : QUALITY.high
}
