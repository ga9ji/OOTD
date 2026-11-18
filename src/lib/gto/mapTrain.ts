// Grand Theft Outfit: JR の鉄桁ガードの上に止まっている電車（viaduct_02、miyamasuzaka_04、109_09/12 の突き当たりに見える）。
// 入口: parkedTrain(map) → 車両ごとの位置・高さ・向き。
// 契約: three にも DOM にも触れない。線路（OSM）に沿わせて並べるだけで、形と色は renderCityRoads.ts。
import type { ShibuyaMap } from './types'

/** 車両 1 両の寸法 m */
export const TRAIN_CAR = { length: 19.5, gap: 0.5, width: 2.9, height: 3.6 } as const

/** ガードが道をまたぐ所（宮益坂下とスクランブル交差点の間） */
const GUARD: [number, number] = [52.7, -13.2]
const CARS = 8

export interface TrainCar {
  x: number
  z: number
  /** レールの高さ */
  y: number
  /** 車体の長手の向き（x 軸からの角度、ラジアン） */
  yaw: number
}

interface Snap {
  x: number
  z: number
  y: number
  dx: number
  dz: number
  dist: number
}

/** JR の線路のうち、(x, z) にいちばん近い点と、そこでの線路の向き */
function snap(map: ShibuyaMap, x: number, z: number): Snap | null {
  let best: Snap | null = null
  for (const r of map.rails) {
    if (r.line !== 'jr') continue
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i]
      const az = r.pts[i + 1]
      const bx = r.pts[i + 2]
      const bz = r.pts[i + 3]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.01) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)))
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      const dist = Math.hypot(px - x, pz - z)
      if (best && dist >= best.dist) continue
      const ya = r.y[i / 2]
      const yb = r.y[i / 2 + 1]
      best = { x: px, z: pz, y: ya + (yb - ya) * t, dx: (bx - ax) / len, dz: (bz - az) / len, dist }
    }
  }
  return best
}

/** ガードのいちばん東の線路（宮益坂の側から見上げたとき、桁の縁の上に見える） */
function eastTrack(map: ShibuyaMap): [number, number] | null {
  let best: [number, number] | null = null
  for (const r of map.rails) {
    if (r.line !== 'jr') continue
    for (let i = 0; i < r.pts.length; i += 2) {
      if (Math.abs(r.pts[i + 1] - GUARD[1]) > 30 || Math.abs(r.pts[i] - GUARD[0]) > 60) continue
      if (!best || r.pts[i] > best[0]) best = [r.pts[i], r.pts[i + 1]]
    }
  }
  return best
}

/** 止まっている電車。西の線路（交差点側から見える）と、いちばん東の線路（宮益坂側から見える）に 1 編成ずつ */
export function parkedTrain(map: ShibuyaMap): TrainCar[] {
  const west = trainAt(map, GUARD)
  const east = eastTrack(map)
  if (!east || west.length === 0) return west
  const second = trainAt(map, east)
  // 同じ線路に重ねない
  return second.some((c) => west.some((w) => Math.hypot(w.x - c.x, w.z - c.z) < TRAIN_CAR.width * 2)) ? west : [...west, ...second]
}

function trainAt(map: ShibuyaMap, at: [number, number]): TrainCar[] {
  const start = snap(map, at[0], at[1])
  if (!start || start.dist > 30) return []
  const pitch = TRAIN_CAR.length + TRAIN_CAR.gap
  const cars: TrainCar[] = []
  // 中心から前後へ 1 両ずつ進み、そのつど線路へ寄せ直す（線路の曲がりに沿わせる）
  for (const dir of [1, -1]) {
    let cur = start
    let fx = start.dx * dir
    let fz = start.dz * dir
    for (let k = dir === 1 ? 0 : 1; k < CARS / 2 + (dir === 1 ? 0 : 1); k++) {
      const step = k === 0 ? 0 : pitch
      const next = snap(map, cur.x + fx * step, cur.z + fz * step)
      // 同じ線路の続きが無い（隣の線路へ飛ぶ・線路が切れる）所で止める
      if (!next || next.dist > 3.5) break
      if (next.dx * fx + next.dz * fz < 0) {
        fx = -next.dx
        fz = -next.dz
      } else {
        fx = next.dx
        fz = next.dz
      }
      cur = next
      const car = { x: next.x, z: next.z, y: next.y, yaw: Math.atan2(next.dz, next.dx) }
      if (dir === 1) cars.push(car)
      else cars.unshift(car)
    }
  }
  return cars
}
