// Grand Theft Outfit [部品: signs] 看板の絵を1枚のアトラスに描く。
// 入口: createSignAtlas(size) / createNightAtlas(size) / createVisionTexture(size) / SOLID_CELL
// 契約: signage.ts の SIGN_CELLS（店ごと・形ごとの絵）を canvas に並べ、絵の名前から UV を引けるようにする。
//       描くのは架空の店名と、丸・帯・枠などの抽象的な図形だけ（実在のロゴや意匠は描かない）。
import * as THREE from 'three'
import { ADS, NIGHT_CELLS, SIGN_CELLS, type CellShape, type SignCell } from '../../lib/gto/signage'
import { drawNeonCell } from './renderSignsNeonCells'

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif'

/** アトラスが 4096px のときの、形ごとの絵の大きさ（px） */
const CELL_SIZE: Record<CellShape, [w: number, h: number]> = {
  wide: [448, 96],
  tall: [96, 448],
  mid: [96, 224],
  board: [448, 224],
  poster: [224, 448],
}
const BASE = 4096

/** 屋上の広告塔の脚や裏面に使う、無地の暗い絵 */
export const SOLID_CELL = 'solid'

export interface UvRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface SignAtlas {
  texture: THREE.CanvasTexture
  uv: (key: string) => UvRect
  dispose: () => void
}

type G = CanvasRenderingContext2D
const isLatin = (s: string) => /^[\x20-\x7e]+$/.test(s)

/** '#rrggbb' がおおよそ暗い色か（暗い地の看板は、文字をネオンのようににじませる） */
function isDark(css: string): boolean {
  const n = Number.parseInt(css.slice(1), 16)
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.6 + (n & 255) * 0.1 < 70
}

/** 文字を描く。暗い地では同じ色の光をにじませる */
function text(g: G, s: string, x: number, y: number, size: number, weight: number, color: string, glow: boolean, maxWidth?: number) {
  g.font = `${weight} ${size}px ${FONT}`
  g.fillStyle = color
  if (glow) {
    g.shadowColor = color
    g.shadowBlur = size * 0.35
    g.fillText(s, x, y, maxWidth)
  }
  g.shadowBlur = 0
  g.fillText(s, x, y, maxWidth)
}

/** 縦長の枠の中に、1文字ずつ縦に並べる（英字だけの名前は横倒しにして書く） */
function verticalText(g: G, s: string, x: number, y: number, w: number, h: number, color: string, glow: boolean) {
  if (isLatin(s)) {
    g.save()
    g.translate(x + w / 2, y + h / 2)
    g.rotate(Math.PI / 2)
    text(g, s, 0, 0, Math.min(w * 0.6, (h * 1.5) / s.length), 900, color, glow, h * 0.92)
    g.restore()
    return
  }
  const chars = [...s.replace(/\s+/g, '')].slice(0, 9)
  const size = Math.min(w * 0.74, (h * 0.94) / chars.length)
  const top = y + (h - size * chars.length) / 2
  chars.forEach((ch, i) => text(g, ch, x + w / 2, top + size * (i + 0.5), size, 900, color, glow))
}

function drawWide(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  const { name, sub, bg, fg } = c.shop
  const glow = isDark(bg)
  const hasSub = sub !== ''
  const style = hasSub ? c.style : 1
  if (style === 0) {
    // 左に種類の札、右に店名
    g.fillStyle = fg
    g.fillRect(x + w * 0.03, y + h * 0.16, w * 0.24, h * 0.68)
    text(g, sub, x + w * 0.15, y + h * 0.52, h * 0.27, 800, bg, false, w * 0.21)
    text(g, name, x + w * 0.64, y + h * 0.53, h * 0.6, 900, fg, glow, w * 0.66)
  } else if (style === 1) {
    text(g, name, x + w / 2, y + (hasSub ? h * 0.42 : h * 0.53), h * (hasSub ? 0.52 : 0.62), 900, fg, glow, w * 0.9)
    if (hasSub) text(g, sub, x + w / 2, y + h * 0.82, h * 0.2, 700, fg, false, w * 0.8)
  } else if (style === 2) {
    // 細い枠で囲む
    g.strokeStyle = fg
    g.lineWidth = Math.max(2, h * 0.05)
    g.strokeRect(x + h * 0.12, y + h * 0.12, w - h * 0.24, h * 0.76)
    text(g, name, x + w * 0.42, y + h * 0.53, h * 0.5, 900, fg, glow, w * 0.6)
    text(g, sub, x + w * 0.84, y + h * 0.53, h * 0.22, 700, fg, false, w * 0.2)
  } else {
    // 下に帯
    g.fillStyle = fg
    g.fillRect(x, y + h * 0.72, w, h * 0.28)
    text(g, name, x + w / 2, y + h * 0.39, h * 0.56, 900, fg, glow, w * 0.9)
    text(g, sub, x + w / 2, y + h * 0.87, h * 0.2, 800, bg, false, w * 0.9)
  }
}

function drawTall(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  const { name, sub, bg, fg } = c.shop
  const glow = isDark(bg)
  const short = c.shape === 'mid'
  // 短い袖看板は、店名が長ければ店の種類を書く
  const plain = name.replace(/\s+/g, '')
  const label = short && plain.length > 5 && sub !== '' && !isLatin(sub) && sub.length <= 5 ? sub : name
  const cap = sub !== '' && !short && c.style !== 2 ? w * 0.9 : 0
  if (cap > 0) {
    // 上か下に、種類を書いた札
    const cy = c.style === 0 ? y + w * 0.08 : y + h - cap - w * 0.08
    g.fillStyle = fg
    g.fillRect(x + w * 0.08, cy, w * 0.84, cap)
    text(g, sub, x + w / 2, cy + cap / 2, Math.min(cap * 0.5, (w * 1.5) / Math.max(1, sub.length)), 800, bg, false, w * 0.76)
  }
  if (c.style === 2) {
    g.strokeStyle = fg
    g.lineWidth = Math.max(2, w * 0.05)
    g.strokeRect(x + w * 0.08, y + w * 0.08, w * 0.84, h - w * 0.16)
  }
  const pad = w * 0.16
  const top = y + pad + (c.style === 0 ? cap : 0)
  verticalText(g, label, x, top, w, h - pad * 2 - cap, fg, glow)
}

function drawBoard(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  const { name, sub, bg, fg } = c.shop
  const glow = isDark(bg)
  g.fillStyle = fg
  g.globalAlpha = 0.9
  if (c.style === 0) {
    // 左に大きな丸
    g.beginPath()
    g.arc(x + w * 0.16, y + h * 0.5, h * 0.3, 0, Math.PI * 2)
    g.fill()
  } else if (c.style === 1) {
    // 斜めの帯
    g.beginPath()
    g.moveTo(x + w * 0.78, y)
    g.lineTo(x + w, y)
    g.lineTo(x + w * 0.9, y + h)
    g.lineTo(x + w * 0.68, y + h)
    g.fill()
  } else if (c.style === 2) {
    g.fillRect(x, y + h * 0.78, w, h * 0.22)
  } else g.fillRect(x + w * 0.08, y + h * 0.86, w * 0.84, h * 0.03)
  g.globalAlpha = 1
  const cx = c.style === 0 ? x + w * 0.62 : c.style === 1 ? x + w * 0.4 : x + w / 2
  const span = c.style === 0 || c.style === 1 ? w * 0.62 : w * 0.9
  text(g, name, cx, y + h * 0.4, h * 0.36, 900, fg, glow, span)
  text(g, sub, cx, y + (c.style === 2 ? h * 0.89 : h * 0.7), h * 0.12, 700, c.style === 2 ? bg : fg, false, span)
}

function drawPoster(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  const { name, sub, bg, fg } = c.shop
  const glow = isDark(bg)
  g.fillStyle = fg
  g.globalAlpha = 0.9
  if (c.style % 2 === 0) {
    g.beginPath()
    g.arc(x + w * 0.5, y + h * 0.16, w * 0.24, 0, Math.PI * 2)
    g.fill()
  } else g.fillRect(x, y, w, h * 0.06)
  g.globalAlpha = 1
  verticalText(g, name, x, y + h * 0.3, w, h * 0.5, fg, glow)
  g.fillStyle = fg
  g.fillRect(x, y + h * 0.86, w, h * 0.14)
  text(g, sub, x + w / 2, y + h * 0.93, h * 0.045, 800, bg, false, w * 0.9)
}

function drawCell(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = c.shop.bg
  g.fillRect(x, y, w, h)
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  if (c.shape === 'wide') drawWide(g, c, x, y, w, h)
  else if (c.shape === 'board') drawBoard(g, c, x, y, w, h)
  else if (c.shape === 'poster') drawPoster(g, c, x, y, w, h)
  else drawTall(g, c, x, y, w, h)
  // 縁を少し暗くして、箱の厚みに見せる
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 2
  g.strokeRect(x + 1, y + 1, w - 2, h - 2)
  g.restore()
}

/** 夜の絵（管の文字）は、店の看板だけ細い線が潰れないよう少し大きく描く */
const NIGHT_WIDE_SCALE = 1.25

/** 昼の看板の絵（印刷の看板） */
export const createSignAtlas = (size: number): SignAtlas => packAtlas(size, SIGN_CELLS, drawCell, () => 1)

/** 夜の看板の絵（暗い板に、屋号を管の線で書いたもの） */
export const createNightAtlas = (size: number): SignAtlas => packAtlas(size, NIGHT_CELLS, drawNeonCell, (c) => (c.shape === 'wide' ? NIGHT_WIDE_SCALE : 1))

type CellDrawer = (g: G, c: SignCell, x: number, y: number, w: number, h: number) => void

/** 看板の絵を棚に詰めて1枚のテクスチャにする。size は一辺の px（4096 が等倍） */
function packAtlas(size: number, cells: readonly SignCell[], draw: CellDrawer, zoom: (c: SignCell) => number): SignAtlas {
  const scale = size / BASE
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  const rects = new Map<string, UvRect>()
  let cx = 0
  let cy = 0
  let rowH = 0
  const place = (key: string, cw: number, ch: number, draw: (x: number, y: number) => void) => {
    if (cx + cw > size) {
      cx = 0
      cy += rowH
      rowH = 0
    }
    if (cy + ch > size) return
    draw(cx, cy)
    // 隣の絵がにじまないよう、1px 内側を使う
    rects.set(key, { u0: (cx + 1) / size, u1: (cx + cw - 1) / size, v0: 1 - (cy + ch - 1) / size, v1: 1 - (cy + 1) / size })
    cx += cw
    rowH = Math.max(rowH, ch)
  }
  for (const c of cells) {
    const cw = Math.round(CELL_SIZE[c.shape][0] * scale * zoom(c))
    const ch = Math.round(CELL_SIZE[c.shape][1] * scale * zoom(c))
    place(c.key, cw, ch, (x, y) => {
      if (g) draw(g, c, x, y, cw, ch)
    })
  }
  place(SOLID_CELL, 16, 16, (x, y) => {
    if (!g) return
    g.fillStyle = '#2a2d33'
    g.fillRect(x, y, 16, 16)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const fallback: UvRect = { u0: 0, v0: 0, u1: 0.01, v1: 0.01 }
  return { texture, uv: (key) => rects.get(key) ?? rects.get(SOLID_CELL) ?? fallback, dispose: () => texture.dispose() }
}

/** ビジョンに流す絵の列数と行数（1枚のテクスチャに並べ、オフセットをずらして切り替える） */
export const VISION_GRID = 2

const VISION_COLORS: [string, string][] = [
  ['#ff3d7f', '#ffb02e'],
  ['#1b6bff', '#3dffc0'],
  ['#7a2bff', '#ff5fa2'],
  ['#0c9a5c', '#ffe95c'],
]

/** 大型ビジョンに流す絵（架空の広告を4コマ）。黒い額縁つき */
export function createVisionTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  const g = canvas.getContext('2d')
  const cw = size / VISION_GRID
  const ch = size / 2 / VISION_GRID
  if (g) {
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    for (let i = 0; i < VISION_GRID * VISION_GRID; i++) {
      const x = (i % VISION_GRID) * cw
      const y = Math.floor(i / VISION_GRID) * ch
      const ad = ADS[(i * 3 + 1) % ADS.length]
      const [c0, c1] = VISION_COLORS[i % VISION_COLORS.length]
      const grad = g.createLinearGradient(x, y, x + cw, y + ch)
      grad.addColorStop(0, c0)
      grad.addColorStop(1, c1)
      g.fillStyle = grad
      g.fillRect(x, y, cw, ch)
      // 抽象的な図形（丸と帯）
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.beginPath()
      g.arc(x + cw * (i % 2 ? 0.8 : 0.2), y + ch * 0.5, ch * 0.42, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(x, y + ch * 0.74, cw, ch * 0.16)
      text(g, ad.name, x + cw / 2, y + ch * 0.42, ch * 0.34, 900, '#ffffff', false, cw * 0.84)
      text(g, ad.sub, x + cw / 2, y + ch * 0.82, ch * 0.1, 700, '#ffffff', false, cw * 0.84)
      // 額縁
      g.strokeStyle = '#08090c'
      g.lineWidth = ch * 0.06
      g.strokeRect(x + ch * 0.03, y + ch * 0.03, cw - ch * 0.06, ch - ch * 0.06)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}
