import { describe, expect, it } from 'vitest'
import harajukuJson from '../data/harajukuMap.json'
import shibuyaJson from '../data/shibuyaMap.json'
import { streetLabel } from '../hud'
import { createWorld, isDriveRoad, loadAreaWorld, loadWorld, streetProps } from '../map'
import { dist2 } from '../math'
import { createGtoState, stepGto } from '../sim'
import type { ShibuyaMap } from '../types'
import { cfg, DT, input } from './helpers'

// 原宿・表参道の地図（scripts/gto-bake-map.mjs --area harajuku の出力）。
// 街として成り立っていること: 広さ・原点・渋谷の範囲と重ならないこと・道の名前・車道のつながり・背の低い街並み・線路の扱い。

const map = harajukuJson as unknown as ShibuyaMap
const shibuya = shibuyaJson as unknown as ShibuyaMap
const world = createWorld(map, 'harajuku')
const buildings = map.buildings

describe('原宿・表参道の地図', () => {
  it('エリアを選んで読める（渋谷とは別の地図から作った世界で、2 度目は使い回す）', async () => {
    const a = await loadAreaWorld('harajuku')
    expect(a.area).toBe('harajuku')
    expect(a.map.meta.title).toMatch(/Harajuku/)
    expect(a.map).not.toBe(loadWorld().map)
    expect(await loadAreaWorld('harajuku')).toBe(a)
  })

  it('渋谷より少し広く、上限（500KB）に収まる', () => {
    const b = map.meta.bounds
    const s = shibuya.meta.bounds
    expect(b.maxX - b.minX).toBeGreaterThan(s.maxX - s.minX)
    expect(b.maxX - b.minX).toBeLessThan((s.maxX - s.minX) * 1.25)
    expect(b.maxZ - b.minZ).toBeGreaterThan(s.maxZ - s.minZ)
    expect(b.maxZ - b.minZ).toBeLessThan((s.maxZ - s.minZ) * 1.15)
    expect(buildings.length).toBeGreaterThan(2000)
    expect(map.roads.length).toBeGreaterThan(500)
    expect(JSON.stringify(map).length).toBeLessThan(500 * 1024)
  })

  it('渋谷の範囲のすぐ北にあり、重ならない（南の端が、渋谷の北の端より北）', () => {
    const lat = (m: ShibuyaMap, z: number) => m.meta.origin.lat - z / m.meta.mPerDegLat
    const harajukuSouth = lat(map, map.meta.bounds.maxZ)
    const shibuyaNorth = lat(shibuya, shibuya.meta.bounds.minZ)
    expect(harajukuSouth).toBeGreaterThan(shibuyaNorth)
    // すき間は 200m より狭い（となりの街）
    expect((harajukuSouth - shibuyaNorth) * map.meta.mPerDegLat).toBeLessThan(200)
  })

  it('原点は明治通りと表参道の交差点の地表（高さ 0、建物の外、車道の上）', () => {
    expect(Math.abs(world.groundY(0, 0))).toBeLessThan(0.3)
    expect(world.insideBuilding(0, 0)).toBe(false)
    expect(world.nearestRoad(0, 0, true, 10)?.dist).toBeLessThan(1)
    expect(map.spots[0]).toMatchObject({ key: 'jingumae', x: 0, z: 0 })
    // 原点で 2 本の通りが交わる
    const at = new Set(map.roads.filter((r) => r.name && r.pts.some((_, i) => i % 2 === 0 && Math.hypot(r.pts[i], r.pts[i + 1]) < 1)).map((r) => r.name))
    expect([...at].sort()).toEqual(['明治通り', '表参道'])
  })

  it('道の名前は通りの名前だけ（店・施設・駅の出入口・歩道橋・橋の名前は焼き込まない）', () => {
    const names = [...new Set(map.roads.filter((r) => r.name).map((r) => r.name!))]
    expect(names.length).toBeGreaterThan(12)
    for (const n of names) {
      expect(n, n).toMatch(/(通り|坂|ストリート|小径)$|^(表参道|南参道)$/)
      expect(n, n).not.toMatch(/[;；（(]|出入口|駅|番線|ホーム|ビル|ストア|病院|歩道橋|橋$/)
      if (streetLabel(n)) expect(streetLabel(n).length).toBeGreaterThan(1)
    }
    for (const n of ['表参道', '明治通り', '竹下通り', 'キャットストリート', '原宿通り', '青山通り']) expect(names, n).toContain(n)
  })

  it('背の低い街: 建物の半分は 12m 以下で、40m を超える棟は 20 棟に満たない（隣の塔に引っぱられた推定が無い）', () => {
    const hs = buildings.map((b) => b.h).sort((a, b) => a - b)
    expect(hs[Math.floor(hs.length / 2)]).toBeLessThanOrEqual(12)
    expect(hs[Math.floor(hs.length * 0.9)]).toBeLessThan(20)
    expect(hs.filter((h) => h > 40).length).toBeLessThan(20)
    const area = (p: number[]) => {
      let a = 0
      for (let i = 0; i < p.length; i += 2) a += p[i] * p[(i + 3) % p.length] - p[(i + 2) % p.length] * p[i + 1]
      return Math.abs(a / 2)
    }
    const shibuyaMedian = shibuya.buildings.map((b) => b.h).sort((a, b) => a - b)[Math.floor(shibuya.buildings.length / 2)]
    expect(hs[Math.floor(hs.length / 2)]).toBeLessThan(shibuyaMedian)
    // 敷地の小さい推定の棟が、塔の高さになっていない（階数の分かる棟と、大通りぞいで壁の高さをそろえた棟だけが 3 階を超える）
    expect(buildings.filter((b) => b.est && !b.part && area(b.pts) < 160 && b.h > 36)).toHaveLength(0)
  })

  it('車道のグラフは、ほぼ 1 つにつながっている（駅前・交差点・表参道の東の端・青山通りを車で行き来できる）', () => {
    const g = world.driveGraph
    const adj: number[][] = g.nodes.map(() => [])
    for (const e of g.edges) {
      adj[e.from].push(e.to)
      adj[e.to].push(e.from)
    }
    const nearest = (x: number, z: number) => g.nodes.reduce((best, n, i) => (dist2(n.x, n.z, x, z) < dist2(g.nodes[best].x, g.nodes[best].z, x, z) ? i : best), 0)
    const seen = new Set<number>([nearest(0, 0)])
    const stack = [...seen]
    while (stack.length > 0) for (const next of adj[stack.pop()!]) if (!seen.has(next)) stack.push(next), seen.add(next)
    expect(seen.size / g.nodes.length).toBeGreaterThan(0.9)
    for (const [x, z] of [[-231, -118], [430, 233], [628, 358], [583, 471], [159, -244], [336, -288]]) expect(seen.has(nearest(x, z)), `(${x}, ${z})`).toBe(true)
  })

  it('表参道と明治通りは、建物に塞がれず端から端まで走れる', () => {
    for (const r of map.roads) {
      if ((r.name !== '表参道' && r.name !== '明治通り') || !isDriveRoad(r)) continue
      for (let i = 0; i < r.pts.length; i += 2) expect(world.insideBuilding(r.pts[i], r.pts[i + 1]), `${r.name} (${r.pts[i]}, ${r.pts[i + 1]})`).toBe(false)
    }
  })

  it('線路は地表のすぐ上を通り、橋の下の区間は地表に描かない（高架にしない）', () => {
    expect(map.rails.length).toBeGreaterThan(5)
    expect(map.railTunnels.length).toBeGreaterThan(5)
    for (const r of map.rails) {
      expect(r.elevated ?? 0, String(r.id)).toBe(0)
      for (let i = 0; i < r.y.length; i++) {
        const lift = r.y[i] - world.groundY(r.pts[i * 2], r.pts[i * 2 + 1])
        expect(lift).toBeGreaterThanOrEqual(0.3)
        expect(lift).toBeLessThan(2.5)
      }
    }
    // 線路は街の西の端（駅の並び）だけを通る
    for (const r of map.rails) for (let i = 0; i < r.pts.length; i += 2) expect(r.pts[i]).toBeLessThan(-150)
  })

  it('街具は建物の外に立ち、渋谷の固定の街具（「渋谷センター街」の札の付く行灯の街灯）は 1 本も無い', () => {
    const props = streetProps(world)
    expect(props.length).toBeGreaterThan(400)
    for (const p of props) expect(world.insideBuilding(p.x, p.z), `${p.kind} (${p.x}, ${p.z})`).toBe(false)
    expect(props.filter((p) => p.kind === 'signal').length).toBeGreaterThan(20)
    expect(props.filter((p) => p.kind === 'lamp-center')).toHaveLength(0)
  })

  it('街が動く: 原宿の世界で始めると、交通と通行人が道の上に出て、歩いても建物にめり込まない', () => {
    const s = createGtoState(world, cfg, { seed: 3 })
    expect(world.insideBuilding(s.player.x, s.player.z)).toBe(false)
    expect(s.vehicles.length).toBeGreaterThan(4)
    expect(s.peds.length).toBeGreaterThan(6)
    for (const v of s.vehicles) expect(world.insideBuilding(v.x, v.z)).toBe(false)
    let t = s
    for (let i = 0; i < 180; i++) t = stepGto(t, input({ moveY: 1 }), world, cfg, DT)
    expect(Number.isFinite(t.player.x) && Number.isFinite(t.player.z)).toBe(true)
    expect(world.insideBuilding(t.player.x, t.player.z)).toBe(false)
  })
})
