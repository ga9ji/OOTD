// Grand Theft Outfit [部品: city] 通りの壁（看板ビルの谷間）の決まりごと。three には触れない。
// 入口: wallAds(buildings, roads, skip) / MAIN_STREETS
// 契約: 現地写真（109_09 / 109_10 / scramble_08 / center-gai_11 / miyamasuzaka_13）で、主な通りに面した壁の
//       上の階に大きな広告面が 1 棟に 1〜2 枚載っている並びを、位置と大きさだけ起こす。絵柄は架空（renderCityBoards）。
import { hash } from './math'
import type { MapBuilding, MapRoad } from './types'

/** 広告面を付ける通り（実名）。括弧書きの付いた名前は括弧の前で比べる */
export const MAIN_STREETS = new Set(['道玄坂', '文化村通り', '井ノ頭通り', '神宮通り', '明治通り', '宮益坂', '公園通り', '渋谷センター街', '青山通り', '旧大山街道', '宇田川通り', '渋谷中央通り'])

/** 広告面の絵の種類の数（renderCityBoards の壁面用の絵） */
export const WALL_AD_ARTS = 12

export interface WallAd {
  /** 載せる建物の id */
  building: number
  /** 板の中心（壁の線の上） */
  x: number
  z: number
  /** 壁の外向きの法線 */
  nx: number
  nz: number
  w: number
  h: number
  /** 建物の足元から板の下端までの高さ m */
  y0: number
  art: number
}

/** 車道の縁から壁までの距離がこれ以内なら「通りに面している」 */
const REACH = 17
const MIN_HEIGHT = 14
const MIN_EDGE = 5
/** 店先の帯と 2 階の看板の上から始める */
const CLEAR_BELOW = 6.5

/** 点から線分へのいちばん近い点 */
function nearestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number, number] {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  const x = ax + dx * t
  const z = az + dz * t
  return [x, z, Math.hypot(px - x, pz - z)]
}

/** 主な通りに面した壁の広告面。1 棟に 1 枚（間口の広い棟は 2 枚）。同じ地図なら同じ並びになる */
/** blocked は「その点が別の建物の中か」。板の前がふさがっている（隣の棟に接している）壁には付けない */
export function wallAds(buildings: MapBuilding[], roads: MapRoad[], skip: (b: MapBuilding) => boolean, blocked: (x: number, z: number) => boolean = () => false): WallAd[] {
  const streets = roads.filter((r) => !r.bridge && !r.tunnel && r.name != null && MAIN_STREETS.has(r.name.replace(/\(.*$/, '')))
  const out: WallAd[] = []
  for (const b of buildings) {
    if (b.roof || b.part || b.minH || b.h < MIN_HEIGHT || skip(b)) continue
    const n = b.pts.length / 2
    let cx = 0
    let cz = 0
    for (let i = 0; i < n; i++) {
      cx += b.pts[i * 2] / n
      cz += b.pts[i * 2 + 1] / n
    }
    // 通りを向いた辺それぞれに、間口 9m ごとに 1 枚（雑居ビルが肩を並べる街区では、棟ごとに 1 枚になる）
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ax = b.pts[j * 2]
      const az = b.pts[j * 2 + 1]
      const bx = b.pts[i * 2]
      const bz = b.pts[i * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < MIN_EDGE) continue
      let nx = (bz - az) / len
      let nz = -(bx - ax) / len
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      if (nx * (mx - cx) + nz * (mz - cz) < 0) {
        nx = -nx
        nz = -nz
      }
      let faces = false
      for (const r of streets) {
        for (let k = 2; k < r.pts.length && !faces; k += 2) {
          const [qx, qz, d] = nearestOnSegment(mx, mz, r.pts[k - 2], r.pts[k - 1], r.pts[k], r.pts[k + 1])
          if (d > r.width / 2 + REACH || d < 0.5) continue
          // 壁の正面に通りがある（斜め後ろの通りは数えない）
          if (((qx - mx) * nx + (qz - mz) * nz) / d > 0.6) faces = true
        }
        if (faces) break
      }
      if (!faces) continue
      const edge = { ax, az, bx, bz, nx, nz, len }
      const ei = i
    const count = Math.max(1, Math.min(8, Math.floor(edge.len / 9)))
    for (let k = 0; k < count; k++) {
      // 3 割の棟は広告面なし（窓だけの壁も混ぜる）
      if (hash(b.id, ei * 16 + k, 61) < 0.2) continue
      const slot = edge.len / count
      const tall = hash(b.id, ei * 16 + k, 62) < 0.45
      const room = b.h - CLEAR_BELOW - 1
      const w = Math.min(slot - 1.2, tall ? 3.2 + hash(b.id, ei * 16 + k, 63) * 1.6 : 6 + hash(b.id, ei * 16 + k, 63) * 5)
      const h = Math.min(room, tall ? 8 + hash(b.id, ei * 16 + k, 64) * 6 : 3.6 + hash(b.id, ei * 16 + k, 64) * 3.2)
      if (w < 2.4 || h < 2.4) continue
      // 辺の中での位置（板が辺からはみ出ない範囲で左右に振る）
      const lo = slot * k + w / 2 + 0.5
      const hi = slot * (k + 1) - w / 2 - 0.5
      const s = lo + (hi - lo) * hash(b.id, ei * 16 + k, 65)
      const t = s / edge.len
      const y0 = CLEAR_BELOW + (room - h) * (0.2 + hash(b.id, ei * 16 + k, 66) * 0.7)
      const x = edge.ax + (edge.bx - edge.ax) * t
      const z = edge.az + (edge.bz - edge.az) * t
      const ux = (edge.bx - edge.ax) / edge.len
      const uz = (edge.bz - edge.az) / edge.len
      const covered = [-0.5, 0, 0.5].some((e) => [1.2, 4].some((d) => blocked(x + ux * w * e + edge.nx * d, z + uz * w * e + edge.nz * d)))
      if (covered) continue
      out.push({
        building: b.id,
        x,
        z,
        nx: edge.nx,
        nz: edge.nz,
        w,
        h,
        y0,
        art: Math.floor(hash(b.id, ei * 16 + k, 67) * WALL_AD_ARTS),
        })
      }
    }
  }
  return out
}

/** これより短い（端から端まで m。辺の横断歩道は 15m 以上ある）スクランブル交差点の横断歩道は、角のつなぎとみなす */
const STUB_CROSSING = 10

/**
 * スクランブル交差点の角にある、横断歩道どうしをつなぐ短い折れ線か。幅 9m の縞を載せると扇形に重なって路面が乱れるので描かない
 */
export function isStubCrossing(r: MapRoad): boolean {
  if (!r.crossing) return false
  // 原点のまわり 45m に収まる横断歩道だけ（map.ts の isScrambleCrossing と同じ範囲）
  for (let i = 0; i < r.pts.length; i += 2) if (Math.hypot(r.pts[i], r.pts[i + 1]) > 45) return false
  return Math.hypot(r.pts[0] - r.pts[r.pts.length - 2], r.pts[1] - r.pts[r.pts.length - 1]) < STUB_CROSSING
}
