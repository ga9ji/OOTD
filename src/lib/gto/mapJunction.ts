// Grand Theft Outfit [部品: city] 交差点の中の路面の決まりごと。three/DOM なし。
// 入口: junctionClearings(roads) / clipOutside(line, discs)
// 契約: 現地写真（109_12 / scramble_08 / miyamasuzaka_02）では、交差点の中は横断歩道の縞だけで、中央線・車線の破線・路肩の線は
//       横断歩道の手前（停止線）で切れる。地図の車道は交差点の中心まで 1 本の線なので、線を引かない円を交差点ごとに決める。
import { isGroundRoad } from './map'
import type { MapRoad } from './types'

export interface Clearing {
  x: number
  z: number
  r: number
}

/** 交差点の中心からこの距離 m までの横断歩道を、その交差点の物とみなす */
const CROSSING_REACH = 30
/** 横断歩道の外の端から停止線までの余白 m */
const STOP_MARGIN = 2.5

const key = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`

/** 車道が 3 本以上集まる点（交差点）ごとの、線を引かない円。同じ地図なら同じ並び */
export function junctionClearings(roads: MapRoad[]): Clearing[] {
  const nodes = new Map<string, { x: number; z: number; ends: number; width: number }>()
  const touch = (x: number, z: number, ends: number, width: number) => {
    const k = key(x, z)
    const n = nodes.get(k)
    nodes.set(k, n ? { ...n, ends: n.ends + ends, width: Math.max(n.width, width) } : { x, z, ends, width })
  }
  for (const r of roads) {
    if (!r.drive || !isGroundRoad(r)) continue
    const last = r.pts.length - 2
    // 端の点は 1 本、途中の点は両側へ延びるので 2 本ぶん
    for (let i = 0; i <= last; i += 2) touch(r.pts[i], r.pts[i + 1], i === 0 || i === last ? 1 : 2, r.width)
  }
  const crossings = roads.filter((r) => r.crossing && isGroundRoad(r))
  const out: Clearing[] = []
  for (const n of nodes.values()) {
    if (n.ends < 3) continue
    let reach = 0
    for (const c of crossings) {
      // 交差点のそばを通る横断歩道だけ（どこかの点が車道の幅＋少しの内側にある）
      let far = 0
      let near = Infinity
      for (let i = 0; i < c.pts.length; i += 2) {
        const d = Math.hypot(c.pts[i] - n.x, c.pts[i + 1] - n.z)
        near = Math.min(near, d)
        far = Math.max(far, d)
      }
      if (far <= CROSSING_REACH && near <= CROSSING_REACH) reach = Math.max(reach, far)
    }
    out.push({ x: n.x, z: n.z, r: Math.max(n.width / 2 + 1, reach > 0 ? reach + STOP_MARGIN : 0, 4) })
  }
  return out
}

const inside = (x: number, z: number, discs: Clearing[]) => discs.some((d) => (x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r)

/** 線分 a→b が「円の外／中」を切り替える所（0..1）を二分法で探す */
function boundary(a: [number, number], b: [number, number], discs: Clearing[]): [number, number] {
  const aIn = inside(a[0], a[1], discs)
  let lo = 0
  let hi = 1
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (inside(a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid, discs) === aIn) lo = mid
    else hi = mid
  }
  const t = (lo + hi) / 2
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** 折れ線から円の中を切り取り、外に残る区間を返す。元の配列は書き換えない */
export function clipOutside(line: [number, number][], discs: Clearing[]): [number, number][][] {
  if (line.length < 2) return []
  const near = discs.filter((d) => line.some(([x, z]) => Math.abs(x - d.x) < d.r + 60 && Math.abs(z - d.z) < d.r + 60))
  if (!near.length) return [line]
  const runs: [number, number][][] = []
  let run: [number, number][] = []
  let prevIn = inside(line[0][0], line[0][1], near)
  if (!prevIn) run = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const nowIn = inside(line[i][0], line[i][1], near)
    if (nowIn !== prevIn) {
      const cut = boundary(line[i - 1], line[i], near)
      if (nowIn) {
        runs.push([...run, cut])
        run = []
      } else run = [cut]
    }
    if (!nowIn) run = [...run, line[i]]
    prevIn = nowIn
  }
  if (run.length >= 2) runs.push(run)
  return runs.filter((r) => r.length >= 2)
}
