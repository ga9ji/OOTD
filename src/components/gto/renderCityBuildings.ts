// Grand Theft Outfit [部品: city] 建物。ふつうの建物（店先の帯＋壁＋屋上の設備）と、目印の建物の振り分け。
// 入口: newCityBuild(world) / extentOf / buildGeneric / extrude / screen / edgeFacing
// 契約: 建物の実名は読まない。目印は map.ts の landmarkOf（OSM の id の表）で見分ける。
import { facadeOf, isSolidBuilding, splitFootprint } from '../../lib/gto/map'
import { hash, pointInPolygon } from '../../lib/gto/math'
import type { Flat, GtoWorld, MapBuilding } from '../../lib/gto/types'
import { box, Builder, cap, centroidOf, cylinder, prism, wall } from './renderCityGeom'
import { WALL_KINDS, WALL_SPECS, type WallKind } from './renderCityTextures'

/** 建物の色と寸法 */
export const BUILDING_STYLE = {
  roof: 0x6f7073,
  roofTall: 0x5d6770,
  deck: 0x8b8d8f,
  /** 下を道がくぐる建物の、桁下の高さ m */
  underpass: 5.5,
  /** 店先の帯の高さ m */
  shop: 4.2,
  /** 雑居ビル・オフィスの壁の色 */
  // 昼の光と色調が暖色へ寄せるので、白と灰は青みで持っておく（写真の雑居ビルは白・灰・濃灰が大半で、ベージュは少ない）
  walls: [0xdfe7f1, 0xc6cfda, 0xeaf0f7, 0xaab4c0, 0xdfe7f1, 0x7f8894, 0xd2d8de, 0x8c96a2, 0xbfc2c2, 0x4c535c, 0xedf2f8, 0x363b43, 0xb9c3cf, 0x7a5a4c, 0x2c3037, 0xeaf0f7],
  /** タイル張りの色（白・ベージュ・赤茶・焦げ茶） */
  tiles: [0xe6ebf0, 0xcfc8b8, 0xa4503a, 0x8b4232, 0xdfe5ec, 0x5e4a40, 0xd6dce4, 0x8f9aa6],
  /** ガラスの色 */
  glass: [0x6fa6de, 0x5f97d4, 0x86b4dc, 0x4f86c8, 0x7f9cb8],
  /** 店先の看板帯の色（白が多く、赤・黄・紺・緑が混じる） */
  shops: [0xf4f1ea, 0xf4f1ea, 0xe9e4d8, 0xd43c2f, 0xf2c230, 0x24408e, 0x2f7d4f, 0x2b2b2e, 0xf08a24, 0xe85d8f],
  equipment: 0x9a9c9e,
}

/** 街の形を溜める入れ物。壁は模様の種類ごとに分ける */
export interface CityBuild {
  world: GtoWorld
  walls: Record<WallKind, Builder>
  roofs: Builder
  /** 大型ビジョンの面（u,v は映像の絵の中の位置） */
  screens: Builder
  /** 屋上の広告塔の板（u,v は板の絵の中の位置） */
  boards: Builder
  /** 向こうが透けて見えるガラス（地下への出入口の囲いなど。半透明の材質で 1 回で描く） */
  glass: Builder
  /** 屋上の設備などの細かい物も作るか（軽量設定では省く） */
  detail: boolean
}

export function newCityBuild(world: GtoWorld, detail = true): CityBuild {
  const walls = {} as Record<WallKind, Builder>
  for (const k of WALL_KINDS) walls[k] = new Builder()
  return { world, walls, roofs: new Builder(), screens: new Builder(), boards: new Builder(), glass: new Builder(), detail }
}

/** 輪郭を y0..y1 に押し出して、種類 kind の壁にする */
export function extrude(cb: CityBuild, kind: WallKind, pts: Flat, y0: number, y1: number, color: number, baseY: number, seed = 0, fitV = false) {
  const spec = WALL_SPECS[kind]
  prism(cb.walls[kind], pts, y0, y1, {
    color,
    bay: spec.bay,
    floor: spec.floor,
    baseY,
    uOff: Math.floor(seed * 8),
    vOff: Math.floor(hash(seed, 5) * 8),
    fitV,
  })
}

/**
 * 大型ビジョンを1面。a→b が下辺、法線 (nx, nz) の側から見える。tile は映像の絵の番号（0..7。絵は横 4 × 縦 2 に並ぶ）。
 * 画面の後ろに黒い枠を付けて、壁から少し浮かせる。
 */
export function screen(cb: CityBuild, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, tile: number) {
  const off = 0.35
  const u0 = (tile % 4) * 0.25
  const v0 = tile < 4 ? 0.5 : 0
  wall(cb.screens, ax + nx * off, az + nz * off, bx + nx * off, bz + nz * off, y0, y1, nx, nz, 0xffffff, 1, u0, u0 + 0.25, v0, v0 + 0.5)
  const len = Math.hypot(bx - ax, bz - az) || 1
  const tx = ((bx - ax) / len) * 0.5
  const tz = ((bz - az) / len) * 0.5
  wall(cb.walls.blank, ax - tx + nx * 0.2, az - tz + nz * 0.2, bx + tx + nx * 0.2, bz + tz + nz * 0.2, y0 - 0.5, y1 + 0.5, nx, nz, 0x17181c, 1)
}

/** 輪郭の辺のうち、点 (tx, tz) のほうを向いている、いちばん長い辺。[ax, az, bx, bz, nx, nz] */
export function edgeFacing(pts: Flat, tx: number, tz: number, minLen = 6): [number, number, number, number, number, number] | null {
  const n = pts.length / 2
  const [cx, cz] = centroidOf(pts)
  let best: [number, number, number, number, number, number] | null = null
  let bestScore = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = pts[j * 2]
    const az = pts[j * 2 + 1]
    const bx = pts[i * 2]
    const bz = pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < minLen) continue
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    // 外向きにそろえる
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    const dl = Math.hypot(tx - mx, tz - mz) || 1
    const facing = (nx * (tx - mx) + nz * (tz - mz)) / dl
    const score = facing * Math.min(len, 30)
    if (facing > 0.3 && score > bestScore) {
      bestScore = score
      best = [ax, az, bx, bz, nx, nz]
    }
  }
  return best
}

/** 店先。下はガラスと入口、上の 1m は看板の帯（色面だけ。文字は renderSigns が載せる） */
export function shopFront(cb: CityBuild, pts: Flat, y0: number, y1: number, fascia: number, seed: number) {
  const band = Math.min(1.1, (y1 - y0) * 0.28)
  extrude(cb, 'shop', pts, y0, y1 - band, 0xe8e6e0, 0, seed, true)
  extrude(cb, 'blank', pts, y1 - band, y1, fascia, y1)
}

/** 屋上の設備（塔屋・室外機・水槽）。空の輪郭を不揃いにする */
function rooftop(cb: CityBuild, bd: MapBuilding, top: number, seed: number) {
  const [cx, cz] = centroidOf(bd.pts)
  const count = bd.h > 20 ? 2 : 1
  for (let k = 0; k < count; k++) {
    const a = hash(bd.id, k, 1) * Math.PI * 2
    const d = 1.5 + hash(bd.id, k, 2) * 4
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    const hx = 1.2 + hash(bd.id, k, 3) * 2.2
    const hz = 1.2 + hash(bd.id, k, 4) * 1.8
    // 箱の四隅が屋根の内側に収まる所だけ
    if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => pointInPolygon(bd.pts, x + sx * (hx + 0.6), z + sz * (hz + 0.6)))) continue
    const h = 1.6 + hash(bd.id, k, 6) * 3.2
    if (k === 1 && seed < 0.4) cylinder(cb.roofs, x, z, 1.3, 1.3, top, top + 2.2, 0xd9d6cc, { seg: 10, cap: 0xcfccc2 })
    else box(cb.roofs, x, z, top, top + h, hx, hz, k === 0 ? BUILDING_STYLE.equipment : 0xb9b6ae, hash(bd.id, 7) * 0.6)
  }
}

/** ふつうの建物。足元に店先の帯、その上に建物ごとの壁、屋上に設備 */
export function buildGeneric(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const { bottom, top, floating } = ext
  const style = BUILDING_STYLE
  const seed = hash(bd.id, bd.pts[0], bd.pts[1])
  const kind = facadeOf(bd)
  const palette = kind === 'curtain' ? style.glass : kind === 'tile' ? style.tiles : style.walls
  const color = bd.roof ? style.deck : palette[Math.floor(seed * palette.length)]
  const tall = bd.h >= 60
  const shopTop = bd.y + style.shop
  const hasShop = !floating && !bd.roof && isSolidBuilding(bd) && bd.h >= 6.5 && top > shopTop + 2
  if (hasShop) {
    const shopColor = style.shops[Math.floor(hash(bd.id, 21) * style.shops.length)]
    // 坂の下側で地面より下に出る分は、無地の基礎で埋める
    if (bottom < shopTop - style.shop) extrude(cb, 'blank', bd.pts, bottom, shopTop - style.shop, 0x6a6660, bottom, seed)
    shopFront(cb, bd.pts, shopTop - style.shop, shopTop, shopColor, seed)
    extrude(cb, kind, bd.pts, shopTop, top, color, shopTop, seed)
  } else {
    extrude(cb, bd.roof ? 'blank' : kind, bd.pts, bottom, top, color, bd.y, seed)
  }
  const roofColor = bd.roof ? style.deck : tall ? style.roofTall : style.roof
  cap(cb.roofs, bd.pts, top, roofColor, true, 0.9 + seed * 0.2)
  if (floating) cap(cb.roofs, bd.pts, bottom, roofColor, false, 0.6)
  if (cb.detail && !bd.roof && !tall && bd.h >= 10 && isSolidBuilding(bd)) rooftop(cb, bd, top, seed)
}

export interface Extent {
  /** 壁の下端と上端の高さ */
  bottom: number
  top: number
  /** 輪郭の中でいちばん低い地面 */
  minGround: number
  /** 地面から浮いているか（下面も見える） */
  floating: boolean
}

/** 建物の上下の範囲。坂では低い側の地面まで壁を下ろし、ガードは桁下を空ける。薄すぎて描かない物は null */
export function extentOf(world: GtoWorld, bd: MapBuilding, bi: number): Extent | null {
  const pts = bd.pts
  const n = pts.length / 2
  if (n < 3) return null
  let minGround = Infinity
  for (let i = 0; i < n; i++) minGround = Math.min(minGround, world.groundY(pts[i * 2], pts[i * 2 + 1]))
  let top = bd.y + bd.h
  let bottom = minGround - 1
  if (bd.minH) bottom = bd.y + bd.minH
  if (world.passUnder[bi]) {
    bottom = bd.y + BUILDING_STYLE.underpass
    top = Math.max(top, bottom + 1.5)
  }
  if (bd.roof || !isSolidBuilding(bd)) bottom = Math.max(bottom, top - (bd.roof ? 0.6 : bd.h - (bd.minH ?? 0)))
  if (top - bottom < 0.3) return null
  return { bottom, top, minGround, floating: bottom > minGround + 1.5 }
}

/**
 * 街区。間口の広い低層〜中層の輪郭は、間口 9〜14m の雑居ビルに割って、高さと壁をばらつかせる。
 * 当たり判定と看板は元の輪郭のままなので、割った棟は元の高さより低くしない。
 */
export function buildBlock(cb: CityBuild, bd: MapBuilding, ext: Extent, bi: number) {
  const splittable = !bd.roof && !ext.floating && isSolidBuilding(bd) && !cb.world.passUnder[bi] && bd.h >= 9 && bd.h < 50
  // 軽量設定では、駅前（交差点から 220m）だけ割る
  const near = cb.detail || Math.hypot(bd.pts[0], bd.pts[1]) < 220
  const parts = splittable && near ? splitFootprint(bd.pts, 9 + hash(bd.id, 41) * 5) : [bd.pts]
  if (parts.length < 2) {
    buildGeneric(cb, bd, ext)
    return
  }
  parts.forEach((pts, k) => {
    const piece: MapBuilding = { ...bd, id: bd.id * 7 + k + 1, pts, h: bd.h * (k === 0 ? 1 : 1 + hash(bd.id, k, 43) * 0.32) }
    const pieceExt = extentOf(cb.world, piece, bi)
    if (pieceExt) buildGeneric(cb, piece, pieceExt)
  })
}
