// Grand Theft Outfit [部品: city] 通りの入口に立つ門。角柱 2 本に梁を渡し、梁の上に通り名の板、梁の下に電球の列。
// 新宿は歌舞伎町の赤い門、原宿は竹下通りの薄荷と桃色の門。通り名は実名（通りの名前は出してよい）。板の両端の飾りは架空。
// 入口: buildArch(world, detail) → 形（頂点色）・電球（夜に光る）・絵を貼る面（通り名の板）・見た目 / createArchTexture(look)
// 契約: 置き場所は lib/gto/mapShinjuku.ts の kabukichoArch と mapHarajuku.ts の takeshitaArch が決める
//       （通りが地図に無ければ何も作らない＝渋谷では立たない。門は 1 エリアに 1 つ）。
//       ここは形にするだけ。実在の門の意匠は写していない（色と「通りの入口に門がある」ことだけ）。
import * as THREE from 'three'
import type { GatePlacement } from '../../lib/gto/map'
import { TAKESHITA_ARCH, takeshitaArch } from '../../lib/gto/mapHarajuku'
import { KABUKICHO_ARCH, kabukichoArch } from '../../lib/gto/mapShinjuku'
import type { GtoWorld } from '../../lib/gto/types'
import { box, Builder } from './renderCityGeom'

/** 門の見た目: 柱と梁の色・板の裏打ちの色・電球の色、板の絵の色（CSS）と字 */
export interface ArchLook {
  post: number
  dark: number
  base: number
  bulbs: number[]
  plate: { bg: string; border: string; text: string; stroke: string; deco: string }
  label: string
}

const LOOKS: Record<'kabukicho' | 'takeshita', ArchLook> = {
  // 通りの名前から「通り」を落として、門の字にする
  kabukicho: {
    post: 0xd3202a,
    dark: 0x9c1820,
    base: 0x3a3c40,
    bulbs: [0xfff2c2, 0xffd166, 0xff8fb8],
    plate: { bg: '#c81d27', border: '#ffe9a8', text: '#ffe14a', stroke: '#7a0f16', deco: '#ffffff' },
    label: KABUKICHO_ARCH.street.replace(/通り$/, ''),
  },
  takeshita: {
    post: 0xa6f0de,
    dark: 0x6fd6c0,
    base: 0xf2ede4,
    bulbs: [0xfff2c2, 0xffb3d1, 0xa8ecff],
    plate: { bg: '#ff8fba', border: '#ffffff', text: '#ffffff', stroke: '#c9457d', deco: '#fff3a8' },
    label: TAKESHITA_ARCH.street,
  },
}

/** そのエリアに立つ門（無ければ null） */
export function archOf(world: GtoWorld): { gate: GatePlacement; look: ArchLook } | null {
  const kabukicho = kabukichoArch(world)
  if (kabukicho) return { gate: kabukicho, look: LOOKS.kabukicho }
  const takeshita = takeshitaArch(world)
  if (takeshita) return { gate: takeshita, look: LOOKS.takeshita }
  return null
}

/** 柱の高さ・太さ、梁の背丈、板の背丈（m） */
const POST_H = 6.4
const POST_HALF = 0.34
const BEAM_H = 0.7
const PLATE_H = 1.9
const PLATE_HALF_DEPTH = 0.16

export interface ArchBuild {
  solid: Builder
  /** 梁の下の電球（街灯の灯具と同じ材質で、夜に光る） */
  glow: Builder
  /** 通り名の板（createArchTexture の絵を貼る。夜は自分で光る） */
  art: Builder
  /** 立てた門の見た目（立てなければ null） */
  look: ArchLook | null
}

export function buildArch(world: GtoWorld, detail: boolean): ArchBuild {
  const out: ArchBuild = { solid: new Builder(), glow: new Builder(), art: new Builder(), look: null }
  const arch = archOf(world)
  if (!arch) return out
  const gate = arch.gate
  const C = { red: arch.look.post, redDark: arch.look.dark, base: arch.look.base, bulbs: arch.look.bulbs }
  out.look = arch.look
  const { solid, glow, art } = out
  // f = 通りの奥へ向かう向き、s = その右手
  const fx = Math.sin(gate.heading)
  const fz = -Math.cos(gate.heading)
  const sx = -fz
  const sz = fx
  const yaw = Math.atan2(sz, sx)
  const y = Math.max(world.groundY(gate.x + sx * gate.half, gate.z + sz * gate.half), world.groundY(gate.x - sx * gate.half, gate.z - sz * gate.half))
  const half = gate.half

  for (const side of [-1, 1]) {
    const px = gate.x + sx * half * side
    const pz = gate.z + sz * half * side
    // 根元の台と、赤い角柱
    box(solid, px, pz, y - 0.6, y + 0.5, POST_HALF + 0.14, POST_HALF + 0.14, C.base, yaw)
    box(solid, px, pz, y + 0.5, y + POST_H, POST_HALF, POST_HALF, C.red, yaw)
    // 柱の頭の飾り
    box(solid, px, pz, y + POST_H, y + POST_H + 0.3, POST_HALF + 0.12, POST_HALF + 0.12, C.redDark, yaw)
  }
  // 梁（柱の外へ少し張り出す）
  const beamY = y + POST_H - 1.5
  box(solid, gate.x, gate.z, beamY, beamY + BEAM_H, half + 0.7, 0.3, C.red, yaw)
  // 板の裏打ち（赤い箱）。表と裏に通り名の絵を貼る
  const plateY = beamY + BEAM_H
  const plateHalf = Math.max(1.6, half - 0.5)
  box(solid, gate.x, gate.z, plateY, plateY + PLATE_H, plateHalf, PLATE_HALF_DEPTH, C.redDark, yaw)
  for (const dir of [-1, 1]) {
    // dir=-1 は通りの入口（南）から見る面、+1 は通りの中から振り返って見る面
    const nx = fx * dir
    const nz = fz * dir
    const ox = gate.x + nx * (PLATE_HALF_DEPTH + 0.02)
    const oz = gate.z + nz * (PLATE_HALF_DEPTH + 0.02)
    // 見る側から見た右手の向き（左から右へ字が並ぶよう、左端を u=0 にする）
    const lx = -sx * dir
    const lz = -sz * dir
    const a = art.vert(ox - lx * plateHalf, plateY + 0.08, oz - lz * plateHalf, nx, 0, nz, 0, 0, 0xffffff)
    const b = art.vert(ox + lx * plateHalf, plateY + 0.08, oz + lz * plateHalf, nx, 0, nz, 1, 0, 0xffffff)
    const c = art.vert(ox + lx * plateHalf, plateY + PLATE_H - 0.08, oz + lz * plateHalf, nx, 0, nz, 1, 1, 0xffffff)
    const d = art.vert(ox - lx * plateHalf, plateY + PLATE_H - 0.08, oz - lz * plateHalf, nx, 0, nz, 0, 1, 0xffffff)
    // 面の表が法線の側を向く並びにする
    const ex = lx * 2 * plateHalf
    const ez = lz * 2 * plateHalf
    // 表から見える向きに頂点を並べる（(b − a) × (d − a) が法線と同じ側を向くほう）
    const facing = -(ez * nx - ex * nz)
    if (facing > 0) art.quad(a, b, c, d)
    else art.quad(a, d, c, b)
  }
  // 梁の下の電球の列
  const count = detail ? Math.max(4, Math.round((half * 2) / 0.6)) : Math.max(3, Math.round((half * 2) / 1.2))
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * 2 - 1
    const bx = gate.x + sx * (half - 0.5) * t
    const bz = gate.z + sz * (half - 0.5) * t
    box(glow, bx, bz, beamY - 0.2, beamY - 0.02, 0.1, 0.1, C.bulbs[i % C.bulbs.length], yaw, 1)
  }
  return out
}

/** 通り名の板の絵。門の見た目の色の地に、縁取りのある太字。両端に星の飾り（架空） */
export function createArchTexture(look: ArchLook): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = look.plate.bg
    g.fillRect(0, 0, 1024, 256)
    g.strokeStyle = look.plate.border
    g.lineWidth = 8
    g.strokeRect(10, 10, 1004, 236)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 118px "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif'
    const name = look.label
    g.lineJoin = 'round'
    g.lineWidth = 14
    g.strokeStyle = look.plate.stroke
    g.strokeText(name, 512, 134, 860)
    g.fillStyle = look.plate.text
    g.fillText(name, 512, 134, 860)
    g.fillStyle = look.plate.deco
    for (const x of [46, 978]) {
      g.beginPath()
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 22 : 9
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2
        g.lineTo(x + Math.cos(a) * r, 128 + Math.sin(a) * r)
      }
      g.closePath()
      g.fill()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
