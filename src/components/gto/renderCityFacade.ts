// Grand Theft Outfit [部品: city] 壁面いっぱいの看板・大型ビジョンと、ハチ公前広場の南の解体現場。
// 現地写真 109_04〜13（109 の向かいの白い棟・黒い棟・赤い大看板、文化村通りの北の棟）、scramble_03（白い仮囲いと足場）、
// scramble_20/21（交差点の北東の棟の西の面）の「場所を決めている面」を形にする。
// 入口: buildFaceDecos(cb, bd) / buildWestSite(cb) / buildPinkStair(cb)
// 契約: 置き場所と寸法は lib/gto/mapFacade.ts。絵柄・店名・映像は架空（renderCityAds / renderCityTextures）。
import { facePanels, pickEdge, PINK_STAIR, WEST_SITE } from '../../lib/gto/mapFacade'
import type { MapBuilding } from '../../lib/gto/types'
import { boardUv } from './renderCityBoards'
import { extrude, screen, type CityBuild } from './renderCityBuildings'
import { box, cap, wall } from './renderCityGeom'

const C = { back: 0x3c4046, mesh: 0x25282c, pipe: 0x9aa0a5, hoarding: 0xf3f3ee, hoardingBase: 0xb9bcbc }

/** 板 1 枚（表は絵、後ろに暗い枠） */
function boardFace(cb: CityBuild, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, art: number) {
  const [u0, u1, v0, v1] = boardUv(art)
  const off = 0.32
  wall(cb.boards, ax + nx * off, az + nz * off, bx + nx * off, bz + nz * off, y0, y1, nx, nz, 0xffffff, 1, u0, u1, v0, v1)
  const len = Math.hypot(bx - ax, bz - az)
  box(cb.roofs, (ax + bx) / 2 + nx * 0.14, (az + bz) / 2 + nz * 0.14, y0 - 0.2, y1 + 0.2, len / 2 + 0.2, 0.14, C.back, Math.atan2(bz - az, bx - ax), 0.8)
}

/** 建物の壁に、決めてある看板・大型ビジョン・色の帯を載せる。決めていない建物は何もしない */
export function buildFaceDecos(cb: CityBuild, bd: MapBuilding) {
  for (const p of facePanels(bd)) {
    const y0 = bd.y + p.y0
    const y1 = bd.y + p.y1
    if (p.kind === 'screen') screen(cb, p.ax + p.nx * p.out, p.az + p.nz * p.out, p.bx + p.nx * p.out, p.bz + p.nz * p.out, y0, y1, p.nx, p.nz, p.ref)
    else if (p.kind === 'board') boardFace(cb, p.ax, p.az, p.bx, p.bz, y0, y1, p.nx, p.nz, p.ref)
    else wall(cb.walls.blank, p.ax + p.nx * 0.25, p.az + p.nz * 0.25, p.bx + p.nx * 0.25, p.bz + p.nz * 0.25, y0, y1, p.nx, p.nz, p.ref, 1)
  }
}

/** 広場の南の解体現場。黒い養生の幕の足場（横の単管の線つき）、幕の広告面、足元の白い仮囲い */
export function buildWestSite(cb: CityBuild) {
  const site = cb.world.map.buildings.find((b) => b.id === WEST_SITE.building)
  if (!site) return
  const base = site.y
  const top = base + site.h
  extrude(cb, 'blank', site.pts, base - 1, top, C.mesh, base)
  cap(cb.roofs, site.pts, top, 0x4a4e52, true)
  const n = site.pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = site.pts[j * 2]
    const az = site.pts[j * 2 + 1]
    const bx = site.pts[i * 2]
    const bz = site.pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const yaw = Math.atan2(bz - az, bx - ax)
    // 足場の単管: 横の線を 3.6m ごと、縦の線を 5.4m ごと（細部を作る設定のときだけ）。屋上から 1 段ぶん突き出す
    if (!cb.detail) continue
    for (let y = 5.6; y < site.h; y += 3.6) box(cb.roofs, (ax + bx) / 2, (az + bz) / 2, base + y, base + y + 0.12, len / 2 + 0.15, 0.15, C.pipe, yaw, 1)
    for (let s = 0; s <= len; s += 5.4) box(cb.roofs, ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len, base, top + 1.3, 0.1, 0.1, C.pipe, yaw, 1)
  }
  const face = pickEdge(site.pts, WEST_SITE.ad.near)
  if (face) {
    const { t0, t1, y0, y1, art } = WEST_SITE.ad
    boardFace(cb, face.ax + (face.bx - face.ax) * t0, face.az + (face.bz - face.az) * t0, face.ax + (face.bx - face.ax) * t1, face.az + (face.bz - face.az) * t1, base + y0, base + y1, face.nx, face.nz, art)
  }
  // 仮囲い。足場の面の少し前に、白い板と足元の灰色の基礎
  for (const near of WEST_SITE.hoardingNear) {
    const e = pickEdge(site.pts, near)
    if (!e) continue
    const out = WEST_SITE.hoardingOut
    const mx = (e.ax + e.bx) / 2 + e.nx * out
    const mz = (e.az + e.bz) / 2 + e.nz * out
    const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax)
    const gy = cb.world.groundY(mx, mz)
    box(cb.walls.metal, mx, mz, gy - 0.5, gy + WEST_SITE.hoardingH, e.len / 2 + out, 0.08, C.hoarding, yaw, 1)
    box(cb.roofs, mx, mz, gy - 0.5, gy + 0.35, e.len / 2 + out + 0.05, 0.14, C.hoardingBase, yaw, 1)
  }
}

/** センター街の桃色の棟の外階段。4 本の柱、階ごとの踊り場、手すりの帯、踊り場をつなぐ段の板（1 階ごとに向きを替える） */
export function buildPinkStair(cb: CityBuild) {
  const bd = cb.world.map.buildings.find((b) => b.id === PINK_STAIR.building)
  const e = bd && pickEdge(bd.pts, PINK_STAIR.near)
  if (!bd || !e) return
  const { out, tier, color, rail, t0, t1 } = PINK_STAIR
  const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax)
  const ux = (e.bx - e.ax) / e.len
  const uz = (e.bz - e.az) / e.len
  const half = (e.len * (t1 - t0)) / 2
  const mid = (t0 + t1) / 2
  const fx = e.ax + (e.bx - e.ax) * mid
  const fz = e.az + (e.bz - e.az) * mid
  const cx = fx + e.nx * (out / 2)
  const cz = fz + e.nz * (out / 2)
  const top = bd.y + bd.h
  for (const [s, o] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
    box(cb.roofs, fx + ux * half * s * 0.96 + e.nx * out * o, fz + uz * half * s * 0.96 + e.nz * out * o, bd.y - 0.5, top, 0.09, 0.09, color, yaw, 1)
  }
  for (let y = bd.y + 3.6, k = 0; y < top; y += tier, k++) {
    box(cb.roofs, cx, cz, y - 0.14, y, half, out / 2, color, yaw, 0.9)
    // 外側の手すり
    box(cb.roofs, cx + e.nx * (out / 2), cz + e.nz * (out / 2), y, y + 1.05, half, 0.05, rail, yaw, 1)
    if (!cb.detail || y + tier >= top) continue
    // 次の踊り場へ上がる段の板（3 枚を斜めに並べる）
    const dir = k % 2 === 0 ? 1 : -1
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3
      box(cb.roofs, cx + ux * half * 0.7 * dir * (t * 2 - 1), cz + uz * half * 0.7 * dir * (t * 2 - 1), y + tier * t - 0.12, y + tier * t, half * 0.26, out * 0.3, rail, yaw, 0.85)
    }
  }
}
