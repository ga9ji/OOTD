// Grand Theft Outfit [部品: city] 宮益坂下から南を見たときの手前の層。乗り場の入口に横向きに連なる路線バス、
// 緑の梁の上屋、白い仮囲い、歩道の白いパイプ柵。現地写真 viaduct_01・miyamasuzaka_06/08。
// 入口: buildEastFront(cb) / bus(cb, p) / sideWindows(…)
// 契約: 置き場所と寸法は lib/gto/mapEastFront.ts と mapEast.ts。どれも当たり判定を持たない飾り。会社名・行き先・ロゴは描かない。
import { BUS_BODY, type ParkedBus } from '../../lib/gto/mapEast'
import { CURB_FENCES, frontBuses, HOARDING_H, HOARDINGS, type Segment } from '../../lib/gto/mapEastFront'
import type { CityBuild } from './renderCityBuildings'
import { box, wall } from './renderCityGeom'

const BUS = { body: 0xf6f1df, green: 0x35a04a, orange: 0xf08a1f, glass: 0x1b2228, pillar: 0x30363b, roof: 0xe9e6da, tyre: 0x17181a, hub: 0x9a9da0, lamp: 0xffb347, sign: 0x15171a, bumper: 0x3a3d40 }
const FRONT = { hoard: 0xf4f5f3, hoardCap: 0xd9dcdc, postGreen: 0x2f9a57, postWhite: 0xf4f4ef, fence: 0xf2f3f1, beam: 0x7d858b, roof: 0xdfe3e4, island: 0xa6adb6 }

/** 車体の両側面の窓の帯（夕方と夜は車内の明かりで光る）。(ux, uz) は車体の長手の向き */
export function sideWindows(cb: CityBuild, cx: number, cz: number, ux: number, uz: number, hl: number, off: number, y0: number, y1: number, sides: number[] = [-1, 1]) {
  for (const side of sides) {
    const nx = -uz * side
    const nz = ux * side
    wall(cb.walls.band, cx - ux * hl + nx * off, cz - uz * hl + nz * off, cx + ux * hl + nx * off, cz + uz * hl + nz * off, y0, y1, nx, nz, 0xdfe8ee, 1, 0, (hl * 2) / 1.3 / 8, 0, 1 / 8)
  }
}

/**
 * 路線バス 1 台（viaduct_01）。クリーム色の車体、裾と後ろ寄りに緑、前寄りの腰に橙、柱で区切られた暗い窓、
 * 黒いタイヤと、前の上の行き先表示（橙の明かりだけ。字は描かない）。
 */
export function bus(cb: CityBuild, p: ParkedBus) {
  const B = BUS_BODY
  const b = cb.walls.blank
  const ux = Math.sin(p.heading)
  const uz = -Math.cos(p.heading)
  const yaw = Math.atan2(uz, ux)
  const y = cb.world.groundY(p.x, p.z)
  const hl = B.length / 2
  const hw = B.width / 2
  // 車体は日陰でも白く見えるよう明るめに持ち上げる
  box(b, p.x, p.z, y + 0.36, y + B.height, hl, hw, BUS.body, yaw, 1.12)
  // 裾は暗い灰色（端から端まで続く緑の帯は電車の塗り分けに見える）。緑は後ろ寄り、橙は前寄りの腰にだけ入れる
  const skirt = p.livery ? 0.95 : 0.8
  box(b, p.x, p.z, y + 0.36, y + 0.66, hl + 0.02, hw + 0.03, BUS.bumper, yaw, 1)
  box(b, p.x + ux * hl * 0.52, p.z + uz * hl * 0.52, y + skirt, y + 1.4, hl * 0.3, hw + 0.03, BUS.orange, yaw, 1.1)
  box(b, p.x - ux * hl * 0.72, p.z - uz * hl * 0.72, y + skirt, y + 1.4, hl * 0.2, hw + 0.03, BUS.green, yaw, 1.1)
  // 窓の帯と、前後の大きな窓
  // 窓は暗いガラスのまま（夜に端から端まで光る窓の帯にすると、地上に止まった電車に見える。光る窓の帯はガードの上の電車だけ）
  box(b, p.x, p.z, y + 1.58, y + 2.6, hl - 0.25, hw + 0.04, BUS.glass, yaw, 1)
  box(b, p.x + ux * hl, p.z + uz * hl, y + 1.1, y + 2.62, 0.05, hw - 0.12, BUS.glass, yaw, 1)
  box(b, p.x - ux * hl, p.z - uz * hl, y + 1.6, y + 2.55, 0.05, hw - 0.2, BUS.glass, yaw, 1)
  // 行き先表示（前の上と、左の側面の前寄り）とバンパー
  box(b, p.x + ux * (hl + 0.03), p.z + uz * (hl + 0.03), y + 2.64, y + 2.98, 0.04, hw - 0.25, BUS.sign, yaw, 1)
  box(b, p.x + ux * (hl + 0.06), p.z + uz * (hl + 0.06), y + 2.7, y + 2.92, 0.03, hw - 0.55, BUS.lamp, yaw, 1.3)
  box(b, p.x, p.z, y + 0.3, y + 0.5, hl + 0.06, hw - 0.1, BUS.bumper, yaw, 1)
  // 屋根の冷房の箱
  box(cb.roofs, p.x - ux * 1.2, p.z - uz * 1.2, y + B.height, y + B.height + 0.3, 1.9, hw - 0.3, BUS.roof, yaw, 1)
  // タイヤ（前 1 軸・後ろ 1 軸）。軽量設定でも付ける（無いと電車に見える）
  for (const s of [-0.58, 0.6]) {
    for (const side of [-1, 1]) {
      const wx = p.x + ux * s * hl - uz * side * (hw - 0.08)
      const wz = p.z + uz * s * hl + ux * side * (hw - 0.08)
      box(b, wx, wz, y, y + 1.0, 0.52, 0.17, BUS.tyre, yaw, 0.8)
      if (cb.detail) box(b, wx - uz * side * 0.03, wz + ux * side * 0.03, y + 0.3, y + 0.7, 0.2, 0.17, BUS.hub, yaw, 1)
    }
  }
  // タイヤの上の暗い切り欠き（車輪が車体の外に見える。電車には無い）と、前の両脇に突き出した鏡
  for (const t of [-0.58, 0.6]) box(b, p.x + ux * t * hl, p.z + uz * t * hl, y + 0.36, y + 1.18, 0.72, hw + 0.035, BUS.tyre, yaw, 0.9)
  for (const side of [-1, 1]) {
    const mx = p.x + ux * (hl - 0.15) - uz * side * (hw + 0.28)
    const mz = p.z + uz * (hl - 0.15) + ux * side * (hw + 0.28)
    box(b, mx, mz, y + 1.9, y + 2.45, 0.07, 0.14, BUS.tyre, yaw, 1)
    box(b, p.x + ux * (hl - 0.15) - uz * side * (hw + 0.12), p.z + uz * (hl - 0.15) + ux * side * (hw + 0.12), y + 2.38, y + 2.46, 0.04, 0.16, BUS.tyre, yaw, 1)
  }
  if (!cb.detail) return
  // 窓の柱（1.5m おき）と、左の側面の扉 2 枚（前と中ほど。床まで届く暗いガラス）
  for (let t = -hl + 1.4; t < hl - 0.6; t += 1.5) {
    box(b, p.x + ux * t, p.z + uz * t, y + 1.5, y + 2.66, 0.06, hw + 0.07, BUS.pillar, yaw, 1)
  }
  for (const t of [hl - 1.25, -0.4]) {
    box(b, p.x + ux * t + uz * (hw + 0.02), p.z + uz * t - ux * (hw + 0.02), y + 0.5, y + 2.6, 0.48, 0.05, BUS.glass, yaw, 1)
  }
}

/** 緑と白の縞の柱（バス停の上屋・仮囲いの控え） */
function stripedPost(cb: CityBuild, x: number, z: number, y0: number, y1: number, r: number, yaw: number) {
  const step = 0.4
  let k = 0
  for (let y = y0; y < y1 - 0.01; y += step, k++) box(cb.walls.blank, x, z, y, Math.min(y1, y + step), r, r, k % 2 ? FRONT.postWhite : FRONT.postGreen, yaw, 1.1)
}

/** 白い鋼板の仮囲い。上に灰色の笠木、6m おきに緑と白の縞の控え柱 */
function hoarding(cb: CityBuild, [ax, az, bx, bz]: Segment) {
  const len = Math.hypot(bx - ax, bz - az)
  const ux = (bx - ax) / len
  const uz = (bz - az) / len
  const yaw = Math.atan2(uz, ux)
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  const y = Math.min(cb.world.groundY(ax, az), cb.world.groundY(bx, bz))
  // 表と裏（どちらから見ても白い鋼板の目地）
  for (const side of [1, -1]) {
    const nx = -uz * side
    const nz = ux * side
    wall(cb.walls.metal, ax + nx * 0.05, az + nz * 0.05, bx + nx * 0.05, bz + nz * 0.05, y - 0.3, y + HOARDING_H, nx, nz, FRONT.hoard, 1.05, 0, len / 1.5 / 8, 0, HOARDING_H / 3 / 8)
  }
  box(cb.roofs, mx, mz, y + HOARDING_H, y + HOARDING_H + 0.08, len / 2, 0.08, FRONT.hoardCap, yaw, 1)
  for (let t = 0; t <= len + 0.01; t += len / Math.max(1, Math.round(len / 6))) stripedPost(cb, ax + ux * t, az + uz * t, y - 0.2, y + HOARDING_H + 0.25, 0.09, yaw)
}

/** 白いパイプ柵（横 2 本、2m おきの支柱） */
function pipeFence(cb: CityBuild, [ax, az, bx, bz]: Segment) {
  const len = Math.hypot(bx - ax, bz - az)
  const ux = (bx - ax) / len
  const uz = (bz - az) / len
  const yaw = Math.atan2(uz, ux)
  const n = Math.max(1, Math.round(len / 2))
  for (let k = 0; k <= n; k++) {
    const x = ax + (ux * len * k) / n
    const z = az + (uz * len * k) / n
    const y = cb.world.groundY(x, z)
    box(cb.walls.blank, x, z, y, y + 0.85, 0.04, 0.04, FRONT.fence, yaw, 1.1)
    if (k === n) break
    const x1 = ax + (ux * len * (k + 1)) / n
    const z1 = az + (uz * len * (k + 1)) / n
    const ym = (y + cb.world.groundY(x1, z1)) / 2
    for (const h of [0.8, 0.45]) box(cb.walls.blank, (x + x1) / 2, (z + z1) / 2, ym + h - 0.03, ym + h + 0.03, len / n / 2, 0.03, FRONT.fence, yaw, 1.1)
  }
}

/** 手前の層をまとめて作る。バスと仮囲いは遠くからも「東口」の決め手なので軽量設定でも置く（柵と上屋は細部） */
export function buildEastFront(cb: CityBuild) {
  for (const p of frontBuses(cb.world)) bus(cb, p)
  for (const seg of HOARDINGS) hoarding(cb, seg)
  if (!cb.detail) return
  for (const seg of CURB_FENCES) pipeFence(cb, seg)
}
