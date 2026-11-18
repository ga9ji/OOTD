// Grand Theft Outfit [部品: onfoot] 正面のくり抜き写真から「後ろ姿」と「腕」の絵を作る（画素の計算だけ。three/DOM なし）。
// 入口: buildBackSprite(src, w, h)
// 契約: src は RGBA（上の行から）。返す back は同じ大きさの RGBA で、左右を裏返したうえで
//       頭は髪（帽子）の色で塗りつぶし、胴は身頃の色でならして前の開き・手・顔を消し、写真の腕は切り落とす
//       （腕は別の板で振るため）。
//       腰から下と、体の外にある持ち物（傘・自転車・かばん）は裏返した写真のまま。
//       arm は肩から手先までの帯（上が肩）。rig は、腕を付ける位置（板に対する割合）。
import { clamp, lerp } from './math'

/** 体の区切り（頭のてっぺんから足元までを 1 とした、上からの割合）と、絵づくりの数字 */
export const BACK_TUNING = {
  /** 頭（髪で塗る）の下端、うなじの下端、肩、腰（ここまでならす）、ならしを写真へ戻し終える高さ */
  head: 0.125,
  nape: 0.15,
  shoulder: 0.2,
  hip: 0.5,
  hipFade: 0.57,
  /** 頭とみなす幅（身長に対する割合）。これより広い行は傘など */
  headMin: 0.05,
  headMax: 0.2,
  /** 縁の色を取るときに縁から入る画素の数 */
  edgeIn: 2,
  edgeSpan: 4,
  /** 縁の色を上下にならす行の数（片側） */
  smooth: 6,
  /** 身頃の色を拾う位置（中心から、肩の半幅に対する割合） */
  bodyAt: [0.4, 0.58, 0.76],
  /** 後ろ姿の胴の半幅（肩の半幅に対する割合）と、腕の色を写真から拾う下端（ここより下は同じ色を続ける） */
  torsoWide: 1,
  /** 肩の角を丸める半径（身長に対する割合） */
  shoulderRound: 0.03,
  sleeveTo: 0.4,
  /** 胴の丸み（縁へ向かって暗くする割合）と、背中の中心線の濃さ */
  round: 0.2,
  seam: 0.06,
  /** 頭の下へ向かって暗くする割合 */
  headShade: 0.2,
  /** 腕の絵の大きさ（画素）と、手の占める割合・縁の暗さ */
  armW: 16,
  armH: 64,
  hand: 0.15,
  armEdge: 0.26,
  /** 腕の長さ・太さ・肩幅の範囲（身長に対する割合） */
  armLen: 0.375,
  armWide: 0.075,
  shoulderMin: 0.085,
  shoulderMax: 0.135,
  alpha: 128,
}

export interface BackRig {
  /** 肩の中心の横位置（板の中心から。板の幅に対する割合、後ろ姿の絵での向き。正面の絵では符号が逆） */
  centerX: number
  /** 左右の脚の分かれ目の横位置（同上） */
  legX: number
  /** 肩の高さ（足元から。板の高さに対する割合） */
  shoulderY: number
  /** 肩の半幅・腕の長さ・腕の太さ（板の高さに対する割合） */
  shoulderHalf: number
  armLen: number
  armWide: number
}

export interface BackSprite {
  back: Uint8ClampedArray
  arm: { data: Uint8ClampedArray; w: number; h: number }
  rig: BackRig
}

type Rgb = [number, number, number]

/** 左右を裏返した写し */
function mirrored(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const j = (y * w + (w - 1 - x)) * 4
      out[j] = src[i]
      out[j + 1] = src[i + 1]
      out[j + 2] = src[i + 2]
      out[j + 3] = src[i + 3]
    }
  }
  return out
}

/** 絵を読むための小さな道具 */
function reader(px: Uint8ClampedArray, w: number, h: number) {
  const A = BACK_TUNING.alpha
  const solid = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && px[(y * w + x) * 4 + 3] >= A
  /** その行で cx を含む（無ければいちばん近い）ひと続きの不透明な範囲 */
  const run = (y: number, cx: number, reach: number): [number, number] | null => {
    let x = Math.round(cx)
    if (!solid(x, y)) {
      let found = -1
      for (let d = 1; d <= reach && found < 0; d++) {
        if (solid(x - d, y)) found = x - d
        else if (solid(x + d, y)) found = x + d
      }
      if (found < 0) return null
      x = found
    }
    let a = x
    let b = x
    while (solid(a - 1, y)) a--
    while (solid(b + 1, y)) b++
    return [a, b]
  }
  /** x0..x1 の不透明な画素の平均の色 */
  const mean = (y0: number, y1: number, x0: number, x1: number): Rgb | null => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        if (!solid(x, y)) continue
        const i = (y * w + x) * 4
        r += px[i]
        g += px[i + 1]
        b += px[i + 2]
        n++
      }
    }
    return n > 0 ? [r / n, g / n, b / n] : null
  }
  return { solid, run, mean }
}

/** 体の中心の列: 胸から腰の高さで、不透明な画素がいちばん多い列（幅をもたせて数える） */
function bodyCenter(solid: (x: number, y: number) => boolean, w: number, h: number): number {
  const count = new Float32Array(w)
  for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.55); y++) for (let x = 0; x < w; x++) if (solid(x, y)) count[x]++
  const half = Math.max(1, Math.round(h * 0.04))
  let best = w / 2
  let bestN = -1
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let d = -half; d <= half; d++) n += count[clamp(x + d, 0, w - 1)]
    // 同じなら板の中心に近いほう
    if (n > bestN + 1e-6 || (Math.abs(n - bestN) <= 1e-6 && Math.abs(x - w / 2) < Math.abs(best - w / 2))) {
      bestN = n
      best = x
    }
  }
  return best
}

/** 頭のてっぺんの行: 中心の列の近くで、頭らしい幅の行が続きはじめる所（傘や荷物は幅で外す） */
function headTop(run: (y: number, cx: number, reach: number) => [number, number] | null, cx: number, h: number): number {
  const T = BACK_TUNING
  const need = Math.max(2, Math.round(h * 0.035))
  let first = -1
  for (let y = 0; y < Math.floor(h * 0.5); y++) {
    const r = run(y, cx, Math.round(h * 0.06))
    if (!r) continue
    if (first < 0) first = y
    let ok = true
    for (let k = 1; k <= need && ok; k++) {
      const q = run(y + k, cx, Math.round(h * 0.06))
      const wide = q ? q[1] - q[0] + 1 : 0
      ok = wide >= h * T.headMin && wide <= h * T.headMax
    }
    if (ok) return y
  }
  return Math.max(0, first)
}

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** 正面の写真から、後ろ姿の絵・腕の絵・腕を付ける位置を作る */
export function buildBackSprite(src: Uint8ClampedArray, w: number, h: number): BackSprite {
  const T = BACK_TUNING
  const back = mirrored(src, w, h)
  const orig = new Uint8ClampedArray(back)
  const { solid, run, mean } = reader(orig, w, h)
  const cx = bodyCenter(solid, w, h)
  const top = headTop(run, cx, h)
  const tall = Math.max(8, h - top)
  const row = (k: number) => Math.min(h - 1, Math.round(top + tall * k))
  const reach = Math.round(tall * 0.06)
  const put = (x: number, y: number, c: Rgb) => {
    const i = (y * w + x) * 4
    back[i] = c[0]
    back[i + 1] = c[1]
    back[i + 2] = c[2]
  }

  // 頭: てっぺんの髪（帽子）の色で、顔を塗りつぶす。列ごとの色むらは少し残し、下へ向かって暗くする
  const yHead = row(T.head)
  const yNape = row(T.nape)
  const hair: Rgb = mean(top, row(0.035), Math.round(cx - tall * 0.05), Math.round(cx + tall * 0.05)) ?? [40, 36, 34]
  for (let y = top; y <= yNape; y++) {
    const r = run(y, cx, reach)
    if (!r || r[1] - r[0] + 1 > tall * T.headMax * 1.3) continue
    for (let x = r[0]; x <= r[1]; x++) {
      let y0 = y
      while (y0 > top && solid(x, y0 - 1)) y0--
      const own = y0 - top < tall * 0.05 ? mean(y0, y0 + 3, x, x) : null
      const base = own ? mixRgb(hair, own, 0.6) : hair
      const down = clamp((y - top) / Math.max(1, yNape - top), 0, 1)
      // うなじは髪から首の色へ少しだけ戻す
      const nape = y > yHead ? clamp((y - yHead) / Math.max(1, yNape - yHead), 0, 1) * 0.45 : 0
      const i = (y * w + x) * 4
      const here: Rgb = [orig[i], orig[i + 1], orig[i + 2]]
      put(x, y, mixRgb(shade(base, 1 - T.headShade * down), here, nape))
    }
  }

  // 肩: 腕を付ける位置と、胴の色を拾う位置の基準
  const ySh = row(T.shoulder)
  const shFound = run(ySh + Math.round(tall * 0.03), cx, reach)
  // 自転車などと繋がって広すぎる行は、肩としては使わない
  const shRun = shFound && shFound[1] - shFound[0] + 1 < tall * 0.42 ? shFound : null
  const mid = shRun ? (shRun[0] + shRun[1]) / 2 : cx
  const shHalf = clamp(shRun ? ((shRun[1] - shRun[0] + 1) / 2) * 0.86 : 0, tall * T.shoulderMin, tall * T.shoulderMax)

  // 胴: 行ごとに「身頃の色」（胴の数か所で拾った真ん中の色）と「縁の色」（袖や腕）を取る
  const y0 = yNape + 1
  const y1 = row(T.hipFade)
  const yHip = row(T.hip)
  const runs: ([number, number] | null)[] = []
  const bodyL: (Rgb | null)[] = []
  const bodyR: (Rgb | null)[] = []
  const edgeL: (Rgb | null)[] = []
  const edgeR: (Rgb | null)[] = []
  for (let y = y0; y <= y1; y++) {
    const r = run(y, cx, reach)
    runs.push(r)
    if (!r) {
      bodyL.push(null)
      bodyR.push(null)
      edgeL.push(null)
      edgeR.push(null)
      continue
    }
    const span = Math.min(T.edgeSpan, Math.max(1, Math.floor((r[1] - r[0]) / 3)))
    edgeL.push(mean(y, y, r[0] + T.edgeIn, r[0] + T.edgeIn + span))
    edgeR.push(mean(y, y, r[1] - T.edgeIn - span, r[1] - T.edgeIn))
    // 身頃の色: 胴の数か所で拾い、明るさが真ん中のものを取る（前の開き・肩ひも・胸の文字に引っぱられない）
    const picks: Rgb[] = []
    for (const at of T.bodyAt) {
      for (const sign of [-1, 1]) {
        const x = clamp(Math.round(mid + sign * shHalf * at), r[0] + 1, r[1] - 1)
        const c = mean(y, y, x - 1, x + 1)
        if (c) picks.push(c)
      }
    }
    picks.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
    const pick = picks.length > 0 ? picks[Math.floor((picks.length - 1) / 2)] : null
    bodyL.push(pick)
    bodyR.push(pick)
  }
  const smoothAt = (list: (Rgb | null)[], i: number): Rgb | null => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let d = -T.smooth; d <= T.smooth; d++) {
      const c = list[i + d]
      if (!c) continue
      r += c[0]
      g += c[1]
      b += c[2]
      n++
    }
    return n > 0 ? [r / n, g / n, b / n] : null
  }
  for (let y = y0; y <= y1; y++) {
    const r = runs[y - y0]
    const l = smoothAt(bodyL, y - y0)
    const rt = smoothAt(bodyR, y - y0)
    if (!r || !l || !rt) continue
    const keep = y > yHip ? clamp((y - yHip) / Math.max(1, y1 - yHip), 0, 1) : 0
    // 写真の腕（体の脇に下がった腕・ポケットの手）は切り落とし、胴を肩幅の柱にする。腕は別の板で描く。
    // 腕と胴のすきまは埋める。腰から下へ向かって、元の輪郭へ戻す
    // 肩の角は丸める
    const corner = clamp(1 - (y - ySh) / (tall * T.shoulderRound), 0, 1)
    const cut = y >= ySh ? tall * T.shoulderRound * (1 - Math.sqrt(1 - corner * corner)) : 0
    const allow = lerp(shHalf * T.torsoWide - cut, Math.max(mid - r[0], r[1] - mid), keep)
    const left = Math.round(mid - allow)
    const right = Math.round(mid + allow)
    if (y >= ySh) {
      for (let x = r[0]; x < left; x++) back[(y * w + x) * 4 + 3] = 0
      for (let x = right + 1; x <= r[1]; x++) back[(y * w + x) * 4 + 3] = 0
    }
    const hasLeft = y >= ySh && r[0] > left && solid(left - 1, y)
    const hasRight = y >= ySh && r[1] < right && solid(right + 1, y)
    const a = y >= ySh ? (r[0] <= left || hasLeft ? left : r[0]) : r[0]
    const b = y >= ySh ? (r[1] >= right || hasRight ? right : r[1]) : r[1]
    const wide = Math.max(1, b - a)
    for (let x = Math.max(0, a); x <= Math.min(w - 1, b); x++) {
      back[(y * w + x) * 4 + 3] = 255
      const t = (x - a) / wide
      const round = 1 - T.round * Math.abs(t - 0.5) * 2
      const seam = Math.abs(x - mid) < 0.8 ? 1 - T.seam : 1
      const i = (y * w + x) * 4
      const here: Rgb = [orig[i], orig[i + 1], orig[i + 2]]
      put(x, y, mixRgb(shade(mixRgb(l, rt, t), round * seam), here, keep))
    }
  }

  // 腕の絵: 肩から手首までは、その高さの縁の色（袖。半袖なら自然に肌になる）。腰より下は腰の所の色を続け、先は手
  const skin: Rgb = mean(row(0.07), row(0.11), Math.round(cx - tall * 0.025), Math.round(cx + tall * 0.025)) ?? [200, 165, 140]
  const armLen = T.armLen * (tall / h)
  const arm = new Uint8ClampedArray(T.armW * T.armH * 4)
  for (let v = 0; v < T.armH; v++) {
    const k = v / (T.armH - 1)
    const hand = k > 1 - T.hand
    const yy = clamp(Math.round(ySh + k * T.armLen * tall), y0, row(T.sleeveTo)) - y0
    const l = smoothAt(edgeL, yy)
    const rt = smoothAt(edgeR, yy)
    const sleeve: Rgb = l && rt ? mixRgb(l, rt, 0.5) : (l ?? rt ?? hair)
    const base = hand ? skin : sleeve
    // 太さ: 肩から手首へ細くなり、手先は丸める
    const tip = hand ? Math.sqrt(clamp((1 - k) / T.hand, 0, 1)) * 0.2 + 0.72 : 1
    const wideAt = lerp(1, 0.74, k) * (k < 0.06 ? 0.8 + (k / 0.06) * 0.2 : 1) * tip
    for (let u = 0; u < T.armW; u++) {
      const d = Math.abs((u + 0.5) / T.armW - 0.5) * 2
      const i = (v * T.armW + u) * 4
      const edge = 1 - T.armEdge * clamp((d / wideAt - 0.45) / 0.55, 0, 1) ** 2
      arm[i] = base[0] * edge
      arm[i + 1] = base[1] * edge
      arm[i + 2] = base[2] * edge
      arm[i + 3] = d <= wideAt ? 255 : 0
    }
  }

  // 脚の中心: 脚の高さで、体の近くにある不透明な範囲の真ん中（左右の脚の分かれ目に使う）
  let legSum = 0
  let legN = 0
  const legReach = Math.round(tall * 0.2)
  for (let y = row(0.64); y <= row(0.82); y++) {
    let a = -1
    let b = -1
    for (let x = Math.max(0, Math.round(cx) - legReach); x <= Math.min(w - 1, Math.round(cx) + legReach); x++) {
      if (!solid(x, y)) continue
      if (a < 0) a = x
      b = x
    }
    if (a < 0) continue
    legSum += (a + b + 1) / 2
    legN++
  }
  const legX = legN > 0 ? legSum / legN : cx + 0.5

  return {
    back,
    arm: { data: arm, w: T.armW, h: T.armH },
    rig: {
      centerX: (mid + 0.5) / w - 0.5,
      legX: legX / w - 0.5,
      shoulderY: 1 - ySh / h,
      shoulderHalf: shHalf / h,
      armLen,
      armWide: T.armWide * (tall / h),
    },
  }
}
