// Grand Theft Outfit [部品: onfoot] くり抜き写真を部位（頭・胴・腿・すね・腕）に切り分けた1枚の絵にする（画素の計算だけ。three/DOM なし）。
// 入口: buildPuppetAtlas(src, w, h, back) / PUPPET_CELLS / PUPPET_ATLAS
// 契約: src は正面の写真の RGBA（上の行から）。back は spriteBack.ts の結果（後ろ姿・腕の帯・体の位置）。
//       返す data は PUPPET_ATLAS 四方の RGBA で、PUPPET_CELLS の升目ごとに部位の絵が入る（すきまは隣の色で埋めて不透明）。
//       升目の横は「体の左→右」（後ろから見た向き）。正面の升目は、前から見ると写真のとおりに見える。
//       dims は部位の太さ（人の身長に対する割合）と、板の高さに対する人の身長。
import { clamp } from './math'
import { BACK_TUNING, type BackSprite } from './spriteBack'

export const PUPPET_ATLAS = 128

/** 升目 [x, y, 幅, 高さ]（画素。y は上から） */
export const PUPPET_CELLS = {
  torsoBack: [0, 0, 32, 64],
  torsoFront: [32, 0, 32, 64],
  headBack: [64, 0, 24, 32],
  headFront: [88, 0, 24, 32],
  thighL: [0, 64, 16, 32],
  shinL: [16, 64, 16, 32],
  thighR: [32, 64, 16, 32],
  shinR: [48, 64, 16, 32],
  arm: [64, 32, 16, 64],
  shoe: [80, 32, 8, 8],
  skin: [88, 32, 8, 8],
  hip: [96, 32, 8, 8],
} as const

export type PuppetCell = keyof typeof PUPPET_CELLS

/** 切り分ける高さ（頭のてっぺんから足元までを 1 とした、上からの割合） */
export const PUPPET_TUNING = {
  headTo: 0.14,
  headHalf: 0.062,
  /** 頭の切り抜き: 半幅と下端（あごの下）、てっぺんの上の余白 */
  cutHalf: 0.115,
  cutTo: 0.16,
  cutAbove: 0.02,
  torsoFrom: 0.185,
  torsoTo: 0.5,
  knee: 0.735,
  ankle: 0.955,
  /** 脚の太さ（片脚の幅の半分）の範囲 */
  legMin: 0.05,
  legMax: 0.07,
  alpha: 128,
}

export interface PuppetDims {
  /** 板の高さに対する人の身長（傘などで板のほうが高いことがある） */
  tall: number
  /** 肩の半幅・腿の半幅（人の身長に対する割合） */
  shoulderHalf: number
  legHalf: number
  /** 裾の広い服（スカート・長い上着）で、腿が左右つながっている */
  skirt: boolean
  /** 頭の切り抜き（髪・帽子の形ごと、板で見せる）。u は後ろ姿の絵での左右（板の幅に対する割合）、v は上から（板の高さに対する割合）。
   *  wide / high は大きさ、lift は肩の線から切り抜きの下端までの高さ（人の身長に対する割合） */
  head: { u0: number; u1: number; v0: number; v1: number; wide: number; high: number; lift: number }
}

export interface PuppetAtlas {
  data: Uint8ClampedArray
  dims: PuppetDims
}

type Rgb = [number, number, number]
type Pick = (x: number, y: number) => Rgb | null

/** 升目を埋める。透明な所は同じ行のいちばん近い色、行ごと空なら上の行の色 */
function fillCell(out: Uint8ClampedArray, cell: readonly number[], pick: Pick, x0: number, x1: number, y0: number, y1: number, fallback: Rgb): void {
  const [cx, cy, cw, ch] = cell
  let above: (Rgb | null)[] = []
  for (let j = 0; j < ch; j++) {
    const y = Math.round(y0 + ((j + 0.5) / ch) * (y1 - y0) - 0.5)
    const line: (Rgb | null)[] = []
    for (let i = 0; i < cw; i++) line.push(pick(Math.round(x0 + ((i + 0.5) / cw) * (x1 - x0) - 0.5), y))
    const filled = line.map((c, i) => {
      if (c) return c
      for (let d = 1; d < cw; d++) {
        const l = line[i - d]
        if (l) return l
        const r = line[i + d]
        if (r) return r
      }
      return above[i] ?? null
    })
    for (let i = 0; i < cw; i++) {
      const c = filled[i] ?? fallback
      const o = ((cy + j) * PUPPET_ATLAS + cx + i) * 4
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
      out[o + 3] = 255
    }
    above = filled
  }
}

function fillFlat(out: Uint8ClampedArray, cell: readonly number[], c: Rgb): void {
  fillCell(out, cell, () => c, 0, 1, 0, 1, c)
}

/** 正面の写真と後ろ姿から、部位ごとの絵を作る */
export function buildPuppetAtlas(src: Uint8ClampedArray, w: number, h: number, back: BackSprite): PuppetAtlas {
  const T = PUPPET_TUNING
  const A = T.alpha
  const out = new Uint8ClampedArray(PUPPET_ATLAS * PUPPET_ATLAS * 4)
  // 体の位置（画素）。後ろ姿の絵（左右を裏返した写真）の座標で考える
  const ySh = (1 - back.rig.shoulderY) * h
  const tall = Math.max(8, (h - ySh) / (1 - BACK_TUNING.shoulder))
  const top = h - tall
  const row = (k: number) => clamp(top + tall * k, 0, h - 1)
  const mid = (back.rig.centerX + 0.5) * w - 0.5
  const legX = (back.rig.legX + 0.5) * w
  const shHalf = back.rig.shoulderHalf * h

  const inside = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h
  /** 正面の写真を、後ろ姿と同じ左右（体の左が左）で読む */
  const front: Pick = (x, y) => {
    if (!inside(x, y)) return null
    const i = (y * w + (w - 1 - x)) * 4
    return src[i + 3] >= A ? [src[i], src[i + 1], src[i + 2]] : null
  }
  const rear: Pick = (x, y) => {
    if (!inside(x, y)) return null
    const i = (y * w + x) * 4
    return back.back[i + 3] >= A ? [back.back[i], back.back[i + 1], back.back[i + 2]] : null
  }
  const mean = (pick: Pick, x0: number, x1: number, y0: number, y1: number): Rgb | null => {
    const sum = [0, 0, 0]
    let n = 0
    for (let y = Math.round(y0); y <= Math.round(y1); y++) {
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        const c = pick(x, y)
        if (!c) continue
        sum[0] += c[0]
        sum[1] += c[1]
        sum[2] += c[2]
        n++
      }
    }
    return n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null
  }

  // 腕の帯はそのまま写す。手の色（肌）は帯の先から取る
  const arm = back.arm
  const armAt: Pick = (x, y) => {
    const i = (clamp(y, 0, arm.h - 1) * arm.w + clamp(x, 0, arm.w - 1)) * 4
    return arm.data[i + 3] >= A ? [arm.data[i], arm.data[i + 1], arm.data[i + 2]] : null
  }
  const skin: Rgb = mean(armAt, arm.w * 0.3, arm.w * 0.7, arm.h * 0.9, arm.h - 2) ?? [200, 165, 140]
  const body: Rgb = mean(rear, mid - shHalf * 0.5, mid + shHalf * 0.5, row(0.3), row(0.4)) ?? [120, 120, 120]
  fillCell(out, PUPPET_CELLS.arm, armAt, 0, arm.w, 0, arm.h, skin)
  fillFlat(out, PUPPET_CELLS.skin, skin)

  // 頭と胴
  const headHalf = tall * T.headHalf
  fillCell(out, PUPPET_CELLS.headBack, rear, mid - headHalf, mid + headHalf, top, row(T.headTo), body)
  fillCell(out, PUPPET_CELLS.headFront, front, mid - headHalf, mid + headHalf, top, row(T.headTo), skin)
  fillCell(out, PUPPET_CELLS.torsoBack, rear, mid - shHalf, mid + shHalf, row(T.torsoFrom), row(T.torsoTo), body)
  fillCell(out, PUPPET_CELLS.torsoFront, front, mid - shHalf, mid + shHalf, row(T.torsoFrom), row(T.torsoTo), body)

  // 脚: すねの高さで、左右それぞれの脚の幅を測る（腿の高さは、かばんや上着の裾と繋がっていて測れない）。
  // 腿の高さで股が割れていない行が多ければ、裾の広い服
  const widths: number[] = []
  const probe = tall * 0.035
  const runWidth = (x: number, y: number): number => {
    if (!front(x, y)) return 0
    let a = x
    let b = x
    while (front(a - 1, y)) a--
    while (front(b + 1, y)) b++
    return b - a + 1
  }
  for (let y = Math.round(row(0.78)); y <= Math.round(row(0.9)); y++) {
    for (const sign of [-1, 1]) {
      const wide = runWidth(Math.round(legX + sign * probe), y)
      if (wide > 0) widths.push(wide)
    }
  }
  let joined = 0
  let rows = 0
  for (let y = Math.round(row(0.58)); y <= Math.round(row(0.7)); y++) {
    rows++
    if (front(Math.round(legX), y) && front(Math.round(legX) - 1, y)) joined++
  }
  widths.sort((p, q) => p - q)
  const legHalfPx = clamp((widths[Math.floor(widths.length / 2)] ?? tall * 0.1) / 2, tall * T.legMin, tall * T.legMax)
  const legSpan = legHalfPx * 2
  const hipColor: Rgb = mean(front, legX - legSpan, legX + legSpan, row(T.torsoTo), row(T.torsoTo + 0.04)) ?? body
  fillCell(out, PUPPET_CELLS.thighL, front, legX - legSpan, legX, row(T.torsoTo), row(T.knee), hipColor)
  fillCell(out, PUPPET_CELLS.shinL, front, legX - legSpan, legX, row(T.knee), row(T.ankle), hipColor)
  fillCell(out, PUPPET_CELLS.thighR, front, legX, legX + legSpan, row(T.torsoTo), row(T.knee), hipColor)
  fillCell(out, PUPPET_CELLS.shinR, front, legX, legX + legSpan, row(T.knee), row(T.ankle), hipColor)
  fillCell(out, PUPPET_CELLS.hip, front, legX - legSpan, legX + legSpan, row(T.torsoTo), row(T.torsoTo + 0.06), hipColor)
  fillFlat(out, PUPPET_CELLS.shoe, mean(front, legX - legSpan, legX + legSpan, row(0.965), row(0.995)) ?? [40, 40, 44])

  return {
    data: out,
    dims: {
      tall: tall / h,
      shoulderHalf: shHalf / tall,
      legHalf: legHalfPx / tall,
      skirt: rows > 0 && joined / rows > 0.7,
      head: (() => {
        const x0 = clamp(mid - tall * T.cutHalf, 0, w)
        const x1 = clamp(mid + tall * T.cutHalf + 1, 0, w)
        const y0 = clamp(top - tall * T.cutAbove, 0, h)
        const y1 = row(T.cutTo)
        return { u0: x0 / w, u1: x1 / w, v0: y0 / h, v1: y1 / h, wide: (x1 - x0) / tall, high: (y1 - y0) / tall, lift: (ySh - y1) / tall }
      })(),
    },
  }
}
