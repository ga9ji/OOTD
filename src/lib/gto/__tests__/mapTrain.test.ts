// JR の高架に止まっている電車の割り付け
import { describe, expect, it } from 'vitest'
import mapJson from '../data/shibuyaMap.json'
import { parkedTrain, TRAIN_CAR } from '../mapTrain'
import type { ShibuyaMap } from '../types'

const map = mapJson as unknown as ShibuyaMap

describe('parkedTrain', () => {
  const cars = parkedTrain(map)
  it('ガードの上に 1 編成ぶんの車両が並ぶ', () => {
    expect(cars.length).toBeGreaterThanOrEqual(5)
    expect(cars.length).toBeLessThanOrEqual(16)
  })
  it('どの車両も JR の線路の真上にあり、高架の高さに載る', () => {
    for (const c of cars) {
      let best = Infinity
      for (const r of map.rails) {
        if (r.line !== 'jr') continue
        for (let i = 0; i + 3 < r.pts.length; i += 2) {
          const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3]
          const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1
          const t = Math.max(0, Math.min(1, ((c.x - ax) * (bx - ax) + (c.z - az) * (bz - az)) / l2))
          best = Math.min(best, Math.hypot(ax + (bx - ax) * t - c.x, az + (bz - az) * t - c.z))
        }
      }
      expect(best).toBeLessThan(0.6)
      expect(c.y).toBeGreaterThan(4)
    }
  })
  it('隣の車両と重ならない', () => {
    for (let i = 0; i < cars.length; i++) {
      for (let j = 0; j < i; j++) {
        const d = Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z)
        // 同じ編成なら 1 両ぶん、隣の線路なら車体の幅より離れる
        expect(d).toBeGreaterThan(TRAIN_CAR.width + 0.5)
      }
    }
  })
  it('線路の無い地図では何も置かない', () => {
    expect(parkedTrain({ ...map, rails: [] })).toEqual([])
  })
})
