// Grand Theft Outfit [部品: city] 街の模様。壁（窓の並び）・店先・鉄桁・路面・横断歩道・大型ビジョンの絵を
// その場で canvas に描いてテクスチャにする。画像ファイルは使わない。絵柄はすべて架空。
// 入口: createCityTextures(size) / WALL_SPECS
import * as THREE from 'three'
import type { FacadeKind } from '../../lib/gto/map'
import { hash } from '../../lib/gto/math'

/** 壁の模様の種類（建物の壁 6 種＋店先・鉄桁・金属パネル・ガラスの帯） */
export type WallKind = FacadeKind | 'shop' | 'girder' | 'metal' | 'band' | 'tube' | 'panel' | 'lit'

export const WALL_KINDS: WallKind[] = ['office', 'ribbon', 'curtain', 'tile', 'stream', 'blank', 'shop', 'girder', 'metal', 'band', 'tube', 'panel', 'lit']

/** 模様1スパンの幅と1階ぶんの高さ（m）。テクスチャ1枚は 8×8 スパン */
export const WALL_SPECS: Record<WallKind, { bay: number; floor: number }> = {
  office: { bay: 2.6, floor: 3.4 },
  ribbon: { bay: 3.2, floor: 3.5 },
  curtain: { bay: 1.8, floor: 4.0 },
  tile: { bay: 2.4, floor: 3.1 },
  stream: { bay: 2.2, floor: 3.6 },
  blank: { bay: 3.0, floor: 3.6 },
  shop: { bay: 4.2, floor: 3.2 },
  girder: { bay: 1.6, floor: 2.4 },
  metal: { bay: 1.5, floor: 3.0 },
  band: { bay: 2.0, floor: 3.6 },
  tube: { bay: 2.4, floor: 4.6 },
  panel: { bay: 3.0, floor: 3.8 },
  lit: { bay: 1.5, floor: 3.0 },
}

type Ctx = CanvasRenderingContext2D
type CellPainter = (g: Ctx, lit: boolean, x: number, y: number, w: number, h: number, r: number, c: number) => void

const LIT = ['#fff3d6', '#ffe2a8', '#cfe4ff', '#f6f1e4']

/** 明かりの付いた窓（夜用の絵）。確率 p で灯る */
function litWindow(g: Ctx, x: number, y: number, w: number, h: number, seed: number, p: number) {
  if (seed >= p) return
  g.globalAlpha = 0.5 + (seed / p) * 0.5
  g.fillStyle = LIT[Math.floor(seed * 97) % LIT.length]
  g.fillRect(x, y, w, h)
  g.globalAlpha = 1
}

/** ガラス1枚（昼用の絵）。空の映り込みを上ほど明るく */
function glass(g: Ctx, x: number, y: number, w: number, h: number, seed: number, dark = 0) {
  const tone = Math.round(96 + seed * 34 - dark * 40)
  g.fillStyle = `rgb(${tone - 8},${tone + 8},${tone + 26})`
  g.fillRect(x, y, w, h)
  g.fillStyle = 'rgba(255,255,255,0.20)'
  g.fillRect(x, y, w, h * 0.24)
  g.fillStyle = 'rgba(0,0,0,0.12)'
  g.fillRect(x, y + h * 0.82, w, h * 0.18)
}

const PAINTERS: Record<WallKind, CellPainter> = {
  // 穴あき窓のオフィス
  office: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 31 + 7, c * 17 + 3)
    const wx = x + w * 0.14
    const wy = y + h * 0.2
    if (lit) litWindow(g, wx, wy, w * 0.72, h * 0.52, s, 0.42)
    else {
      glass(g, wx, wy, w * 0.72, h * 0.52, s, 0.3)
      g.fillStyle = 'rgba(0,0,0,0.10)'
      g.fillRect(x, y + h * 0.94, w, h * 0.06)
    }
  },
  // 横連窓の雑居ビル。階ごとに帯の窓、ところどころ目隠しのパネル
  ribbon: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 13 + 5, c * 29 + 1)
    const wy = y + h * 0.26
    const wh = h * 0.5
    if (lit) litWindow(g, x + w * 0.03, wy, w * 0.94, wh, s, 0.5)
    else {
      if (s > 0.86) {
        g.fillStyle = '#d8d4c8'
        g.fillRect(x, wy, w, wh)
      } else glass(g, x, wy, w, wh, s, 0.2)
      g.fillStyle = 'rgba(40,44,50,0.9)'
      g.fillRect(x + w * 0.97, wy, w * 0.03, wh)
      g.fillStyle = 'rgba(0,0,0,0.14)'
      g.fillRect(x, y + h * 0.78, w, h * 0.04)
    }
  },
  // ガラスのカーテンウォール。細い方立てと無目だけ
  curtain: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 7 + 3, c * 11 + 9)
    // オフィスは階ごとにまとめて灯る（towers_04/07、miyamasuzaka_06: 明るい階が横の帯になる）
    if (lit) litWindow(g, x + w * 0.02, y + h * 0.1, w * 0.96, h * 0.72, s, hash(r, 77) < 0.42 ? 0.86 : 0.1)
    else {
      // 空の映り込み。パネルごとに明るさが少し違い、上ほど明るい
      // 所々に、ブラインドを下ろした暗いパネルと、雲を映した明るいパネルが混じる
      const tone = Math.round(s < 0.12 ? 120 + s * 200 : s > 0.9 ? 236 : 168 + s * 62)
      const grad = g.createLinearGradient(0, y, 0, y + h)
      grad.addColorStop(0, `rgb(${tone + 10},${tone + 10},${tone + 10})`)
      grad.addColorStop(1, `rgb(${tone - 44},${tone - 36},${tone - 26})`)
      g.fillStyle = grad
      g.fillRect(x, y, w, h)
      // 床の位置の無目と、縦の方立て
      g.fillStyle = 'rgba(30,44,60,0.42)'
      g.fillRect(x, y + h * 0.9, w, h * 0.1)
      g.fillStyle = 'rgba(244,247,250,0.8)'
      g.fillRect(x + w * 0.955, y, w * 0.045, h)
    }
  },
  // タイル張りに小窓（ホテル・住宅）
  tile: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 19 + 2, c * 23 + 5)
    const wx = x + w * 0.28
    const wy = y + h * 0.24
    if (lit) litWindow(g, wx, wy, w * 0.44, h * 0.46, s, 0.36)
    else {
      glass(g, wx, wy, w * 0.44, h * 0.46, s, 0.45)
      g.fillStyle = 'rgba(0,0,0,0.06)'
      g.fillRect(x, y, w, h * 0.03)
      g.fillRect(x, y, w * 0.03, h)
    }
  },
  // 白いパネルと窓が不規則に入れ替わる外壁
  stream: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 5 + 1, c * 3 + 7)
    // 白いパネルが勝つ割合（towers_14: 暗い窓は面の 1/3 ほど）
    const wide = s < 0.22 ? 1 : s < 0.5 ? 0.5 : 0
    if (wide === 0) return
    const wx = x + (hash(r, c) < 0.5 ? 0 : w * (1 - wide))
    if (lit) litWindow(g, wx, y + h * 0.06, w * wide, h * 0.88, hash(c, r), 0.3)
    else {
      g.fillStyle = s < 0.12 ? '#2b3138' : '#4a5560'
      g.fillRect(wx, y + h * 0.04, w * wide, h * 0.92)
    }
  },
  // 窓の無い面。パネルの目地だけ
  blank: (g, lit, x, y, w, h) => {
    if (lit) return
    g.fillStyle = 'rgba(0,0,0,0.08)'
    g.fillRect(x, y, w, h * 0.025)
    g.fillRect(x, y, w * 0.02, h)
  },
  // 店先のガラス面（縦は1枚で帯の高さ）。看板の帯は別の面で上に載せる
  shop: (g, lit, x, y, w, h, r, c) => {
    if (r > 0) return
    const H = h * 8
    const s = hash(c * 41 + 3, 9)
    const glassTop = y + H * 0.06
    const glassH = H * 0.84
    if (lit) {
      g.fillStyle = s < 0.3 ? '#fff6dc' : s < 0.6 ? '#ffe9b8' : '#eaf3ff'
      g.globalAlpha = 0.75 + s * 0.25
      g.fillRect(x + w * 0.05, glassTop, w * 0.9, glassH)
      g.globalAlpha = 1
    } else {
      // ガラスの奥に店内の明るさ
      const grad = g.createLinearGradient(0, glassTop, 0, glassTop + glassH)
      grad.addColorStop(0, '#4e5862')
      grad.addColorStop(0.45, '#9a9c96')
      grad.addColorStop(1, '#474e56')
      g.fillStyle = grad
      g.fillRect(x + w * 0.05, glassTop, w * 0.9, glassH)
      g.fillStyle = 'rgba(255,255,255,0.18)'
      g.fillRect(x + w * 0.05, glassTop, w * 0.9, glassH * 0.1)
      // 棚や人影のような明暗
      for (let k = 0; k < 4; k++) {
        g.fillStyle = hash(c, k, 2) < 0.5 ? 'rgba(255,240,210,0.22)' : 'rgba(20,24,30,0.25)'
        g.fillRect(x + w * (0.1 + hash(c, k) * 0.7), glassTop + glassH * (0.35 + hash(c, k, 1) * 0.3), w * 0.12, glassH * 0.3)
      }
      // 入口の枠
      if (s < 0.55) {
        g.fillStyle = 'rgba(25,28,32,0.85)'
        g.fillRect(x + w * 0.38, glassTop + glassH * 0.2, w * 0.025, glassH * 0.8)
        g.fillRect(x + w * 0.6, glassTop + glassH * 0.2, w * 0.025, glassH * 0.8)
        g.fillRect(x + w * 0.38, glassTop + glassH * 0.2, w * 0.245, glassH * 0.035)
      }
      // 足元の腰壁と、柱
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(x, y + H * 0.9, w, H * 0.1)
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.fillRect(x + w * 0.96, y, w * 0.04, H)
    }
  },
  // リベット打ちの鉄桁（縦は1枚で桁の高さ）。縦の補剛材と上下のフランジ
  girder: (g, lit, x, y, w, h, r) => {
    if (lit || r > 0) return
    const H = h * 8
    g.fillStyle = 'rgba(0,0,0,0.30)'
    g.fillRect(x + w * 0.46, y, w * 0.08, H)
    g.fillStyle = 'rgba(255,255,255,0.10)'
    g.fillRect(x + w * 0.54, y, w * 0.03, H)
    g.fillStyle = 'rgba(0,0,0,0.38)'
    g.fillRect(x, y, w, H * 0.07)
    g.fillRect(x, y + H * 0.9, w, H * 0.1)
    // リベットの列
    g.fillStyle = 'rgba(0,0,0,0.42)'
    for (let k = 0; k < 9; k++) {
      g.fillRect(x + w * 0.36, y + H * (0.12 + k * 0.09), w * 0.05, H * 0.022)
      g.fillRect(x + w * 0.62, y + H * (0.12 + k * 0.09), w * 0.05, H * 0.022)
    }
    // 錆と汚れの筋
    g.fillStyle = 'rgba(70,40,20,0.16)'
    g.fillRect(x + w * hash(x, 3) * 0.8, y + H * 0.1, w * 0.07, H * (0.3 + hash(x, 5) * 0.5))
  },
  // 金属パネル（円筒の外装）。縦の目地が細かく、横の目地が粗い
  metal: (g, lit, x, y, w, h, r, c) => {
    if (lit) return
    const s = hash(r * 3 + 1, c * 5 + 2)
    g.fillStyle = `rgba(255,255,255,${0.05 + s * 0.12})`
    g.fillRect(x, y, w, h)
    g.fillStyle = 'rgba(0,0,0,0.20)'
    g.fillRect(x, y, w * 0.035, h)
    g.fillRect(x, y, w, h * 0.03)
  },
  // 夜に外装ごと照らされて光る壁（円筒の銀色のパネル、通りの桃色の棟）。昼は金属パネルと同じ目地。
  // 夜の絵は一面の明かりで、材質の側で壁の色を掛ける（白い壁は白く、桃色の壁は桃色に光る）
  lit: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 3 + 1, c * 5 + 2)
    if (lit) {
      g.fillStyle = `rgb(${Math.round(190 + s * 50)},${Math.round(190 + s * 50)},${Math.round(190 + s * 50)})`
      g.fillRect(x, y, w, h)
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(x, y, w * 0.035, h)
      g.fillRect(x, y, w, h * 0.03)
      return
    }
    g.fillStyle = `rgba(255,255,255,${0.05 + s * 0.12})`
    g.fillRect(x, y, w, h)
    g.fillStyle = 'rgba(0,0,0,0.20)'
    g.fillRect(x, y, w * 0.035, h)
    g.fillRect(x, y, w, h * 0.03)
  },
  // ガラスの帯（高架の駅の側面）。上下に梁、間は全部ガラス
  band: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 9 + 4, c * 7 + 1)
    if (lit) {
      g.globalAlpha = 0.85
      g.fillStyle = '#f4f1e6'
      g.fillRect(x, y + h * 0.16, w, h * 0.66)
      g.globalAlpha = 1
    } else {
      glass(g, x, y + h * 0.14, w, h * 0.7, s, -0.3)
      g.fillStyle = 'rgba(240,244,246,0.9)'
      g.fillRect(x + w * 0.94, y + h * 0.14, w * 0.06, h * 0.7)
    }
  },
  // 金属パネル張りの商業ビル（109_02、dogenzaka_05）。目地の格子に、階ごとの横長の細い窓
  panel: (g, lit, x, y, w, h, r, c) => {
    const s = hash(r * 5 + 2, c * 3 + 7)
    if (lit) {
      litWindow(g, x + w * 0.05, y + h * 0.36, w * 0.9, h * 0.2, s, 0.55)
      return
    }
    // パネルごとの濃淡
    g.fillStyle = `rgba(0,0,0,${(s * 0.09).toFixed(3)})`
    g.fillRect(x, y, w, h)
    g.fillStyle = 'rgba(0,0,0,0.20)'
    for (let k = 0; k < 2; k++) g.fillRect(x + (w * k) / 2, y, w * 0.02, h)
    for (let k = 0; k < 3; k++) g.fillRect(x, y + (h * k) / 3, w, h * 0.022)
    glass(g, x + w * 0.05, y + h * 0.36, w * 0.9, h * 0.2, s, 0.45)
  },
  // 高架の駅の側面（縦は1枚で帯の高さ）。上下 2 段のガラス、奥に明るい天井と白い鉄骨の斜材
  tube: (g, lit, x, y, w, h, r, c) => {
    if (r > 0) return
    const H = h * 8
    const top = y + H * 0.04
    const gh = H * 0.9
    if (lit) {
      // 夕方と夜: 内側から白く光る 2 段のガラス（miyamasuzaka_07）。上の段は天井の明かりで明るく、下の段は人の影でまだら。
      // 一面の黄色い帯にすると、ガラスの駅舎ではなく光る看板の帯に見える
      g.fillStyle = '#f3f6ff'
      g.globalAlpha = 0.8
      g.fillRect(x, top, w, gh * 0.47)
      g.globalAlpha = 0.45 + hash(c * 7 + 3, 11) * 0.3
      g.fillStyle = '#ffeccd'
      g.fillRect(x, top + gh * 0.47, w, gh * 0.53)
      g.globalAlpha = 1
    } else {
      const grad = g.createLinearGradient(0, top, 0, top + gh)
      grad.addColorStop(0, '#dfe9f0')
      grad.addColorStop(0.2, '#8ea2b2')
      grad.addColorStop(0.55, '#6f8494')
      grad.addColorStop(1, '#56697a')
      g.fillStyle = grad
      g.fillRect(x, top, w, gh)
    }
    // 奥の白い鉄骨の斜材（viaduct_01: ガラスの帯の中に白い斜めの線が続く。電車は見えない）
    g.strokeStyle = lit ? 'rgba(0,0,0,0.55)' : 'rgba(232,238,242,0.6)'
    g.lineWidth = Math.max(1, w * 0.035)
    g.beginPath()
    if (c % 2) {
      g.moveTo(x, top + gh)
      g.lineTo(x + w, top)
    } else {
      g.moveTo(x, top)
      g.lineTo(x + w, top + gh)
    }
    g.stroke()
    // 方立てと、中段の無目、上下の枠
    g.fillStyle = lit ? '#000' : 'rgba(236,240,243,0.95)'
    g.fillRect(x + w * 0.95, y, w * 0.05, H)
    g.fillRect(x, top + gh * 0.47, w, H * 0.035)
    g.fillRect(x, y, w, H * 0.04)
    g.fillRect(x, y + H * 0.94, w, H * 0.06)
  },
}

const wrapTexture = (canvas: HTMLCanvasElement, anisotropy = 4) => {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = anisotropy
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function paintWall(kind: WallKind, size: number, lit: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return canvas
  const cell = size / 8
  g.fillStyle = lit ? '#000' : '#fff'
  g.fillRect(0, 0, size, size)
  // テクスチャの v は下から上。canvas の行 r=0 を「いちばん上の段」として描く
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) PAINTERS[kind](g, lit, c * cell, r * cell, cell, cell, r, c)
  return canvas
}

/** 横断歩道の縞（道のりに沿って白と路面が交互）。擦れとひび割れでアスファルトが透ける */
function paintZebra() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const g = canvas.getContext('2d')
  if (!g) return canvas
  g.fillStyle = '#3b3d42'
  g.fillRect(0, 0, 128, 256)
  for (let band = 0; band < 2; band++) {
    const y0 = band * 128
    g.fillStyle = '#ecebe4'
    g.fillRect(0, y0, 128, 62)
    for (let i = 0; i < 90; i++) {
      const h1 = hash(i, band * 7 + 1)
      const h2 = hash(i, band * 7 + 2)
      const h3 = hash(i, band * 7 + 3)
      g.fillStyle = `rgba(59,61,66,${0.25 + h3 * 0.5})`
      // タイヤの通る筋に沿った擦れ（道のり方向に細長い）
      if (i % 3 === 0) g.fillRect(h1 * 128, y0, 1 + h3 * 3, 62)
      else g.fillRect(h1 * 128, y0 + h2 * 60, 2 + h3 * 10, 1 + h3 * 2)
    }
  }
  return canvas
}

/** 路面と舗装のざらつき（頂点色に掛ける、明るさだけの絵） */
function paintGrain(seed: number, contrast: number, tiles = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) return canvas
  g.fillStyle = '#e4e4e4'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 900; i++) {
    const v = hash(i, seed)
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${contrast * v})` : `rgba(255,255,255,${contrast * (v - 0.5)})`
    g.fillRect(hash(i, seed + 1) * 128, hash(i, seed + 2) * 128, 1 + hash(i, seed + 3) * 5, 1 + hash(i, seed + 4) * 3)
  }
  if (tiles > 0) {
    g.fillStyle = 'rgba(0,0,0,0.16)'
    const step = 128 / tiles
    for (let k = 0; k < tiles; k++) {
      g.fillRect(k * step, 0, 1, 128)
      g.fillRect(0, k * step, 128, 1)
    }
  }
  return canvas
}

/** 大型ビジョンに流す架空の映像（2×2 の 4 枚）。色面と図形だけで、実在の広告は写さない */
/** 大型ビジョンの映像（架空）。横 4 × 縦 2 の 8 枚。0..3 は色の帯と丸、4 は赤地に人物の大写し、5 は淡い色の輪、6 は黄、7 は紺 */
function paintScreens(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size * 2
  canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return canvas
  const half = size / 2
  const themes: [string, string, string][] = [
    ['#18b7c9', '#f25fa3', '#fff3b0'],
    ['#ff5a36', '#ffd23f', '#1b1464'],
    ['#2b6cff', '#9ff0ff', '#ffffff'],
    ['#101018', '#ff3d7f', '#7af0c8'],
    ['#e3202b', '#ea2f37', '#ffffff'],
    ['#cfe6f7', '#e9d6f5', '#ffffff'],
    ['#ffd21f', '#ffe45c', '#17181c'],
    ['#14204e', '#2a48a8', '#ffe45c'],
  ]
  themes.forEach(([a, b, c], i) => {
    const x = (i % 4) * half
    const y = Math.floor(i / 4) * half
    const grad = g.createLinearGradient(x, y, x + half, y + half)
    grad.addColorStop(0, a)
    grad.addColorStop(1, b)
    g.fillStyle = grad
    g.fillRect(x, y, half, half)
    if (i === 4) {
      // 赤地に人物の大写し（帽子・顔・白い服）と、上の白い帯に字の代わりの四角
      g.fillStyle = '#ffffff'
      g.fillRect(x + half * 0.06, y + half * 0.1, half * 0.62, half * 0.13)
      g.fillStyle = '#e3202b'
      for (let k = 0; k < 5; k++) g.fillRect(x + half * (0.1 + k * 0.11), y + half * 0.135, half * 0.07, half * 0.06)
      g.fillStyle = '#ffffff'
      g.fillRect(x + half * 0.74, y + half * 0.08, half * 0.2, half * 0.07)
      g.fillRect(x + half * 0.74, y + half * 0.19, half * 0.16, half * 0.05)
      g.fillStyle = '#f6f1ea'
      g.beginPath()
      g.ellipse(x + half * 0.5, y + half * 0.98, half * 0.26, half * 0.3, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#f3c9a8'
      g.beginPath()
      g.arc(x + half * 0.5, y + half * 0.56, half * 0.15, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#f27aa6'
      g.beginPath()
      g.ellipse(x + half * 0.5, y + half * 0.43, half * 0.17, half * 0.08, 0, 0, Math.PI * 2)
      g.fill()
    } else if (i === 5) {
      // 淡い地に色の輪
      const rings = ['#ff5a6e', '#ffc93c', '#3fb6ff', '#5ad18b']
      rings.forEach((col, k) => {
        g.strokeStyle = col
        g.lineWidth = half * 0.07
        g.beginPath()
        g.arc(x + half * 0.5, y + half * 0.55, half * (0.12 + k * 0.075), k * 1.3, k * 1.3 + Math.PI * 1.2)
        g.stroke()
      })
    } else {
      g.fillStyle = c
      g.globalAlpha = 0.85
      g.beginPath()
      g.arc(x + half * (0.3 + 0.1 * (i % 4)), y + half * 0.52, half * 0.24, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 0.9
      g.fillRect(x + half * 0.58, y + half * 0.3, half * 0.32, half * 0.08)
      g.fillRect(x + half * 0.58, y + half * 0.46, half * 0.24, half * 0.05)
      g.fillRect(x + half * 0.58, y + half * 0.58, half * 0.28, half * 0.05)
      g.globalAlpha = 1
    }
    // 画面の縁
    g.strokeStyle = '#0b0c10'
    g.lineWidth = size / 64
    g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, half - g.lineWidth, half - g.lineWidth)
  })
  return canvas
}

export interface CityTextures {
  walls: Record<WallKind, { color: THREE.Texture; glow: THREE.Texture }>
  zebra: THREE.Texture
  asphalt: THREE.Texture
  paving: THREE.Texture
  screens: THREE.Texture
  dispose: () => void
}

export function createCityTextures(size: number): CityTextures {
  const all: THREE.Texture[] = []
  const keep = <T extends THREE.Texture>(t: T) => {
    all.push(t)
    return t
  }
  const walls = {} as CityTextures['walls']
  for (const kind of WALL_KINDS) {
    // 模様の粗い種類は小さい絵で足りる
    const s = kind === 'blank' || kind === 'metal' || kind === 'girder' ? Math.min(size, 256) : size
    walls[kind] = { color: keep(wrapTexture(paintWall(kind, s, false))), glow: keep(wrapTexture(paintWall(kind, s, true))) }
  }
  const zebra = keep(wrapTexture(paintZebra(), 8))
  // 縞は道のり 1.1m ごと（絵1枚に2本）、幅方向は 6m で1回
  zebra.repeat.set(1, 1 / 2.2)
  const asphalt = keep(wrapTexture(paintGrain(11, 0.22), 4))
  const paving = keep(wrapTexture(paintGrain(23, 0.12, 8), 4))
  const screens = keep(wrapTexture(paintScreens(Math.min(512, size * 2)), 4))
  return { walls, zebra, asphalt, paving, screens, dispose: () => all.forEach((t) => t.dispose()) }
}
