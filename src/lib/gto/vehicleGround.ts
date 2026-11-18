// Grand Theft Outfit [部品: vehicle] 車輪が乗る面の高さ。
// 入口: VEHICLE_GROUND / surfaceLift / surfaceY / wheelSurface
// 契約: 地表（world.groundY）の上に街の描画が敷いている面（車道の舗装、その外の縁石の帯、歩道の敷石、
//       スクランブル交差点の広場）の厚みを足して、車輪1つずつの接地面の高さを返す。
//       数字は renderCityRoads.ts が道を敷く高さと同じ。車道の縁を1輪だけ越えれば、その輪だけが段を降りる。
import { dirOf } from './math'
import type { GtoWorld } from './types'
import type { WheelHeights } from './vehicleSuspension'

/** 面の厚み（地表からの高さ m） */
export const VEHICLE_GROUND = {
  /** 車道の舗装 */
  road: 0.12,
  /** 車道の外の縁石の帯と、その幅 m（幅 5m 以上の通りだけ） */
  kerb: 0.09,
  kerbWidth: 0.25,
  /** 歩道の敷石 */
  walk: 0.07,
  /** スクランブル交差点の広場と、その半径 m */
  plaza: 0.13,
  plazaRadius: 20,
  /** 道を探す範囲 m */
  reach: 20,
  walkReach: 8,
}

interface Probe {
  lift: number
  /** 車道の縁までの余裕 m（車道の内側で正。車道の外や広場では 0） */
  margin: number
}

function probe(world: GtoWorld, x: number, z: number): Probe {
  const tune = VEHICLE_GROUND
  const center = Math.hypot(x, z)
  if (center < tune.plazaRadius) return { lift: tune.plaza, margin: 0 }
  const near = world.nearestRoad(x, z, true, tune.reach)
  if (near) {
    const road = world.map.roads[near.road]
    const edge = road.width / 2 - near.dist
    // 広場のすぐ外では、縁を越えた輪が広場に乗るかもしれないので、輪ごとに調べさせる
    if (edge >= 0) return { lift: tune.road, margin: Math.min(edge, center - tune.plazaRadius) }
    if (edge > -tune.kerbWidth && road.width >= 5 && road.kind !== 'service') return { lift: tune.kerb, margin: 0 }
  }
  const walk = world.nearestRoad(x, z, false, tune.walkReach)
  if (walk && !walk.drive && walk.dist < world.map.roads[walk.road].width / 2) return { lift: tune.walk, margin: 0 }
  return { lift: 0, margin: 0 }
}

/** 地表からその場所の面までの厚み m */
export const surfaceLift = (world: GtoWorld, x: number, z: number): number => probe(world, x, z).lift

/** その場所の面の高さ（世界の y） */
export const surfaceY = (world: GtoWorld, x: number, z: number): number => world.groundY(x, z) + surfaceLift(world, x, z)

/**
 * 四輪の接地面の高さ。offsets は車輪の位置（車体の座標。右が ＋x、前が −z）。
 * 車が車道の縁から十分に内側にいるときは、道を1回だけ調べて済ませる。
 */
export function wheelSurface(world: GtoWorld, x: number, z: number, heading: number, offsets: readonly (readonly [number, number])[]): WheelHeights {
  const f = dirOf(heading)
  const center = probe(world, x, z)
  const reach = Math.max(...offsets.map(([lx, lz]) => Math.hypot(lx, lz)))
  const inside = center.margin > reach
  return offsets.map(([lx, lz]) => {
    const wx = x - f.z * lx - f.x * lz
    const wz = z + f.x * lx - f.z * lz
    return world.groundY(wx, wz) + (inside ? center.lift : probe(world, wx, wz).lift)
  }) as WheelHeights
}
