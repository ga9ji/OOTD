import { describe, expect, it } from 'vitest'
import { EAST_BRIDGE, reachWest, tubeAxis, tubeColumns, tubeSection } from '../mapBridge'
import { pointInPolygon } from '../math'
import { world } from './helpers'

describe('gto mapBridge: 明治通りをまたぐ駅の橋（ガラスのチューブ）', () => {
  const bridge = world.map.buildings.find((b) => b.id === 810356690)

  it('細長い輪郭から、中心線と半幅を取り出す。a が西の端', () => {
    expect(bridge).toBeTruthy()
    if (!bridge) return
    const axis = tubeAxis(bridge.pts)
    expect(axis).not.toBeNull()
    if (!axis) return
    expect(axis.len).toBeGreaterThan(80)
    expect(axis.half).toBeGreaterThan(8)
    expect(axis.half).toBeLessThan(13)
    expect(axis.ax).toBeLessThan(axis.bx)
    expect(Math.hypot(axis.ux, axis.uz)).toBeCloseTo(1, 5)
    expect(Math.hypot(axis.bx - axis.ax, axis.bz - axis.az)).toBeCloseTo(axis.len, 5)
    // 中心線は輪郭の中を通る
    for (const t of [0.1, 0.5, 0.9]) {
      expect(pointInPolygon(bridge.pts, axis.ax + (axis.bx - axis.ax) * t, axis.az + (axis.bz - axis.az) * t)).toBe(true)
    }
  })

  it('長い橋は西の端を JR の高架まで伸ばす（宮益坂下から見て、ガラスの帯が工事中の躯体へ横一直線につながる）', () => {
    if (!bridge) return
    const axis = tubeAxis(bridge.pts)
    if (!axis) return
    const long = reachWest(axis)
    expect(long.len).toBeCloseTo(axis.len + EAST_BRIDGE.westReach, 5)
    expect([long.bx, long.bz, long.ux, long.uz, long.half]).toEqual([axis.bx, axis.bz, axis.ux, axis.uz, axis.half])
    expect(Math.hypot(long.bx - long.ax, long.bz - long.az)).toBeCloseTo(long.len, 5)
    // 西の端は、JR の駅舎の東の面（南の端は 96, 70）から 12m 以内
    expect(Math.hypot(long.ax - 96, long.az - 70)).toBeLessThan(12)
    // 短い棟（塔へつながる渡り）は伸ばさない
    const short = { ...axis, len: 50 }
    expect(reachWest(short)).toBe(short)
  })

  it('向かい合う長い辺の無い輪郭では中心線を返さない', () => {
    expect(tubeAxis([0, 0, 10, 0, 5, 8])).toBeNull()
  })

  it('断面は下から 白い腰 → ガラス → 丸い屋根 の順で、屋根は外へふくらんだ弧になり棟で中心に届く', () => {
    const half = 10
    const sec = tubeSection(half)
    expect(sec[0]).toMatchObject({ s: half, y: EAST_BRIDGE.deck, part: 'fascia' })
    expect(sec[1]).toMatchObject({ y: EAST_BRIDGE.sill, part: 'glass' })
    expect(sec[2]).toMatchObject({ y: EAST_BRIDGE.eave, part: 'roof' })
    const last = sec[sec.length - 1]
    expect(last.s).toBeCloseTo(0, 6)
    expect(last.y).toBeCloseTo(EAST_BRIDGE.ridge, 6)
    for (let i = 1; i < sec.length; i++) {
      expect(sec[i].y).toBeGreaterThanOrEqual(sec[i - 1].y)
      expect(sec[i].s).toBeLessThanOrEqual(sec[i - 1].s)
    }
    // 弧: 屋根の途中の点は、軒と棟を結ぶ直線より外（上）にある
    const eave = sec[2]
    const mid = sec[2 + Math.floor((sec.length - 3) / 2)]
    const k = (eave.s - mid.s) / (eave.s - last.s)
    expect(mid.y).toBeGreaterThan(eave.y + (last.y - eave.y) * k + 0.5)
    // 軒の立ち上がりは急で、棟の近くは寝ている
    const rise0 = (sec[3].y - sec[2].y) / Math.max(0.001, sec[2].s - sec[3].s)
    const rise1 = (last.y - sec[sec.length - 2].y) / Math.max(0.001, sec[sec.length - 2].s - last.s)
    expect(rise0).toBeGreaterThan(rise1 * 3)
  })

  it('低い棟は屋根だけ低くなり、桁下の高さは変わらない（バスが下を抜けられる）', () => {
    const low = tubeSection(8, 0.5)
    expect(low[0].y).toBe(EAST_BRIDGE.deck)
    expect(EAST_BRIDGE.deck).toBeGreaterThanOrEqual(4.5)
    expect(low[low.length - 1].y).toBeLessThan(EAST_BRIDGE.ridge - 2)
    expect(low[low.length - 1].y).toBeGreaterThan(low[2].y)
  })

  it('柱は車道にも建物にも立たず、橋の幅の内側に並ぶ', () => {
    if (!bridge) return
    const axis = tubeAxis(bridge.pts)
    if (!axis) return
    const cols = tubeColumns(world, axis)
    expect(cols.length).toBeGreaterThanOrEqual(4)
    for (const [x, z] of cols) {
      expect(world.insideBuilding(x, z)).toBe(false)
      const road = world.nearestRoad(x, z, true, 20)
      if (road) expect(road.dist).toBeGreaterThan(world.map.roads[road.road].width / 2 + 1.5)
      const t = (x - axis.ax) * axis.ux + (z - axis.az) * axis.uz
      const side = Math.abs((x - axis.ax) * -axis.uz + (z - axis.az) * axis.ux)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(axis.len)
      expect(side).toBeLessThan(axis.half)
    }
  })
})
