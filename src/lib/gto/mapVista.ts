// Grand Theft Outfit [部品: city] 通りの突き当たりに見える物の決まりごと。three/DOM なし。
// 入口: roofScreens(b) / ROOF_SCREENS / splitSlab(pts, cap) / guardEastFace(map) / GUARD_EAST / TOWER_CROWN
//       / isBrickWalkRoad(r) / walkRuns(world, r, offset, step) / BRICK_WALK
// 契約: 現地写真（miyamasuzaka_04/05、viaduct_10）から、位置・大きさ・高さ関係だけを起こす。映像の中身は架空。
//       宮益坂下からガード越しに西を見ると、ガードの真上に細い高層棟が 1 本、その右の屋上に大型ビジョンが 2 面並ぶ。
import { cumulative, pointAlong } from './math'
import type { Flat, GtoWorld, MapBuilding, MapRoad, ShibuyaMap } from './types'

/** 屋上の縁に立てる大型ビジョン 1 面の決めごと */
export interface RoofScreenSpec {
  /** 載せる辺を選ぶ点（辺の中点がここにいちばん近い辺に載せる） */
  near: [x: number, z: number]
  /** 辺の中で占める範囲（割合） */
  t0: number
  t1: number
  /** 屋上から下端までの高さ m と、画面の高さ m */
  lift: number
  h: number
  /** 映像の絵の番号（renderCityTextures の screens、0..3） */
  tile: number
}

/**
 * スクランブル交差点の西、道玄坂の入口の角の棟。屋上に大型ビジョンが 2 面（北東の隅切りに 1 面、東の面の北寄りに 1 面）。
 * ガードの東からは、電車の屋根のすぐ上に 2 面が並んで見える（miyamasuzaka_04/05）。
 */
export const ROOF_SCREENS: Record<number, RoofScreenSpec[]> = {
  60739635: [
    { near: [-48, 14], t0: 0.04, t1: 0.96, lift: 1.4, h: 12, tile: 1 },
    { near: [-46.3, 36.9], t0: 0.02, t1: 0.42, lift: 1.4, h: 12, tile: 2 },
  ],
  // 109 の向かいの黒い外壁の棟（109_10/13）。屋上の縁に、通りへ向いた横長の大型ビジョンが黒い枠ごと載る
  136587748: [{ near: [-104, 12.5], t0: 0.03, t1: 0.97, lift: 0.4, h: 6, tile: 0 }],
}

export interface RoofScreen {
  /** 下辺の両端 */
  ax: number
  az: number
  bx: number
  bz: number
  /** 表の向き */
  nx: number
  nz: number
  /** 屋上からの高さ m */
  y0: number
  y1: number
  tile: number
}

/** 建物の屋上に立てる大型ビジョンの置き場所。決めていない建物は空 */
export function roofScreens(b: MapBuilding): RoofScreen[] {
  const specs = ROOF_SCREENS[b.id]
  if (!specs) return []
  const n = b.pts.length / 2
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += b.pts[i * 2] / n
    cz += b.pts[i * 2 + 1] / n
  }
  return specs.flatMap((spec) => {
    let best = -1
    let bestDist = Infinity
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const d = Math.hypot((b.pts[i * 2] + b.pts[j * 2]) / 2 - spec.near[0], (b.pts[i * 2 + 1] + b.pts[j * 2 + 1]) / 2 - spec.near[1])
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    if (best < 0) return []
    const j = (best + n - 1) % n
    const px = b.pts[j * 2]
    const pz = b.pts[j * 2 + 1]
    const qx = b.pts[best * 2]
    const qz = b.pts[best * 2 + 1]
    const len = Math.hypot(qx - px, qz - pz) || 1
    let nx = (qz - pz) / len
    let nz = -(qx - px) / len
    // 外向きにそろえる
    if (nx * ((px + qx) / 2 - cx) + nz * ((pz + qz) / 2 - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    return [
      {
        ax: px + (qx - px) * spec.t0,
        az: pz + (qz - pz) * spec.t0,
        bx: px + (qx - px) * spec.t1,
        bz: pz + (qz - pz) * spec.t1,
        nx,
        nz,
        y0: spec.lift,
        y1: spec.lift + spec.h,
        tile: spec.tile,
      },
    ]
  })
}

const lerp2 = (ax: number, az: number, bx: number, bz: number, t: number): [number, number] => [ax + (bx - ax) * t, az + (bz - az) * t]

/**
 * 板状の塔（四角い輪郭）を、長手の両端 cap m ぶんの妻面と、間の胴に分ける。
 * ホテル棟は長い面が小窓の並ぶ壁、妻面がガラスなので、端から見たときだけ細いガラスの塔に見える。
 */
export function splitSlab(pts: Flat, cap: number): { body: Flat; ends: [Flat, Flat] } | null {
  if (pts.length !== 8) return null
  const p = (i: number): [number, number] => [pts[(i % 4) * 2], pts[(i % 4) * 2 + 1]]
  const len = (i: number) => Math.hypot(p(i + 1)[0] - p(i)[0], p(i + 1)[1] - p(i)[1])
  // 長い辺の組（向かい合う 2 辺）を、同じ向きにそろえて取り出す
  const s = len(0) >= len(1) ? 0 : 1
  const [a0, a1, b1, b0] = [p(s), p(s + 1), p(s + 2), p(s + 3)]
  const long = Math.min(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), Math.hypot(b1[0] - b0[0], b1[1] - b0[1]))
  if (long <= cap * 2.5) return null
  const t = cap / long
  const at = (k: number) => [lerp2(a0[0], a0[1], a1[0], a1[1], k), lerp2(b0[0], b0[1], b1[0], b1[1], k)]
  const quad = (k0: number, k1: number): Flat => {
    const [pa, pb] = at(k0)
    const [qa, qb] = at(k1)
    return [pa[0], pa[1], qa[0], qa[1], qb[0], qb[1], pb[0], pb[1]]
  }
  return { body: quad(t, 1 - t), ends: [quad(0, t), quad(1 - t, 1)] }
}

/** ホテル棟の頂部（miyamasuzaka_04: 片側が一段高く、その上に細いアンテナ）。高さは m、幅は輪郭に対する割合 */
export const TOWER_CROWN = { step: 5.5, stepScale: 0.55, mast: 15, mastSize: 0.35 } as const

/**
 * JR の鉄桁ガードを東から見た面（viaduct_10、miyamasuzaka_04）。無地の明るい灰色の板で、上に低い高欄。
 * bottom / top はレールの高さからの上下 m、out は線路の中心から板までの離れ m、zMin..zMax は道をまたぐ区間。
 */
export const GUARD_EAST = { bottom: -2.3, top: 1.25, out: 2.75, zMin: -15, zMax: 12.5 } as const

export interface GuardFace {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
  /** レールの高さ */
  y: number
}

/** ガードのいちばん東の線路の東の縁。道をまたぐ区間だけを切り出す（北 → 南） */
export function guardEastFace(map: ShibuyaMap): GuardFace | null {
  const G = GUARD_EAST
  let best: GuardFace | null = null
  for (const r of map.rails) {
    if (r.line !== 'jr' || !r.bridge) continue
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      let [ax, az, bx, bz] = [r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]]
      if (az > bz) [ax, az, bx, bz] = [bx, bz, ax, az]
      if (bz <= G.zMin || az >= G.zMax || bz - az < 1) continue
      // 区間を zMin..zMax に切る
      const k0 = Math.max(0, (G.zMin - az) / (bz - az))
      const k1 = Math.min(1, (G.zMax - az) / (bz - az))
      const len = Math.hypot(bx - ax, bz - az)
      // 北 → 南へ進むときの左（東）向きの法線
      let nx = (bz - az) / len
      let nz = -(bx - ax) / len
      if (nx < 0) {
        nx = -nx
        nz = -nz
      }
      const face: GuardFace = {
        ax: ax + (bx - ax) * k0 + nx * G.out,
        az: az + (bz - az) * k0 + nz * G.out,
        bx: ax + (bx - ax) * k1 + nx * G.out,
        bz: az + (bz - az) * k1 + nz * G.out,
        nx,
        nz,
        y: r.y[i / 2],
      }
      if (!best || face.ax + face.bx > best.ax + best.bx) best = face
    }
  }
  return best
}

/**
 * 宮益坂と、ガードの手前の通りの歩道（miyamasuzaka_04/05）。赤茶のレンガ調の舗装で、車道との境に緑の横パイプ柵。
 * center / width = 車道の縁から歩道の帯の中心までの離れと帯の幅 m、fence = 車道の縁から柵までの離れ m、xMin = ガードより東だけ。
 */
export const BRICK_WALK = { names: ['宮益坂', '旧大山街道'], xMin: 78, center: 2.5, width: 4.2, fence: 0.45, fenceH: 0.8, panel: 2, fenceSkip: [[104, 196, -2, 40], [136, 196, -18, 40], [126.3, 133.7, -18, 40]] } as const

/**
 * 緑の柵を立てる所か。宮益坂下の交差点の広場側と、交差点の角（fenceSkip = [x0, x1, z0, z1] の列）は開けていて、柵は無い
 * （miyamasuzaka_01/02 の手前、miyamasuzaka_08 の足元）。ガードの手前の北の歩道（miyamasuzaka_04/05）には残る
 */
export function brickFenceAt(x: number, z: number): boolean {
  return !BRICK_WALK.fenceSkip.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1)
}

export function isBrickWalkRoad(r: MapRoad): boolean {
  if (!r.drive || r.bridge || r.tunnel || r.name == null || !(BRICK_WALK.names as readonly string[]).includes(r.name)) return false
  for (let i = 0; i < r.pts.length; i += 2) if (r.pts[i] < BRICK_WALK.xMin) return false
  return true
}

/**
 * 道の中心線から offset m（進む向きの右が＋）ずらした線を step m ごとに刻み、
 * 車道の上と建物の中に掛かる点で切って、つながった区間ごとに返す（交差点と横道の口では途切れる）。
 */
export function walkRuns(world: GtoWorld, r: MapRoad, offset: number, step: number): [number, number][][] {
  const cum = cumulative(r.pts)
  const total = cum[cum.length - 1]
  const runs: [number, number][][] = []
  let run: [number, number][] = []
  const flush = () => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  const n = Math.max(1, Math.round(total / step))
  for (let k = 0; k <= n; k++) {
    const p = pointAlong(r.pts, cum, (total * k) / n)
    const x = p.x + Math.cos(p.heading) * offset
    const z = p.z + Math.sin(p.heading) * offset
    const near = world.nearestRoad(x, z, true, 30)
    const onRoad = near != null && near.dist < world.map.roads[near.road].width / 2
    if (onRoad || world.insideBuilding(x, z)) flush()
    else run.push([x, z])
  }
  flush()
  return runs
}

/**
 * ハチ公前広場の南西の連絡通路（scramble_14/16/17/18、scramble_02 の右）。道をまたぐ白い箱で、
 * 下は白い腰の帯、その上の 2 層ぶんが白い細い方立てのガラス、いちばん上に薄く張り出した白い屋根。
 * 夜は中の明かりで全体が白く光る。高さは地表から m（地図の高さより低く、まわりの棟の半分以下）
 */
export const CONCOURSE = { sill: 1.8, glassTop: 14.4, roof: 15.6, eave: 0.9 } as const

/** 交差点の角の地下鉄出入口（scramble_02 の右手前、scramble_22）。白い腰壁と屋根の間は透明なガラス */
export const SUBWAY_KIOSK = { base: 0.55, top: 3.4, roof: 0.35, post: 0.07 } as const
