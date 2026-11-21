// Grand Theft Outfit [部品: city] 新宿（東口・歌舞伎町・新宿三丁目）の街並みの決まりごと。three/DOM なし。
// 入口: SHINJUKU_BLOCK_STYLES（建物ごとの外装。map.ts の blockStyleOf / landmarkOf が渋谷の表と合わせて引く）
//       / SHINJUKU_STREET_FURNITURE（通りごとの街灯と並木）/ SHINJUKU_MAIN_STREETS（壁の広告面を付ける通り）
//       / kabukichoArch(world)（歌舞伎町の通りの入口に立つ赤い門の置き場所）
// 契約: 建物は OSM の id で指す（新宿の地図にしか無い id なので、渋谷には効かない）。色・壁の種類・板の位置と大きさだけを決め、
//       絵柄と店名は架空（renderCityBoards の絵）。画面に出す実名は通りの名前だけ（門の字）。
//       現地写真との突き合わせはしていない。東口の広場と歌舞伎町の通りが「それらしく」見分けられる所まで。
import { cumulative, pointAlong } from './math'
import type { BlockStyle, GatePlacement, PropKind } from './map'
import type { GtoWorld } from './types'

/** 東口の駅前広場（大型ビジョンと広告塔は、ここへ向ける） */
const EAST_PLAZA: [number, number] = [-28, 16]
/** 東口の交差点（原点） */
const EAST_CROSSING: [number, number] = [0, 0]
/** 歌舞伎町の広場（通りの突き当たり） */
const KABUKI_SQUARE: [number, number] = [-5, -300]

export const SHINJUKU_BLOCK_STYLES: Record<number, BlockStyle> = {
  // ---- 東口の広場の北: 広場へ向いた大型ビジョンの棟（待ち合わせの目印） ----
  55798483: { facade: 'ribbon', color: 0xe6e9ec, shop: 0xf4f1ea, vision: { toward: EAST_PLAZA, tile: 1 }, boards: [{ toward: EAST_PLAZA, w: 12, h: 5, art: 3, lift: 1.4, shift: 4 }] },
  // 交差点の北東の角のガラスの棟と、その西隣
  137626288: { facade: 'curtain', color: 0x9fb6c8, shop: 0xe9e4d8, boards: [{ toward: EAST_CROSSING, w: 10, h: 8, art: 2, lift: 1.6 }] },
  170625420: { facade: 'office', color: 0xd8d2c6, shop: 0xf4f1ea, boards: [{ toward: EAST_PLAZA, w: 9, h: 9, art: 4, lift: 1.6, shift: -3 }] },
  // ---- 広場の東と南: 白い角の棟、茶のタイルの棟、駅ビル ----
  138533189: { facade: 'office', color: 0xf0ede6, shop: 0xd9c9a8, boards: [{ toward: EAST_PLAZA, w: 10, h: 8, art: 0, lift: 1.6 }] },
  55798486: { facade: 'tile', color: 0xb49a80, shop: 0xe9e4d8 },
  165027540: { facade: 'ribbon', color: 0xf1f0ec, shop: 0xf4f1ea, boards: [{ toward: EAST_PLAZA, w: 15, h: 5.5, art: 3, lift: 1.4, shift: -6 }, { toward: EAST_PLAZA, w: 9, h: 4.2, art: 6, lift: 1.2, shift: 10 }] },
  // 新宿通りを東へ進んだ先の、茶色いタイルの大きな棟
  55798488: { facade: 'tile', color: 0x8a6c55, shop: 0xd9c9a8 },
  180069986: { facade: 'curtain', color: 0xa9bccb, shop: 0xe9e4d8 },
  // ---- 歌舞伎町: 夜に外装ごと光る棟（通りの入口と、広場の手前） ----
  137626283: { facade: 'blank', color: 0xf0468c, shop: 0xe23a7c, lit: true, vision: { toward: [-22, -160], tile: 2 } },
  137626102: { facade: 'blank', color: 0x18b7c9, shop: 0x1596a6, lit: true },
  137626199: { facade: 'blank', color: 0xf2c230, shop: 0xe0a91a, lit: true, vision: { toward: [-4, -220], tile: 0 } },
  137626176: { facade: 'blank', color: 0x8a4fd8, shop: 0x7038c0, lit: true },
  137626300: { facade: 'blank', color: 0xe23a3a, shop: 0xc92a2a, lit: true, vision: { toward: KABUKI_SQUARE, tile: 3 }, boards: [{ toward: KABUKI_SQUARE, w: 11, h: 6, art: 7, lift: 1.6 }] },
  153133129: { facade: 'blank', color: 0xff6a2b, shop: 0xe2562b, lit: true },
}

/** 通りごとの街灯の型と間隔・街路樹の間隔（m）。map.ts の STREET_FURNITURE と同じ形（通り名は実名） */
export const SHINJUKU_STREET_FURNITURE: Record<string, { lamp: PropKind; every: number; tree: number }> = {
  新宿通り: { lamp: 'lamp-koen', every: 20, tree: 14 },
  靖国通り: { lamp: 'lamp-plain', every: 28, tree: 12 },
  甲州街道: { lamp: 'lamp-plain', every: 32, tree: 14 },
  御苑通り: { lamp: 'lamp-plain', every: 30, tree: 12 },
  区役所通り: { lamp: 'lamp-miyamasu', every: 22, tree: 0 },
  花道通り: { lamp: 'lamp-dogenzaka', every: 20, tree: 0 },
  歌舞伎町一番街通り: { lamp: 'lamp-dogenzaka', every: 18, tree: 0 },
  セントラルロード: { lamp: 'lamp-dogenzaka', every: 18, tree: 12 },
}

/** 壁の広告面を付ける通り（実名） */
export const SHINJUKU_MAIN_STREETS = ['新宿通り', '靖国通り', '甲州街道', '御苑通り', '区役所通り', '花道通り', '歌舞伎町一番街通り', 'セントラルロード']

/** 門を立てる通り（実名。門の字にも使う）と、靖国通り側の端から何 m 入った所に立てるか */
export const KABUKICHO_ARCH = { street: '歌舞伎町一番街通り', inset: 7, halfMax: 5.5, halfMin: 2.5 } as const

/**
 * 歌舞伎町の通りの入口の門の置き場所。靖国通り（南）側の端から少し入った所で、通りの両脇の壁ぎわまで柱を寄せる。
 * 通りが地図に無ければ null（渋谷では立たない）。
 */
export function kabukichoArch(world: GtoWorld): GatePlacement | null {
  const A = KABUKICHO_ARCH
  // 同じ名前の道のうち、いちばん南（靖国通り寄り）まで届いている区間を入口にする
  let road: { pts: number[] } | null = null
  let south = -Infinity
  for (const r of world.map.roads) {
    if (r.name !== A.street || !r.drive) continue
    for (let i = 1; i < r.pts.length; i += 2) {
      if (r.pts[i] > south) {
        south = r.pts[i]
        road = r
      }
    }
  }
  if (!road) return null
  const n = road.pts.length
  const startSouth = road.pts[1] > road.pts[n - 1]
  const cum = cumulative(road.pts)
  const total = cum[cum.length - 1]
  if (total < A.inset * 2) return null
  const at = pointAlong(road.pts, cum, startSouth ? A.inset : total - A.inset)
  // 通りの奥（北）へ向かう向き
  const heading = startSouth ? at.heading : at.heading + Math.PI
  const rx = Math.cos(heading)
  const rz = Math.sin(heading)
  const reach = (side: number) => {
    let d = 1
    while (d + 0.25 <= A.halfMax && !world.resolveCircle(at.x + rx * (d + 0.25) * side, at.z + rz * (d + 0.25) * side, 0.5).hit) d += 0.25
    return d
  }
  const half = Math.min(reach(1), reach(-1))
  if (half < A.halfMin) return null
  return { x: at.x, z: at.z, heading, half }
}
