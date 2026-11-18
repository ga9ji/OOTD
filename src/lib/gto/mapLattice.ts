// Grand Theft Outfit [部品: city] 道玄坂下の北の角の棟（109 前から駅を向いて左手前）の、外壁の前に立つ鉄骨の格子と袖看板。three/DOM なし。
// 入口: LATTICE / EXTRA_BLADES / latticeMembers(b) / latticeBlades(b)
// 契約: 現地写真 109_12・dogenzaka_13: 暗いガラスの外壁の前に、灰色の鉄骨の水平材と斜材が格子に組まれ、通りへ突き出した
//       青い縦長の袖看板と、2 階の高さの青い横長の帯、その先に黄色い縦長の袖看板が付く。形・位置・色だけ起こす。名前は架空。
//       高さは建物の足元（b.y）からの m。どれも当たり判定を持たない飾り。
import { pickEdge, type Edge } from './mapFacade'
import type { MapBuilding } from './types'

export type V3 = [x: number, y: number, z: number]

export interface BladeSpec {
  /** 辺の中の位置（外から壁を見て左が 0・右が 1） */
  t: number
  y0: number
  y1: number
  /** 壁から突き出す長さ m */
  out: number
  /** 板の絵の番号（renderCityBoards の並び） */
  art: number
}

/** 板の絵の番号（renderCityAds の FACE_ART_PAINTERS の続き） */
export const BLADE_ART = { blueBank: 28, yellowDrug: 29, redShop: 31, whiteBanner: 34 } as const

export const LATTICE = {
  building: 114755219,
  /** 格子を組む面を選ぶ点と、その面の格子の下端 m。通りに面した南の面は店先の上から、西の面は隣の棟の屋上より上だけ */
  faces: [
    { near: [-89.6, -22.6], y0: 6.4 },
    { near: [-98.7, -38], y0: 24.4 },
  ] as { near: [number, number]; y0: number }[],
  /** 1 段の高さ・1 スパンの幅の目安 m */
  tier: 3.6,
  bay: 6,
  /** 壁から格子の面までの離れ m と、部材の太さの半分 m */
  out: 0.9,
  chord: 0.17,
  brace: 0.1,
  color: 0x7b8389,
  /** 袖看板（南の面）。青い縦長、その先に黄色い縦長 */
  blades: [
    { t: 0.3, y0: 7.2, y1: 17.5, out: 1.9, art: BLADE_ART.blueBank },
    { t: 0.86, y0: 6.6, y1: 21, out: 1.9, art: BLADE_ART.yellowDrug },
  ] as BladeSpec[],
  /** 2 階の高さの青い横長の帯（南の面の中の範囲と高さ） */
  band: { t0: 0.08, t1: 0.52, y0: 4.5, y1: 6.1, color: 0x1f3fa8 },
} as const

/**
 * 格子の棟のほかに、通りへ突き出す袖看板を付ける棟（near = 付ける面を選ぶ点）。
 * 109 の向かいの赤い大看板の棟（109_02/03・dogenzaka_05 の左手前）: 西の端に、屋上より高く伸びる赤い縦長の袖看板
 */
export const EXTRA_BLADES: Record<number, { near: [number, number]; blades: BladeSpec[] }> = {
  136587824: { near: [-116, 16], blades: [{ t: 0.88, y0: 5.2, y1: 21.5, out: 2.4, art: BLADE_ART.redShop }] },
  // 交差点の北西の街区の西の端（dogenzaka_13: 道玄坂下から駅を向くと、通りの抜けの先に白い丸みのある棟と赤い縦幕が立つ）。
  // 通りに沿って見る人へ向いた白い壁として、南の面の西の端から歩道の上へ張り出す
  136690966: { near: [-59.2, -23.9], blades: [{ t: 0.03, y0: 6.5, y1: 23.5, out: 5, art: BLADE_ART.whiteBanner }] },
}

export interface LatticeMember {
  a: V3
  b: V3
  /** 太さの半分 m */
  half: number
}

const onEdge = (e: Edge, t: number, out: number): [number, number] => [e.ax + (e.bx - e.ax) * t + e.nx * out, e.az + (e.bz - e.az) * t + e.nz * out]

/**
 * 格子の部材。段ごとの水平材、スパンごとの柱、各マスの斜材（隣り合うマスで向きを入れ替えてジグザグにする）。
 * detail = false（軽量設定）では斜材を省く
 */
export function latticeMembers(b: MapBuilding, detail = true): LatticeMember[] {
  if (b.id !== LATTICE.building) return []
  const L = LATTICE
  const out: LatticeMember[] = []
  for (const f of L.faces) {
    const e = pickEdge(b.pts, f.near)
    if (!e) continue
    const tiers = Math.max(1, Math.floor((b.h - f.y0) / L.tier))
    const bays = Math.max(1, Math.round(e.len / L.bay))
    const y = (k: number) => b.y + f.y0 + k * L.tier
    for (let k = 0; k <= tiers; k++) {
      const [ax, az] = onEdge(e, 0, L.out)
      const [bx, bz] = onEdge(e, 1, L.out)
      out.push({ a: [ax, y(k), az], b: [bx, y(k), bz], half: L.chord })
    }
    for (let i = 0; i <= bays; i++) {
      const [x, z] = onEdge(e, i / bays, L.out)
      out.push({ a: [x, y(0), z], b: [x, y(tiers), z], half: L.chord })
    }
    if (!detail) continue
    for (let k = 0; k < tiers; k++) {
      for (let i = 0; i < bays; i++) {
        const flip = (i + k) % 2 === 1
        const [ax, az] = onEdge(e, (i + (flip ? 1 : 0)) / bays, L.out)
        const [bx, bz] = onEdge(e, (i + (flip ? 0 : 1)) / bays, L.out)
        out.push({ a: [ax, y(k), az], b: [bx, y(k + 1), bz], half: L.brace })
      }
    }
  }
  return out
}

export interface Blade {
  /** 壁の付け根と、突き出した先 */
  ax: number
  az: number
  bx: number
  bz: number
  y0: number
  y1: number
  art: number
}

/** 袖看板。壁に直角に通りへ突き出す（通りに沿って歩く人から正面に見える） */
export function latticeBlades(b: MapBuilding): Blade[] {
  const lattice = b.id === LATTICE.building
  const extra = EXTRA_BLADES[b.id]
  if (!lattice && !extra) return []
  const e = pickEdge(b.pts, lattice ? LATTICE.faces[0].near : extra.near)
  if (!e) return []
  // 格子の棟は格子の面の外から、ほかの棟は壁のすぐ外から突き出す
  const from = lattice ? LATTICE.out + 0.1 : 0.3
  return (lattice ? LATTICE.blades : extra.blades).map((s) => {
    const [ax, az] = onEdge(e, s.t, from)
    const [bx, bz] = onEdge(e, s.t, from + s.out)
    return { ax, az, bx, bz, y0: b.y + s.y0, y1: b.y + s.y1, art: s.art }
  })
}
