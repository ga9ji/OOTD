// Grand Theft Outfit [部品: city] 通りの突き当たりに見える物。屋上に並ぶ大型ビジョン、妻面がガラスの板状のホテル棟、ガードの東の面。
// 現地写真 miyamasuzaka_04/05・viaduct_10: 宮益坂下からガード越しに西を見ると、明るい灰色の桁の上に電車、
// その真上に細い高層棟が 1 本（頂部の片側が一段高く、アンテナが立つ）、右の屋上に大型ビジョンが 2 面並ぶ。
// 入口: buildRoofScreens(cb, bd, roofY) / hotelSlab(cb, bd, ext) / buildGuardFace(cb) / buildBrickWalks(world, walk, solid, detail)
// 契約: 置き場所と寸法は lib/gto/mapVista.ts。名前・ロゴ・広告は描かない（映像は renderCityTextures の架空の絵）。
import { BRICK_WALK, brickFenceAt, GUARD_EAST, guardEastFace, isBrickWalkRoad, roofScreens, splitSlab, TOWER_CROWN, walkRuns } from '../../lib/gto/mapVista'
import { hash } from '../../lib/gto/math'
import type { GtoWorld, MapBuilding } from '../../lib/gto/types'
import { extrude, screen, type CityBuild, type Extent } from './renderCityBuildings'
import { box, cap, centroidOf, ribbon, wall, type Builder } from './renderCityGeom'

const C = {
  frame: 0x2c2f33,
  back: 0x3a3e44,
  /** ホテル棟の長い面（小窓の並ぶ明るい灰色の壁。109_10/13）と、その下の窓の無い濃い灰色の帯、妻面のガラス */
  slabWall: 0xe6e8e8,
  slabBase: 0x8e9296,
  slabGlass: 0x24456e,
  slabCrown: 0xb4b6b4,
  slabStep: 0x1f3c60,
  slabRoof: 0x8f8a80,
  mast: 0xe2e5e7,
  /** ガードの東の面（無地の明るい灰色の板）と、上の高欄、下の影 */
  guard: 0xe4e8ea,
  guardRail: 0xf4f6f6,
  guardShadow: 0x3b3f44,
  /** 歩道の赤茶のレンガ調の舗装と、緑の横パイプ柵 */
  brick: 0xb27c66,
  fence: 0x2f6b4a,
}

/** ホテル棟の足元の、窓の無い帯の高さ m（下端から） */
const SLAB_BASE_BAND = 20

/** 屋上の縁に立つ大型ビジョン。画面の後ろに鉄骨の枠と脚を付ける（裏からは暗い箱に見える） */
export function buildRoofScreens(cb: CityBuild, bd: MapBuilding, roofY: number) {
  for (const s of roofScreens(bd)) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1
    const ux = (s.bx - s.ax) / len
    const uz = (s.bz - s.az) / len
    const yaw = Math.atan2(uz, ux)
    const mx = (s.ax + s.bx) / 2
    const mz = (s.az + s.bz) / 2
    screen(cb, s.ax, s.az, s.bx, s.bz, roofY + s.y0, roofY + s.y1, s.nx, s.nz, s.tile)
    // 裏の箱（画面の厚み）と、屋上から立ち上がる脚
    box(cb.roofs, mx - s.nx * 0.55, mz - s.nz * 0.55, roofY + s.y0 - 0.5, roofY + s.y1 + 0.5, len / 2 + 0.5, 0.6, C.back, yaw, 0.8)
    const posts = Math.max(2, Math.round(len / 4))
    for (let k = 0; k <= posts; k++) {
      const t = -len / 2 + 0.5 + ((len - 1) * k) / posts
      box(cb.roofs, mx + ux * t - s.nx * 0.6, mz + uz * t - s.nz * 0.6, roofY, roofY + s.y0, 0.14, 0.14, C.frame, yaw)
      // 後ろへ倒した控え（細部）
      if (cb.detail) box(cb.roofs, mx + ux * t - s.nx * 2.2, mz + uz * t - s.nz * 2.2, roofY, roofY + (s.y1 - s.y0) * 0.5, 0.1, 0.1, C.frame, yaw)
    }
  }
}

/**
 * 板状のホテル棟。長い面は小窓の並ぶベージュの壁、両端の妻面はガラス。
 * 頂部は東の端が一段高く、その上にアンテナ。四角い輪郭でなければ false（ふつうの塔として作る）
 */
export function hotelSlab(cb: CityBuild, bd: MapBuilding, ext: Extent): boolean {
  const parts = splitSlab(bd.pts, 2.6)
  if (!parts) return false
  const base = ext.floating ? ext.bottom : bd.y
  const seed = hash(bd.id, 9)
  const crown = 3.5
  // 109 の前から見上げると、低い棟の屋根のすぐ上は窓の無い濃い灰色の帯で、その上から小窓の格子が始まる
  const band = Math.min(ext.bottom + SLAB_BASE_BAND, ext.top - crown - 10)
  extrude(cb, 'blank', parts.body, ext.bottom, band, C.slabBase, base)
  extrude(cb, 'tile', parts.body, band, ext.top - crown, C.slabWall, band, seed)
  extrude(cb, 'blank', parts.body, ext.top - crown, ext.top, C.slabCrown, ext.top)
  for (const end of parts.ends) extrude(cb, 'curtain', end, ext.bottom, ext.top, C.slabGlass, base, seed)
  cap(cb.roofs, bd.pts, ext.top, C.slabRoof, true)
  if (ext.floating) cap(cb.roofs, bd.pts, ext.bottom, C.slabRoof, false, 0.6)
  // 東の妻面の重心と、反対の端の重心から、長手の向き（東向き）を出す
  const [e0x, e0z] = centroidOf(parts.ends[0])
  const [e1x, e1z] = centroidOf(parts.ends[1])
  const east = e0x >= e1x ? [e0x, e0z, e1x, e1z] : [e1x, e1z, e0x, e0z]
  const long = Math.hypot(east[0] - east[2], east[1] - east[3]) || 1
  const ux = (east[0] - east[2]) / long
  const uz = (east[1] - east[3]) / long
  const end = e0x >= e1x ? parts.ends[0] : parts.ends[1]
  // 妻面の幅（短手）
  const short = Math.max(Math.hypot(end[2] - end[4], end[3] - end[5]), Math.hypot(end[0] - end[6], end[1] - end[7]))
  const T = TOWER_CROWN
  const yaw = Math.atan2(uz, ux)
  // 一段高い部分は東の端の南寄り（東から見て左）
  const south = -ux >= 0 ? 1 : -1
  const sx = east[0] - ux * long * 0.14 + -uz * south * short * 0.2
  const sz = east[1] - uz * long * 0.14 + ux * south * short * 0.2
  box(cb.walls.curtain, sx, sz, ext.top, ext.top + T.step, long * 0.16, (short * T.stepScale) / 2, C.slabStep, yaw, 1)
  box(cb.walls.blank, sx, sz, ext.top + T.step, ext.top + T.step + T.mast, T.mastSize, T.mastSize, C.mast, yaw, 1)
  return true
}

/** JR の鉄桁ガードの東の面。無地の明るい灰色の板、上に高欄、下の縁に影の線 */
export function buildGuardFace(cb: CityBuild) {
  const f = guardEastFace(cb.world.map)
  if (!f) return
  const G = GUARD_EAST
  const lift = (off: number): [number, number, number, number] => [f.ax + f.nx * off, f.az + f.nz * off, f.bx + f.nx * off, f.bz + f.nz * off]
  const [ax, az, bx, bz] = lift(0)
  // 日陰の面でも明るい灰色に見えるよう、空を映す金属板の壁として張る（東口の仮囲いと同じ材質）
  const span = Math.hypot(bx - ax, bz - az)
  wall(cb.walls.metal, ax, az, bx, bz, f.y + G.bottom, f.y + G.top, f.nx, f.nz, C.guard, 1, 0, span / 3 / 8, 0, (G.top - G.bottom) / 3.6 / 8)
  const [rx0, rz0, rx1, rz1] = lift(0.08)
  wall(cb.walls.metal, rx0, rz0, rx1, rz1, f.y + G.top - 0.35, f.y + G.top, f.nx, f.nz, C.guardRail, 1, 0, 0.01, 0, 0.01)
  wall(cb.walls.blank, rx0, rz0, rx1, rz1, f.y + G.bottom, f.y + G.bottom + 0.3, f.nx, f.nz, C.guardShadow, 1)
  // 板の上面（上から見たときの厚み）
  const len = Math.hypot(bx - ax, bz - az)
  box(cb.roofs, (ax + bx) / 2 - f.nx * 0.2, (az + bz) / 2 - f.nz * 0.2, f.y + G.top - 0.1, f.y + G.top, len / 2, 0.2, C.guardRail, Math.atan2(bz - az, bx - ax), 1)
}

/**
 * 宮益坂とガードの手前の通りの歩道。赤茶のレンガ調の帯を敷き、車道との境に緑の横パイプ柵を立てる。
 * 柵は当たり判定を持たない飾り（細部）。交差点と横道の口では途切れる。
 */
export function buildBrickWalks(world: GtoWorld, walk: Builder, solid: Builder, detail: boolean) {
  const W = BRICK_WALK
  for (const r of world.map.roads) {
    if (!isBrickWalkRoad(r)) continue
    for (const side of [1, -1]) {
      for (const run of walkRuns(world, r, (r.width / 2 + W.center) * side, 4)) ribbon(walk, run, W.width, (x, z) => world.groundY(x, z) + 0.11, C.brick, 2, true)
      if (!detail) continue
      for (const run of walkRuns(world, r, (r.width / 2 + W.fence) * side, W.panel)) {
        run.forEach(([x, z], i) => {
          if (!brickFenceAt(x, z)) return
          const y = world.groundY(x, z)
          box(solid, x, z, y, y + W.fenceH, 0.035, 0.035, C.fence)
          if (i === 0) return
          const [px, pz] = run[i - 1]
          const len = Math.hypot(x - px, z - pz)
          // 柵の 1 枚ぶんより離れた点どうしはつながない（区間の切れ目）
          if (len > W.panel * 1.6 || !brickFenceAt(px, pz)) return
          const ym = (y + world.groundY(px, pz)) / 2
          const yaw = Math.atan2(z - pz, x - px)
          for (const h of [W.fenceH - 0.04, W.fenceH * 0.5]) box(solid, (x + px) / 2, (z + pz) / 2, ym + h - 0.025, ym + h + 0.025, len / 2, 0.025, C.fence, yaw)
        })
      }
    }
  }
}
