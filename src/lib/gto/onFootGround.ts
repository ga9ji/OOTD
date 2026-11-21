// Grand Theft Outfit [部品: onfoot] 足が乗る面の高さ。
// 入口: createFootGround(world) → ground.lift(x, z) / FOOT_GROUND
// 契約: 街の描画は地表（world.groundY）の上に舗装・敷石・横断歩道の縞を厚みを付けて敷いている
//       （renderCityRoads.ts）。人を地表の高さに置くと、靴が舗装へ沈み、足元の影が舗装の下へ隠れて、
//       体が浮いて滑っているように見える。ここは人の足元の面の厚み（地表からの高さ m）を返す。
//       車道・縁石・歩道・広場・横断歩道の縞を、敷く条件・幅・高さとも renderCityRoads.ts と同じに並べ、
//       重なっている所はいちばん上の面を返す。three/DOM なし。
import { areaDef } from './areas'
import { isGroundRoad, isScrambleCrossing } from './map'
import { FORK_RED_PATCHES, FORK_ZEBRA_WIDTH, forkCrossing } from './map109'
import { BUS_APRON } from './mapEast'
import { isStubCrossing } from './mapStreet'
import type { GtoWorld } from './types'

/** 面の高さ（地表から m）。renderCityRoads.ts が敷く高さと同じ */
export const FOOT_GROUND = {
  /** 横断歩道の縞 */
  zebra: 0.2,
  /** 109 前の分岐の赤茶の舗装 */
  redPatch: 0.16,
  /** スクランブル交差点の広場と、その半径 m */
  plaza: 0.13,
  plazaRadius: 20,
  /** 車道の舗装・その外の縁石の帯・東口のバス乗り場の路面・歩道の敷石 */
  road: 0.12,
  kerb: 0.09,
  apron: 0.1,
  walk: 0.07,
}

export interface FootGround {
  /** 地表からその場所に敷かれた面（舗装・敷石・縞）までの厚み m。何も敷かれていなければ 0 */
  lift: (x: number, z: number) => number
  /** 地表（world.groundY）から、描かれている足元の面までの上がり m（敷かれた面と、描かれた地面の高いほう） */
  rise: (x: number, z: number) => number
}

/**
 * 描かれている地面の高さ。地面の板（renderCityRoads.ts の buildTerrain）は地表を step m の格子で拾い、
 * 升目を対角線（格子の小さい角 → 大きい角）で三角2枚に割って張ってあるので、あいだの高さは地表と数 cm ずれる。
 */
export function terrainMeshY(world: GtoWorld, step: number, x: number, z: number): number {
  const el = world.map.elevation
  const c = Math.floor((x - el.x0) / step)
  const r = Math.floor((z - el.z0) / step)
  const ax = el.x0 + c * step
  const az = el.z0 + r * step
  const u = (x - ax) / step
  const v = (z - az) / step
  const a = world.groundY(ax, az)
  const far = world.groundY(ax + step, az + step)
  // 対角線より z の側の三角は (c, r+1) の角、x の側の三角は (c+1, r) の角を使う
  if (v >= u) {
    const b = world.groundY(ax, az + step)
    return a + u * (far - b) + v * (b - a)
  }
  const d = world.groundY(ax + step, az)
  return a + u * (d - a) + v * (far - d)
}

interface Strip {
  pts: readonly number[]
  half: number
  lift: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const makeStrip = (pts: readonly number[], width: number, lift: number): Strip => {
  const half = width / 2
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i])
    maxX = Math.max(maxX, pts[i])
    minZ = Math.min(minZ, pts[i + 1])
    maxZ = Math.max(maxZ, pts[i + 1])
  }
  return { pts, half, lift, minX: minX - half, maxX: maxX + half, minZ: minZ - half, maxZ: maxZ + half }
}

/** 点が帯（折れ線の両側 half）の中にあるか */
function inStrip(s: Strip, x: number, z: number): boolean {
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false
  const limit = s.half * s.half
  for (let i = 0; i + 3 < s.pts.length; i += 2) {
    const ax = s.pts[i]
    const az = s.pts[i + 1]
    const dx = s.pts[i + 2] - ax
    const dz = s.pts[i + 3] - az
    const len = dx * dx + dz * dz
    const t = len > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len)) : 0
    const px = ax + dx * t - x
    const pz = az + dz * t - z
    if (px * px + pz * pz <= limit) return true
  }
  return false
}

/** 面の帯（renderCityRoads.ts が道・歩道・縞を敷く線と幅と高さ）。高い面ほど前に並べる */
function surfaceStrips(world: GtoWorld): Strip[] {
  const T = FOOT_GROUND
  const strips: Strip[] = []
  // [areas] 原点の広場と、渋谷だけの固定の路面は、そのエリアでだけ（renderCityRoads.ts と同じ出し分け）
  const area = areaDef(world)
  for (const r of world.map.roads) {
    if (!isGroundRoad(r)) continue
    if (r.crossing) {
      if (area.scramble && isStubCrossing(r)) continue
      const fork = area.shibuyaSet ? forkCrossing(r) : null
      if (fork === 'none') continue
      const scramble = area.scramble && isScrambleCrossing(r)
      const diagonal = scramble && r.pts.some((v, i) => i % 2 === 0 && Math.hypot(v, r.pts[i + 1]) < 1)
      strips.push(makeStrip(r.pts, fork ? FORK_ZEBRA_WIDTH : scramble ? (diagonal ? 7 : 9) : Math.max(r.width, 4), T.zebra))
    } else if (r.drive) {
      strips.push(makeStrip(r.pts, r.width, T.road))
      if (r.width >= 5 && r.kind !== 'service') strips.push(makeStrip(r.pts, r.width + 0.5, T.kerb))
    } else {
      strips.push(makeStrip(r.pts, r.name === '渋谷センター街' ? r.width + 1.5 : r.width, T.walk))
    }
  }
  if (area.shibuyaSet) {
    strips.push(makeStrip(BUS_APRON.crosswalk.line, BUS_APRON.crosswalk.width, T.zebra))
    for (const lane of BUS_APRON.lanes) strips.push(makeStrip(lane.line, lane.width, T.apron))
    for (const [x, z, r] of FORK_RED_PATCHES) strips.push(makeStrip([x, z, x, z], r * 2, T.redPatch))
  }
  // スクランブル交差点の広場
  if (area.scramble) strips.push(makeStrip([0, 0, 0, 0], T.plazaRadius * 2, T.plaza))
  return strips.sort((a, b) => b.lift - a.lift)
}

/**
 * @param terrainStep 地面の板の格子の間隔 m（画質の設定 quality.terrainStep と同じ値）
 */
export function createFootGround(world: GtoWorld, terrainStep: number): FootGround {
  const strips = surfaceStrips(world)
  // 重なっている所は、いちばん上の面に立つ
  const lift = (x: number, z: number) => {
    for (const s of strips) if (inStrip(s, x, z)) return s.lift
    return 0
  }
  return {
    lift,
    rise: (x, z) => Math.max(lift(x, z), terrainMeshY(world, terrainStep, x, z) - world.groundY(x, z)),
  }
}
