// Grand Theft Outfit [部品: onfoot の見た目] 後ろ姿の絵と、体の板とは別に振れる腕。
// 入口: createBackSprites(ctx, textureOf, tint) / createArms(castShadow) / placeArms(...)
// 契約: 正面のくり抜き写真が読み込めたら、lib/gto/spriteBack.ts で後ろ姿と腕の絵を1回だけ作って覚える。
//       腕は体の板（plane）の子として置く。板と同じ座標（x は板の幅、y は板の高さが 1）で頂点を毎フレーム書く。
//       奥へ振った所は板の後ろへ回るので、体に隠れる。
import * as THREE from 'three'
import type { ArmLimb, ArmPoint } from '../../lib/gto/onFootArms'
import type { BodyPose } from '../../lib/gto/onFootPose'
import { ARM_TUNING } from '../../lib/gto/onFootArms'
import { buildBackSprite, type BackRig } from '../../lib/gto/spriteBack'
import { buildPuppetAtlas, PUPPET_ATLAS } from '../../lib/gto/spritePuppet'
import { RIG_STYLE } from './renderActorGait'
import type { PuppetLook } from './renderActorPuppet'

/** 腕の見た目を決める数字 */
export const ARMS_STYLE = {
  /** 腕を板より手前へ出す量 m（重なりのちらつきを防ぐ） */
  bias: 0.03,
  /** 奥行きを板の前後へ写す倍率 */
  depthScale: 1,
}

export interface BackLook {
  tex: THREE.Texture
  arm: THREE.MeshBasicMaterial
  rig: BackRig
  /** 部位に切り分けた絵（関節のある体に貼る）。作れなければ null */
  puppet: PuppetLook | null
}

export interface BackSprites {
  /** 後ろ姿の絵。正面の写真がまだ読み込めていなければ null */
  get: (key: string) => BackLook | null
  dispose: () => void
}

function canvasTexture(data: Uint8ClampedArray, w: number, h: number): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return null
  const image = g.createImageData(w, h)
  image.data.set(data)
  g.putImageData(image, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 正面の写真から後ろ姿を作って覚えておく入れ物 */
export function createBackSprites(textureOf: (key: string) => THREE.Texture, tint: THREE.Color): BackSprites {
  const looks = new Map<string, BackLook | null>()
  const build = (key: string): BackLook | null | undefined => {
    const image = textureOf(key).image as HTMLImageElement | undefined
    const w = image?.naturalWidth ?? 0
    const h = image?.naturalHeight ?? 0
    // まだ読み込み中
    if (!image || !image.complete || w === 0 || h === 0) return undefined
    try {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d', { willReadFrequently: true })
      if (!g) return null
      g.drawImage(image, 0, 0)
      const src = g.getImageData(0, 0, w, h).data
      const made = buildBackSprite(src, w, h)
      const tex = canvasTexture(made.back, w, h)
      const armTex = canvasTexture(made.arm.data, made.arm.w, made.arm.h)
      if (!tex || !armTex) return null
      tex.anisotropy = 2
      const arm = new THREE.MeshBasicMaterial({ map: armTex, color: tint, alphaTest: 0.5, side: THREE.DoubleSide })
      // 部位に切り分けた絵（頭・胴・腿・すね・腕の升目）
      const atlas = buildPuppetAtlas(src, w, h, made)
      const atlasTex = canvasTexture(atlas.data, PUPPET_ATLAS, PUPPET_ATLAS)
      if (atlasTex) atlasTex.generateMipmaps = false
      if (atlasTex) atlasTex.minFilter = THREE.LinearFilter
      const cut = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, color: tint, alphaTest: 0.5, side: THREE.DoubleSide })
      const puppet = atlasTex
        ? { material: new THREE.MeshBasicMaterial({ map: atlasTex, color: tint, vertexColors: true, side: THREE.DoubleSide }), headBack: cut(tex), headFront: cut(textureOf(key)), dims: atlas.dims }
        : null
      return { tex, arm, rig: made.rig, puppet }
    } catch {
      // 画素を読めない環境では、後ろ姿なし（正面の絵のまま）で続ける
      return null
    }
  }
  return {
    get: (key) => {
      if (key === '') return null
      const cached = looks.get(key)
      if (cached !== undefined) return cached
      const made = build(key)
      if (made === undefined) return null
      looks.set(key, made)
      return made
    },
    dispose: () => {
      for (const look of looks.values()) {
        if (!look) continue
        look.tex.dispose()
        look.arm.map?.dispose()
        look.arm.dispose()
        look.puppet?.material.map?.dispose()
        look.puppet?.material.dispose()
        look.puppet?.headBack.dispose()
        look.puppet?.headFront.dispose()
      }
      looks.clear()
    },
  }
}

/** 腕2本ぶんの板（1本 = 肩・肘・手首の3つの断面） */
export interface Arms {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  position: THREE.BufferAttribute
}

const UPPER_V = 1 - ARM_TUNING.upper

export function createArms(material: THREE.MeshBasicMaterial, castShadow: boolean): Arms {
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(new Float32Array(12 * 3), 3)
  position.setUsage(THREE.DynamicDrawUsage)
  const uv = new Float32Array(12 * 2)
  const index: number[] = []
  for (let arm = 0; arm < 2; arm++) {
    const o = arm * 6
    const vs = [1, UPPER_V, 0]
    for (let i = 0; i < 3; i++) {
      uv.set([0, vs[i], 1, vs[i]], (o + i * 2) * 2)
      if (i < 2) index.push(o + i * 2, o + i * 2 + 2, o + i * 2 + 1, o + i * 2 + 1, o + i * 2 + 2, o + i * 2 + 3)
    }
  }
  geometry.setAttribute('position', position)
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(index)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = castShadow
  mesh.frustumCulled = false
  mesh.visible = false
  return { mesh, position }
}

/** 体の姿勢（前かがみ・横の傾き・腰の沈み・ひねり）で、腕の点も体と一緒に動かす。座標は身長を 1、板の中心を x=0 とする */
function carried(p: ArmPoint, baseX: number, baseY: number, body: BodyPose): ArmPoint {
  const hip = RIG_STYLE.hip
  const x = baseX + p.x
  const dy = baseY - hip - (baseY - hip) * body.hunch + p.y
  const sn = Math.sin(body.bend)
  const cs = Math.cos(body.bend)
  return { x: (x * cs - dy * sn) * (1 - body.twist), y: hip + x * sn + dy * cs - body.drop, depth: p.depth }
}

/**
 * 腕の頂点を書く。
 * @param centerX 肩の中心の横位置（体の板の原点から。板の幅に対する割合）
 * @param aspect 板の幅÷高さ
 * @param height 身長 m（奥行きを m にするため）
 */
export function placeArms(arms: Arms, limbs: readonly [ArmLimb, ArmLimb], rig: BackRig, centerX: number, body: BodyPose, aspect: number, height: number): void {
  const S = ARMS_STYLE
  const pos = arms.position
  const asp = Math.max(0.05, aspect)
  const half = rig.armWide / 2
  for (let arm = 0; arm < 2; arm++) {
    const limb = limbs[arm]
    const baseX = centerX * asp
    const pts = [limb.shoulder, limb.elbow, limb.wrist].map((p) => carried(p, baseX, rig.shoulderY, body))
    // 各断面の向き: 前後の線分に直角（肘は2本のあいだ）
    const normal = (a: ArmPoint, b: ArmPoint): [number, number] => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      return len > 1e-5 ? [-dy / len, dx / len] : [-1, 0]
    }
    const n0 = normal(pts[0], pts[1])
    const n2 = normal(pts[1], pts[2])
    const mx = n0[0] + n2[0]
    const my = n0[1] + n2[1]
    const ml = Math.hypot(mx, my)
    const n1: [number, number] = ml > 0.5 ? [mx / ml, my / ml] : n0
    const ns = [n0, n1, n2]
    for (let i = 0; i < 3; i++) {
      const p = pts[i]
      const z = S.bias - p.depth * height * S.depthScale
      const o = arm * 6 + i * 2
      pos.setXYZ(o, (p.x + ns[i][0] * half) / asp, p.y + ns[i][1] * half, z)
      pos.setXYZ(o + 1, (p.x - ns[i][0] * half) / asp, p.y - ns[i][1] * half, z)
    }
  }
  pos.needsUpdate = true
}
