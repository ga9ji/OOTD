// Grand Theft Outfit: 道の分岐の先端に立つ円筒の建物（109_02/03、dogenzaka_05）の割り付け。
// 入口: forkTower(pts) → 円筒の中心と半径、円筒の後ろに付く棟の輪郭、円筒の脇の吹き抜けの面。
//       forkCanopy(tower) → 円筒の足元を巻く鉄骨トラスの庇の柱の位置（dogenzaka_07）。
// 契約: three にも DOM にも触れない。輪郭（OSM）から位置を決めるだけで、見た目は renderCity109.ts。
import type { Flat, MapRoad } from './types'

export interface ForkTower {
  /** 円筒の中心と半径 */
  cx: number
  cz: number
  r: number
  /** 円筒が向く先（交差点の側）への単位ベクトル */
  fx: number
  fz: number
  /** 円筒の後ろに付く棟の輪郭（先端を切り落として、円筒の裏へ差し込む） */
  body: Flat
  /** 円筒の脇の吹き抜けの面。a が円筒の側、(nx, nz) が外向き */
  atrium: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }
}

const RADIUS = 8.5

export function forkTower(pts: Flat): ForkTower {
  const n = pts.length / 2
  let mx = 0
  let mz = 0
  let tip = 0
  for (let i = 0; i < n; i++) {
    mx += pts[i * 2] / n
    mz += pts[i * 2 + 1] / n
    if (Math.hypot(pts[i * 2], pts[i * 2 + 1]) < Math.hypot(pts[tip * 2], pts[tip * 2 + 1])) tip = i
  }
  const tx = pts[tip * 2]
  const tz = pts[tip * 2 + 1]
  const dl = Math.hypot(mx - tx, mz - tz) || 1
  // 先端 → 重心（建物の奥）への向き
  const bx = (mx - tx) / dl
  const bz = (mz - tz) / dl
  const r = Math.min(RADIUS, dl * 0.6)
  const cx = tx + bx * (r - 0.6)
  const cz = tz + bz * (r - 0.6)
  // 円筒の裏へ差し込む 2 点（奥へ 2m、左右へ r - 1.5m）
  const half = Math.max(r - 1.5, 0.5)
  const inserts: [number, number][] = [
    [cx + bx * 2 - bz * half, cz + bz * 2 + bx * half],
    [cx + bx * 2 + bz * half, cz + bz * 2 - bx * half],
  ]
  const near = (i: number) => Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz) < r + 2.5
  // 切り落とす角の並びの、次の角から回る
  let start = -1
  for (let i = 0; i < n; i++) if (near((i + n - 1) % n) && !near(i)) start = i
  const kept: [number, number][] = []
  if (start >= 0) for (let k = 0; k < n; k++) if (!near((start + k) % n)) kept.push([pts[((start + k) % n) * 2], pts[((start + k) % n) * 2 + 1]])
  if (kept.length < 2) {
    // 小さすぎる輪郭は、円筒の後ろに四角い棟を置く
    kept.length = 0
    kept.push([cx + bx * (r + 6) + bz * half, cz + bz * (r + 6) - bx * half], [cx + bx * (r + 6) - bz * half, cz + bz * (r + 6) + bx * half])
  }
  const last = kept[kept.length - 1]
  const d = (p: [number, number]) => Math.hypot(p[0] - last[0], p[1] - last[1])
  const ordered = d(inserts[0]) <= d(inserts[1]) ? inserts : [inserts[1], inserts[0]]
  const ring = [...kept, ...ordered]
  // 差し込んだ点から出る 2 辺のうち、長いほう（坂に面した側）を吹き抜けの面にする
  const edgeA = { from: ordered[0], to: last }
  const edgeB = { from: ordered[1], to: kept[0] }
  const lenOf = (e: { from: [number, number]; to: [number, number] }) => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1])
  const edge = lenOf(edgeA) >= lenOf(edgeB) ? edgeA : edgeB
  const el = lenOf(edge) || 1
  let nx = (edge.to[1] - edge.from[1]) / el
  let nz = -(edge.to[0] - edge.from[0]) / el
  // 外向き（重心から遠ざかる側）にそろえる
  if (nx * ((edge.from[0] + edge.to[0]) / 2 - mx) + nz * ((edge.from[1] + edge.to[1]) / 2 - mz) < 0) {
    nx = -nx
    nz = -nz
  }
  return {
    cx,
    cz,
    r,
    fx: -bx,
    fz: -bz,
    body: ring.flat(),
    atrium: { ax: edge.from[0], az: edge.from[1], bx: edge.to[0], bz: edge.to[1], nx, nz },
  }
}

export interface ForkCanopy {
  /** 柱の位置（文化村通りの側から道玄坂の側へ、円筒の前を回る順） */
  posts: [number, number][]
  /** 柱ごとの、円筒の壁ぎわの梁の受け点 */
  inner: [number, number][]
}

/**
 * 庇の寸法: 柱は円筒の前の広場に、前へ ahead m・横へ side m 張り出した楕円の上に立つ（広場は先細りなので前に長い）。
 * 正面から文化村通りの側へ north 度・道玄坂の側へ south 度まで
 */
const CANOPY = { ahead: 6, side: 2.5, inner: 1.2, north: 50, south: 60, bays: 4 }

/** 庇の部材の太さ（半分の幅 m）。現地（dogenzaka_07）は細い丸柱と細い鋼管の格子で、向こうの棟が透けて見える */
export const CANOPY_MEMBER = { post: 0.1, chord: 0.055, brace: 0.04 } as const

/**
 * 円筒の足元の広場に立つ鉄骨トラスの庇（dogenzaka_07: 109 前の歩道から東を見ると、左手前を金茶色の格子が埋める）。
 * 正面（交差点の側）を中心に、文化村通りの側と道玄坂の側へ回り込む
 */
export function forkCanopy(f: ForkTower): ForkCanopy {
  const a = f.r + CANOPY.ahead
  const b = f.r + CANOPY.side
  // 横の向き（正面に向かって右 = 道玄坂の側）
  const sx = -f.fz
  const sz = f.fx
  const posts: [number, number][] = []
  const inner: [number, number][] = []
  for (let k = 0; k <= CANOPY.bays; k++) {
    const t = ((-CANOPY.north + ((CANOPY.north + CANOPY.south) * k) / CANOPY.bays) * Math.PI) / 180
    const u = Math.cos(t) * a
    const v = Math.sin(t) * b
    const x = f.cx + f.fx * u + sx * v
    const z = f.cz + f.fz * u + sz * v
    const d = Math.hypot(x - f.cx, z - f.cz)
    posts.push([x, z])
    inner.push([f.cx + ((x - f.cx) / d) * (f.r + CANOPY.inner), f.cz + ((z - f.cz) / d) * (f.r + CANOPY.inner)])
  }
  return { posts, inner }
}

/** 109 前の分岐の真ん中（道玄坂と文化村通りが合わさる所）。OSM では斜めの横断歩道 2 本がここで交わる */
export const FORK_109_MID: [number, number] = [-110.1, 0.9]
const FORK_CROSSING_REACH = 40

/** 分岐の先端から南東の歩道へ斜めに渡る線（OSM 215956003）。両端の位置で見分ける */
const FORK_TIP: [number, number] = [-121.8, -4.6]
const FORK_SOUTH_EAST: [number, number] = [-95.4, 7.5]
/** 分岐の横断歩道の縞の幅 m（109_12 の足元の縞は車 1 台の長さほど） */
export const FORK_ZEBRA_WIDTH = 5

/**
 * 109 前の分岐の横断歩道の描き方（109_12 の足元）。現地で縞が引かれているのは、先端から左右の通りを渡る 2 本、
 * 北東の角から南の歩道へ斜めに渡る 1 本、合わさった通りを渡る 1 本。先端から正面（南東）へ延びる線には縞が無く、
 * 足元から 20m 先の横断歩道までは何も描かれていないアスファルト。ここまで縞で埋めるとスクランブル交差点に見える。
 * 分岐のまわりの縞を描く横断歩道は 'plain'（縞だけ。赤茶の帯は添えない）、縞を描かない線は 'none'、離れた横断歩道は null
 */
export function forkCrossing(r: MapRoad): 'plain' | 'none' | null {
  if (!r.crossing) return null
  const [mx, mz] = FORK_109_MID
  let near = false
  for (let i = 0; i < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - mx, r.pts[i + 1] - mz) < FORK_CROSSING_REACH) near = true
  if (!near) return null
  const ends = [
    [r.pts[0], r.pts[1]],
    [r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]],
  ]
  const at = (p: [number, number]) => ends.some(([x, z]) => Math.hypot(x - p[0], z - p[1]) < 3)
  return at(FORK_TIP) && at(FORK_SOUTH_EAST) ? 'none' : 'plain'
}

/**
 * 横断歩道の付け根の赤茶の舗装 [x, z, 半径 m]（109_07 / 109_08 / 109_12 の足元）。分岐の先端と、向かいの歩道の角。
 * 縞はこの上に重なる
 */
export const FORK_RED_PATCHES: [x: number, z: number, r: number][] = [
  [-121.8, -4.6, 5.5],
  [-117.6, 13.9, 4],
  [-100.4, -18.5, 4],
  [-94.8, 6, 4],
]
