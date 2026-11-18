// Grand Theft Outfit [部品: city] 目印の建物。現地写真の輪郭と外装を、形と色だけで起こす。
// 入口: buildLandmark(cb, kind, bd, ext) → 専用の形を作ったら true（false ならふつうの建物として作る）
// 契約: 建物の名前・ロゴ・広告は描かない。大型ビジョンには架空の映像（renderCityTextures）だけを流す。
import { blockStyleOf, type LandmarkKind } from '../../lib/gto/map'
import { hash } from '../../lib/gto/math'
import type { Flat, MapBuilding } from '../../lib/gto/types'
import { box, cap, centroidOf, scaleOutline, wall } from './renderCityGeom'
import { BUILDING_STYLE, buildBlock, buildGeneric, edgeFacing, extrude, screen, shopFront, type CityBuild, type Extent } from './renderCityBuildings'
import { roofBoards } from '../../lib/gto/map'
import { buildStyled, roofBoard } from './renderCityBoards'
import { ginzaStation } from './renderCityBridge'
import { scrambleSquare } from './renderCityEast'
import { buildForkTower } from './renderCity109'
import { buildRoofScreens, hotelSlab } from './renderCityVista'
import { CONCOURSE, ROOF_SCREENS, SUBWAY_KIOSK } from '../../lib/gto/mapVista'
import { pickEdge } from '../../lib/gto/mapFacade'
import type { WallKind } from './renderCityTextures'

/** 輪郭を y0..y1 に押し出し、上（と必要なら下）に蓋をする */
function block(cb: CityBuild, kind: WallKind, pts: Flat, y0: number, y1: number, color: number, baseY: number, roof: number, seed = 0, under = false) {
  extrude(cb, kind, pts, y0, y1, color, baseY, seed)
  cap(cb.roofs, pts, y1, roof, true)
  if (under) cap(cb.roofs, pts, y0, roof, false, 0.6)
}

/** 足元の店先の帯（坂の下側は基礎で埋める）。戻り値は帯の上端 */
function shopBase(cb: CityBuild, bd: MapBuilding, ext: Extent, color: number, height = BUILDING_STYLE.shop) {
  const topY = bd.y + height
  if (ext.bottom < topY - height) extrude(cb, 'blank', bd.pts, ext.bottom, topY - height, 0x6a6660, ext.bottom)
  shopFront(cb, bd.pts, topY - height, topY, color, hash(bd.id, 3))
  return topY
}

/** 交差点の角のガラス張りの建物。全面カーテンウォール、低層に白い帯、交差点側に横長の大型ビジョン */
function qfront(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const base = shopBase(cb, bd, ext, 0xf2f2ee, 5)
  // 2〜3 階は白い文字サインが並ぶ帯（文字は描かず、明るい帯だけ）
  extrude(cb, 'band', bd.pts, base, base + 6, 0xe9edf0, base)
  block(cb, 'curtain', bd.pts, base + 6, ext.top, 0x5f8fbe, base + 6, 0x58626c, 0.2)
  const face = edgeFacing(bd.pts, 4, 6, 8)
  if (face) {
    const [ax, az, bx, bz, nx, nz] = face
    screen(cb, ax + (bx - ax) * 0.06, az + (bz - az) * 0.06, bx - (bx - ax) * 0.06, bz - (bz - az) * 0.06, bd.y + 13.5, bd.y + 25, nx, nz, 0)
  }
  // 東面（神宮通り側）にも縦長の面
  const east = edgeFacing(bd.pts, 40, -40, 8)
  if (east && east !== face) {
    const [ax, az, bx, bz, nx, nz] = east
    screen(cb, ax + (bx - ax) * 0.55, az + (bz - az) * 0.55, bx - (bx - ax) * 0.08, bz - (bz - az) * 0.08, bd.y + 13.5, bd.y + 25, nx, nz, 2)
  }
}

/** 大きさの違う箱をずらして積んだ塔。段の境目にくびれ */
function hikarie(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const h = ext.top - bd.y
  const layers: [from: number, to: number, scale: number, dx: number, dz: number, kind: WallKind, color: number][] = [
    [0, 0.3, 1, 0, 0, 'curtain', 0x7fa8cc],
    [0.33, 0.56, 0.93, 5, -2, 'ribbon', 0xdfe5e8],
    [0.59, 0.78, 0.86, -4, 3, 'curtain', 0x6a98c4],
    [0.81, 1, 0.78, 3, -1, 'curtain', 0x5b8cbc],
  ]
  let prevTop = ext.bottom
  layers.forEach(([from, to, scale, dx, dz, kind, color], i) => {
    const y0 = i === 0 ? ext.bottom : bd.y + h * from
    const y1 = bd.y + h * to
    // 段の間のくびれ（暗い色で一回り小さく）
    if (i > 0) extrude(cb, 'blank', scaleOutline(bd.pts, scale * 0.82, dx * 0.5, dz * 0.5), prevTop, y0, 0x3d444c, bd.y)
    const outline = scaleOutline(bd.pts, scale, dx, dz)
    block(cb, kind, outline, y0, y1, color, bd.y, 0x6a747e, i * 0.3, i > 0)
    prevTop = y1
  })
}

/** ハチ公側の低い駅舎。ガラス張りの箱に白い庇 */
function jrStation(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  if (ext.floating) return false
  const mid = bd.y + 4.4
  extrude(cb, 'band', bd.pts, ext.bottom, mid, 0xd9dee0, mid - 3.6)
  extrude(cb, 'blank', bd.pts, mid, mid + 0.9, 0xf2f2ee, mid)
  block(cb, 'band', bd.pts, mid + 0.9, ext.top, 0xe6ebee, mid + 0.9, 0x9a9da0, 0.5)
  // 屋上の縁の白い庇と、交差点へ向いた広告の板
  extrude(cb, 'blank', scaleOutline(bd.pts, 1.01), ext.top - 0.2, ext.top + 0.9, 0xf4f6f8, ext.top)
  for (const board of roofBoards(bd)) roofBoard(cb, board, ext.top + 0.9)
  return true
}

/** 交差点の角の地下鉄出入口。白い腰壁と白い屋根の間は透明なガラス（向こうの交差点が透ける）。四隅に細い柱 */
function kiosk(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const K = SUBWAY_KIOSK
  const top = bd.y + K.top
  extrude(cb, 'metal', bd.pts, ext.bottom, bd.y + K.base, 0xf2f5f6, bd.y)
  extrude(cb, 'metal', scaleOutline(bd.pts, 1.04), top - K.roof, top, 0xf6f6f4, top)
  cap(cb.roofs, scaleOutline(bd.pts, 1.04), top, 0xe9eaea, true)
  cap(cb.roofs, scaleOutline(bd.pts, 1.04), top - K.roof, 0xd9dcdc, false, 0.8)
  const n = bd.pts.length / 2
  const [cx, cz] = centroidOf(bd.pts)
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = bd.pts[j * 2]
    const az = bd.pts[j * 2 + 1]
    const bx = bd.pts[i * 2]
    const bz = bd.pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az) || 1
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    // ガラスは表と裏の両方から見える
    wall(cb.glass, ax, az, bx, bz, bd.y + K.base, top - K.roof, nx, nz, 0xd6ecf8, 1)
    wall(cb.glass, bx, bz, ax, az, bd.y + K.base, top - K.roof, -nx, -nz, 0xd6ecf8, 1)
    box(cb.walls.metal, ax, az, bd.y + K.base, top - K.roof, K.post, K.post, 0xe4e8ea, 0, 1)
    // 長い辺は 2.4m ごとに方立て
    const bays = Math.round(len / 2.4)
    for (let k = 1; k < bays; k++) box(cb.walls.metal, ax + ((bx - ax) * k) / bays, az + ((bz - az) * k) / bays, bd.y + K.base, top - K.roof, K.post * 0.6, K.post * 0.6, 0xe4e8ea, 0, 1)
  }
}

/** 道をまたぐガラス張りの連絡通路。白い腰の帯・ガラスの 2 層・張り出した白い屋根。屋上に交差点へ向いた板 */
function concourse(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const C = CONCOURSE
  const sill = ext.bottom + C.sill
  const glassTop = bd.y + C.glassTop
  const roof = bd.y + C.roof
  extrude(cb, 'metal', bd.pts, ext.bottom, sill, 0xf4f6f7, ext.bottom)
  extrude(cb, 'band', bd.pts, sill, glassTop, 0xeef3f6, sill, 0.3)
  const eave = scaleOutline(bd.pts, 1 + C.eave / 25)
  extrude(cb, 'metal', eave, glassTop, roof, 0xf6f7f8, glassTop)
  cap(cb.roofs, eave, roof, 0xdfe2e4, true)
  cap(cb.roofs, eave, glassTop, 0xe6e8ea, false, 0.85)
  if (ext.floating) cap(cb.roofs, bd.pts, ext.bottom, 0xcfd3d6, false, 0.6)
  for (const board of roofBoards(bd)) roofBoard(cb, board, roof)
  return true
}

/** 線路沿いの細長い低層棟。屋上に銀色のパイプのアーチが連続する */
function miyashita(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  buildGeneric(cb, bd, ext)
  const pts = bd.pts
  const n = pts.length / 2
  if (n > 8) {
    // 長辺に沿って、屋上をまたぐアーチを 12m おきに立てる
    let best = 0
    let bi = 0
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const len = Math.hypot(pts[i * 2] - pts[j * 2], pts[i * 2 + 1] - pts[j * 2 + 1])
      if (len > best) {
        best = len
        bi = i
      }
    }
    const j = (bi + n - 1) % n
    const ax = pts[j * 2]
    const az = pts[j * 2 + 1]
    const dx = (pts[bi * 2] - ax) / best
    const dz = (pts[bi * 2 + 1] - az) / best
    const [cx, cz] = centroidOf(pts)
    // 長辺から重心の側へ向く法線
    let nx = -dz
    let nz = dx
    if (nx * (cx - ax) + nz * (cz - az) < 0) {
      nx = -nx
      nz = -nz
    }
    const span = 22
    for (let s = 6; s < best - 4; s += 12) {
      const steps = 8
      for (let k = 0; k < steps; k++) {
        const a0 = (k / steps) * Math.PI
        const a1 = ((k + 1) / steps) * Math.PI
        const mid = (a0 + a1) / 2
        const off = span / 2 - Math.cos(mid) * (span / 2)
        const y = ext.top + Math.sin(mid) * 6
        const x = ax + dx * s + nx * (off + 1)
        const z = az + dz * s + nz * (off + 1)
        box(cb.walls.metal, x, z, y - 0.18, y + 0.18, (span / steps) * 0.62, 0.18, 0xc9cdd1, Math.atan2(nz, nx))
      }
    }
  }
}

/** 交差点を向いた面に大型ビジョンを載せた雑居ビル */
function vision(cb: CityBuild, bd: MapBuilding, ext: Extent, bi: number) {
  // 屋上に大型ビジョンを並べる棟は、屋上を平らにそろえて（棟を割らずに）建てる
  if (ROOF_SCREENS[bd.id]) {
    buildGeneric(cb, bd, ext)
    buildRoofScreens(cb, bd, ext.top)
  } else buildBlock(cb, bd, ext, bi)
  // 屋上の広告塔。割った棟は元の高さの 1.32 倍まで伸びるので、脚で持ち上げてある（lift）
  for (const board of roofBoards(bd)) roofBoard(cb, board, bd.y + bd.h)
  const face = edgeFacing(bd.pts, 0, 0, 8)
  if (!face) return
  const [ax, az, bx, bz, nx, nz] = face
  const len = Math.hypot(bx - ax, bz - az)
  const w = Math.min(len * 0.8, 16)
  const t0 = (1 - w / len) / 2
  const t1 = 1 - t0
  const h = ext.top - bd.y
  const tile = Math.floor(hash(bd.id, 31) * 4)
  screen(cb, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, bd.y + h * 0.45, bd.y + h * 0.9, nx, nz, tile)
  // 画面の上の色帯
  wall(cb.walls.blank, ax + (bx - ax) * t0 + nx * 0.4, az + (bz - az) * t0 + nz * 0.4, ax + (bx - ax) * t1 + nx * 0.4, az + (bz - az) * t1 + nz * 0.4, bd.y + h * 0.92, bd.y + h * 0.99, nx, nz, tile % 2 ? 0xd8366f : 0xc92a2a)
}

/** 白い面を折り重ねた低層の商業棟と、その奥に下がって立つガラスの高層棟。足元はガラス張り */
function parco(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  // 昼の光が暖色へ寄せるので、白は青みで持つ
  const white = 0xf2f6fb
  // 足元 2 層ぶんはガラス
  const base = shopBase(cb, bd, ext, 0xf4f1ea, 4.2)
  extrude(cb, 'band', bd.pts, base, base + 3.6, 0xe4ebee, base)
  const podiumTop = Math.min(ext.top - 12, bd.y + 46)
  // 白い箱を 3 段、少しずつずらして重ねる（段の間に暗い切れ込み＝外を回る通路）
  const tiers: [from: number, to: number, scale: number, dx: number, dz: number][] = [
    [0, 0.28, 1.0, 0, 0],
    [0.39, 0.62, 0.93, 5, -3.6],
    [0.73, 1, 0.84, -4.6, 5],
  ]
  const y0 = base + 3.6
  const span = podiumTop - y0
  let prev = y0
  tiers.forEach(([from, to, scale, dx, dz], i) => {
    const lo = y0 + span * from
    const hi = y0 + span * to
    if (i > 0) extrude(cb, 'band', scaleOutline(bd.pts, scale * 0.86, dx * 0.5, dz * 0.5), prev, lo, 0x2c343c, bd.y)
    // 窓の無い大きな白いパネルの面（koen-dori_16: 目地だけが入った白い面が、暗い切れ込みを挟んで折り重なる）
    // 空の色を映す金属パネルの壁で描く（日陰の面がベージュの土壁に沈まず、白いパネルに見える）
    block(cb, 'metal', scaleOutline(bd.pts, scale, dx, dz), lo, hi, i === 1 ? 0xffffff : white, bd.y, 0xb9bbbd, i * 0.3, i > 0)
    prev = hi
  })
  // 奥の高層棟
  block(cb, 'curtain', scaleOutline(bd.pts, 0.5, -6, 8), podiumTop, ext.top, 0x93adc2, podiumTop, 0x6c757e, 0.6)
}

/** 色と壁の種類だけを決めた塔（外装の違いで見分ける） */
const SIMPLE: Partial<Record<LandmarkKind, { kind: WallKind; color: number; roof: number; crown?: number; shop?: number }>> = {
  stream: { kind: 'stream', color: 0xf4f8fc, roof: 0xb8bcc0 },
  markcity: { kind: 'tile', color: 0xdccdb0, roof: 0x8f8a80, crown: 0xcbbd9f },
  cerulean: { kind: 'tile', color: 0xc4cbd0, roof: 0x7d858c, crown: 0xaab4bc },
  fukuras: { kind: 'curtain', color: 0x5f86b0, roof: 0x4a5560 },
  sakura: { kind: 'curtain', color: 0x86a9cf, roof: 0x6c757e, crown: 0xe6e9ec },
  magnet: { kind: 'panel', color: 0xe3e4e2, roof: 0x8c8f92, shop: 0x2b2b2e },
}

export function buildLandmark(cb: CityBuild, kind: LandmarkKind, bd: MapBuilding, ext: Extent, bi: number): boolean {
  switch (kind) {
    case 'qfront':
      qfront(cb, bd, ext)
      return true
    case 'cylinder109':
      buildForkTower(cb, bd, ext)
      return true
    case 'scramble-square':
      scrambleSquare(cb, bd, ext)
      return true
    case 'hikarie':
      hikarie(cb, bd, ext)
      return true
    case 'ginza-station':
      return ginzaStation(cb, bd, ext)
    case 'jr-station':
      return jrStation(cb, bd, ext)
    case 'kiosk':
      kiosk(cb, bd, ext)
      return true
    case 'concourse':
      return concourse(cb, bd, ext)
    case 'miyashita':
      miyashita(cb, bd, ext)
      return true
    case 'parco':
      parco(cb, bd, ext)
      return true
    case 'vision':
      vision(cb, bd, ext, bi)
      return true
    case 'styled': {
      const style = blockStyleOf(bd)
      if (!style || ext.floating) return false
      buildStyled(cb, bd, ext, style)
      // 屋上の縁に載る大型ビジョン（決めてある棟だけ）
      buildRoofScreens(cb, bd, ext.top + (style.raise ?? 0) * 3.4 + 0.6)
      return true
    }
    default: {
      const s = SIMPLE[kind]
      if (!s) return false
      // 板状のホテル棟（マークシティの東の高層部）は、妻面をガラスにして頂部にアンテナを立てる
      if (kind === 'markcity' && hotelSlab(cb, bd, ext)) return true
      let y0 = ext.bottom
      if (s.shop != null && !ext.floating) y0 = shopBase(cb, bd, ext, s.shop)
      const crownH = s.crown != null ? 3.5 : 0
      extrude(cb, s.kind, bd.pts, y0, ext.top - crownH, s.color, ext.floating ? ext.bottom : bd.y, hash(bd.id, 9))
      if (s.crown != null) extrude(cb, 'blank', bd.pts, ext.top - crownH, ext.top, s.crown, ext.top)
      cap(cb.roofs, bd.pts, ext.top, s.roof, true)
      if (ext.floating) cap(cb.roofs, bd.pts, ext.bottom, s.roof, false, 0.6)
      if (kind === 'sakura' && !ext.floating) {
        // 低層部は曲面ガラスに桃色の大きな模様（towers_08/10）。ひと回り外へ張り出したガラスの帯と、桃色の帯で表す
        const podium = scaleOutline(bd.pts, 1.03)
        extrude(cb, 'curtain', podium, y0, bd.y + 24, 0xcfe2ee, bd.y, 0.4)
        cap(cb.roofs, podium, bd.y + 24, 0x9aa4ac, true)
        extrude(cb, 'blank', scaleOutline(bd.pts, 1.036), bd.y + 10.5, bd.y + 14.5, 0xf2a3c6, bd.y)
        extrude(cb, 'blank', scaleOutline(bd.pts, 1.036), bd.y + 17, bd.y + 18.2, 0xf7c5da, bd.y)
      }
      if (kind === 'magnet') {
        // 交差点へ向いた南西の隅切りに大型ビジョン（西の面の看板とビジョンは mapFacade の表で載せる）
        const face = pickEdge(bd.pts, [22.6, -17])
        if (face) screen(cb, face.ax, face.az, face.bx, face.bz, bd.y + 9, bd.y + 21, face.nx, face.nz, 3)
      }
      return true
    }
  }
}
