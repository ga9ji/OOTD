// Grand Theft Outfit [部品: city] 原宿・表参道の街並みの決まりごと。three/DOM なし。
// 入口: HARAJUKU_BLOCK_STYLES（建物ごとの外装。map.ts の blockStyleOf / landmarkOf が渋谷・新宿の表と合わせて引く）
//       / HARAJUKU_STREET_FURNITURE（通りごとの街灯と並木）/ HARAJUKU_MAIN_STREETS（壁の広告面を付ける通り）
//       / takeshitaArch(world)（竹下通りの駅側の入口に立つ門の置き場所）
//       / groveTrees(world)（神宮の森。線路の西の、建物の無い一帯に立てる木の場所）/ inGrove(world, x, z)（森の地面か）
// 契約: 建物は OSM の id で指す（原宿の地図にしか無い id なので、ほかのエリアには効かない）。色・壁の種類・板の位置と大きさだけを決め、
//       絵柄と店名は架空（renderCityBoards の絵）。画面に出す実名は通りの名前だけ（門の字）。
//       現地写真との突き合わせはしていない。「低い街並み・表参道のケヤキ並木・竹下通りの淡い色の店・線路の西の森」が見分けられる所まで。
import { cumulative, hash, pointAlong } from './math'
import type { BlockStyle, GatePlacement, PropKind } from './map'
import type { GtoWorld } from './types'

/** 明治通りと表参道の交差点（原点） */
const CROSSING: [number, number] = [0, 0]
/** 竹下通りの真ん中 */
const TAKESHITA_MID: [number, number] = [-45, -305]

export const HARAJUKU_BLOCK_STYLES: Record<number, BlockStyle> = {
  // ---- 交差点の四つ角: ガラスの商業棟と、交差点へ向いた大型ビジョン ----
  139043543: { facade: 'curtain', color: 0xa8c4cf, shop: 0xf4f1ea, vision: { toward: CROSSING, tile: 1 }, boards: [{ toward: CROSSING, w: 11, h: 5, art: 2, lift: 1.4 }] },
  139043545: { facade: 'ribbon', color: 0xf1efe9, shop: 0xe9e4d8, vision: { toward: CROSSING, tile: 3 }, boards: [{ toward: CROSSING, w: 12, h: 5, art: 5, lift: 1.4, shift: 3 }] },
  1073294162: { facade: 'curtain', color: 0x9fbfb2, shop: 0xf4f1ea, boards: [{ toward: CROSSING, w: 10, h: 6, art: 0, lift: 1.6 }] },
  139043763: { facade: 'tile', color: 0xc9b9a0, shop: 0xf4f1ea },
  139043712: { facade: 'office', color: 0xe9e6de, shop: 0xd9c9a8, boards: [{ toward: CROSSING, w: 8, h: 6, art: 4, lift: 1.6 }] },
  139043534: { facade: 'office', color: 0xdcd6ca, shop: 0xf4f1ea },
  // ---- 表参道: 並木の奥の、ガラスと石の長い棟 ----
  139070531: { facade: 'curtain', color: 0xb9cbd4, shop: 0xe9e4d8 },
  96378352: { facade: 'office', color: 0xe4ded2, shop: 0xf4f1ea },
  139085887: { facade: 'curtain', color: 0xaebfcc, shop: 0xf4f1ea },
  96369982: { facade: 'ribbon', color: 0xefece5, shop: 0xd9c9a8 },
  // ---- キャットストリートの入口の、茶のタイルの棟 ----
  139043580: { facade: 'tile', color: 0x9a7b62, shop: 0xe9e4d8 },
  // ---- 竹下通り: 夜に外装ごと光る、淡い色の店（桃・薄荷・藤・檸檬・空） ----
  139072558: { facade: 'blank', color: 0xff9ec4, shop: 0xff7fb0, lit: true, vision: { toward: TAKESHITA_MID, tile: 2 } },
  139072539: { facade: 'blank', color: 0x8fe3cf, shop: 0x6fd0ba, lit: true },
  139072590: { facade: 'blank', color: 0xc3a6f5, shop: 0xa98be8, lit: true },
  139078664: { facade: 'blank', color: 0xffe37a, shop: 0xf5cf4a, lit: true },
  139078646: { facade: 'blank', color: 0x8fd0ff, shop: 0x6fbaf0, lit: true },
  139072579: { facade: 'blank', color: 0xffb38a, shop: 0xf59a6a, lit: true },
}

/** 通りごとの街灯の型と間隔・街路樹の間隔（m）。map.ts の STREET_FURNITURE と同じ形（通り名は実名）。明治通りと青山通りは渋谷の表のまま */
export const HARAJUKU_STREET_FURNITURE: Record<string, { lamp: PropKind; every: number; tree: number }> = {
  // ケヤキ並木。ほかの通りより木の間隔を詰める
  表参道: { lamp: 'lamp-koen', every: 24, tree: 8 },
  代々木公園通り: { lamp: 'lamp-plain', every: 28, tree: 10 },
  キャットストリート: { lamp: 'lamp-miyamasu', every: 22, tree: 16 },
  原宿通り: { lamp: 'lamp-dogenzaka', every: 22, tree: 0 },
  ファイアー通り: { lamp: 'lamp-plain', every: 28, tree: 14 },
}

/** 壁の広告面を付ける通り（実名） */
export const HARAJUKU_MAIN_STREETS = ['表参道', '竹下通り', 'キャットストリート', '原宿通り']

/** 門を立てる通り（実名。門の字にも使う）と、駅側の端から何 m 入った所に立てるか */
export const TAKESHITA_ARCH = { street: '竹下通り', inset: 6, halfMax: 5, halfMin: 2 } as const

/**
 * 竹下通りの入口の門の置き場所。駅（西）側の端から少し入った所で、通りの両脇の壁ぎわまで柱を寄せる。
 * 通りが地図に無ければ null（ほかのエリアでは立たない）。
 */
export function takeshitaArch(world: GtoWorld): GatePlacement | null {
  const A = TAKESHITA_ARCH
  const road = world.map.roads.find((r) => r.name === A.street)
  if (!road) return null
  const n = road.pts.length
  const startWest = road.pts[0] < road.pts[n - 2]
  const cum = cumulative(road.pts)
  const total = cum[cum.length - 1]
  if (total < A.inset * 2) return null
  const at = pointAlong(road.pts, cum, startWest ? A.inset : total - A.inset)
  // 通りの奥（東）へ向かう向き
  const heading = startWest ? at.heading : at.heading + Math.PI
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

/** 神宮の森: 線路の西の、建物の無い一帯（x・z の範囲 m）と、木の間隔 m・道から離す距離 m */
export const GROVE = { minX: -436, maxX: -292, minZ: -445, maxZ: -138, gap: 9, roadClear: 5.5 } as const

/** 森の地面（土と下草の色に塗る所）か。舗装の地面の中で、森の一帯だけ色を変える */
export const inGrove = (world: Pick<GtoWorld, 'area'>, x: number, z: number): boolean =>
  world.area === 'harajuku' && x >= GROVE.minX - GROVE.gap && x <= GROVE.maxX && z >= GROVE.minZ - GROVE.gap && z <= GROVE.maxZ

/**
 * 森の木の場所。格子の点を少しずつ散らし、建物の中・道（参道と車道）の上・橋のたもとを避ける。
 * 地図だけから決まり、毎回同じ並びになる。原宿のほかのエリアでは空。
 */
export function groveTrees(world: GtoWorld): { x: number; z: number }[] {
  if (world.area !== 'harajuku') return []
  const G = GROVE
  const out: { x: number; z: number }[] = []
  let i = 0
  for (let gz = G.minZ; gz <= G.maxZ; gz += G.gap) {
    for (let gx = G.minX; gx <= G.maxX; gx += G.gap) {
      i++
      const x = Math.round((gx + (hash(i, 1) - 0.5) * G.gap * 0.7) * 10) / 10
      const z = Math.round((gz + (hash(i, 2) - 0.5) * G.gap * 0.7) * 10) / 10
      if (world.insideBuilding(x, z)) continue
      const near = world.nearestRoad(x, z, false, 30)
      if (near && near.dist < world.map.roads[near.road].width / 2 + G.roadClear) continue
      if (world.resolveCircle(x, z, 0.6).hit) continue
      out.push({ x, z })
    }
  }
  return out
}
