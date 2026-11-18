// Grand Theft Outfit [部品: city] 東口の眺め（宮益坂下から南）。いちばん高い塔、明治通りをまたぐ駅の橋、
// 工事中の躯体、バス乗り場の上屋。現地写真 miyamasuzaka_06/08、towers_15/17 の重なり方（手前から 広場 → 橋 → 塔）を作る。
// 入口: scrambleSquare(cb, bd, ext) / buildEastSite(cb)（駅の橋は renderCityBridge.ts）
// 契約: 寸法と置き場所は lib/gto/mapEast.ts。ここは形にするだけ。名前・ロゴ・広告は描かない。
import { EAST_TOWER, finOffset, finWidth, SITE_FRAMES, siteColumns, towerNorthFace, type FinSpec, type TowerFace } from '../../lib/gto/mapEast'
import type { Flat, MapBuilding } from '../../lib/gto/types'
import { extrude, screen, type CityBuild, type Extent } from './renderCityBuildings'
import { insetOutline } from './renderCityExtras'
import { box, cap, centroidOf, scaleOutline, type Builder } from './renderCityGeom'

const TOWER = { glass: 0x5283c2, crown: 0xf4f6f8, roof: 0x8c98a4, fin: 0xa3b4c4, podium: 0xb7c6d2, foot: 0x24282d }

type Face = TowerFace
const FIN = { glass: 0x62798c, glassLow: 0x8aa0b1, mullion: 0xdfe6ec, edge: 0x39434d }

/**
 * 塔の裾 1 枚。足元で外へ張り出し、上へ行くほど壁に寄って細くなるガラスの曲面。
 * west = true なら西の角（t=1）へ、false なら東の角（t=0）へ寄る。
 * 横の目地（銀色の細い帯）を band m ごとに入れ、内側の縁と角の側は壁まで塞いで厚みを見せる。
 */
function fin(b: Builder, f: Face, baseY: number, spec: FinSpec, west: boolean) {
  const len = Math.hypot(f.bx - f.ax, f.bz - f.az) || 1
  const ux = (f.bx - f.ax) / len
  const uz = (f.bz - f.az) / len
  const rows = Math.ceil(spec.height / EAST_TOWER.band)
  const cols = 5
  const p = (t: number, off: number, y: number): [number, number, number] => [f.ax + (f.bx - f.ax) * t + f.nx * off, baseY + y, f.az + (f.bz - f.az) * t + f.nz * off]
  /** 高さ y での [角の側の t, 内側の縁の t, 張り出し] */
  const at = (y: number): [number, number, number] => {
    const k = y / spec.height
    const w = finWidth(spec, k)
    return [west ? 1 : 0, west ? 1 - w : w, finOffset(spec, k)]
  }
  const both = (q: number[]) => {
    b.quad(q[0], q[1], q[2], q[3])
    b.quad(q[0], q[3], q[2], q[1])
  }
  /** 高さ y0..y1 の帯を 1 段ぶん張る */
  const strip = (y0: number, y1: number, color: number, shade: number) => {
    const [c0, e0, o0] = at(y0)
    const [c1, e1, o1] = at(y1)
    // 面は下ほど外へ出ているので、法線は少し上を向く（空を映して明るく見える）
    const tilt = Math.min(0.9, (o0 - o1) / (y1 - y0))
    const lo: number[] = []
    const hi: number[] = []
    for (let i = 0; i <= cols; i++) {
      const s = i / cols
      const t0 = c0 + (e0 - c0) * s
      const t1 = c1 + (e1 - c1) * s
      const a = p(t0, o0, y0)
      const c = p(t1, o1, y1)
      lo.push(b.vert(a[0], a[1], a[2], f.nx, tilt, f.nz, (t0 * len) / 1.5 / 8, y0 / 3 / 8, color, shade))
      hi.push(b.vert(c[0], c[1], c[2], f.nx, tilt, f.nz, (t1 * len) / 1.5 / 8, y1 / 3 / 8, color, shade))
    }
    for (let i = 0; i < cols; i++) both([lo[i], lo[i + 1], hi[i + 1], hi[i]])
    // 厚み: 内側の縁と角の側を、壁まで戻る面で塞ぐ
    const side = west ? -1 : 1
    for (const [t0, t1, dir] of [
      [e0, e1, side],
      [c0, c1, -side],
    ] as const) {
      const q = [p(t0, o0, y0), p(t0, 0, y0), p(t1, 0, y1), p(t1, o1, y1)]
      both(q.map((v, i) => b.vert(v[0], v[1], v[2], ux * dir, 0, uz * dir, i === 1 || i === 2 ? 0 : 0.1, v[1] / 3 / 8, FIN.edge, 1)))
    }
  }
  const line = 0.55
  for (let r = 0; r < rows; r++) {
    const y0 = (spec.height * r) / rows
    const y1 = (spec.height * (r + 1)) / rows
    // 足元の数段は中が透けて明るく、上は空を映した暗いガラス（miyamasuzaka_08）
    // いちばん下は橋の桁下から覗く暗い層
    const low = y0 < EAST_TOWER.footH
    const glass = low ? TOWER.foot : r % 5 === 4 || y0 < 9 ? FIN.glassLow : FIN.glass
    strip(y0, y1 - line, glass, 0.92 + 0.04 * ((r * 7) % 3))
    strip(y1 - line, y1, low ? TOWER.foot : FIN.mullion, 1)
  }
  // 頂部の切り口
  const [c, e, o] = at(spec.height)
  if (Math.abs(e - c) > 0.001) {
    const q = [p(c, 0, spec.height), p(e, 0, spec.height), p(e, o, spec.height), p(c, o, spec.height)]
    both(q.map((v) => b.vert(v[0], v[1], v[2], 0, 1, 0, 0, 0, FIN.mullion, 1)))
  }
}

/** 塔 1 本ぶん（ガラスの壁・頂部の白い縁・一段低い塔屋） */
function shaft(cb: CityBuild, pts: Flat, bottom: number, top: number, color: number, baseY: number, seed: number) {
  extrude(cb, 'curtain', pts, bottom, top - 4, color, baseY, seed)
  extrude(cb, 'blank', scaleOutline(pts, 1.015), top - 5, top, TOWER.crown, baseY)
  // 頂部の縁の明かり（center-gai_08: 夜は頂部の輪郭が白い線で光り、暗い空の中でも超高層の頭だと分かる）
  extrude(cb, 'lit', scaleOutline(pts, 1.025), top - 3.4, top + 0.6, 0xffffff, baseY)
  extrude(cb, 'lit', scaleOutline(pts, 1.02), top - 19, top - 17.6, 0xffffff, baseY)
  cap(cb.roofs, pts, top, TOWER.roof, true)
  const hut = scaleOutline(pts, 0.78)
  extrude(cb, 'blank', hut, top, top + 5, 0xdfe5ea, top)
  cap(cb.roofs, hut, top + 5, TOWER.roof, true)
}

/**
 * いちばん高い塔。青いガラスに細かい格子、頂部に白い縁。北の面の足元に横長の大型ビジョン、
 * その西に下から上へ細くなる大きな裾、東に小さな三角の裾（どちらもビジョンの下隅に被さる）。
 */
export function scrambleSquare(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  // 足元は橋の桁下から覗く暗い層（バス乗り場の奥。miyamasuzaka_08 では橋の下が影で黒く沈む）
  const foot = bd.y + EAST_TOWER.footH
  extrude(cb, 'blank', bd.pts, ext.bottom, foot, TOWER.foot, bd.y)
  shaft(cb, bd.pts, foot, ext.top, TOWER.glass, bd.y, 0.1)
  // ガラスの壁を一周する白い横の帯（遠くの通りから見ても、無地の箱ではなく階の重なったガラスの塔に見える）
  // 壁から 0.6m ほど浮かせる（0.1m だと 400m 先のセンター街からは奥行きの精度で壁に埋もれ、無地の箱に戻っていた）
  for (const y of EAST_TOWER.bands) extrude(cb, 'lit', scaleOutline(bd.pts, 1.02), bd.y + y, bd.y + y + 2.2, TOWER.crown, bd.y)
  const f = towerNorthFace(bd.pts)
  if (!f) return
  fin(cb.walls.metal, f, bd.y, EAST_TOWER.finWest, true)
  fin(cb.walls.metal, f, bd.y, EAST_TOWER.finEast, false)
  // 大型ビジョン。裾の切れ込みの奥、壁のすぐ表に張る（両下隅は裾の曲面に隠れる）
  const s = EAST_TOWER.screen
  const at = (t: number): [number, number] => [f.ax + (f.bx - f.ax) * t + f.nx * s.off, f.az + (f.bz - f.az) * t + f.nz * s.off]
  const [sx0, sz0] = at(s.t0)
  const [sx1, sz1] = at(s.t1)
  screen(cb, sx0, sz0, sx1, sz1, bd.y + s.y0, bd.y + s.y1, f.nx, f.nz, EAST_TOWER.screen.tile)
}

const SITE = { slab: 0xf0f0ec, column: 0xd9dbdb, core: 0x4b5057, sheet: 0xe3e7ea, mesh: 0x9aa2a8, pipe: 0xb8bcc0 }

/** 工事中の躯体。柱と白い床の骨組み、奥に暗い芯、上の段は養生の幕、外周に足場の縦パイプ */
function siteFrame(cb: CityBuild, frame: (typeof SITE_FRAMES)[number]) {
  const [cx, cz] = centroidOf(frame.pts)
  const ground = cb.world.groundY(cx, cz)
  const top = ground + frame.floors[frame.floors.length - 1]
  for (const h of frame.floors) {
    const y = ground + h
    extrude(cb, 'blank', frame.pts, y - 0.7, y, SITE.slab, y)
    cap(cb.roofs, frame.pts, y, 0xc9cbc8, true)
    cap(cb.roofs, frame.pts, y - 0.7, 0xb4b6b4, false, 0.62)
  }
  for (const [x, z] of siteColumns(cb.world, frame)) box(cb.walls.blank, x, z, cb.world.groundY(x, z) - 0.3, top - 0.7, 0.4, 0.4, SITE.column)
  // 床が 2 段以上あれば、間に暗い芯（向こうが素通しにならないように）
  const first = ground + frame.floors[0]
  const sheet = ground + frame.sheetFrom
  if (frame.floors.length > 1) extrude(cb, 'blank', insetOutline(frame.pts, 3.2), first, sheet - 0.7, SITE.core, first)
  // 上の縁の養生の幕（低ければ柵）。背の高い幕だけ上を塞ぐ
  extrude(cb, 'blank', insetOutline(frame.pts, 0.5), sheet, sheet + frame.sheetH, SITE.sheet, sheet)
  if (frame.sheetH > 2) cap(cb.roofs, insetOutline(frame.pts, 0.5), sheet + frame.sheetH, SITE.mesh, true)
  if (!cb.detail) return
  // 足場の縦パイプ（3m おき）と、段ごとの横パイプ
  const n = frame.pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = frame.pts[j * 2]
    const az = frame.pts[j * 2 + 1]
    const bx = frame.pts[i * 2]
    const bz = frame.pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.round(len / 3))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      box(cb.walls.metal, ax + (bx - ax) * t, az + (bz - az) * t, first, sheet + frame.sheetH, 0.07, 0.07, SITE.pipe)
    }
    const yaw = Math.atan2(bz - az, bx - ax)
    for (let y = first + 2.2; y < sheet - 1; y += 2.2) box(cb.walls.metal, (ax + bx) / 2, (az + bz) / 2, y, y + 0.1, len / 2, 0.05, SITE.pipe, yaw)
  }
}

/** 東口の手前の層（工事中の躯体）。遠くからの目印なので軽量設定でも立てる。上屋と乗り場の島は置かない（バスターミナルに見える） */
export function buildEastSite(cb: CityBuild) {
  for (const frame of SITE_FRAMES) siteFrame(cb, frame)
}
