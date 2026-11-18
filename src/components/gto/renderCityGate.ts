// Grand Theft Outfit [部品: city] センター街入口のゲート。両脇の銀色の太い柱が、三段の輪の上から内側へ曲がり、
// 先端が筒のまま切れている（左右はつながらない）。曲がった腕の正面に通り名の板、柱に巻き広告・スピーカー・吊り旗、
// 柱の間に横断幕。通り名は実名、横断幕と旗の中身は架空。
// 入口: buildGate(world, detail) → 形（頂点色）と、絵を貼る面（通り名の字・横断幕） / createGateTexture()
// 契約: 置き場所は map.ts の centerGaiGate が決める。ここは形にするだけ。
import * as THREE from 'three'
import { centerGaiGate } from '../../lib/gto/map'
import type { GtoWorld } from '../../lib/gto/types'
import { box, Builder } from './renderCityGeom'

const NAME = ['渋', '谷', 'セ', 'ン', 'タ', 'ー', '街']
/** 絵の割り付け: 上半分に通り名の 7 字（1 字ぶん 1/8 幅）、下半分に横断幕 */
const CHAR_U = 1 / 8

const C = {
  silver: 0xd3d8dd,
  silverDark: 0xa9aeb4,
  base: 0xe6e7e4,
  plate: 0xe4e6e8,
  mouth: 0x2a2d31,
  black: 0x1c1d20,
  rod: 0x8c9094,
  flag: 0xf3f1ea,
  drums: [
    [0xf4efe2, 0xd8366f, 0x18b7c9],
    [0xf4efe2, 0xf2c230, 0x2b6cff],
  ],
}

/** 柱のまっすぐな部分の高さ・輪の段・腕の曲がり（m） */
const SHAFT_H = 5.1
const PIPE_R = 0.4
const ARM_REACH = 4.6
const ARM_RISE = 2.4
const ARM_SWEEP = (66 * Math.PI) / 180

type V3 = [number, number, number]
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** 縦軸まわりの回転体。profile は下から上への [半径, 高さ] の列 */
function lathe(b: Builder, cx: number, cz: number, profile: [number, number][], color: number, seg: number) {
  let prev: number[] | null = null
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i]
    const [pr, py] = profile[Math.max(0, i - 1)]
    const [qr, qy] = profile[Math.min(profile.length - 1, i + 1)]
    // 輪郭の向きから法線の傾きを出す（外向き＋上下）
    const slope = norm([qy - py, -(qr - pr), 0])
    const ring: number[] = []
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2
      const nx = Math.cos(a)
      const nz = Math.sin(a)
      ring.push(b.vert(cx + nx * r, y, cz + nz * r, nx * slope[0], slope[1], nz * slope[0], 0, 0, color))
    }
    if (prev) for (let k = 0; k < seg; k++) b.quad(prev[k], ring[k], ring[k + 1], prev[k + 1])
    prev = ring
  }
}

/** 道筋に沿った管。side は道筋の面に直角な向き（どの点でも同じ）。radii は点ごとの太さ */
function tube(b: Builder, path: V3[], side: V3, radii: number[], color: number, seg: number, capColor: number | null) {
  let prev: number[] | null = null
  let lastT: V3 = [0, 1, 0]
  for (let i = 0; i < path.length; i++) {
    const t = norm(add(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)], -1))
    const up = cross(t, side)
    const ring: number[] = []
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2
      const n = add([side[0] * Math.cos(a), side[1] * Math.cos(a), side[2] * Math.cos(a)], up, Math.sin(a))
      const p = add(path[i], n, radii[i])
      ring.push(b.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, color))
    }
    if (prev) for (let k = 0; k < seg; k++) b.quad(prev[k], prev[k + 1], ring[k + 1], ring[k])
    prev = ring
    lastT = t
  }
  if (capColor == null || !prev) return
  // 先端の切り口（筒の中は暗い）。少し奥に張って、縁を残す
  const end = add(path[path.length - 1], lastT, -0.12)
  const up = cross(lastT, side)
  const r = radii[radii.length - 1] * 0.82
  const c = b.vert(end[0], end[1], end[2], lastT[0], lastT[1], lastT[2], 0, 0, capColor)
  const rim: number[] = []
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2
    const p = add(add(end, side, Math.cos(a) * r), up, Math.sin(a) * r)
    rim.push(b.vert(p[0], p[1], p[2], lastT[0], lastT[1], lastT[2], 0, 0, capColor))
  }
  for (let k = 0; k < seg; k++) b.idx.push(c, rim[k], rim[k + 1])
}

/** 4 隅を指定した 1 枚の面。a→b が下辺、d→c が上辺。法線 n の側から見える */
function face(b: Builder, a: V3, bb: V3, c: V3, d: V3, n: V3, color: number, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
  const i0 = b.vert(a[0], a[1], a[2], n[0], n[1], n[2], u0, v0, color)
  const i1 = b.vert(bb[0], bb[1], bb[2], n[0], n[1], n[2], u1, v0, color)
  const i2 = b.vert(c[0], c[1], c[2], n[0], n[1], n[2], u1, v1, color)
  const i3 = b.vert(d[0], d[1], d[2], n[0], n[1], n[2], u0, v1, color)
  const facing = cross(add(bb, a, -1), add(d, a, -1))
  if (facing[0] * n[0] + facing[1] * n[1] + facing[2] * n[2] > 0) b.quad(i0, i1, i2, i3)
  else b.quad(i0, i3, i2, i1)
}

export interface GateBuild {
  solid: Builder
  /** 通り名の字と横断幕（createGateTexture の絵を貼る） */
  art: Builder
}

export function buildGate(world: GtoWorld, detail: boolean): GateBuild {
  const out: GateBuild = { solid: new Builder(), art: new Builder() }
  const gate = centerGaiGate(world)
  if (!gate) return out
  const { solid, art } = out
  const seg = detail ? 14 : 8
  const steps = detail ? 12 : 7
  const f: V3 = [Math.sin(gate.heading), 0, -Math.cos(gate.heading)]
  const s: V3 = [-f[2], 0, f[0]]
  const yaw = Math.atan2(s[2], s[0])
  const y = world.groundY(gate.x, gate.z)

  for (const side of [-1, 1]) {
    const px = gate.x + s[0] * gate.half * side
    const pz = gate.z + s[2] * gate.half * side
    const inward: V3 = [-s[0] * side, 0, -s[2] * side]
    // ---- 柱: 白い根元、銀の胴、三段の輪 ----
    lathe(solid, px, pz, [[0.5, y], [0.5, y + 1.1], [PIPE_R, y + 1.2], [PIPE_R, y + SHAFT_H]], C.base, seg)
    const rings: [number, number][] = []
    ;[0.74, 0.64, 0.56].forEach((r, k) => {
      const y0 = y + SHAFT_H + k * 0.3
      rings.push([PIPE_R, y0], [r, y0 + 0.04], [r, y0 + 0.22], [PIPE_R, y0 + 0.26])
    })
    rings.push([PIPE_R, y + SHAFT_H + 1.0])
    lathe(solid, px, pz, rings, C.silver, seg)
    // 巻き広告の筒（色の帯だけ）
    const drum = C.drums[side > 0 ? 0 : 1]
    drum.forEach((color, k) => lathe(solid, px, pz, [[0.56, y + 1.9 + k * 0.4], [0.56, y + 2.3 + k * 0.4]], color, seg))
    // スピーカー（通りの外側の面に付く）
    box(solid, px - inward[0] * 0.62 - f[0] * 0.1, pz - inward[2] * 0.62 - f[2] * 0.1, y + 3.9, y + 4.6, 0.28, 0.24, C.black, yaw)
    // 吊り旗。柱から左右へ棒を出して白い旗を下げる
    for (const dir of [-1, 1]) {
      const bx = px + s[0] * 0.9 * dir
      const bz = pz + s[2] * 0.9 * dir
      box(solid, bx, bz, y + 3.72, y + 3.78, 0.55, 0.03, C.rod, yaw)
      box(solid, bx, bz, y + 2.4, y + 3.7, 0.42, 0.025, dir * side > 0 ? C.flag : 0xe9e4d6, yaw)
      box(solid, bx, bz, y + 2.4, y + 2.7, 0.42, 0.03, [0x2b6cff, 0xd8366f][(dir + side + 2) % 2 === 0 ? 0 : 1], yaw)
    }

    // ---- 腕: 輪の上から内側へ曲がって、先端で切れる ----
    const top: V3 = [px, y + SHAFT_H + 1.0, pz]
    const armAt = (t: number): V3 => add([top[0], top[1] + ARM_RISE * Math.sin(t), top[2]], inward, ARM_REACH * (1 - Math.cos(t)))
    const path: V3[] = []
    const radii: number[] = []
    for (let k = 0; k <= steps; k++) {
      path.push(armAt((k / steps) * ARM_SWEEP))
      radii.push(PIPE_R)
    }
    // 先端は少し太い口金
    const tipT = norm(add(path[steps], path[steps - 1], -1))
    path.push(add(path[steps], tipT, 0.02), add(path[steps], tipT, 0.34))
    radii.push(PIPE_R + 0.09, PIPE_R + 0.09)
    tube(solid, path, f, radii, C.silver, seg, C.mouth)

    // ---- 通り名の板と字（正面と裏の両方） ----
    const t0 = ARM_SWEEP * 0.14
    const t1 = ARM_SWEEP * 0.93
    const plateHalf = 0.36
    for (const dirF of [-1, 1]) {
      // dirF = -1 が交差点側（正面）、+1 が通りの中側
      const toward: V3 = [f[0] * dirF, 0, f[2] * dirF]
      const off = PIPE_R + 0.05
      const edge = (t: number, w: number): V3 => {
        const p = armAt(t)
        const tan = norm(add(armAt(t + 0.01), armAt(t - 0.01), -1))
        // 腕の面の中で、曲がりの外側を向く向き
        const outer = cross(tan, [f[0] * side, 0, f[2] * side])
        return add(add(p, toward, off), outer, w)
      }
      const plateSteps = detail ? 8 : 4
      for (let k = 0; k < plateSteps; k++) {
        const a = t0 + ((t1 - t0) * k) / plateSteps
        const bT = t0 + ((t1 - t0) * (k + 1)) / plateSteps
        face(solid, edge(a, -plateHalf), edge(bT, -plateHalf), edge(bT, plateHalf), edge(a, plateHalf), toward, C.plate)
      }
      // 見る人から見て右の腕は「腕に沿った横書き」、左の腕は「先端から根元への縦書き」
      const viewerRight = side * -dirF > 0
      NAME.forEach((_, k) => {
        // 先端側から 渋 → 街
        const t = t1 - ((t1 - t0) * (k + 0.5)) / NAME.length
        const p = add(armAt(t), toward, off + 0.02)
        const tan = norm(add(armAt(t + 0.01), armAt(t - 0.01), -1))
        const outer = cross([f[0] * side, 0, f[2] * side], tan)
        const up: V3 = viewerRight ? outer : tan
        const right = cross(up, toward)
        const h = 0.29
        const a = add(add(p, right, -h), up, -h)
        const bb = add(add(p, right, h), up, -h)
        const c = add(add(p, right, h), up, h)
        const d = add(add(p, right, -h), up, h)
        face(art, a, bb, c, d, toward, 0xffffff, k * CHAR_U, (k + 1) * CHAR_U, 0.5, 1)
      })
    }
  }

  // ---- 柱の間の横断幕（少し傾けて張る） ----
  const span = gate.half - 0.9
  const corner = (u: number, v: number): V3 => {
    const along = (u - 0.5) * 2 * span
    return [gate.x + s[0] * along, y + 3.9 + v * 1.6 + u * 0.5, gate.z + s[2] * along]
  }
  for (const dirF of [-1, 1]) {
    const toward: V3 = [f[0] * dirF, 0, f[2] * dirF]
    const shift = (p: V3): V3 => add(p, toward, 0.02)
    // 裏から見ても字が読めるよう、裏は左右を入れ替える
    const [ul, ur] = dirF < 0 ? [0, 1] : [1, 0]
    face(art, shift(corner(ul, 0)), shift(corner(ur, 0)), shift(corner(ur, 1)), shift(corner(ul, 1)), toward, 0xffffff, 0, 1, 0, 0.5)
  }
  // 幕を吊る綱
  for (const side of [-1, 1]) {
    const u = side > 0 ? 1 : 0
    for (const v of [0, 1]) {
      const from = corner(u, v)
      const cx = gate.x + s[0] * (span + (gate.half - span) / 2) * side
      const cz = gate.z + s[2] * (span + (gate.half - span) / 2) * side
      box(solid, cx, cz, from[1] - 0.02, from[1] + 0.02, (gate.half - span) / 2, 0.015, C.rod, yaw)
    }
  }
  return out
}

/** 通り名の字（上半分）と横断幕（下半分）の絵。横断幕の催しは架空 */
export function createGateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const g = canvas.getContext('2d')
  if (g) {
    // 字: 板の色の地に黒い太字
    g.fillStyle = '#e4e6e8'
    g.fillRect(0, 0, 1024, 256)
    g.fillStyle = '#17181a'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 104px "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif'
    NAME.forEach((ch, k) => g.fillText(ch, (k + 0.5) * 128, 132))
    // 横断幕: 左が黄、右が黒。斜めの切り替え
    g.fillStyle = '#17181a'
    g.fillRect(0, 256, 1024, 256)
    g.fillStyle = '#f6d92b'
    g.beginPath()
    g.moveTo(0, 256)
    g.lineTo(520, 256)
    g.lineTo(400, 512)
    g.lineTo(0, 512)
    g.closePath()
    g.fill()
    g.fillStyle = '#17181a'
    g.font = 'italic 900 78px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'
    g.fillText('まちあるき', 215, 340)
    g.font = '900 40px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'
    g.fillText('WALKERS WEEK', 205, 420)
    g.fillStyle = '#ff6a1f'
    g.font = '900 120px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'
    g.fillText('OOTD', 740, 350)
    g.fillStyle = '#f4f1ea'
    g.font = '900 34px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'
    g.fillText('きょうの出勤服で歩こう', 730, 440)
    g.fillStyle = '#f4f1ea'
    g.fillRect(0, 478, 1024, 6)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
