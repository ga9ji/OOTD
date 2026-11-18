import { describe, expect, it } from 'vitest'
import { buildGraph, fromLatLon, isDriveRoad } from '../map'
import { pointAlong } from '../math'
import type { MapRoad } from '../types'
import { world } from './helpers'

describe('gto map: 渋谷の地図から作る世界', () => {
  it('交差点の中心が原点で、標高 0', () => {
    expect(Math.abs(world.groundY(0, 0))).toBeLessThan(0.5)
    const o = world.map.meta.origin
    expect(fromLatLon(world.map, o.lat, o.lon)).toEqual({ x: 0, z: -0 })
  })

  it('道玄坂と宮益坂は、駅前の谷底から上っている', () => {
    expect(world.groundY(-386, 200)).toBeGreaterThan(14)
    expect(world.groundY(455, -71)).toBeGreaterThan(12)
    expect(world.groundY(-200, 31)).toBeGreaterThan(world.groundY(-60, -8))
  })

  it('建物の中は塞がっていて、交差点の真ん中は空いている', () => {
    const tower = world.spot('tower-scramble-square')
    expect(tower && world.insideBuilding(tower.x, tower.z)).toBe(true)
    expect(world.insideBuilding(0, 0)).toBe(false)
    expect(world.resolveCircle(0, 0, 0.4).hit).toBe(false)
  })

  it('建物に食い込んだ円は、外へ押し出される', () => {
    const tower = world.spot('tower-scramble-square')
    if (!tower) throw new Error('spot')
    const res = world.resolveCircle(tower.x, tower.z, 0.4)
    expect(res.hit).toBe(true)
    expect(world.insideBuilding(res.x, res.z)).toBe(false)
  })

  it('建物をまたぐ視線は途中で遮られる', () => {
    const tower = world.spot('tower-scramble-square')
    if (!tower) throw new Error('spot')
    expect(world.segmentClear(0, 0, tower.x, tower.z)).toBeLessThan(1)
    expect(world.segmentClear(0, 0, 5, 5)).toBe(1)
  })

  it('交差点のそばのいちばん近い車道は、名前のある通り', () => {
    const road = world.nearestRoad(-40, -6, true)
    expect(road?.name).toBe('道玄坂')
    expect(road?.dist).toBeLessThan(3)
  })

  it('車道のグラフは地上の車道だけで、交差点でつながっている', () => {
    const g = world.driveGraph
    expect(g.edges.length).toBeGreaterThan(400)
    for (const e of g.edges) {
      expect(isDriveRoad(world.map.roads[e.road])).toBe(true)
      expect(e.length).toBeGreaterThan(0)
      const end = pointAlong(e.pts, e.cum, e.length)
      expect(end.x).toBeCloseTo(g.nodes[e.to].x, 5)
      if (e.rev >= 0) expect(g.edges[e.rev].rev).toBe(e.id)
    }
    // 交差点の中心からは3方向以上に出られる
    const center = g.nodes.find((n) => n.x === 0 && n.z === 0)
    expect(center?.out.length).toBeGreaterThanOrEqual(3)
  })

  it('一方通行は順方向の辺だけになる', () => {
    const roads: MapRoad[] = [
      { id: 1, kind: 'residential', width: 4, drive: 1, oneway: 1, pts: [0, 0, 10, 0] },
      { id: 2, kind: 'residential', width: 4, drive: 1, pts: [10, 0, 10, 10] },
    ]
    const g = buildGraph(roads, [0, 1], true)
    expect(g.edges.filter((e) => e.road === 0)).toHaveLength(1)
    expect(g.edges.filter((e) => e.road === 1)).toHaveLength(2)
    expect(g.nodes).toHaveLength(3)
  })
})
