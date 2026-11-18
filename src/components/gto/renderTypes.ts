// Grand Theft Outfit: 描画部品が共有する型。各 render*.ts は「作る関数」を1つ持ち、
// RenderPart（update と dispose）を返す。部品どうしは互いを import せず、ここの型だけを見る。
import type * as THREE from 'three'
import type { LightingParams } from '../../lib/gto/lighting'
import type { QualityPreset } from '../../lib/gto/quality'
import type { GtoView } from '../../lib/gto/sim'
import type { GtoState, GtoWorld, TimeOfDay } from '../../lib/gto/types'

export interface RenderCtx {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  world: GtoWorld
  quality: QualityPreset
  lighting: LightingParams
  time: TimeOfDay
  /** 出勤服のくり抜きスプライト（public/cutouts/*.webp）の URL と縦横比（幅÷高さ） */
  spriteUrl: (key: string) => string
  spriteAspect: (key: string) => number
  /** 読み込み中のテクスチャの数を数える（撮影ツールが「絵が出そろった」ことを知るため） */
  loading: { begin: () => void; end: () => void }
}

export interface FrameInfo {
  state: GtoState
  view: GtoView
  /** 前の描画からの秒 */
  dt: number
  /** 経過秒（点滅や揺れに使う） */
  now: number
  /** 固定カメラ（現地写真との見比べ）か。true のあいだ主人公は描かない */
  photo: boolean
}

export interface RenderPart {
  update: (frame: FrameInfo) => void
  dispose: () => void
}
