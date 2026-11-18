// Grand Theft Outfit [部品: signs] 夜の看板の絵: 暗い板に、屋号を「管の線」で書く。
// 入口: drawNeonCell(g, cell, x, y, w, h)
// 契約: signage.ts の NIGHT_CELLS（店の看板・袖看板）を1枚ずつ描く。板は光らせない（ほぼ黒）。
//       光るのは管だけ: 文字は細い字の輪郭を色でなぞり（外側の色とにじみ）、字そのものを白く塗る（芯）。
//       飾りは下線・囲み・区切りの管だけ。描くのは架空の屋号で、実在のロゴや意匠は描かない。
import type { SignCell } from '../../lib/gto/signage'
import { neonAccent } from '../../lib/gto/signageNeon'
import { NEON_COLORS } from '../../lib/gto/signageCatalog'

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif'

type G = CanvasRenderingContext2D
const isLatin = (s: string) => /^[\x20-\x7e]+$/.test(s)

/** 灯の入っていない板の色（夜の外壁よりわずかに暗い） */
const PANEL = '#06060a'
/** 管の芯の色（白に、ほんの少し管の色を残す） */
const CORE_MIX = 0.86

const parse = (css: string) => {
  const n = Number.parseInt(css.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** 管の芯: 色を白へ寄せる */
function coreOf(color: string): string {
  const [r, g, b] = parse(color).map((v) => Math.round(v + (255 - v) * CORE_MIX))
  return `rgb(${r},${g},${b})`
}

/** 管1本ぶんを描く: 外へにじむ色 → 色の管 → 白い芯。draw(線の太さ, 芯か) を3回呼ぶ */
function tube(g: G, color: string, width: number, draw: (lineWidth: number, core: boolean) => void) {
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = color
  g.fillStyle = color
  g.shadowColor = color
  // 外へ広く薄いにじみと、管のすぐ外の濃いにじみ
  g.shadowBlur = width * 4.5
  draw(width, false)
  g.shadowBlur = width * 1.4
  draw(width, false)
  g.shadowBlur = 0
  g.strokeStyle = g.fillStyle = coreOf(color)
  draw(width * 0.36, true)
}

/** 管で書いた文字。細い字の輪郭を色でなぞり、字そのものを芯として白く塗る（芯が白く、外側が色の1本の管に見える） */
function tubeText(g: G, s: string, x: number, y: number, size: number, color: string, maxWidth?: number) {
  g.font = `300 ${size}px ${FONT}`
  tube(g, color, Math.max(1.6, size * 0.075), (lw, core) => {
    if (core) g.fillText(s, x, y, maxWidth)
    else {
      g.lineWidth = lw
      g.strokeText(s, x, y, maxWidth)
    }
  })
}

/** 小さな添え字。細すぎて管にならないので、色のまま薄くにじませて書く */
function smallText(g: G, s: string, x: number, y: number, size: number, color: string, maxWidth?: number) {
  g.font = `600 ${size}px ${FONT}`
  g.fillStyle = color
  g.shadowColor = color
  g.shadowBlur = size * 0.5
  g.fillText(s, x, y, maxWidth)
  g.shadowBlur = 0
  g.globalAlpha = 0.55
  g.fillStyle = coreOf(color)
  g.fillText(s, x, y, maxWidth)
  g.globalAlpha = 1
}

/** 管の線分 */
function tubeLine(g: G, color: string, width: number, x0: number, y0: number, x1: number, y1: number) {
  tube(g, color, width, (lw) => {
    g.lineWidth = lw
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
    g.stroke()
  })
}

/** 角の丸い管の囲み */
function tubeBox(g: G, color: string, width: number, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) * 0.28
  tube(g, color, width, (lw) => {
    g.lineWidth = lw
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
    g.stroke()
  })
}

function drawWide(g: G, c: SignCell, color: string, second: string, x: number, y: number, w: number, h: number) {
  const { name, sub } = c.shop
  const line = Math.max(1.6, h * 0.035)
  const hasSub = sub !== ''
  const style = hasSub ? c.style : 1
  if (style === 0) {
    // 左に、管で囲んだ種類の札。右に屋号
    tubeBox(g, second, line, x + w * 0.04, y + h * 0.24, w * 0.22, h * 0.52)
    smallText(g, sub, x + w * 0.15, y + h * 0.52, h * 0.22, second, w * 0.18)
    tubeText(g, name, x + w * 0.64, y + h * 0.52, h * 0.56, color, w * 0.62)
  } else if (style === 1) {
    tubeText(g, name, x + w / 2, y + (hasSub ? h * 0.42 : h * 0.52), h * (hasSub ? 0.5 : 0.58), color, w * 0.86)
    if (hasSub) smallText(g, sub, x + w / 2, y + h * 0.83, h * 0.19, second, w * 0.8)
  } else if (style === 2) {
    // 屋号の下に、管の下線
    tubeText(g, name, x + w * 0.42, y + h * 0.46, h * 0.5, color, w * 0.6)
    tubeLine(g, second, line, x + w * 0.1, y + h * 0.84, x + w * 0.74, y + h * 0.84)
    smallText(g, sub, x + w * 0.86, y + h * 0.52, h * 0.21, second, w * 0.2)
  } else {
    // 屋号と添え字のあいだに、短い管を2本
    tubeText(g, name, x + w / 2, y + h * 0.4, h * 0.52, color, w * 0.86)
    smallText(g, sub, x + w / 2, y + h * 0.84, h * 0.19, second, w * 0.5)
    tubeLine(g, second, line, x + w * 0.06, y + h * 0.84, x + w * 0.2, y + h * 0.84)
    tubeLine(g, second, line, x + w * 0.8, y + h * 0.84, x + w * 0.94, y + h * 0.84)
  }
}

/** 縦長の枠の中に、1文字ずつ縦に並べる（英字だけの名前は横倒しにして書く） */
function verticalTube(g: G, s: string, x: number, y: number, w: number, h: number, color: string) {
  if (isLatin(s)) {
    g.save()
    g.translate(x + w / 2, y + h / 2)
    g.rotate(Math.PI / 2)
    tubeText(g, s, 0, 0, Math.min(w * 0.58, (h * 1.5) / s.length), color, h * 0.9)
    g.restore()
    return
  }
  const chars = [...s.replace(/\s+/g, '')].slice(0, 9)
  const size = Math.min(w * 0.7, (h * 0.94) / chars.length)
  const top = y + (h - size * chars.length) / 2
  chars.forEach((ch, i) => tubeText(g, ch, x + w / 2, top + size * (i + 0.5), size, color))
}

function drawTall(g: G, c: SignCell, color: string, second: string, x: number, y: number, w: number, h: number) {
  const { name, sub } = c.shop
  const short = c.shape === 'mid'
  // 短い袖看板は、店名が長ければ店の種類を書く
  const plain = name.replace(/\s+/g, '')
  const label = short && plain.length > 5 && sub !== '' && !isLatin(sub) && sub.length <= 5 ? sub : name
  const cap = sub !== '' && !short && c.style !== 2 ? w * 0.8 : 0
  const line = Math.max(1.6, w * 0.035)
  if (cap > 0) {
    // 上か下に、管で囲んだ種類の札
    const cy = c.style === 0 ? y + w * 0.14 : y + h - cap - w * 0.14
    tubeBox(g, second, line, x + w * 0.14, cy, w * 0.72, cap)
    smallText(g, sub, x + w / 2, cy + cap / 2, Math.min(cap * 0.42, (w * 1.3) / Math.max(1, sub.length)), second, w * 0.6)
  }
  const pad = w * 0.2
  const top = y + pad + (c.style === 0 ? cap : 0)
  verticalTube(g, label, x, top, w, h - pad * 2 - cap, color)
}

/** 夜の看板1枚を描く。色は看板の光の色（neonAccent）と、差し色を1つ（1枚に2色まで） */
export function drawNeonCell(g: G, c: SignCell, x: number, y: number, w: number, h: number) {
  const design = Number(c.key.slice(c.key.lastIndexOf(':') + 1)) || 0
  const color = neonAccent({ bg: c.shop.bg, fg: c.shop.fg, design })
  const pickSecond = NEON_COLORS[(design + 1) % NEON_COLORS.length]
  // 差し色が主の色とほぼ同じなら、隣の色にする
  const second = pickSecond === color ? NEON_COLORS[(design + 2) % NEON_COLORS.length] : pickSecond
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = PANEL
  g.fillRect(x, y, w, h)
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  if (c.shape === 'wide') drawWide(g, c, color, second, x, y, w, h)
  else drawTall(g, c, color, second, x, y, w, h)
  g.restore()
}
