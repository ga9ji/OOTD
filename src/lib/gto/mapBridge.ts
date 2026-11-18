// Grand Theft Outfit [部品: city] 明治通りをまたぐ駅の橋（ガラスのチューブ）の決まりごと。three には触れない。
// 入口: EAST_BRIDGE / tubeAxis(pts) / reachWest(axis) / tubeSection(half, squash) / tubeColumns(world, axis)
// 契約: 現地写真（miyamasuzaka_06/08、viaduct_01、towers_17）から形だけを起こす。
//       橋は「道路の上に浮いた、丸い屋根の筒」。下は車とバスが抜ける暗い空間で、壁を地面まで下ろさない。
//       足元に置くのは、車道と建物を避けた丸柱だけ（当たり判定は持たない）。
import type { Flat, GtoWorld } from './types'

/**
 * 橋の断面の高さ（地表から m）。下から: 桁下、白いパネルの腰、ガラスの帯、丸いルーバー屋根。
 * lean = ガラスの上端が内へ倒れる量 m、capDepth = 端の丸みの奥行き（半幅に対する割合）。
 * towers_17・viaduct_01 の見かけの角度から: 桁下はバスの屋根の倍の高さ、腰はバス 1 台ぶんより高く、
 * 屋根の棟は桁下の 3 倍の高さ（宮益坂下から見て、橋の厚みが桁下の空きの 2 倍に見える）。
 * ガラスの帯は腰の 2 倍以上の高さ（miyamasuzaka_07: 薄暮に内側から光る 2 段のガラスが、塔の足元を横一直線に通る。
 * 腰の白い板が厚いと、ガラスの駅舎ではなく「ベージュの低い帯」に見える）。
 */
export const EAST_BRIDGE = { deck: 6.2, sill: 8.5, eave: 14.8, ridge: 19.4, lean: 0.5, roofSteps: 6, capDepth: 0.7, columnStep: 17, columnInset: 2.4, westReach: 19, reachMinLen: 80 } as const

/** 細長い建物の中心線。a が西の端、(ux, uz) が a→b の向き、half が半幅 */
export interface TubeAxis {
  ax: number
  az: number
  bx: number
  bz: number
  ux: number
  uz: number
  half: number
  len: number
}

/**
 * 輪郭から、向かい合う 2 本の長い辺を探して、その真ん中を通る中心線を返す。
 * 長さは 2 本の辺が重なっている範囲（端の出っ張りや付け足しの小部屋は入れない）。
 */
export function tubeAxis(pts: Flat): TubeAxis | null {
  const n = pts.length / 2
  if (n < 4) return null
  const edges: { ax: number; az: number; bx: number; bz: number; len: number }[] = []
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = pts[j * 2]
    const az = pts[j * 2 + 1]
    const bx = pts[i * 2]
    const bz = pts[i * 2 + 1]
    edges.push({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az) })
  }
  const first = edges.reduce((a, b) => (b.len > a.len ? b : a))
  if (first.len < 1) return null
  let ux = (first.bx - first.ax) / first.len
  let uz = (first.bz - first.az) / first.len
  // 西から東へ向ける
  if (ux < 0) {
    ux = -ux
    uz = -uz
  }
  const along = (x: number, z: number) => (x - first.ax) * ux + (z - first.az) * uz
  const across = (x: number, z: number) => (x - first.ax) * -uz + (z - first.az) * ux
  let second: (typeof edges)[number] | null = null
  for (const e of edges) {
    if (e === first || e.len < first.len * 0.5) continue
    if (Math.abs(((e.bx - e.ax) * ux + (e.bz - e.az) * uz) / e.len) < 0.95) continue
    if (Math.abs(across((e.ax + e.bx) / 2, (e.az + e.bz) / 2)) < 4) continue
    if (!second || e.len > second.len) second = e
  }
  if (!second) return null
  const off = across((second.ax + second.bx) / 2, (second.az + second.bz) / 2)
  const span = (e: (typeof edges)[number]) => [Math.min(along(e.ax, e.az), along(e.bx, e.bz)), Math.max(along(e.ax, e.az), along(e.bx, e.bz))]
  const [f0, f1] = span(first)
  const [s0, s1] = span(second)
  const t0 = Math.max(f0, s0)
  const t1 = Math.min(f1, s1)
  if (t1 - t0 < 1) return null
  const at = (t: number): [number, number] => [first.ax + ux * t - uz * (off / 2), first.az + uz * t + ux * (off / 2)]
  const [ax, az] = at(t0)
  const [bx, bz] = at(t1)
  return { ax, az, bx, bz, ux, uz, half: Math.abs(off) / 2, len: t1 - t0 }
}

export interface SectionPoint {
  /** 中心線からの離れ m */
  s: number
  /** 地表からの高さ m */
  y: number
  /** この点から次の点までの面の種類 */
  part: 'fascia' | 'glass' | 'roof'
}

/**
 * 橋の断面の片側（外の縁の下端から棟まで）。squash は屋根とガラスの高さの縮み（低い渡りは 1 より小さい）。
 * 屋根は楕円の 1/4。軒で立ち、棟で寝る。
 */
export function tubeSection(half: number, squash = 1): SectionPoint[] {
  const B = EAST_BRIDGE
  const k = Math.min(1, Math.max(0.2, squash))
  const eave = B.sill + (B.eave - B.sill) * k
  const ridge = eave + (B.ridge - B.eave) * k
  const r = half - B.lean
  const out: SectionPoint[] = [
    { s: half, y: B.deck, part: 'fascia' },
    { s: half, y: B.sill, part: 'glass' },
    { s: r, y: eave, part: 'roof' },
  ]
  for (let i = 1; i <= B.roofSteps; i++) {
    const a = (i / B.roofSteps) * (Math.PI / 2)
    out.push({ s: i === B.roofSteps ? 0 : r * Math.cos(a), y: eave + (ridge - eave) * Math.sin(a), part: 'roof' })
  }
  return out
}

/**
 * 長い橋（明治通りをまたぐ本体）の西の端を、JR の高架まで westReach m 伸ばす。
 * 地図の輪郭は西の端が斜めに切れていて、中心線が 20m 手前で終わる。現地写真（miyamasuzaka_06〜08）では
 * ガラスの帯が塔の足元を通り過ぎて、右手の JR の工事中の躯体まで横一直線につながる。
 */
export function reachWest(axis: TubeAxis): TubeAxis {
  const B = EAST_BRIDGE
  if (axis.len < B.reachMinLen) return axis
  return { ...axis, ax: axis.ax - axis.ux * B.westReach, az: axis.az - axis.uz * B.westReach, len: axis.len + B.westReach }
}

/** 橋を支える丸柱の位置。中心線の両側に columnStep m おき。車道と建物に掛かる所は抜く */
export function tubeColumns(world: GtoWorld, axis: TubeAxis): [number, number][] {
  const { columnStep, columnInset } = EAST_BRIDGE
  const side = Math.max(1, axis.half - columnInset)
  const out: [number, number][] = []
  const count = Math.max(1, Math.round(axis.len / columnStep))
  for (let i = 0; i <= count; i++) {
    const t = (axis.len * i) / count
    for (const d of [-side, side]) {
      const x = axis.ax + axis.ux * t - axis.uz * d
      const z = axis.az + axis.uz * t + axis.ux * d
      if (world.insideBuilding(x, z)) continue
      const road = world.nearestRoad(x, z, true, 20)
      if (road && road.dist <= world.map.roads[road.road].width / 2 + 1.6) continue
      out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10])
    }
  }
  return out
}
