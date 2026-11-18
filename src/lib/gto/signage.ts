// Grand Theft Outfit [部品: signs] 架空の店名・看板・ネオンの配置データ。
// 入口: buildSignage(world, detail) / buildNeonTubes(world, detail) / buildStorefrontShades(world) / signLook / signGain / signCell / SIGN_CELLS / NIGHT_CELLS / NEON_WORDS
// 契約: 建物の壁と道の位置から、看板をどこにどの向きで出すかを決めて Sign の配列で返す。
//       店名・広告はすべて架空（signageCatalog.ts。実在の店名・ロゴ・広告は使わない）。建物の実名（MapBuilding.name）は読まない。
//       並び: 先頭に「路面を染める主な看板」（1棟に1〜2枚）を交差点に近い順で、その後ろに袖看板などの細かい看板を近い順で置く。
//             光の部品（renderSky.ts）は先頭の quality.maxSigns 枚だけを光だまりにするので、この並びを変えない。
//       密度は渋谷の夜の写真から写した（雑居ビル1棟に袖看板 5〜10 枚・間口ごとに店の看板・屋上に広告塔）。
//       描画（renderSigns.ts）は Sign と NeonTube の配列を絵にするだけ。
import { landmarkOf } from './map'
import { clamp, dirOf, headingOf, pointInPolygon } from './math'
import { ADS, NEON_COLORS, NEON_WORDS, SHOPS, UPPER_SHOPS, type Shop } from './signageCatalog'
import type { GtoWorld, MapBuilding } from './types'

export { ADS, NEON_WORDS, SHOPS, UPPER_SHOPS }

/**
 * fascia: 店の間口の上の横長看板 / blade: 壁から突き出す縦長の袖看板 / billboard: 壁面の大きな広告 /
 * banner: 壁面の縦長の広告 / rooftop: 屋上の広告塔 / vision: 映像の流れる大型ビジョン /
 * neon: 板のない、管を曲げて書いた筆記体の文字看板（NEON_WORDS。夜は管の形で光り、壁と路面を染める）
 */
export type SignKind = 'fascia' | 'blade' | 'billboard' | 'banner' | 'rooftop' | 'vision' | 'neon'

/** 'full' は PC 向けの全部、'lite' はスマホ向け（主な看板と、駅前の袖看板だけ） */
export type SignDetail = 'full' | 'lite'

export interface Sign {
  kind: SignKind
  /** 看板の中心 */
  x: number
  y: number
  z: number
  w: number
  h: number
  /** 看板の面が向いている向き（ラジアン、北 0・時計回り） */
  heading: number
  text: string
  sub: string
  bg: string
  fg: string
  /** 縦書きにするか（袖看板） */
  vertical: boolean
  /** 自分で光るか（夜にネオンとして強く光る） */
  lit: boolean
  /** 一覧（SHOPS / UPPER_SHOPS / ADS / NEON_WORDS）の中の番号。アトラスの絵を引くのに使う */
  design: number
  /** 屋上の広告塔だけ: 脚の下端（屋根）の高さ */
  footY?: number
}

/** 建物の輪郭や軒をなぞるネオン管。水平の管は y0 = y1、縦の管は両端の x・z が同じ */
export interface NeonTube {
  x0: number
  z0: number
  x1: number
  z1: number
  y0: number
  y1: number
  /** 壁の外向き */
  nx: number
  nz: number
  color: string
  /** 看板を縁取る管（signageNeon.ts）。軒の管より細く、路面の光は看板の側で落とす */
  frame?: boolean
}

/** 配置の数字 */
export const SIGNAGE_TUNING = {
  /** 看板を出す壁の、最短の長さ m */
  minEdge: 5,
  /** 壁からこの距離までに道があれば「道に面している」 */
  roadReach: 13,
  fasciaY: 3.7,
  /** 店1軒ぶんの間口 m（建物ごとに 0.85〜1.25 倍にばらつかせる） */
  bay: 6.4,
  /** 2階の壁面看板の高さ */
  upperY: 7.1,
  bladeMinHeight: 9,
  /** これより高い建物（ガラスの高層）には袖看板を付けない */
  bladeMaxBuilding: 58,
  /** 袖看板のいちばん下 */
  bladeBase: 4.9,
  billboardMinHeight: 24,
  billboardMinEdge: 12,
  /** 軽量の配置で、主でない看板を残す範囲（交差点からの距離 m） */
  liteRadius: 240,
  /** 1つの建物で看板を付ける壁の数の上限 */
  maxFaces: 5,
  eaveY: 4.48,
  /** 筆記体のネオン文字: 付ける建物の高さの下限・看板の中心の高さ（店の看板のすぐ上、2階の壁） */
  neonMinHeight: 9.5,
  neonY: 6.9,
  /** ネオン文字の幅の上限 m と、高さ ÷ 幅 */
  neonMaxW: 8.5,
  neonAspect: 0.36,
}

/**
 * 整数の組から 0..1 の決まった数を作る。math.ts の hash は続き番号どうしが近い値になりやすく、
 * 縦に積んだ袖看板に同じ店が続いてしまうので、ここでは混ぜ方の強いものを使う。
 */
function mix(...values: number[]): number {
  let h = 0x9e3779b9
  for (const v of values) {
    h ^= Math.round(v) | 0
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h ^= h >>> 16
  }
  return (h >>> 0) / 4294967296
}

// ----------------------------------------------------------------------------
// 明るさ
// ----------------------------------------------------------------------------

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

const linearOf = (css: string) => {
  const n = Number.parseInt(css.slice(1), 16)
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)]
}
/** '#rrggbb' のいちばん明るい成分と、輝度（どちらもリニア） */
const peak = (css: string) => Math.max(...linearOf(css))
const luma = (css: string) => {
  const [r, g, b] = linearOf(css)
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

/** 昼の発光の強さ（lighting.ts の day.neon）と、夜として扱い切る強さ */
const NEON_DAY = 0.95
const NEON_NIGHT = 1.15
/** 夜、看板の地がこれを越えないようにする（越えるとブルームで白く飛んで文字が読めない） */
const BG_CAP = 0.84
/** 夜、濃い地（リニアで DARK_BG 未満）の看板の文字をここまで持ち上げる（文字だけがにじんで光る） */
const FG_NEON = 1.6
const DARK_BG = 0.06
/** 夜、文字の輝度（リニア）の上限。白に近い文字はここで止まり、色の濃い文字だけが強く光る */
const FG_LUMA = 1
/** 夜、それ以外の看板の文字の上限（ブルームのしきい値の少し上まで） */
const FG_CAP = 1.1

/**
 * 看板の絵に掛ける明るさ。neon は lighting の neon（昼 0.95・夜 1.16）。
 * 夜は「地は白飛びさせず、濃い地の文字だけをブルームに乗せる」。昼は発光させない。
 */
export function signGain(sign: Pick<Sign, 'bg' | 'fg' | 'lit'>, neon: number): number {
  const night = clamp((neon - NEON_DAY) / (NEON_NIGHT - NEON_DAY), 0, 1)
  const day = Math.min(neon, NEON_DAY)
  if (!sign.lit) return day * (1 - night * 0.62)
  const bg = Math.max(peak(sign.bg), 0.001)
  // 濃い地の看板だけ、文字をブルームに乗せる。明るい地の看板は文字も飛ばさない
  const fgCap = bg < DARK_BG ? FG_NEON : FG_CAP
  const lit = clamp(Math.min(BG_CAP / bg, fgCap / Math.max(peak(sign.fg), 0.001), FG_LUMA / Math.max(luma(sign.fg), 0.001)), 0.7, 2.6)
  return day + (lit - day) * night
}

// ----------------------------------------------------------------------------
// アトラスの絵
// ----------------------------------------------------------------------------

/** 絵の形。wide: 横長 / tall: 縦長 / mid: 短い縦長 / board: 2:1 の広告 / poster: 1:2 の広告 */
export type CellShape = 'wide' | 'tall' | 'mid' | 'board' | 'poster'

export interface SignCell {
  key: string
  shape: CellShape
  shop: Shop
  /** 絵柄の変化（枠・帯・丸など）を選ぶ番号 */
  style: number
}

/** 袖看板のうち、これより縦横比が小さいものは短い絵を使う */
const MID_RATIO = 3.1

const shapeOf = (s: Pick<Sign, 'kind' | 'w' | 'h'>): CellShape =>
  s.kind === 'fascia' ? 'wide' : s.kind === 'blade' ? (s.h / s.w < MID_RATIO ? 'mid' : 'tall') : s.kind === 'banner' ? 'poster' : 'board'

/** 看板が使うアトラスの絵の名前 */
export const signCell = (s: Pick<Sign, 'kind' | 'w' | 'h' | 'design'>): string => `${s.kind === 'neon' ? 'neon' : shapeOf(s)}:${s.design}`

const TENANTS: Shop[] = [...SHOPS, ...UPPER_SHOPS]

/** アトラスに描く絵の一覧。同じ店の看板は同じ絵を使い回す */
export const SIGN_CELLS: SignCell[] = [
  ...SHOPS.map((shop, i): SignCell => ({ key: `wide:${i}`, shape: 'wide', shop, style: i % 4 })),
  ...TENANTS.map((shop, i): SignCell => ({ key: `tall:${i}`, shape: 'tall', shop, style: i % 3 })),
  ...TENANTS.map((shop, i): SignCell => ({ key: `mid:${i}`, shape: 'mid', shop, style: i % 3 })),
  ...ADS.map((shop, i): SignCell => ({ key: `board:${i}`, shape: 'board', shop, style: i % 4 })),
  ...ADS.map((shop, i): SignCell => ({ key: `poster:${i}`, shape: 'poster', shop, style: i % 4 })),
]

/** 夜の絵の名前の頭（暗い板に、屋号を管の線で書いた絵。renderSignsNeonCells.ts が描く） */
const NIGHT_PREFIX = 'n:'

/** 夜だけ使う絵の一覧: 店の看板と袖看板を「暗い板 ＋ 管で書いた屋号」にしたもの。key は昼の絵の名前に 'n:' を付ける */
export const NIGHT_CELLS: SignCell[] = SIGN_CELLS.filter((c) => c.shape === 'wide' || c.shape === 'tall' || c.shape === 'mid').map((c) => ({ ...c, key: `${NIGHT_PREFIX}${c.key}` }))

/** 夜、管の文字の絵に掛ける明るさ（芯の白がブルームに乗る） */
const TUBE_GAIN = 1.5
/** 夜、光らない板（広告・灯の入っていない看板）の明るさの上限。街の暗い壁より少し明るい程度 */
const BOARD_NIGHT = 0.42

export interface SignLook {
  /** アトラスの絵の名前 */
  cell: string
  /** 絵に掛ける明るさ */
  gain: number
  /** 夜の絵（暗い板に管の文字）を使うか */
  tube: boolean
}

/**
 * 看板1枚の見え方。昼は印刷の看板（signCell と signGain）。
 * 夜は、灯の入った店の看板と袖看板を「暗い板に管で書いた屋号」にし、広告の板と灯の入っていない看板は暗く沈める。
 * 板そのものを光らせない（発光する色面にしない）: 光るのは管の線だけ。
 */
export function signLook(sign: Pick<Sign, 'kind' | 'w' | 'h' | 'design' | 'bg' | 'fg' | 'lit'>, neon: number): SignLook {
  const cell = signCell(sign)
  const gain = signGain(sign, neon)
  const night = clamp((neon - NEON_DAY) / (NEON_NIGHT - NEON_DAY), 0, 1)
  if (night < 0.5) return { cell, gain, tube: false }
  if (sign.lit && (sign.kind === 'fascia' || sign.kind === 'blade')) return { cell: `${NIGHT_PREFIX}${cell}`, gain: TUBE_GAIN, tube: true }
  return { cell, gain: Math.min(gain, BOARD_NIGHT), tube: false }
}

// ----------------------------------------------------------------------------
// 道に面した壁
// ----------------------------------------------------------------------------

interface Face {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
  len: number
  score: number
  /** 名前のある通りに面しているか（袖看板が多い） */
  named: boolean
}

/** 建物の壁のうち、道に面していて前が空いているものを、目立つ順に返す */
function streetFaces(world: GtoWorld, b: MapBuilding): Face[] {
  const tune = SIGNAGE_TUNING
  const pts = b.pts
  const faces: Face[] = []
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const ax = pts[j]
    const az = pts[j + 1]
    const bx = pts[i]
    const bz = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < tune.minEdge) continue
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    if (pointInPolygon(pts, mx + nx * 0.6, mz + nz * 0.6)) {
      nx = -nx
      nz = -nz
    }
    // 壁のすぐ外が別の建物なら看板は見えない
    if (world.insideBuilding(mx + nx * 2.5, mz + nz * 2.5)) continue
    const road = world.nearestRoad(mx + nx * 4, mz + nz * 4, false, tune.roadReach)
    if (!road) continue
    const named = road.name != null && road.name !== ''
    faces.push({ ax, az, bx, bz, nx, nz, len, named, score: len * (road.drive ? 1.5 : 1) * (named ? 1.4 : 1) })
  }
  return faces.sort((p, q) => q.score - p.score)
}

/** いちばん目立つ壁と、それに次ぐ壁（角を曲がった先や、裏の通りの側）を選ぶ */
function pickFaces(faces: Face[], max: number): Face[] {
  const first = faces[0]
  if (!first) return []
  return [first, ...faces.slice(1).filter((f) => f.len >= 6 && f.score >= first.score * 0.3)].slice(0, max)
}

// ----------------------------------------------------------------------------
// 配置
// ----------------------------------------------------------------------------

/** tier: 0 は主な看板、1 は軽量の配置にも残す看板、2 は PC だけの看板 */
type Ranked = Sign & { rank: number; tier: 0 | 1 | 2 }

const pick = (list: readonly Shop[], seed: number) => Math.min(list.length - 1, Math.floor(seed * list.length))

interface Lot {
  world: GtoWorld
  b: MapBuilding
  face: Face
  /** 壁の番号（0 がいちばん目立つ壁） */
  fi: number
  /** 交差点からの距離 */
  rank: number
  /** 袖看板などの密度（0..1）。駅前と名前のある通りで高い */
  dense: number
  heading: number
  /** 袖看板を積める高さの上限（建物の基準の高さから）。駅前のビジョンのビルは画面の下まで */
  bladeTop: number
}

/** 壁の足元の高さ。坂では建物の基準の高さより地面のほうが高いことがあるので、高いほうを取る */
const footOf = (lot: Lot, p: { x: number; z: number }) => Math.max(lot.b.y, lot.world.groundY(p.x, p.z))

const along = (f: Face, t: number, out: number) => ({ x: f.ax + (f.bx - f.ax) * t + f.nx * out, z: f.az + (f.bz - f.az) * t + f.nz * out })

/** 壁の番号 fi の面に、筆記体のネオン文字を出すか（建物ごとに決まる。駅前と名前のある通りで 2 棟に 1 棟ほど） */
const hasNeonWord = (lot: Lot) =>
  lot.fi === 0 && lot.b.h >= SIGNAGE_TUNING.neonMinHeight && lot.b.h <= SIGNAGE_TUNING.bladeMaxBuilding && lot.face.len >= 7 && mix(lot.b.id, 211) < 0.12 + lot.dense * 0.4

/** 筆記体のネオン文字。店の看板の上（2〜3階の壁）に、壁から少し浮かせて付ける */
function neonSigns(lot: Lot): Ranked[] {
  if (!hasNeonWord(lot)) return []
  const { b, face, rank, heading } = lot
  const tune = SIGNAGE_TUNING
  const design = Math.min(NEON_WORDS.length - 1, Math.floor(mix(b.id, 223) * NEON_WORDS.length))
  const word = NEON_WORDS[design]
  const w = Math.min(face.len * 0.78, tune.neonMaxW)
  const h = w * tune.neonAspect
  const p = along(face, 0.5, 0.22)
  const y = Math.min(footOf(lot, p) + tune.neonY, b.y + b.h - h / 2 - 0.5)
  return [
    {
      kind: 'neon',
      text: word.name,
      sub: word.sub,
      bg: word.bg,
      fg: word.fg,
      vertical: false,
      lit: true,
      design,
      ...p,
      y,
      w,
      h,
      heading,
      rank: rank + 1,
      tier: rank < tune.liteRadius ? 1 : 2,
    },
  ]
}

const signOf = (kind: SignKind, list: readonly Shop[], design: number, lit: boolean) => {
  const shop = list[design]
  return { kind, text: shop.name, sub: shop.sub, bg: shop.bg, fg: shop.fg, vertical: kind === 'blade', lit, design }
}

/** 間口ごとの店の看板と、2階の壁面看板 */
function fasciaSigns(lot: Lot, bays: number): Ranked[] {
  const { b, face, fi, rank, heading } = lot
  const tune = SIGNAGE_TUNING
  const out: Ranked[] = []
  const bayW = face.len / bays
  for (let i = 0; i < bays; i++) {
    const seed = mix(b.id, fi * 31 + i, 101)
    const w = Math.min(bayW * (0.8 + mix(b.id, i, 103) * 0.12), 9)
    const primary = fi === 0 && i === Math.floor(bays / 2)
    // 灯の入っていない看板も少し混ぜる（主な看板は必ず光る）
    const lit = primary || mix(b.id, fi + i * 7, 107) > 0.1
    const p = along(face, (i + 0.5) / bays, 0.12)
    const foot = footOf(lot, p)
    out.push({
      ...signOf('fascia', SHOPS, pick(SHOPS, seed), lit),
      ...p,
      y: foot + tune.fasciaY,
      w,
      h: clamp(w * 0.2, 0.75, 1.25),
      heading,
      rank: primary ? rank : rank + 2,
      tier: primary ? 0 : rank < tune.liteRadius ? 1 : 2,
    })
    // ネオン文字は2階の壁に付くので、そこには2階の壁面看板を出さない
    if (!hasNeonWord(lot) && b.h >= 10.5 && mix(b.id, fi * 13 + i, 109) < 0.3 + lot.dense * 0.25) {
      const uw = Math.min(bayW * 0.62, 5.2)
      out.push({
        ...signOf('fascia', SHOPS, pick(SHOPS, mix(b.id, fi * 17 + i, 113)), true),
        ...p,
        y: foot + tune.upperY,
        w: uw,
        h: clamp(uw * 0.22, 0.7, 1.1),
        heading,
        rank: rank + 3,
        tier: 2,
      })
    }
  }
  return out
}

/** 間口の境目ごとに、袖看板を縦に積む */
function bladeSigns(lot: Lot, bays: number): Ranked[] {
  const { world, b, face, fi, rank, heading, dense } = lot
  const tune = SIGNAGE_TUNING
  if (b.h < tune.bladeMinHeight || b.h > tune.bladeMaxBuilding) return []
  const out: Ranked[] = []
  const inset = Math.min(0.9 / face.len, 0.2)
  for (let c = 0; c <= bays; c++) {
    if (mix(b.id, fi * 19 + c, 127) > 0.42 + dense * 0.5) continue
    // 軽量の配置には、駅前のいちばん目立つ壁の端の1本だけを残す
    const tier = fi === 0 && rank < tune.liteRadius && c === (mix(b.id, 3) < 0.5 ? 0 : bays) ? 1 : 2
    const t = clamp(c / bays, inset, 1 - inset)
    const w = 0.78 + mix(b.id, c, 131) * 0.26
    const reach = 0.28 + w / 2
    const p = along(face, t, reach)
    // 突き出した先が隣の建物に刺さるなら付けない
    if (world.insideBuilding(p.x + face.nx * (w / 2 + 0.2), p.z + face.nz * (w / 2 + 0.2))) continue
    const top = b.y + Math.min(lot.bladeTop, tune.bladeBase + 4 + mix(b.id, fi + c * 3, 137) * (7 + dense * 13))
    let y = footOf(lot, p) + tune.bladeBase + mix(b.id, c, 139) * 0.8
    for (let k = 0; k < 8; k++) {
      // 短い看板（店の種類を書く）と長い看板（店名を書く）を混ぜる
      const seed = mix(b.id, fi * 23 + c * 11 + k, 149)
      const h = w * (seed < 0.4 ? 2.1 + seed * 1.6 : 3.6 + (seed - 0.4) * 2.4)
      if (y + h > top) break
      out.push({
        ...signOf('blade', TENANTS, pick(TENANTS, mix(b.id, fi * 29 + c * 13 + k, 151)), mix(b.id, c * 5 + k, 157) > 0.07),
        ...p,
        y: y + h / 2,
        w,
        h,
        // 袖看板は壁から突き出し、通りを歩く人のほうを向く
        heading: heading + Math.PI / 2,
        rank: rank + 5 + k * 0.01,
        tier,
      })
      y += h + 0.22
    }
  }
  return out
}

/** 壁面の大きな広告・ビジョン・縦長の広告、屋上の広告塔 */
function adSigns(lot: Lot): Ranked[] {
  const { b, face, fi, rank, heading } = lot
  const tune = SIGNAGE_TUNING
  if (fi > 0) return []
  const out: Ranked[] = []
  const ad = pick(ADS, mix(b.id, 11))
  const roll = mix(b.id, 163)
  if (b.h >= tune.billboardMinHeight && face.len >= tune.billboardMinEdge) {
    // 広い通りに面した大きな壁は、3枚に1枚を映像の流れるビジョンにする
    const kind: SignKind = roll < 0.34 ? 'vision' : 'billboard'
    const w = Math.min(face.len * 0.7, 18)
    const p = along(face, 0.5, 0.15)
    out.push({
      ...signOf(kind, ADS, ad, true),
      ...p,
      // 坂の上側では足元の地面が高いので、店の看板より上に収める
      y: Math.max(b.y + Math.min(b.h * 0.7, b.h - w * 0.3 - 1), footOf(lot, p) + 5 + w * 0.25),
      w,
      h: w * 0.5,
      heading,
      rank: rank - 20,
      tier: 0,
    })
  } else if (b.h >= 17 && face.len >= 6.5 && roll < 0.2 + lot.dense * 0.2) {
    const w = Math.min(face.len * 0.5, 4.6)
    const p = along(face, 0.5, 0.15)
    out.push({
      ...signOf('banner', ADS, ad, true),
      ...p,
      y: Math.max(b.y + b.h - w - 1.6, footOf(lot, p) + 5 + w),
      w,
      h: w * 2,
      heading,
      rank: rank + 4,
      tier: 2,
    })
  }
  // 屋上の広告塔。描画側は建物を割って背を伸ばすことがある（最大 1.32 倍）ので、その上に脚で持ち上げる
  if (b.h >= 11 && b.h <= 46 && face.len >= 8 && mix(b.id, 167) < 0.16 + lot.dense * 0.3) {
    const w = Math.min(face.len * 0.72, 11)
    const h = w * 0.5
    const roof = b.y + b.h
    const foot = b.h >= 9 && b.h < 50 ? b.y + b.h * 1.32 : roof
    out.push({
      ...signOf('rooftop', ADS, pick(ADS, mix(b.id, 173)), true),
      // 屋上の縁から少し内側に立てる
      ...along(face, 0.5, 0.2),
      y: foot + 0.9 + h / 2,
      w,
      h,
      heading,
      footY: roof,
      rank: rank + 4,
      tier: mix(b.id, 167) < 0.1 ? 1 : 2,
    })
  }
  return out
}

/** 1つの建物に付ける看板 */
function buildingSigns(world: GtoWorld, b: MapBuilding): Ranked[] {
  const tune = SIGNAGE_TUNING
  const landmark = landmarkOf(b)
  const homes = b.use === 'apartments' || b.use === 'residential'
  const faces = pickFaces(streetFaces(world, b), tune.maxFaces)
  return faces.flatMap((face, fi) => {
    const rank = Math.hypot((face.ax + face.bx) / 2, (face.az + face.bz) / 2)
    // 駅前（300m 以内）と名前のある通りは看板が多く、外れと住宅は少ない
    const dense = clamp((face.named ? 0.62 : 0.3) + (rank < 300 ? 0.38 : rank < 420 ? 0.12 : 0) - (homes ? 0.4 : 0), 0, 1)
    const lot: Lot = { world, b, face, fi, rank, dense, heading: headingOf(face.nx, face.nz), bladeTop: landmark === 'vision' ? b.h * 0.45 - 0.6 : b.h - 0.9 }
    const bayW = tune.bay * (0.85 + mix(b.id, fi, 41) * 0.4)
    const bays = Math.max(1, Math.round(face.len / bayW))
    // 目印の建物は街の部品が外装を作る。ビジョンのビルは画面の下に袖看板まで、ほかは足元の店の看板だけにする
    if (landmark === 'vision') return [...fasciaSigns(lot, bays).filter((s) => s.y < b.y + tune.upperY - 1), ...bladeSigns(lot, bays)]
    if (landmark) return fasciaSigns(lot, bays).filter((s) => s.y < b.y + tune.upperY - 1)
    const neon = neonSigns(lot)
    // ネオン文字を付けた壁には、重なる看板（坂で持ち上がった2階の看板・縦長の広告）を出さない
    const clear = (s: Ranked) => neon.every((o) => Math.hypot(s.x - o.x, s.z - o.z) >= (s.w + o.w) / 2 || Math.abs(s.y - o.y) >= (s.h + o.h) / 2 + 0.2)
    return [...fasciaSigns(lot, bays).filter(clear), ...bladeSigns(lot, bays), ...adSigns(lot).filter(clear), ...neon]
  })
}

const isSignable = (world: GtoWorld, b: MapBuilding, bi: number) => !(b.roof || b.part || world.passUnder[bi] || (b.minH ?? 0) > 0 || b.h < 6)

const signCache = new WeakMap<GtoWorld, Partial<Record<SignDetail, Sign[]>>>()

/**
 * 世界の建物の壁に、架空の看板を割り振る。
 * 先頭に主な看板（交差点に近い順）、その後ろに細かい看板（交差点に近い順）。同じ世界なら同じ配列を返す。
 */
export function buildSignage(world: GtoWorld, detail: SignDetail = 'full'): Sign[] {
  const cached = signCache.get(world)?.[detail]
  if (cached) return cached
  const maxTier = detail === 'full' ? 2 : 1
  const all = world.map.buildings
    .flatMap((b, bi) => (isSignable(world, b, bi) ? buildingSigns(world, b) : []))
    .filter((s) => s.tier <= maxTier && !world.insideBuilding(s.x, s.z))
  const byRank = (p: Ranked, q: Ranked) => p.rank - q.rank
  const signs = [...all.filter((s) => s.tier === 0).sort(byRank), ...all.filter((s) => s.tier > 0).sort(byRank)].map(
    ({ rank: _rank, tier: _tier, ...sign }): Sign => sign,
  )
  signCache.set(world, { ...signCache.get(world), [detail]: signs })
  return signs
}

/** 袖看板が付いている壁の外向き（袖看板の面は壁と直角なので、向きを 90 度戻す） */
export const wallNormalOf = (s: Pick<Sign, 'kind' | 'heading'>) => dirOf(s.kind === 'blade' ? s.heading - Math.PI / 2 : s.heading)

// ----------------------------------------------------------------------------
// ネオン管
// ----------------------------------------------------------------------------

/**
 * 軒と建物の角をなぞるネオン管。色は少なく（桃と薄緑が主）、1つの建物に2色まで。
 * 夜でも建物の形が読めるように、軒の水平の管を主に、角の縦の管と屋上の縁の管を少し足す。
 */
export function buildNeonTubes(world: GtoWorld, detail: SignDetail = 'full'): NeonTube[] {
  const tune = SIGNAGE_TUNING
  const tubes: NeonTube[] = []
  world.map.buildings.forEach((b, bi) => {
    if (!isSignable(world, b, bi) || landmarkOf(b) != null || b.use === 'apartments' || b.use === 'residential') return
    const face = streetFaces(world, b)[0]
    if (!face) return
    const rank = Math.hypot((face.ax + face.bx) / 2, (face.az + face.bz) / 2)
    // 駅前の名前のある通りでは、ほぼ2棟に1棟の軒に管が走る
    const chance = (face.named ? 0.4 : 0.24) + (rank < 300 ? 0.16 : 0)
    if (mix(b.id, 181) > (detail === 'full' ? chance : chance * 0.4)) return
    const color = NEON_COLORS[Math.floor(mix(b.id, 191) * NEON_COLORS.length)]
    const second = NEON_COLORS[Math.floor(mix(b.id, 193) * NEON_COLORS.length)]
    const off = 0.2
    const a = along(face, 0.03, off)
    const c = along(face, 0.97, off)
    const base = { nx: face.nx, nz: face.nz }
    const mid = along(face, 0.5, off + 0.5)
    if (world.insideBuilding(a.x, a.z) || world.insideBuilding(c.x, c.z) || world.insideBuilding(mid.x, mid.z)) return
    tubes.push({ ...base, x0: a.x, z0: a.z, x1: c.x, z1: c.z, y0: b.y + tune.eaveY, y1: b.y + tune.eaveY, color })
    if (detail !== 'full' || b.h > 40) return
    // 屋上の縁
    if (mix(b.id, 197) < 0.3) tubes.push({ ...base, x0: a.x, z0: a.z, x1: c.x, z1: c.z, y0: b.y + b.h - 0.25, y1: b.y + b.h - 0.25, color: second })
    // 建物の角の縦の管
    if (b.h >= 10 && mix(b.id, 199) < 0.3) {
      for (const p of [a, c]) tubes.push({ ...base, x0: p.x, z0: p.z, x1: p.x, z1: p.z, y0: b.y + tune.eaveY, y1: b.y + b.h - 0.25, color: second })
    }
  })
  return tubes
}

// ----------------------------------------------------------------------------
// 店先の陰
// ----------------------------------------------------------------------------

/** 看板を出した壁の1階ぶん（店先）。夜、ここを暗く落として、管の光が落ちる下地にする */
export interface StorefrontShade {
  ax: number
  az: number
  bx: number
  bz: number
  /** 壁の外向き */
  nx: number
  nz: number
  /** 両端の足元の高さ（坂では違う） */
  ya: number
  yb: number
  /** 足元から軒（店の看板の上）までの高さ */
  h: number
}

const shadeCache = new WeakMap<GtoWorld, StorefrontShade[]>()

/**
 * 看板を出す壁（buildSignage が店の看板を並べる壁と同じ選び方）の店先を返す。
 * 夜の店先は閉めたシャッターで、自分では光らない。明るい色面のままだと管の線が沈むので、描画はここを暗く落とす。
 */
export function buildStorefrontShades(world: GtoWorld): StorefrontShade[] {
  const cached = shadeCache.get(world)
  if (cached) return cached
  const tune = SIGNAGE_TUNING
  const shades = world.map.buildings.flatMap((b, bi) => {
    if (!isSignable(world, b, bi)) return []
    return pickFaces(streetFaces(world, b), tune.maxFaces).map((f): StorefrontShade => {
      // 坂では足元の高さが両端で違うので、両端それぞれの足元から軒までを覆う
      const ya = Math.max(b.y, world.groundY(f.ax + f.nx * 0.12, f.az + f.nz * 0.12))
      const yb = Math.max(b.y, world.groundY(f.bx + f.nx * 0.12, f.bz + f.nz * 0.12))
      return { ax: f.ax, az: f.az, bx: f.bx, bz: f.bz, nx: f.nx, nz: f.nz, ya, yb, h: Math.min(tune.eaveY, b.h) }
    })
  })
  shadeCache.set(world, shades)
  return shades
}
