// Grand Theft Outfit [部品: signs] 管を曲げて書いた筆記体のネオン文字の絵。
// 入口: createNeonWordTexture(size)
// 契約: signageCatalog.ts の NEON_WORDS（架空の屋号）を、黒地に「芯が白く外側が色の管」として描く。
//       板は描かない。描画（renderSigns.ts）はこの絵を加算で壁の前に重ねるので、黒は透けて管だけが光る。
//       実在のロゴや書体の意匠は写さない（OS の筆記体で屋号を書き、下線と小さな添え字を付けるだけ）。
import * as THREE from 'three'
import { NEON_WORDS, type NeonWord } from '../../lib/gto/signageCatalog'
import type { UvRect } from './renderSignsAtlas'

/** 筆記体（無い端末では OS の cursive に落ちる） */
const SCRIPT = '"Snell Roundhand", "Savoye LET", "Brush Script MT", "Segoe Script", "Lucida Handwriting", "Dancing Script", cursive'
const CAPS = '"Avenir Next", "Futura", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'

/** 絵の並び（列 × 行）。NEON_WORDS の数以上にする */
const COLS = 3
const ROWS = 4

type G = CanvasRenderingContext2D

/** 管を1本なぞる: 外へ広いにじみ → 色の管 → 白い芯 */
function tube(g: G, color: string, width: number, draw: (line: number) => void) {
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.shadowColor = color
  g.strokeStyle = color
  g.fillStyle = color
  // にじみ（2回重ねて、管のすぐ外を濃くする）
  g.shadowBlur = width * 5
  draw(width)
  g.shadowBlur = width * 1.6
  draw(width)
  g.shadowBlur = 0
  // 芯は白（外側に色の縁が残る）
  g.strokeStyle = '#ffffff'
  g.fillStyle = '#ffffff'
  g.globalAlpha = 0.92
  draw(width * 0.34)
  g.globalAlpha = 1
}

function drawWord(g: G, word: NeonWord, x: number, y: number, w: number, h: number) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.textBaseline = 'alphabetic'
  g.textAlign = 'center'
  const line = Math.max(2, h * 0.034)
  // 屋号（筆記体）。幅に収まる大きさにする
  let size = h * 0.56
  g.font = `700 ${size}px ${SCRIPT}`
  const span = g.measureText(word.name).width
  const fit = (w * 0.84) / Math.max(span, 1)
  if (fit < 1) size *= fit
  g.font = `700 ${size}px ${SCRIPT}`
  const tw = Math.min(span * Math.min(fit, 1), w * 0.84)
  const base = y + h * 0.56
  const cx = x + w / 2
  tube(g, word.fg, line, (lw) => {
    g.lineWidth = lw
    g.strokeText(word.name, cx, base)
    if (lw < line) g.fillText(word.name, cx, base)
  })
  // 下線の管（2色目）。左から右へ少し反って、右端で跳ねる
  const x0 = cx - tw * 0.5
  const x1 = cx + tw * 0.5
  const uy = y + h * 0.74
  tube(g, word.bg, line, (lw) => {
    g.lineWidth = lw
    g.beginPath()
    g.moveTo(x0, uy)
    g.quadraticCurveTo(cx, uy + h * 0.07, x1 - h * 0.62, uy - h * 0.005)
    g.stroke()
  })
  // 添え字（小さな大文字。右下）
  g.textAlign = 'right'
  g.font = `600 ${h * 0.15}px ${CAPS}`
  const sx = x1
  const sy = uy + h * 0.05
  tube(g, word.bg, line * 0.5, (lw) => {
    g.lineWidth = lw
    g.strokeText(word.sub, sx, sy)
  })
  g.restore()
}

export interface NeonWordTexture {
  texture: THREE.CanvasTexture
  /** NEON_WORDS の番号から UV を引く */
  uv: (design: number) => UvRect
  dispose: () => void
}

/** 筆記体のネオン文字を並べたテクスチャ。size は横の px（縦は半分） */
export function createNeonWordTexture(size: number): NeonWordTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  const cw = size / COLS
  const ch = size / 2 / ROWS
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#000000'
    g.fillRect(0, 0, canvas.width, canvas.height)
    NEON_WORDS.slice(0, COLS * ROWS).forEach((word, i) => drawWord(g, word, (i % COLS) * cw, Math.floor(i / COLS) * ch, cw, ch))
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const uv = (design: number): UvRect => {
    const i = ((design % (COLS * ROWS)) + COLS * ROWS) % (COLS * ROWS)
    const c = i % COLS
    const r = Math.floor(i / COLS)
    return { u0: c / COLS, u1: (c + 1) / COLS, v0: 1 - (r + 1) / ROWS, v1: 1 - r / ROWS }
  }
  return { texture, uv, dispose: () => texture.dispose() }
}
