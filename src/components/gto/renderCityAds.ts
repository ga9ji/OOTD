// Grand Theft Outfit [部品: city] 壁の広告面の絵（看板ビルの上の階に載る大きな板）。
// 入口: WALL_AD_PAINTERS（renderCityBoards の板のテクスチャの下 3 段に並ぶ）
// 契約: 実在の社名・ロゴ・人物は描かない。色面と図形と、読めない程度の帯だけ。板は縦長にも横長にも引き伸ばされるので、
//       伸びても崩れない絵柄（帯・円・人影の形）にする。現地写真の「色と明るさの並び」（赤白、黄黒、青、桃、人物の大写し）を写す。
type Ctx = CanvasRenderingContext2D
type Painter = (g: Ctx, x: number, y: number, s: number) => void

/** 文字の代わりの帯（遠目に文字列に見える、太さの違う短い棒） */
function bars(g: Ctx, x: number, y: number, w: number, h: number, color: string, rows: number, seed: number) {
  g.fillStyle = color
  for (let r = 0; r < rows; r++) {
    const len = 0.55 + ((seed * (r + 3) * 37) % 40) / 100
    g.fillRect(x + (w * (1 - len)) / 2, y + (h * r) / rows, w * len, (h / rows) * 0.56)
  }
}

/** 人物の大写しのような形（頭と肩の影絵） */
function figure(g: Ctx, cx: number, top: number, w: number, h: number, skin: string, cloth: string) {
  g.fillStyle = cloth
  g.beginPath()
  g.ellipse(cx, top + h * 1.02, w * 0.5, h * 0.42, 0, Math.PI, 0)
  g.fill()
  g.fillStyle = skin
  g.beginPath()
  g.ellipse(cx, top + h * 0.38, w * 0.2, h * 0.26, 0, 0, Math.PI * 2)
  g.fill()
  // 髪
  g.fillStyle = 'rgba(24,20,22,0.92)'
  g.beginPath()
  g.ellipse(cx, top + h * 0.28, w * 0.23, h * 0.2, 0, Math.PI, 0)
  g.fill()
}

/** 地の色と差し色から、決まった割り付けの絵を作る */
const banded =
  (bg: string, band: string, ink: string, layout: number): Painter =>
  (g, x, y, s) => {
    g.fillStyle = bg
    g.fillRect(x, y, s, s)
    if (layout === 0) {
      // 上に色帯、中央に大きな丸、下に帯の列
      g.fillStyle = band
      g.fillRect(x, y, s, s * 0.22)
      g.beginPath()
      g.arc(x + s * 0.5, y + s * 0.52, s * 0.2, 0, Math.PI * 2)
      g.fill()
      bars(g, x + s * 0.12, y + s * 0.78, s * 0.76, s * 0.16, ink, 2, 3)
    } else if (layout === 1) {
      // 太い 2 段の文字帯
      bars(g, x + s * 0.08, y + s * 0.14, s * 0.84, s * 0.5, ink, 2, 5)
      g.fillStyle = band
      g.fillRect(x, y + s * 0.72, s, s * 0.28)
      bars(g, x + s * 0.14, y + s * 0.79, s * 0.72, s * 0.14, bg, 1, 7)
    } else if (layout === 2) {
      // 人物の大写しと、下の帯
      figure(g, x + s * 0.5, y + s * 0.08, s * 0.9, s * 0.66, '#f1cdb4', band)
      g.fillStyle = ink
      g.fillRect(x, y + s * 0.76, s, s * 0.24)
      bars(g, x + s * 0.12, y + s * 0.82, s * 0.76, s * 0.12, bg, 1, 9)
    } else {
      // 斜めの色面と小さな四角
      g.fillStyle = band
      g.beginPath()
      g.moveTo(x, y + s)
      g.lineTo(x + s, y + s * 0.3)
      g.lineTo(x + s, y + s)
      g.fill()
      g.fillStyle = ink
      g.fillRect(x + s * 0.1, y + s * 0.1, s * 0.34, s * 0.34)
      bars(g, x + s * 0.52, y + s * 0.14, s * 0.38, s * 0.26, ink, 3, 11)
    }
  }

/** 壁の広告面の絵 12 枚（map の WALL_AD_ARTS と同じ数） */
export const WALL_AD_PAINTERS: Painter[] = [
  banded('#f6f5f0', '#d5281f', '#17181b', 1),
  banded('#d5281f', '#ffffff', '#ffe14a', 1),
  banded('#f7d02c', '#17181b', '#17181b', 0),
  banded('#1f3f9a', '#ffffff', '#ffffff', 1),
  banded('#e9eef2', '#2a7de1', '#17181b', 2),
  banded('#f3a6c4', '#e2356f', '#ffffff', 2),
  banded('#15161a', '#ee5c97', '#f6f5f0', 0),
  banded('#f6f5f0', '#16a36a', '#16a36a', 3),
  banded('#2bb8c8', '#f6f5f0', '#17181b', 2),
  banded('#f08a24', '#ffffff', '#5a1d0c', 3),
  banded('#f6f5f0', '#1f3f9a', '#d5281f', 0),
  banded('#6b3fc4', '#f7d02c', '#ffffff', 3),
]

const JP = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif'
function label(g: Ctx, str: string, x: number, y: number, size: number, color: string, maxWidth: number) {
  g.font = `900 ${size}px ${JP}`
  g.fillStyle = color
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(str, x, y, maxWidth)
}

/** 縦長の袖看板。地の色を塗り、字を縦に積む（1 字を板の幅いっぱいまで横に伸ばす）。h = 字を積む高さ、w = 板の幅 */
function vertical(g: Ctx, x: number, y: number, h: number, bg: string, fg: string, str: string, w = h) {
  g.fillStyle = bg
  g.fillRect(x, y, w, h)
  const chars = [...str]
  const cell = h / chars.length
  chars.forEach((ch, i) => {
    g.save()
    g.translate(x + w / 2, y + cell * (i + 0.5))
    g.scale((w * 0.8) / (cell * 0.84), 1)
    label(g, ch, 0, 0, cell * 0.84, fg, cell)
    g.restore()
  })
}

/**
 * 壁面いっぱいの大看板（lib/gto/mapFacade.ts の ART.bigRed 以降。並びの番号は ART と同じ）。店名・数字はすべて架空。
 * 109 の向かいの赤い横長の大看板、白地に赤い丸印 2 つ、緑地の人物の大写し、濃い灰色に白い斜めの光の線。
 */
export const FACE_ART_PAINTERS: Painter[] = [
  (g, x, y, s) => {
    g.fillStyle = '#d81f26'
    g.fillRect(x, y, s, s)
    g.strokeStyle = '#ffffff'
    g.lineWidth = s * 0.02
    g.strokeRect(x + s * 0.03, y + s * 0.05, s * 0.94, s * 0.9)
    label(g, 'ぜんぶ試着できる大型店', x + s * 0.5, y + s * 0.2, s * 0.085, '#ffe14a', s * 0.84)
    label(g, '古着のヤマト', x + s * 0.36, y + s * 0.5, s * 0.2, '#ffffff', s * 0.6)
    label(g, '渋谷本店', x + s * 0.36, y + s * 0.8, s * 0.16, '#ffffff', s * 0.6)
    label(g, '3000', x + s * 0.8, y + s * 0.58, s * 0.34, '#ffffff', s * 0.32)
    label(g, '着', x + s * 0.93, y + s * 0.82, s * 0.1, '#ffe14a', s * 0.1)
  },
  (g, x, y, s) => {
    g.fillStyle = '#f6f5f0'
    g.fillRect(x, y, s, s)
    ;[
      [0.27, 'い'],
      [0.73, 'ろ'],
    ].forEach(([cx, ch]) => {
      g.fillStyle = '#d5281f'
      g.beginPath()
      g.ellipse(x + s * (cx as number), y + s * 0.5, s * 0.13, s * 0.36, 0, 0, Math.PI * 2)
      g.fill()
      label(g, ch as string, x + s * (cx as number), y + s * 0.52, s * 0.4, '#ffffff', s * 0.2)
    })
  },
  (g, x, y, s) => {
    g.fillStyle = '#3aa655'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#f7d02c'
    g.fillRect(x + s * 0.08, y + s * 0.04, s * 0.84, s * 0.2)
    label(g, 'みどりの青汁', x + s * 0.5, y + s * 0.14, s * 0.14, '#1d5b30', s * 0.8)
    figure(g, x + s * 0.5, y + s * 0.26, s * 0.92, s * 0.5, '#f1cdb4', '#c9b089')
    g.fillStyle = '#f6f5f0'
    g.fillRect(x, y + s * 0.8, s, s * 0.2)
    bars(g, x + s * 0.1, y + s * 0.84, s * 0.8, s * 0.13, '#1d5b30', 2, 5)
  },
  (g, x, y, s) => {
    g.fillStyle = '#34383d'
    g.fillRect(x, y, s, s)
    g.strokeStyle = 'rgba(255,255,255,0.08)'
    g.lineWidth = s * 0.006
    for (let k = 1; k < 7; k++) g.strokeRect(x, y + (s * k) / 7, s, 0)
    // 折れ線で壁を横切る白い光の線
    g.strokeStyle = '#f4f6f8'
    g.lineWidth = s * 0.022
    g.lineJoin = 'miter'
    const line = (pts: number[]) => {
      g.beginPath()
      pts.forEach((v, i) => (i % 2 ? null : i === 0 ? g.moveTo(x + s * v, y + s * pts[i + 1]) : g.lineTo(x + s * v, y + s * pts[i + 1])))
      g.stroke()
    }
    line([0.02, 0.86, 0.36, 0.22, 0.58, 0.22, 0.98, 0.7])
    line([0.3, 0.98, 0.62, 0.48, 0.98, 0.2])
    line([0.02, 0.4, 0.2, 0.1])
  },
  // 黒地に白い太字の横長の帯（架空の靴屋）
  (g, x, y, s) => {
    g.fillStyle = '#131418'
    g.fillRect(x, y, s, s)
    label(g, 'HAYATE', x + s * 0.5, y + s * 0.36, s * 0.4, '#ffffff', s * 0.9)
    label(g, 'くつのハヤテ', x + s * 0.5, y + s * 0.78, s * 0.2, '#ffffff', s * 0.9)
  },
  // 暗い格子の枠に、赤と黄の丸い提灯を 4 列 3 段
  (g, x, y, s) => {
    g.fillStyle = '#23201d'
    g.fillRect(x, y, s, s)
    g.strokeStyle = '#0c0c0d'
    g.lineWidth = s * 0.012
    for (let k = 0; k <= 4; k++) g.strokeRect(x + (s * k) / 4, y, 0, s)
    for (let k = 0; k <= 3; k++) g.strokeRect(x, y + (s * k) / 3, s, 0)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const cx = x + (s * (c + 0.5)) / 4
        const cy = y + (s * (r + 0.5)) / 3
        const red = (r + c) % 2 === 0
        g.fillStyle = red ? '#ff5a3c' : '#ffd34a'
        g.beginPath()
        g.ellipse(cx, cy, s * 0.088, s * 0.125, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = red ? '#ffb39c' : '#fff3b8'
        g.beginPath()
        g.ellipse(cx, cy, s * 0.04, s * 0.07, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#1a1614'
        g.fillRect(cx - s * 0.035, cy - s * 0.14, s * 0.07, s * 0.018)
        g.fillRect(cx - s * 0.035, cy + s * 0.122, s * 0.07, s * 0.018)
      }
    }
  },
  // 桃色の地に白い花びらの散る大型の広告面
  (g, x, y, s) => {
    g.fillStyle = '#f06aa8'
    g.fillRect(x, y, s, s)
    for (let k = 0; k < 14; k++) {
      g.fillStyle = k % 3 === 0 ? '#ffe3f0' : k % 3 === 1 ? '#ff9cc8' : '#d93f8a'
      g.beginPath()
      g.ellipse(x + s * (0.1 + ((k * 0.37) % 0.8)), y + s * (0.1 + ((k * 0.23) % 0.8)), s * 0.09, s * 0.05, k * 0.9, 0, Math.PI * 2)
      g.fill()
    }
    label(g, 'はなやぐ春服', x + s * 0.5, y + s * 0.88, s * 0.12, '#ffffff', s * 0.9)
  },
  // 木目の黄色い地に墨の太字の店先の帯（架空の居酒屋）
  (g, x, y, s) => {
    g.fillStyle = '#e9b54a'
    g.fillRect(x, y, s, s)
    g.strokeStyle = 'rgba(120,70,10,0.35)'
    g.lineWidth = s * 0.01
    for (let k = 1; k < 9; k++) g.strokeRect(x, y + (s * k) / 9, s, 0)
    g.fillStyle = '#c8402a'
    g.beginPath()
    g.arc(x + s * 0.12, y + s * 0.5, s * 0.09, 0, Math.PI * 2)
    g.fill()
    label(g, '坂の上酒場', x + s * 0.58, y + s * 0.52, s * 0.52, '#1c1410', s * 0.72)
  },
  // 28: 青い縦長の袖看板（架空の銀行）。白い字を縦に積む。細長い板に引き伸ばされるので、字は横いっぱいに太らせて描く
  (g, x, y, s) => vertical(g, x, y, s, '#1c3fae', '#ffffff', 'くもい銀行'),
  // 29: 黄色い縦長の袖看板（架空の薬局）。上に赤い丸、下に紺の字
  (g, x, y, s) => {
    vertical(g, x, y + s * 0.14, s * 0.86, '#f5d21c', '#1a2c7a', 'ひなた薬局', s)
    g.fillStyle = '#f5d21c'
    g.fillRect(x, y, s, s * 0.14)
    g.fillStyle = '#d5281f'
    g.beginPath()
    g.ellipse(x + s * 0.5, y + s * 0.075, s * 0.34, s * 0.055, 0, 0, Math.PI * 2)
    g.fill()
  },
  // 30: 白地に赤い太字の横長の帯（屋上の量販店の看板。店名は架空）。横長の板に引き伸ばされるので、字は縦いっぱいに描く
  (g, x, y, s) => {
    g.fillStyle = '#f7f6f2'
    g.fillRect(x, y, s, s)
    label(g, 'ミカド電機', x + s * 0.5, y + s * 0.54, s * 0.86, '#e0161c', s * 0.94)
  },
  // 31: 赤い縦長の袖看板（109 の向かいの大看板の棟。店名は架空）。黄色い字を縦に積む
  (g, x, y, s) => vertical(g, x, y, s, '#d81f26', '#ffe14a', '古着のヤマト'),
  // 32: 桃色の枠のガラスの窓割り（5 階 × 6 列）に、階ごとの青い帯の看板（センター街の桃色の棟の通りの面。店名は架空）
  (g, x, y, s) => {
    g.fillStyle = '#d81b72'
    g.fillRect(x, y, s, s)
    const rows = 5
    const cols = 6
    const top = s * 0.03
    const rowH = (s * 0.84) / rows
    const words = ['カラオケ ミラボ', 'うたい放題 60分', 'ひとりうた歓迎', '全室あたらしい音', 'MIRABO カラオケ']
    for (let r = 0; r < rows; r++) {
      const ry = y + top + r * rowH
      for (let c = 0; c < cols; c++) {
        const cx = x + s * 0.03 + (c * s * 0.94) / cols
        const cw = (s * 0.94) / cols - s * 0.012
        const grad = g.createLinearGradient(0, ry, 0, ry + rowH)
        grad.addColorStop(0, (r + c) % 3 === 0 ? '#b9cdea' : '#93aede')
        grad.addColorStop(1, '#4f6fb0')
        g.fillStyle = grad
        g.fillRect(cx, ry, cw, rowH - s * 0.014)
      }
      // 階ごとの青い帯の看板に白い字
      g.fillStyle = '#1f49b5'
      g.fillRect(x + s * 0.03, ry + rowH * 0.5, s * 0.94 - s * 0.012, rowH * 0.34)
      label(g, words[r], x + s * 0.5, ry + rowH * 0.68, rowH * 0.26, '#ffffff', s * 0.86)
    }
    // 足元の店先の白い帯
    g.fillStyle = '#f6f5f0'
    g.fillRect(x, y + s * 0.88, s, s * 0.12)
    label(g, 'TACO と うたの店', x + s * 0.5, y + s * 0.945, s * 0.07, '#d5281f', s * 0.9)
  },
  // 33: 中から白く灯るガラスの外壁（4 階 × 5 列）。階の境に暗い床の帯、中ほどの階に白い立体文字（センター街の突き当たりの角の棟。店名は架空）
  (g, x, y, s) => {
    g.fillStyle = '#2a2d33'
    g.fillRect(x, y, s, s)
    const rows = 4
    const cols = 5
    const rowH = s / rows
    for (let r = 0; r < rows; r++) {
      const ry = y + r * rowH
      for (let c = 0; c < cols; c++) {
        const cx = x + (c * s) / cols
        const grad = g.createLinearGradient(0, ry, 0, ry + rowH)
        // 天井の明かりが上、棚の並ぶ売り場が下。列ごとに少し色を変える
        grad.addColorStop(0, '#fffdf2')
        grad.addColorStop(0.55, (r + c) % 2 === 0 ? '#ffe9bd' : '#f6dcae')
        grad.addColorStop(1, '#c9a877')
        g.fillStyle = grad
        g.fillRect(cx + s * 0.006, ry + rowH * 0.14, s / cols - s * 0.012, rowH * 0.86)
      }
      // 売り場の棚の影
      bars(g, x + s * 0.04, ry + rowH * 0.66, s * 0.92, rowH * 0.22, 'rgba(90,60,30,0.5)', 1, r * 7 + 3)
    }
    label(g, 'HAYATE', x + s * 0.5, y + rowH * 1.56, rowH * 0.5, '#ffffff', s * 0.8)
  },
  // 34: 白い外壁（階ごとの細い目地と窓の帯）に赤い縦幕（道玄坂下の通りの抜けの先の白い棟。字は架空）
  (g, x, y, s) => {
    g.fillStyle = '#f7f6f0'
    g.fillRect(x, y, s, s)
    for (let r = 0; r < 7; r++) {
      g.fillStyle = '#c9ced3'
      g.fillRect(x, y + (s * (r + 0.72)) / 7, s, s * 0.018)
      g.fillStyle = '#9fb4c8'
      g.fillRect(x + s * 0.68, y + (s * (r + 0.2)) / 7, s * 0.26, s * 0.05)
    }
    // 縦幕は付け根寄り（付け根の側は手前の棟の袖看板に隠れるので、先の側に白い壁を残す）
    vertical(g, x + s * 0.36, y + s * 0.04, s * 0.92, '#d5281f', '#ffffff', 'まるは館', s * 0.26)
  },
  // 35: 濃い灰色の縦のリブの壁に白い印（三角を 3 つ重ねた形と小さな字。109 の向かいの棟の下半分。印は架空）
  (g, x, y, s) => {
    g.fillStyle = '#6a6e72'
    g.fillRect(x, y, s, s)
    const ribs = 56
    for (let i = 0; i < ribs; i++) {
      g.fillStyle = i % 2 === 0 ? '#5a5e62' : '#7b7f83'
      g.fillRect(x + (s * i) / ribs, y, s / ribs / 2, s)
    }
    // 階の境の細い影
    g.fillStyle = 'rgba(30,32,36,0.35)'
    for (let r = 1; r < 3; r++) g.fillRect(x, y + (s * r) / 3, s, s * 0.008)
    // 白い印（右寄り、下から 3 分の 1）
    const cx = x + s * 0.64
    const cy = y + s * 0.6
    g.fillStyle = '#ffffff'
    for (let k = 0; k < 3; k++) {
      g.beginPath()
      g.arc(cx + (k - 1) * s * 0.07, cy, s * 0.028 + k * s * 0.012, 0, Math.PI * 2)
      g.fill()
    }
    label(g, 'kazeno', cx, cy + s * 0.13, s * 0.085, '#ffffff', s * 0.3)
  },
  // 36: 縦長の寄せ絵の広告面（交差点の南西の角の棟の道玄坂の面）。色とりどりの小さな切り抜きを敷き詰めた地に、赤い太字を縦に積む。
  // 字も絵も架空。板は幅の 5 倍ほど縦に引き伸ばされるので、切り抜きは横長に、字は 1 字ずつ横いっぱいに描く
  (g, x, y, s) => {
    g.fillStyle = '#f3ead8'
    g.fillRect(x, y, s, s)
    const inks = ['#e23d6d', '#f2b632', '#2f9bd6', '#38a86b', '#7a4cc2', '#f08a24', '#fdfbf4', '#22242a']
    // 決まった並びの乱数（毎回同じ絵になる）
    const rnd = (k: number) => {
      const v = Math.sin(k * 127.1 + 31.7) * 43758.5453
      return v - Math.floor(v)
    }
    for (let k = 0; k < 420; k++) {
      const px = x + s * rnd(k * 3 + 1)
      const py = y + s * rnd(k * 3 + 2)
      const w = s * (0.03 + 0.05 * rnd(k * 3 + 3))
      g.fillStyle = inks[k % inks.length]
      g.beginPath()
      if (k % 3 === 0) g.rect(px - w / 2, py - w / 9, w, w / 4.5)
      else g.ellipse(px, py, w / 2, w / 9, 0, 0, Math.PI * 2)
      g.fill()
    }
    // 赤い太字（白い縁どり）を縦に 4 つ。上と下に寄せ絵だけの帯を残す
    const chars = [...'ハレマチ']
    const top = y + s * 0.13
    const cell = (s * 0.68) / chars.length
    chars.forEach((ch, i) => {
      g.save()
      g.translate(x + s / 2, top + cell * (i + 0.5))
      g.scale((s * 0.86) / (cell * 0.9), 1)
      g.font = `900 ${cell * 0.9}px ${JP}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineJoin = 'round'
      g.lineWidth = cell * 0.12
      g.strokeStyle = '#fdfbf4'
      g.strokeText(ch, 0, 0, cell)
      g.fillStyle = '#e0252b'
      g.fillText(ch, 0, 0, cell)
      g.restore()
    })
    // 足元の白い帯に、字の代わりの短い棒
    g.fillStyle = '#fdfbf4'
    g.fillRect(x + s * 0.08, y + s * 0.9, s * 0.84, s * 0.06)
    bars(g, x + s * 0.14, y + s * 0.912, s * 0.72, s * 0.04, '#e0252b', 2, 13)
  },
]
