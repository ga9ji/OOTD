import { describe, expect, it } from 'vitest'
import { BUS_BODY } from '../mapEast'
import { CURB_FENCES, EAST_CROSSWALKS, EAST_SIGNALS, FRONT_LANE, frontBuses, HOARDINGS, STAND_CLEAR } from '../mapEastFront'
import { PHOTO_STANDS, photoStandpoint } from '../mapPhoto'
import { world } from './helpers'

/** 宮益坂下の横断歩道の北の端（viaduct_01 の立ち位置） */
const STAND = { x: 144.5, z: -11.5 }

describe('gto mapEastFront: 宮益坂下から南を見たときの手前の層（乗り場の入口に並ぶ路線バス）', () => {
  const buses = frontBuses(world)

  it('入口の車路にバスの列は置かない（第16ラウンドの本番: 横一列のバスで西口のバスターミナルと読まれた）', () => {
    expect(FRONT_LANE.rows.length).toBe(0)
    expect(buses.length).toBe(0)
  })

  it('バスは建物・車の走る道・横断歩道・ほかのバスに掛からない', () => {
    buses.forEach((b, i) => {
      const ux = Math.sin(b.heading)
      const uz = -Math.cos(b.heading)
      for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const x = b.x + ux * BUS_BODY.length * t
        const z = b.z + uz * BUS_BODY.length * t
        expect(world.insideBuilding(x, z), `${x},${z}`).toBe(false)
        const road = world.nearestRoad(x, z, true, 20)
        if (road) expect(road.dist, `${x},${z}`).toBeGreaterThan(world.map.roads[road.road].width / 2 + BUS_BODY.width / 2)
      }
      buses.forEach((o, k) => {
        if (k !== i) expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThan(BUS_BODY.width + 2)
      })
    })
  })

  it('写真の立ち位置の目の前には、車体も上屋も置かない（カメラが車体の中に入らない）', () => {
    for (const [sx, sz] of PHOTO_STANDS) {
      for (const b of buses) expect(Math.hypot(b.x - sx, b.z - sz), `${sx},${sz}`).toBeGreaterThan(STAND_CLEAR - BUS_BODY.length / 2)
    }
  })

  it('通りを渡る横断歩道は車道の幅いっぱいに掛かり、両岸に信号柱が立つ。柵はその口を空ける', () => {
    for (const c of EAST_CROSSWALKS) {
      const mx = (c.line[0] + c.line[2]) / 2
      const mz = (c.line[1] + c.line[3]) / 2
      const road = world.nearestRoad(mx, mz, true, 20)
      expect(road).not.toBeNull()
      if (!road) continue
      expect(road.dist).toBeLessThan(2)
      expect(Math.hypot(c.line[2] - c.line[0], c.line[3] - c.line[1])).toBeGreaterThan(world.map.roads[road.road].width - 1)
      for (const seg of CURB_FENCES) for (const t of [0, 0.5, 1]) expect(Math.abs(seg[0] + (seg[2] - seg[0]) * t - mx)).toBeGreaterThan(c.width / 2)
      // 南と北の岸に 1 本ずつ
      expect(EAST_SIGNALS.some(([, z]) => z > mz)).toBe(true)
      expect(EAST_SIGNALS.some(([, z]) => z < mz)).toBe(true)
    }
    for (const [x, z] of EAST_SIGNALS) {
      expect(world.insideBuilding(x, z)).toBe(false)
      const road = world.nearestRoad(x, z, true, 20)
      if (road) expect(road.dist).toBeGreaterThan(world.map.roads[road.road].width / 2)
    }
  })

  it('白い仮囲いと歩道の柵は、建物にも車道にも掛からず、横断歩道の口を空ける', () => {
    for (const seg of [...HOARDINGS, ...CURB_FENCES]) {
      for (let t = 0; t <= 1; t += 0.125) {
        const x = seg[0] + (seg[2] - seg[0]) * t
        const z = seg[1] + (seg[3] - seg[1]) * t
        expect(world.insideBuilding(x, z), `${x},${z}`).toBe(false)
        const road = world.nearestRoad(x, z, true, 20)
        if (road) expect(road.dist, `${x},${z}`).toBeGreaterThan(world.map.roads[road.road].width / 2)
        // 横断歩道（x=140.5〜146.5）の口
        expect(x < 140 || x > 147, `${x}`).toBe(true)
      }
    }
  })

  it('南向きの写真の推定位置は、交差点とガードの間の北の歩道の縁へ移る（第15ラウンド: 橋が正面を横切り、高架が右の端を奥へ伸びる所）', () => {
    const p = photoStandpoint(151.9, -18.6, 190)
    expect(p.x).toBeLessThan(STAND.x - 12)
    expect(Math.abs(p.z - STAND.z)).toBeLessThan(8)
    expect(world.insideBuilding(p.x, p.z)).toBe(false)
    // 東向き（miyamasuzaka_01/02）の直しはそのまま
    const e = photoStandpoint(152.1, -18.6, 75)
    // 第16ラウンド: 乗り場の車路の上ではなく、通りを渡る横断歩道の南の岸
    expect(e.x).toBeCloseTo(129.8, 0)
    expect(e.z).toBeLessThan(12)
  })
})
