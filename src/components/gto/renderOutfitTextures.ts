// Grand Theft Outfit [部品: outfit の見た目] 演出に使う小さな絵（その場で canvas に描く。画像ファイルは持たない）。
// 入口: makeTagTexture（狙いの札）/ makeStarTexture（散る星）/ makeBubbleTexture（相手の「!?」）
import * as THREE from 'three'

const INK = '#12172b'
const CLOTH = '#f1e7d0'
const MINT = '#2fd3a6'
const THREAD = '#ff6a2b'
/** ハンガーの線（24x18.4 の枠に描いた形） */
const HANGER =
  'M12 7.5V6Q12 4.6 13.3 4.3Q15 3.8 15 2.4Q15 0.8 12 0.8Q9.6 0.8 9.4 2.6M12 7.5L2 14.5Q0.8 15.5 1.4 16.8Q1.8 17.6 3 17.6H21Q22.2 17.6 22.6 16.8Q23.2 15.5 22 14.5Z'

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) draw(g)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 狙いの札: 生成りの丸にハンガー、下に相手を指す三角（幅 0.8 : 高さ 1） */
export function makeTagTexture(): THREE.Texture {
  return canvasTexture(128, 160, (g) => {
    g.lineJoin = 'round'
    // 指す三角
    g.beginPath()
    g.moveTo(64, 156)
    g.lineTo(40, 112)
    g.lineTo(88, 112)
    g.closePath()
    g.fillStyle = MINT
    g.strokeStyle = INK
    g.lineWidth = 7
    g.stroke()
    g.fill()
    // 丸い札
    g.beginPath()
    g.arc(64, 62, 52, 0, Math.PI * 2)
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    g.arc(64, 62, 46, 0, Math.PI * 2)
    g.fillStyle = MINT
    g.fill()
    g.beginPath()
    g.arc(64, 62, 37, 0, Math.PI * 2)
    g.fillStyle = CLOTH
    g.fill()
    // ハンガー
    g.save()
    g.translate(64 - 12 * 2.5, 62 - 9.6 * 2.5)
    g.scale(2.5, 2.5)
    g.strokeStyle = INK
    g.lineWidth = 2.1
    g.lineCap = 'round'
    g.stroke(new Path2D(HANGER))
    g.restore()
  })
}

/** 散る星: 4つの角を持つ白い光（色は頂点の色で付ける） */
export function makeStarTexture(): THREE.Texture {
  return canvasTexture(64, 64, (g) => {
    g.translate(32, 32)
    g.beginPath()
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 30 : 9
      const a = (i / 8) * Math.PI * 2
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    g.lineJoin = 'round'
    g.strokeStyle = INK
    g.lineWidth = 5
    g.stroke()
    g.fillStyle = '#ffffff'
    g.fill()
  })
}

/** 相手の頭の上に出す「!?」の吹き出し */
export function makeBubbleTexture(): THREE.Texture {
  return canvasTexture(128, 128, (g) => {
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(64, 124)
    g.lineTo(50, 98)
    g.lineTo(78, 98)
    g.closePath()
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    g.roundRect(8, 8, 112, 94, 26)
    g.fillStyle = CLOTH
    g.strokeStyle = INK
    g.lineWidth = 8
    g.fill()
    g.stroke()
    g.font = 'italic 900 70px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = THREAD
    g.strokeStyle = INK
    g.lineWidth = 6
    g.strokeText('!?', 62, 58)
    g.fillText('!?', 62, 58)
  })
}
