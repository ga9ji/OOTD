import { describe, expect, it } from 'vitest'
import { createFootGround, FOOT_GROUND, terrainMeshY } from '../onFootGround'
import { isGroundRoad, isScrambleCrossing } from '../map'
import { VEHICLE_GROUND } from '../vehicleGround'
import { world } from './helpers'

describe('onFootGround: 足が乗る面の高さ', () => {
  const ground = createFootGround(world, 5)

  it('スクランブル交差点の横断歩道の上では、縞の高さに立つ（足が縞へ沈まない・影が縞の下へ隠れない）', () => {
    const zebra = world.map.roads.find((r) => isGroundRoad(r) && isScrambleCrossing(r))
    expect(zebra).toBeDefined()
    if (!zebra) return
    const x = (zebra.pts[0] + zebra.pts[2]) / 2
    const z = (zebra.pts[1] + zebra.pts[3]) / 2
    expect(ground.lift(x, z)).toBe(FOOT_GROUND.zebra)
    expect(FOOT_GROUND.zebra).toBeGreaterThan(VEHICLE_GROUND.plaza)
  })

  it('横断歩道の外: 車道の上は舗装の高さ、歩道（車の通らない道）の上は敷石の高さ、道から遠い所は地表のまま', () => {
    const far = (r: { pts: number[] }) => Math.hypot(r.pts[0], r.pts[1]) > 80
    const drive = world.map.roads.find((r) => isGroundRoad(r) && r.drive && !r.crossing && far(r))
    const walk = world.map.roads.find((r) => isGroundRoad(r) && !r.drive && !r.crossing && far(r))
    expect(drive && walk).toBeTruthy()
    if (!drive || !walk) return
    // 道の真ん中は、少なくともその道の面の高さ（上に横断歩道が重なっていれば縞の高さ）
    expect(ground.lift(drive.pts[0], drive.pts[1])).toBeGreaterThanOrEqual(FOOT_GROUND.road)
    expect(ground.lift(walk.pts[0], walk.pts[1])).toBeGreaterThanOrEqual(FOOT_GROUND.walk)
    expect(ground.lift(world.bounds.minX - 500, world.bounds.minZ - 500)).toBe(0)
    // 車輪が乗る面と数字がそろっている
    expect(FOOT_GROUND.road).toBe(VEHICLE_GROUND.road)
    expect(FOOT_GROUND.walk).toBe(VEHICLE_GROUND.walk)
    expect(FOOT_GROUND.plaza).toBe(VEHICLE_GROUND.plaza)
  })

  it('面の高さは 0〜縞の高さに収まる', () => {
    for (let i = 0; i < 200; i++) {
      const x = -150 + ((i * 37) % 300)
      const z = -150 + ((i * 91) % 300)
      const lift = ground.lift(x, z)
      expect(lift).toBeGreaterThanOrEqual(0)
      expect(lift).toBeLessThanOrEqual(FOOT_GROUND.zebra)
    }
  })

  it('道の無い所では、描かれている地面（地表を粗い格子で三角に張った面）の高さに立つ: 格子の点では地表と同じ、あいだは三角の面の上', () => {
    const step = 5
    const el = world.map.elevation
    const x0 = el.x0 + step * 7
    const z0 = el.z0 + step * 9
    expect(terrainMeshY(world, step, x0, z0)).toBeCloseTo(world.groundY(x0, z0), 6)
    // 升目の対角線（左上→右下）の上は、両端の平均
    const mid = terrainMeshY(world, step, x0 + step / 2, z0 + step / 2)
    expect(mid).toBeCloseTo((world.groundY(x0, z0) + world.groundY(x0 + step, z0 + step)) / 2, 6)
    // 辺の上は、辺の両端のあいだ
    const edge = terrainMeshY(world, step, x0 + step / 2, z0)
    expect(edge).toBeCloseTo((world.groundY(x0, z0) + world.groundY(x0 + step, z0)) / 2, 6)
  })

  it('足元の面の上がり（地表からの高さ）は、敷かれた面の厚みと、描かれた地面のずれの大きいほう。地面の下には立たない', () => {
    const rough = createFootGround(world, 5)
    for (let i = 0; i < 300; i++) {
      const x = -200 + ((i * 37) % 400)
      const z = -200 + ((i * 91) % 400)
      const rise = rough.rise(x, z)
      expect(rise).toBeGreaterThanOrEqual(rough.lift(x, z) - 1e-9)
      expect(rise).toBeGreaterThanOrEqual(terrainMeshY(world, 5, x, z) - world.groundY(x, z) - 1e-9)
      expect(rise).toBeLessThan(1)
    }
  })
})
