// Grand Theft Outfit [部品: city] 東口（宮益坂下から南を見た眺め）の決まりごと。three には触れない。
// 入口: towerNorthFace(pts) / SITE_FRAMES + siteColumns(world, frame) / parkedBuses(world) / EAST_BRIDGE
// 契約: 現地写真（miyamasuzaka_06/08、towers_15/17）から、形と位置と高さ関係だけを起こす。名前・ロゴ・広告は持たない。
//       ここで足す物（工事中の躯体・バス乗り場の上屋）は当たり判定を持たないので、
//       足元は細い柱だけにして、人と車が通れる高さを空ける。
import { EAST_BRIDGE } from './mapBridge'
import { headingOf, pointInPolygon } from './math'
import type { Flat, GtoWorld } from './types'

export { EAST_BRIDGE }

/** 塔の北の面。a が東の端、b が西の端、n は外向き */
export interface TowerFace {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
}

/**
 * 塔の輪郭から、いちばん北を向いた面を探す。大型ビジョンと裾はこの面に載る。
 * 現地写真では東の端が左に見えるので、a を東の端にそろえる。
 */
export function towerNorthFace(pts: Flat): TowerFace | null {
  const n = pts.length / 2
  if (n < 3) return null
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2] / n
    cz += pts[i * 2 + 1] / n
  }
  let best: TowerFace | null = null
  let score = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const len = Math.hypot(pts[i * 2] - pts[j * 2], pts[i * 2 + 1] - pts[j * 2 + 1])
    if (len < 8) continue
    let nx = (pts[i * 2 + 1] - pts[j * 2 + 1]) / len
    let nz = -(pts[i * 2] - pts[j * 2]) / len
    if (nx * ((pts[i * 2] + pts[j * 2]) / 2 - cx) + nz * ((pts[i * 2 + 1] + pts[j * 2 + 1]) / 2 - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    // 北向きで、長い辺ほどよい
    if (-nz * len <= score || nz > -0.5) continue
    score = -nz * len
    const east = pts[j * 2] > pts[i * 2] ? j : i
    const west = east === j ? i : j
    best = { ax: pts[east * 2], az: pts[east * 2 + 1], bx: pts[west * 2], bz: pts[west * 2 + 1], nx, nz }
  }
  return best
}

/**
 * 塔の北の面の寸法（地表からの m と、面に沿った割合。0 = 東の端、1 = 西の端）。
 * miyamasuzaka_08・towers_16・viaduct_01 から起こした。
 * 低層部は、ガラスの曲面が左右から裾広がりに張り出し、その切れ込みの奥の壁に大型ビジョンがはまる。
 */
export const EAST_TOWER = {
  /** 大型ビジョン。壁のすぐ表（off m）に張る横長の面。下の両隅は裾に隠れ、見える形は下すぼまりになる。tile = 映像の絵（4 = 赤地） */
  screen: { t0: 0.02, t1: 0.8, y0: 15, y1: 46, off: 0.4, tile: 4 },
  /**
   * 西の大きな裾。足元では面の 3/4 まで広がってビジョンの右下に被さり、
   * 上へ行くほど西の角へ寄って細くなる（内側の縁は下ほど寝て、上ほど立つ）。頂部は幅 tip の水平な切り口。
   */
  finWest: { height: 80, spread: 0.68, tip: 0.07, power: 1.6, out: 13 },
  /** 東の小さな裾。東の角を頂点にした三角で、ビジョンの左下に被さる。頂点はビジョンの上端より低い */
  finEast: { height: 39, spread: 0.42, tip: 0, power: 1, out: 7 },
  /** 裾の面が壁からいちばん近づく所の離れ m（ビジョンより必ず手前） */
  finGap: 1.2,
  /** 足元の暗い層の高さ m（橋の桁下と同じくらい） */
  footH: 5.6,
  /** 裾の横の目地の間隔 m（銀色の細い帯と、間のガラス） */
  band: 3.2,
  /** ガラスの壁を一周する白い横の帯の高さ（地表から m）。遠くの通りから見ても無地の箱にならず、階の重なったガラスの塔に見える（center-gai_11） */
  bands: [74, 98, 120, 142, 164, 186, 208],
} as const

export interface FinSpec {
  /** 頂部の高さ（地表から m） */
  height: number
  /** 足元で広がる幅（割合） */
  spread: number
  /** 頂部の切り口の幅（割合） */
  tip: number
  /** 縁の曲がり具合（1 = まっすぐ、大きいほど下で寝る） */
  power: number
  /** 足元で外へ張り出す量 m */
  out: number
}

/** 裾が面に沿って占める幅（割合）。k は裾の高さに対する割合（0 = 足元、1 = 頂部） */
export function finWidth(spec: FinSpec, k: number): number {
  const c = Math.min(1, Math.max(0, k))
  return spec.tip + spec.spread * (1 - c) ** spec.power
}

/** 裾の面が壁から張り出す量 m。足元でいちばん大きく、上へ行くほど壁に寄る（裾広がりの曲面） */
export function finOffset(spec: FinSpec, k: number): number {
  const c = Math.min(1, Math.max(0, k))
  return EAST_TOWER.finGap + spec.out * (1 - c) ** 2
}

/** 地表から y m の高さで、ビジョンのうち裾に隠れず見えている範囲 [東の端, 西の端]（割合）。見えなければ null */
export function screenVisibleSpan(y: number): [number, number] | null {
  const { screen, finWest, finEast } = EAST_TOWER
  if (y < screen.y0 || y > screen.y1) return null
  const east = y < finEast.height ? finWidth(finEast, y / finEast.height) : 0
  const west = y < finWest.height ? 1 - finWidth(finWest, y / finWest.height) : 1
  const t0 = Math.max(screen.t0, east)
  const t1 = Math.min(screen.t1, west)
  return t1 > t0 ? [t0, t1] : null
}

/** 工事中の躯体。柱と床だけの骨組みで、上の段は養生の幕で覆う */
export interface SiteFrame {
  pts: Flat
  /** 床の高さ（地表から m）。いちばん下は人と車が通れる高さより上 */
  floors: number[]
  /** この高さより上は白い養生の幕で囲う */
  sheetFrom: number
  /** 幕の高さ m（低ければ柵） */
  sheetH: number
  /** 柱の間隔 m */
  grid: number
}

/**
 * 橋の西の端と JR の高架の間（towers_17 の中央、viaduct_01 の右端）。
 * 細い柱に載った白い薄い床が 1 段だけ。橋の腰より低く、上は低い柵。橋の丸い端がその上に見える。
 */
// 西の縁は高架から 10m 手前で止める（宮益坂下の北の歩道から見て、床の板が高架の上の電車を隠さない）
export const SITE_FRAMES: SiteFrame[] = [{ pts: [106.5, 23.7, 117, 20, 124, 46, 113.5, 49.2], floors: [4.6], sheetFrom: 4.6, sheetH: 1.3, grid: 8.5 }]

/** 躯体の柱の位置。輪郭の中に格子で並べ、車道と建物に掛かる所は抜く */
export function siteColumns(world: GtoWorld, frame: SiteFrame): [number, number][] {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < frame.pts.length; i += 2) {
    minX = Math.min(minX, frame.pts[i])
    maxX = Math.max(maxX, frame.pts[i])
    minZ = Math.min(minZ, frame.pts[i + 1])
    maxZ = Math.max(maxZ, frame.pts[i + 1])
  }
  const out: [number, number][] = []
  for (let x = minX + 1.5; x <= maxX; x += frame.grid) {
    for (let z = minZ + 1.5; z <= maxZ; z += frame.grid) {
      if (!pointInPolygon(frame.pts, x, z) || world.insideBuilding(x, z)) continue
      const road = world.nearestRoad(x, z, true, 20)
      if (road && road.dist <= world.map.roads[road.road].width / 2 + 0.5) continue
      out.push([x, z])
    }
  }
  return out
}

/** 東口の橋の北側（地図では構内道路の広場）。橋と平行な向きの基準線 */
const BUS_PLAZA = { ax: 121, az: 53, bx: 172, bz: 35.5 }

/** 路面に敷く帯 1 本（折れ線の中心線と幅 m） */
export interface ApronStroke {
  line: Flat
  width: number
}

/**
 * 東口のバス乗り場の路面（miyamasuzaka_08、viaduct_01）。橋の手前から桁下まで一面のアスファルトで、
 * バスと車が橋の下を抜けていく。地図の細い構内道路だけでは歩道の色のままなので、帯を重ねて敷く。
 * lanes = アスファルトの帯、crosswalk = 入口の車路を渡る横断歩道（写真の手前の縞）。
 */
export const BUS_APRON: { lanes: ApronStroke[]; crosswalk: ApronStroke } = {
  lanes: [
    // 明治通りからの入口の車路
    { line: [122, 28, 151, 17, 170, 10], width: 11 },
    // 西の端を南へ回る車路
    { line: [123, 29, 134, 60, 140, 80], width: 9 },
    // 橋の真下
    { line: [124, 72, 208, 42], width: 24 },
    // 橋の手前の広い車路
    { line: [128, 36, 167, 22], width: 22 },
    // 塔の足元を東へ抜ける車路
    { line: [140, 80, 167, 70, 183, 94], width: 8 },
  ],
  crosswalk: { line: [145.2, 12.6, 149, 24.4], width: 5 },
}

/** 乗り場に停まっている路線バス 1 台（当たり判定は持たない飾り） */
export interface ParkedBus {
  x: number
  z: number
  /** 車体の長手の向き（ラジアン） */
  heading: number
  /** 塗り分けの番号（0 = 緑の帯、1 = 橙の帯） */
  livery: number
}

/** 橋の手前に停めておくバスの道のり（基準線の西の端から m）。空 = 置かない */
export const PARKED_BUS_SLOTS: number[] = []

/** 路線バスの寸法 m */
export const BUS_BODY = { length: 10.6, width: 2.5, height: 3.05 } as const

/**
 * 橋の下の車路を走っている路線バス（viaduct_01・towers_03: 橋の下の通りを 1〜2 台が抜けていく）。
 * 第16ラウンドの練習判定: 橋の手前に櫛形に何台も並べると「駅前のバスターミナル」と読まれたので、
 * 並べずに、橋と平行な車路の上に間を空けて 2 台だけ置く。上屋と乗り場の島は置かない。
 */
export function parkedBuses(world: GtoWorld): ParkedBus[] {
  const { ax, az, bx, bz } = BUS_PLAZA
  const total = Math.hypot(bx - ax, bz - az)
  const ux = (bx - ax) / total
  const uz = (bz - az) / total
  const L = BUS_BODY.length
  const out: ParkedBus[] = []
  // 橋の北の縁から 12m 手前の筋。s = 基準線の西の端からの道のり
  // 第17ラウンド: 橋と平行に置いた車体は「駅舎の前に横一列のバス」に見えるので、1 台も置かない（走る車とバスは交通の部品が出す）
  for (const s of PARKED_BUS_SLOTS) {
    const x = ax + ux * s + uz * 12
    const z = az + uz * s - ux * 12
    if (![-0.5, 0, 0.5].every((t) => !world.insideBuilding(x + ux * L * t, z + uz * L * t))) continue
    out.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: headingOf(ux, uz), livery: out.length % 2 })
  }
  return out
}

/** JR の高架の東の面 1 区間。a → b は北から南、(nx, nz) は外（東）向き */
export interface EastEdge {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
}

/**
 * 東口から見える JR の高架（工事中）。miyamasuzaka_07 の右手前・towers_17 の右:
 * 下は白い仮囲い、その上に電車の載る床、電車の上を白い鉄骨の桁が覆う。
 * hoard = 仮囲いの上端、rail = 電車の床、girder0..girder1 = 上の桁、out = 床と桁が壁から張り出す量（すべて m）。
 * その上は工事中の躯体が 2 層ぶん立ち上がる（miyamasuzaka_06/07 の右端: 白い柱と梁の骨組み、床の縁の白い板、頂部に足場の手すり）。
 * deck2 = 2 層めの床の上端、top = 頂部の床の上端、back = 上の層の奥行き（壁から内へ）、bay = 柱の間隔。
 * upperZ = 上の層を建てる範囲の北の端（これより北は桁まで。宮益坂の下から西を見たとき、ガードの真上の細い高層棟を隠さない: miyamasuzaka_04/05、viaduct_10）。
 */
export const JR_EAST = { hoard: 6.1, rail: 6.5, girder0: 10.9, girder1: 12.8, out: 3.3, post: 6.5, zMax: 75, xMin: 75, deck2: 19.6, top: 26.4, back: 7, bay: 6.5, upperZ: 44 } as const

/** 東の面の 1 辺のうち、上の層（工事中の躯体）を建てる範囲。辺の a からの道のり [t0, t1]。建てない辺は null */
export function jrUpperSpan(e: EastEdge): [number, number] | null {
  const len = Math.hypot(e.bx - e.ax, e.bz - e.az)
  if (e.bz <= JR_EAST.upperZ || len < 1) return null
  const t0 = e.az >= JR_EAST.upperZ ? 0 : ((JR_EAST.upperZ - e.az) / (e.bz - e.az)) * len
  return len - t0 < JR_EAST.bay ? null : [t0, len]
}

/** 駅舎の輪郭から、東を向いた辺（宮益坂下の広場に面した側）だけを北から順に取り出す */
export function jrEastEdges(pts: Flat): EastEdge[] {
  const n = pts.length / 2
  let area = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) area += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1]
  const sign = area >= 0 ? 1 : -1
  const out: EastEdge[] = []
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = pts[j * 2]
    const az = pts[j * 2 + 1]
    const bx = pts[i * 2]
    const bz = pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 2 || Math.max(az, bz) > JR_EAST.zMax || Math.min(ax, bx) < JR_EAST.xMin) continue
    const nx = ((bz - az) / len) * sign
    const nz = (-(bx - ax) / len) * sign
    if (nx < 0.7) continue
    out.push(az <= bz ? { ax, az, bx, bz, nx, nz } : { ax: bx, az: bz, bx: ax, bz: az, nx, nz })
  }
  return out.sort((p, q) => p.az - q.az)
}

/**
 * 宮益坂下の北、明治通りの西の歩道から南を見たときの手前の物（towers_16）。
 * 右に映画館のビルの丸い角（白いパネルの帯とガラスの帯が交互に巻く）と、その前に立つ縦長のテナント案内塔、
 * 左に地下への出入口のガラスの囲い。奥の橋と塔はこの間から見える。どれも飾りで当たり判定は持たない。
 * 案内塔の札は色面だけ（店名・ロゴは描かない）。panels は上から [色, 高さ m]
 */
export const NORTH_PLAZA = {
  building: 120105804,
  round: { x: 142.9, z: -45.9, r: 3.3, top: 34, band: 1.3, glass: 2.5, shop: 4.4 },
  pylon: {
    // 第17ラウンド: 隙間の立ち位置から見て塔の西の裾を隠さないよう、丸い角の足元へ寄せた（右 20 度）
    // 練習判定 1 回目の外れ（towers_15）: 写真の案内塔は歩道の中ほどに立ち、塔の西の裾のすぐ右（右 6 度前後）に来る。
    // 右 20 度だと白い円柱と重なって 1 本の柱に見えたので、丸い角から 2.5m 離して通りの側へ出す
    x: 147.3,
    z: -42.2,
    w: 1.25,
    d: 0.42,
    h: 7.6,
    foot: 0.5,
    panels: [
      [0x17181a, 1.25],
      [0x7fc7bd, 0.6],
      [0xf4f4f1, 0.6],
      [0xf4f4f1, 0.6],
      [0x17181a, 0.65],
      [0xf4f4f1, 0.6],
      [0xd8262c, 0.6],
      [0x17181a, 0.6],
      [0xd8262c, 0.9],
    ] as [number, number][],
  },
  // 庇を支える白い円柱 [x, z, 半径]。東の壁の前（立ち位置から右 22 度・6m 先。右 30 度だと店の印を隠す）
  columns: [[146.3, -46.6, 0.45]] as [number, number, number][],
  // 東の壁に沿った庇（a → b は北から南、out = 壁からの出 m）。高さは round.shop
  canopy: { ax: 144.5, az: -64, bx: 145.2, bz: -44.6, out: 2.0 },
  // 庇の下の壁の、赤い箱の看板（東の壁の面。y0..y1 は地表から m、half は壁に沿った半幅）
  // 第17ラウンド: 立体の印（mark）を隙間の立ち位置から隠さないよう、北へ 2.1m 寄せた（茶色い板壁は印の後ろまで届く）
  sign: { x: 145.2, z: -49.3, y0: 2.5, y1: 3.6, half: 0.9 },
  // 壁から通りへ突き出す店の立体の印（towers_15 の右: 白い円柱のすぐ右、目の高さより上）。赤い台に黄色い太鼓形の行灯（架空の店。字もロゴも描かない）。
  // (x, z) = 印の中心、reach = 壁に直角な向きの半幅、depth = 壁に沿った半幅、y0 = 台の下端、base = 台の厚み、r と y1 = 行灯の半径と上端（地表から m）
  mark: { x: 145.55, z: -47.25, reach: 0.5, depth: 0.2, y0: 2.6, base: 0.4, r: 0.4, y1: 3.75 },
  // OSM の屋根（355252207）の輪郭に合わせる。base = 白いタイルの腰壁、その上は透明なガラス（北が高い片流れ）、bay = 方立ての間隔
  kiosk: { x0: 150.4, x1: 152.1, z0: -55.7, z1: -44.5, hNorth: 5.4, hSouth: 3.9, base: 0.9, bay: 2.8 },
} as const
