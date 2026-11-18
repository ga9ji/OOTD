// Grand Theft Outfit [部品: city] 宮益坂下から南を見たときの手前の層。three には触れない。
// 入口: FRONT_LANE / frontBuses(world) / HOARDINGS / CURB_FENCES / EAST_CROSSWALKS / EAST_SIGNALS
// 契約: 現地写真 viaduct_01・miyamasuzaka_06/08: 足元に横断歩道、渡った先に信号柱と白いパイプ柵、そのすぐ奥の車路を
//       路線バスが 1 列で前へ詰めて走っている（信号待ちの車列）。右手は白い仮囲い。橋はその 40m 奥。
//       第16ラウンドの練習判定: 車路の両脇に 2 列＋上屋の島＋橋の手前に櫛形のバスを置くと「西口のバスターミナル」と読まれた。
//       バスは車路の片側に 1 列だけ、上屋と島は置かない。手前は横断歩道と信号柱（交差点だと読める決め手）。
//       どれも当たり判定を持たない飾り。会社名・行き先・ロゴは持たない。
import { BUS_BODY, type ApronStroke, type ParkedBus } from './mapEast'
import { nearPhotoStand } from './mapPhoto'
import { headingOf } from './math'
import type { Flat, GtoWorld } from './types'

/**
 * 乗り場の入口の車路（OSM の構内道路）と、その両脇のバスの列。
 * off = 車路の中心線からの離れ m（負 = 北の歩道側、正 = 南の乗り場側）、start = 列の先頭の道のり m。
 * cross = 車路を渡る横断歩道の道のりの範囲（ここにはバスを置かない）。
 */
export const FRONT_LANE = {
  line: [122, 27, 151, 17, 168, 11] as Flat,
  // 先頭は車路の起点より手前（西）から。横断歩道の西に 2 台、東に 1 台が同じ筋に連なる
  // 第16ラウンドの本番の外れ（開けた路面の先にバスが横一列 → 西口のバスターミナルと読まれた）: 列は置かない
  rows: [] as { off: number; start: number }[],
  /** 車間 m。信号待ちの列の詰まり方（viaduct_01） */
  gap: 2.6,
  /** 1 台ごとの向きのばらつき（ラジアン）。まっすぐ一列に連なると電車の編成に見えるので、ほんの少しだけ振る */
  yaw: 0.03,
  cross: [23.6, 30.4] as [number, number],
} as const

/** 写真の立ち位置からこの距離 m 以内には車体も上屋も置かない */
export const STAND_CLEAR = 6.5

export interface FrontBus extends ParkedBus {
  /** 何列目か（0 = 北） */
  row: number
}

/** 折れ線の道のり s の点と、そこでの向き */
function along(line: Flat, s: number): { x: number; z: number; ux: number; uz: number } | null {
  let left = s
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2]
    const az = line[i - 1]
    const len = Math.hypot(line[i] - ax, line[i + 1] - az)
    if (left <= len || i === line.length - 2) {
      if (left > len) return null
      const ux = (line[i] - ax) / len
      const uz = (line[i + 1] - az) / len
      return { x: ax + ux * left, z: az + uz * left, ux, uz }
    }
    left -= len
  }
  return null
}

/** 長さ len の物を道のり s・離れ off に置けるか（建物と車道に掛からない）。置ければその中心 */
function slot(world: GtoWorld, s: number, off: number, len: number, clear: number) {
  const p = along(FRONT_LANE.line, s)
  if (!p) return null
  const x = p.x - p.uz * off
  const z = p.z + p.ux * off
  for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const px = x + p.ux * len * t
    const pz = z + p.uz * len * t
    // 写真の立ち位置（広場から宮益坂下の街区を見る所）の目の前は空ける
    if (world.insideBuilding(px, pz) || nearPhotoStand(px, pz, STAND_CLEAR)) return null
    const road = world.nearestRoad(px, pz, true, 20)
    if (road && road.dist <= world.map.roads[road.road].width / 2 + clear) return null
  }
  return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: headingOf(p.ux, p.uz) }
}

/** 道のり s0..s1 が横断歩道に掛かるか */
const onCross = (s0: number, s1: number) => s1 > FRONT_LANE.cross[0] && s0 < FRONT_LANE.cross[1]

/** 入口の車路の両脇に連なる路線バス。列ごとに先頭から詰めて置き、置けない所（横断歩道・車道の近く）は 1m ずつ送る */
export function frontBuses(world: GtoWorld): FrontBus[] {
  const L = BUS_BODY.length
  const out: FrontBus[] = []
  FRONT_LANE.rows.forEach((row, ri) => {
    let s = row.start + L / 2
    for (let guard = 0; guard < 80; guard++) {
      const p = onCross(s - L / 2, s + L / 2) ? null : slot(world, s, row.off, L, BUS_BODY.width / 2 + 0.15)
      if (!p) {
        s += 1
        continue
      }
      out.push({ ...p, heading: p.heading + (out.length % 2 === 0 ? 1 : -1) * FRONT_LANE.yaw, livery: (out.length + ri) % 3 === 0 ? 1 : 0, row: ri })
      s += L + FRONT_LANE.gap
    }
  })
  return out
}

/** 塀や柵の 1 区間 [ax, az, bx, bz] */
export type Segment = [number, number, number, number]

/** 工事の白い仮囲い（viaduct_01 の右手前。歩道の南の縁に沿う）。歩道の分かれ道の口は空ける。高さは HOARDING_H */
// 東口の広場から坂上を見る立ち位置（miyamasuzaka_01/02）の目の前には立てない（写真は車道と横断歩道まで開けている）
export const HOARDINGS: Segment[] = [[115.5, 13.3, 111.5, 13.5]]
export const HOARDING_H = 2.3

/** 車道との境の白いパイプ柵（横断歩道の両脇）。高さ 0.85m */
export const CURB_FENCES: Segment[] = [
  [121, 6, 125.6, 5.6],
  [134.2, 4.8, 139.4, 4.3],
  [147.6, 3.4, 156.5, 2.4],
]

/**
 * 宮益坂下とガードの間で通りを渡る横断歩道（地図の信号の停止位置 [130.7, -2] の所。viaduct_01・miyamasuzaka_08 の足元の縞）。
 * 飾りの縞だけで、車と人の動きには関わらない。CURB_FENCES と緑の柵（mapVista.ts の fenceSkip）はこの口を空ける
 */
export const EAST_CROSSWALKS: ApronStroke[] = [{ line: [129.5, -8.4, 130.5, 4.6], width: 5.5 }]

/**
 * 横断歩道の向こう岸と手前に立つ信号柱 [x, z, 腕の向き（度）]。写真の立ち位置のすぐ脇にも立てる
 * （map.ts の streetProps は立ち位置のまわりを空けるので、ここの柱は別に足す）。
 * viaduct_01: 画面の中央左に、橋の手前を縦に切る信号柱と歩行者用の赤い灯
 */
export const EAST_SIGNALS: [x: number, z: number, headingDeg: number][] = [
  [125.6, 5.7, 5],
  [134, -8.9, 185],
]
