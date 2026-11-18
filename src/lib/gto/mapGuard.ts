// Grand Theft Outfit [部品: city] JR の鉄桁ガードを下から見上げたときの骨組み（viaduct_05）。three には触れない。
// 入口: GUARD_SOFFIT / guardSoffit(map) / soffitFrame(soffit)
// 契約: 現地写真は、桁の下に入ると画面の上半分を桁の裏が覆う。薄い灰緑に塗った主桁（線路の向き）と横桁（道の向き）の格子に、
//       斜材が X 字に渡り、ところどころに丸い灯具が付く。線路（OSM）の 4 本が道をまたぐ区間を 1 枚の四角形にまとめ、その中に格子を割る。
import type { ShibuyaMap } from './types'

/**
 * zMin..zMax = 道をまたぐ区間（北の橋台 → 駅舎の北の面）、pad = 両端の線路の中心から桁の縁までの離れ m、
 * plate = 床板の下面（レールの高さから m）、beam = 主桁の下端が床板から下がる量 m、
 * mainStep / crossStep = 主桁・横桁の間隔 m、lampEvery = 灯具を付ける横桁の間隔（本）。
 */
export const GUARD_SOFFIT = { zMin: -14.5, zMax: 13, pad: 2.9, plate: -1.93, beam: 0.95, mainStep: 2.5, crossStep: 3.4, mainW: 0.4, crossW: 0.24, braceW: 0.11, lampEvery: 2 } as const

export type P2 = [x: number, z: number]

export interface GuardSoffit {
  /** 四隅（北西・北東・南東・南西） */
  nw: P2
  ne: P2
  se: P2
  sw: P2
  /** レールの高さ */
  y: number
}

export interface Seg {
  ax: number
  az: number
  bx: number
  bz: number
}

/** JR の線路が z を横切る所の x の最小と最大（横切る線路が無ければ null） */
function span(map: ShibuyaMap, z: number): { x0: number; x1: number; y: number } | null {
  let x0 = Infinity
  let x1 = -Infinity
  let y = 0
  for (const r of map.rails) {
    if (r.line !== 'jr') continue
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const az = r.pts[i + 1]
      const bz = r.pts[i + 3]
      if ((az - z) * (bz - z) > 0 || Math.abs(bz - az) < 0.01) continue
      const x = r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * (z - az)) / (bz - az)
      if (x < x0) x0 = x
      if (x > x1) {
        x1 = x
        y = r.y[i / 2]
      }
    }
  }
  return x1 > x0 ? { x0, x1, y } : null
}

/** 道をまたぐ区間の桁の裏の四角形 */
export function guardSoffit(map: ShibuyaMap): GuardSoffit | null {
  const G = GUARD_SOFFIT
  const n = span(map, G.zMin)
  const s = span(map, G.zMax)
  if (!n || !s) return null
  return { nw: [n.x0 - G.pad, G.zMin], ne: [n.x1 + G.pad, G.zMin], se: [s.x1 + G.pad, G.zMax], sw: [s.x0 - G.pad, G.zMax], y: n.y }
}

/** 四角形の中の点。t = 西 → 東（0..1）、s = 北 → 南（0..1） */
export function soffitPoint(q: GuardSoffit, t: number, s: number): P2 {
  const nx = q.nw[0] + (q.ne[0] - q.nw[0]) * t
  const nz = q.nw[1] + (q.ne[1] - q.nw[1]) * t
  const sx = q.sw[0] + (q.se[0] - q.sw[0]) * t
  const sz = q.sw[1] + (q.se[1] - q.sw[1]) * t
  return [nx + (sx - nx) * s, nz + (sz - nz) * s]
}

export interface SoffitFrame {
  /** 主桁（線路の向き。北 → 南） */
  mains: Seg[]
  /** 横桁（道の向き。西 → 東） */
  crosses: Seg[]
  /** 斜材（市松に並ぶ升目の対角線 2 本ずつ） */
  braces: Seg[]
  /** 斜材の交点の添え板 */
  gussets: P2[]
  /** 灯具 */
  lamps: P2[]
}

/** 桁の裏の骨組み。主桁と横桁の格子、市松の升目に X 字の斜材、横桁の何本かおきに灯具 */
export function soffitFrame(q: GuardSoffit): SoffitFrame {
  const G = GUARD_SOFFIT
  const wide = Math.hypot(q.ne[0] - q.nw[0], q.ne[1] - q.nw[1])
  const long = Math.hypot(q.sw[0] - q.nw[0], q.sw[1] - q.nw[1])
  const nt = Math.max(2, Math.round(wide / G.mainStep))
  const ns = Math.max(2, Math.round(long / G.crossStep))
  const seg = (a: P2, b: P2): Seg => ({ ax: a[0], az: a[1], bx: b[0], bz: b[1] })
  const frame: SoffitFrame = { mains: [], crosses: [], braces: [], gussets: [], lamps: [] }
  for (let i = 0; i <= nt; i++) frame.mains.push(seg(soffitPoint(q, i / nt, 0), soffitPoint(q, i / nt, 1)))
  for (let j = 0; j <= ns; j++) frame.crosses.push(seg(soffitPoint(q, 0, j / ns), soffitPoint(q, 1, j / ns)))
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < ns; j++) {
      if ((i + j) % 2 === 0) {
        frame.braces.push(seg(soffitPoint(q, i / nt, j / ns), soffitPoint(q, (i + 1) / nt, (j + 1) / ns)))
        frame.braces.push(seg(soffitPoint(q, (i + 1) / nt, j / ns), soffitPoint(q, i / nt, (j + 1) / ns)))
        frame.gussets.push(soffitPoint(q, (i + 0.5) / nt, (j + 0.5) / ns))
      } else if (j % G.lampEvery === 1 && i % 4 === 0) frame.lamps.push(soffitPoint(q, (i + 0.5) / nt, (j + 0.5) / ns))
    }
  }
  return frame
}
