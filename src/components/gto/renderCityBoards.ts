// Grand Theft Outfit [部品: city] 現地写真から外装を決めた街区と、屋上の広告塔。
// 宮益坂下の正面を塞ぐ雑居ビルの壁と、その屋上に載る大きな板（脚の鉄骨つき）など。板の絵柄・社名はすべて架空。
// 入口: buildStyled(cb, bd, ext, style) / createBoardTexture(size)
// 契約: どの建物をどう作るか・板をどこへ向けるかは map.ts（BLOCK_STYLES / roofBoards）が決める。ここは形にするだけ。
import * as THREE from 'three'
import { roofBoards, type BlockStyle, type RoofBoard } from '../../lib/gto/map'
import type { WallAd } from '../../lib/gto/mapStreet'
import { FACE_ART_PAINTERS, WALL_AD_PAINTERS } from './renderCityAds'
import { hash, pointInPolygon } from '../../lib/gto/math'
import type { MapBuilding } from '../../lib/gto/types'
import { box, cap, centroidOf, scaleOutline, wall } from './renderCityGeom'
import { BUILDING_STYLE, edgeFacing, extrude, screen, shopFront, type CityBuild, type Extent } from './renderCityBuildings'

/** 板の絵の割り付け（横 4 × 縦 10）。上 2 段が屋上の広告塔、次の 3 段が壁の広告面、続く 2 段が壁面いっぱいの大看板、次の段が袖看板、その次の段が窓割りごとの壁面、最後の段が縦長の寄せ絵 */
const COLS = 4
const ROWS = 10

/** 板の絵 1 枚の、テクスチャの中の範囲 [u0, u1, v0, v1] */
export function boardUv(art: number): [number, number, number, number] {
  const col = art % COLS
  const row = Math.floor(art / COLS)
  return [col / COLS, (col + 1) / COLS, 1 - (row + 1) / ROWS, 1 - row / ROWS]
}
/** 屋上の広告塔の絵の数（この後ろに壁の広告面の絵が続く） */
const ROOF_ARTS = 8
const FRAME = 0x6f7478
const BACK = 0x3c4046

type Ctx = CanvasRenderingContext2D
const JP = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif'
const MINCHO = '"Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", serif'

function text(g: Ctx, str: string, x: number, y: number, size: number, color: string, font = JP, weight = 800, maxWidth?: number) {
  g.font = `${weight} ${size}px ${font}`
  g.fillStyle = color
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(str, x, y, maxWidth)
}

/** 板の絵。1 枚ぶんの左上 (x, y) と一辺 s をもらって描く。実在の社名・ロゴは使わない */
const BOARD_ARTS: ((g: Ctx, x: number, y: number, s: number) => void)[] = [
  // 0: 緑の格子地に白い太字、下に白い帯（部屋さがしの店）
  (g, x, y, s) => {
    g.fillStyle = '#17a56b'
    g.fillRect(x, y, s, s)
    g.strokeStyle = 'rgba(255,255,255,0.28)'
    g.lineWidth = s / 128
    for (let k = 1; k < 8; k++) {
      g.strokeRect(x + (s * k) / 8, y, 0, s * 0.72)
      if (k < 6) g.strokeRect(x, y + (s * 0.72 * k) / 6, s, 0)
    }
    text(g, 'ミドリエ', x + s / 2, y + s * 0.3, s * 0.2, '#fff', JP, 900, s * 0.86)
    text(g, 'お部屋さがし', x + s / 2, y + s * 0.56, s * 0.1, '#0c3d2a', JP, 800, s * 0.8)
    g.fillStyle = '#f6f6f2'
    g.fillRect(x, y + s * 0.72, s, s * 0.28)
    text(g, '渋谷店 このビル4階', x + s / 2, y + s * 0.86, s * 0.085, '#1c1d20', JP, 700, s * 0.9)
  },
  // 1: 白地に筆文字と小さな英字
  (g, x, y, s) => {
    g.fillStyle = '#f7f6f1'
    g.fillRect(x, y, s, s)
    text(g, 'はるひ', x + s / 2, y + s * 0.4, s * 0.3, '#16171a', MINCHO, 700, s * 0.8)
    text(g, 'HARUHI GROUP', x + s / 2, y + s * 0.75, s * 0.085, '#16171a', JP, 600, s * 0.8)
  },
  // 2: 白い長円に水色の縁（会社の広告塔）
  (g, x, y, s) => {
    g.fillStyle = '#7fd0d6'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#f8f8f4'
    g.beginPath()
    g.ellipse(x + s / 2, y + s / 2, s * 0.46, s * 0.4, 0, 0, Math.PI * 2)
    g.fill()
    text(g, 'KUMOI', x + s / 2, y + s * 0.44, s * 0.2, '#1c1d20', JP, 900, s * 0.7)
    text(g, 'クモイ株式会社', x + s / 2, y + s * 0.66, s * 0.085, '#1c1d20', JP, 700, s * 0.7)
    text(g, 'まちに、ひと息。', x + s / 2, y + s * 0.25, s * 0.06, '#3a7f86', JP, 600, s * 0.6)
  },
  // 3: 赤地に白い横長の字
  (g, x, y, s) => {
    g.fillStyle = '#d5282c'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#fff'
    g.fillRect(x, y + s * 0.74, s, s * 0.26)
    text(g, 'アカネ堂', x + s / 2, y + s * 0.38, s * 0.24, '#fff', JP, 900, s * 0.9)
    text(g, 'くすりと日用品', x + s / 2, y + s * 0.87, s * 0.09, '#d5282c', JP, 800, s * 0.9)
  },
  // 4: 上が青、下が緑の 2 段
  (g, x, y, s) => {
    g.fillStyle = '#1f58c7'
    g.fillRect(x, y, s, s / 2)
    g.fillStyle = '#2f9d58'
    g.fillRect(x, y + s / 2, s, s / 2)
    text(g, 'SORANE', x + s / 2, y + s * 0.26, s * 0.2, '#fff', JP, 900, s * 0.86)
    text(g, 'はっぱ銀行', x + s / 2, y + s * 0.75, s * 0.17, '#fff', JP, 800, s * 0.86)
  },
  // 5: 白い箱に丸い印
  (g, x, y, s) => {
    g.fillStyle = '#f5f5f1'
    g.fillRect(x, y, s, s)
    g.strokeStyle = '#e2572b'
    g.lineWidth = s * 0.07
    g.beginPath()
    g.arc(x + s / 2, y + s * 0.42, s * 0.26, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = '#e2572b'
    g.beginPath()
    g.arc(x + s / 2, y + s * 0.42, s * 0.1, 0, Math.PI * 2)
    g.fill()
    text(g, 'マルワ', x + s / 2, y + s * 0.85, s * 0.12, '#1c1d20', JP, 800, s * 0.8)
  },
  // 6: 黄地に黒い字
  (g, x, y, s) => {
    g.fillStyle = '#f6c928'
    g.fillRect(x, y, s, s)
    text(g, 'カラオケ', x + s / 2, y + s * 0.32, s * 0.2, '#16171a', JP, 900, s * 0.9)
    text(g, 'うたまる', x + s / 2, y + s * 0.66, s * 0.22, '#c8201f', JP, 900, s * 0.9)
  },
  // 7: 黒地に桃色の帯
  (g, x, y, s) => {
    g.fillStyle = '#15161a'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#ee5c97'
    g.fillRect(x, y, s, s * 0.2)
    text(g, 'NEMURI', x + s / 2, y + s * 0.5, s * 0.2, '#fff', JP, 900, s * 0.86)
    text(g, 'ねむり寝具店', x + s / 2, y + s * 0.78, s * 0.1, '#ee5c97', JP, 700, s * 0.86)
  },
]

/** 屋上の板の絵を 1 枚にまとめたテクスチャ。size は 1 枚ぶんの一辺（px） */
export function createBoardTexture(size: number): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size * COLS
  canvas.height = size * ROWS
  const g = canvas.getContext('2d')
  if (g) {
    ;[...BOARD_ARTS, ...WALL_AD_PAINTERS, ...FACE_ART_PAINTERS].forEach((paint, i) => {
      const x = (i % COLS) * size
      const y = Math.floor(i / COLS) * size
      g.save()
      g.beginPath()
      g.rect(x, y, size, size)
      g.clip()
      paint(g, x, y, size)
      // 板の縁
      g.strokeStyle = 'rgba(20,22,26,0.55)'
      g.lineWidth = size / 48
      g.strokeRect(x, y, size, size)
      g.restore()
    })
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 屋上の広告塔 1 基。板（表は絵、裏は暗い面）と、屋上から立ち上がる鉄骨の脚・控え */
export function roofBoard(cb: CityBuild, board: RoofBoard, roofY: number) {
  const { x, z, heading, w, h, lift, art } = board
  const nx = Math.sin(heading)
  const nz = -Math.cos(heading)
  // 板に沿う向き（見る人から見て左が＋）
  const tx = Math.cos(heading)
  const tz = Math.sin(heading)
  const y0 = roofY + lift
  const y1 = y0 + h
  const col = art % COLS
  const row = Math.floor((art % ROOF_ARTS) / COLS)
  wall(cb.boards, x + tx * (w / 2), z + tz * (w / 2), x - tx * (w / 2), z - tz * (w / 2), y0, y1, nx, nz, 0xffffff, 1, col / COLS, (col + 1) / COLS, 1 - (row + 1) / ROWS, 1 - row / ROWS)
  // 裏と小口
  const bx = x - nx * 0.3
  const bz = z - nz * 0.3
  box(cb.roofs, x - nx * 0.16, z - nz * 0.16, y0 - 0.15, y1 + 0.15, w / 2 + 0.12, 0.14, BACK, heading, 0.8)
  // 脚（板の後ろの柱）と、後ろへ倒した控え、横つなぎ
  const posts = Math.max(2, Math.round(w / 3.2))
  for (let k = 0; k <= posts; k++) {
    const s = -w / 2 + 0.4 + ((w - 0.8) * k) / posts
    const px = bx + tx * s
    const pz = bz + tz * s
    box(cb.roofs, px, pz, roofY, y1 - 0.2, 0.09, 0.09, FRAME, heading)
    if (!cb.detail) continue
    // 控え: 後ろ 2.4m の屋上から、板の高さの 6 割へ向けて段々に上げる
    const reach = Math.min(2.6, h * 0.4)
    for (let j = 0; j < 4; j++) {
      const f = (j + 0.5) / 4
      box(cb.roofs, px - nx * reach * (1 - f), pz - nz * reach * (1 - f), roofY + (y0 + h * 0.6 - roofY) * f - 0.5, roofY + (y0 + h * 0.6 - roofY) * f + 0.5, 0.07, reach / 8 + 0.05, FRAME, heading, 0.75)
    }
  }
  box(cb.roofs, bx, bz, y0 - 0.5, y0 - 0.3, w / 2, 0.08, FRAME, heading)
  if (cb.detail) {
    box(cb.roofs, bx, bz, y0 + h * 0.5, y0 + h * 0.5 + 0.16, w / 2, 0.07, FRAME, heading)
    // 板を照らす灯具（上の縁から前へ出た腕）
    const lamps = Math.max(2, Math.round(w / 2.6))
    for (let k = 0; k < lamps; k++) {
      const s = -w / 2 + (w * (k + 0.5)) / lamps
      box(cb.roofs, x + tx * s + nx * 0.5, z + tz * s + nz * 0.5, y1 + 0.1, y1 + 0.22, 0.05, 0.55, 0x2c2f33, heading)
      box(cb.roofs, x + tx * s + nx * 1.0, z + tz * s + nz * 1.0, y1 - 0.05, y1 + 0.22, 0.16, 0.1, 0x2c2f33, heading)
    }
  }
}

/** 壁の広告面 1 枚。壁から少し浮かせた板と、後ろの暗い枠。baseY は建物の足元の高さ */
export function wallBoard(cb: CityBuild, ad: WallAd, baseY: number) {
  const art = ROOF_ARTS + ad.art
  const col = art % COLS
  const row = Math.floor(art / COLS)
  // 壁に沿う向き（外から見て左が＋）
  const tx = -ad.nz
  const tz = ad.nx
  const y0 = baseY + ad.y0
  const y1 = y0 + ad.h
  const x = ad.x + ad.nx * 0.3
  const z = ad.z + ad.nz * 0.3
  const hw = ad.w / 2
  wall(cb.boards, x + tx * hw, z + tz * hw, x - tx * hw, z - tz * hw, y0, y1, ad.nx, ad.nz, 0xffffff, 1, col / COLS, (col + 1) / COLS, 1 - (row + 1) / ROWS, 1 - row / ROWS)
  box(cb.roofs, ad.x + ad.nx * 0.12, ad.z + ad.nz * 0.12, y0 - 0.2, y1 + 0.2, hw + 0.2, 0.14, BACK, Math.atan2(tz, tx), 0.8)
}

/** 低い基壇（輪郭の全体）の奥に、小窓のタイル張りの高い棟（輪郭の一部）を立てる。頂部は無地の帯 */
function buildPodiumTower(cb: CityBuild, bd: MapBuilding, shopTop: number, top: number, style: BlockStyle, tower: NonNullable<BlockStyle['tower']>) {
  const podiumTop = bd.y + tower.podium
  extrude(cb, style.facade, bd.pts, shopTop, podiumTop, style.color, shopTop, hash(bd.id, 9))
  extrude(cb, 'blank', bd.pts, podiumTop, podiumTop + 0.9, style.color, podiumTop)
  cap(cb.roofs, bd.pts, podiumTop + 0.6, BUILDING_STYLE.roof, true)
  extrude(cb, 'tile', tower.pts, podiumTop, top - 2.4, tower.color, podiumTop, hash(bd.id, 5))
  extrude(cb, 'blank', tower.pts, top - 2.4, top, tower.color, top)
  cap(cb.roofs, tower.pts, top, BUILDING_STYLE.roof, true)
}

/** 外装を決めてある街区。足元に店先、その上に決めた壁、屋上に塔屋と設備、決めてあれば広告塔 */
export function buildStyled(cb: CityBuild, bd: MapBuilding, ext: Extent, style: BlockStyle) {
  const top = ext.top + (style.raise ?? 0) * 3.4
  const shopTop = bd.y + BUILDING_STYLE.shop
  if (ext.bottom < bd.y) extrude(cb, 'blank', bd.pts, ext.bottom, bd.y, 0x6a6660, ext.bottom)
  shopFront(cb, bd.pts, bd.y, shopTop, style.shop ?? 0xf4f1ea, hash(bd.id, 3))
  if (style.tower) return buildPodiumTower(cb, bd, shopTop, top, style, style.tower)
  const kind = style.lit ? 'lit' : style.facade
  // 上の階が輪郭の一部だけの棟は、段の高さまでを輪郭の全体で建て、その上を狭い輪郭で積む
  const step = style.upper ? Math.min(bd.y + style.upper.from, top) : top
  const crown = style.upper ? style.upper.pts : bd.pts
  extrude(cb, kind, bd.pts, shopTop, step, style.color, shopTop, hash(bd.id, 9))
  if (style.upper) {
    extrude(cb, 'blank', bd.pts, step, step + 0.9, style.color, step)
    cap(cb.roofs, bd.pts, step + 0.6, BUILDING_STYLE.roof, true)
    extrude(cb, kind, crown, step, top, style.color, shopTop, hash(bd.id, 9))
  }
  // 屋上の立ち上がり（壁と同じ色の無地の帯）
  extrude(cb, 'blank', crown, top, top + 0.9, style.color, top)
  cap(cb.roofs, crown, top + 0.6, BUILDING_STYLE.roof, true)
  if (cb.detail) {
    // 塔屋を奥に寄せて載せる
    const [cx, cz] = centroidOf(crown)
    const boards = style.boards ?? []
    const away = boards.length > 0 ? [cx - boards[0].toward[0], cz - boards[0].toward[1]] : [0, 0]
    const al = Math.hypot(away[0], away[1]) || 1
    const pent = scaleOutline(crown, 0.36, (away[0] / al) * 2.5, (away[1] / al) * 2.5)
    extrude(cb, 'blank', pent, top, top + 3.6, style.color, top)
    cap(cb.roofs, pent, top + 3.6, BUILDING_STYLE.roof, true)
  }
  // 広告塔は、足元の屋上（段の下か上か）から立てる
  for (const board of roofBoards(bd)) roofBoard(cb, board, (pointInPolygon(crown, board.x, board.z) ? top : step) + 0.6)
  if (style.vision) {
    // 相手を向いた面の上半分に、大型ビジョンを 1 面
    const edge = edgeFacing(bd.pts, style.vision.toward[0], style.vision.toward[1], 5)
    if (edge) {
      const [ax, az, bx, bz, nx, nz] = edge
      const h = top - bd.y
      screen(cb, ax + (bx - ax) * 0.3, az + (bz - az) * 0.3, ax + (bx - ax) * 0.92, az + (bz - az) * 0.92, bd.y + h * 0.5, bd.y + h * 0.88, nx, nz, style.vision.tile)
    }
  }
}
