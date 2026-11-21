import { describe, expect, it } from 'vitest'
import shinjukuJson from '../data/shinjukuMap.json'
import shibuyaJson from '../data/shibuyaMap.json'
import { streetLabel } from '../hud'
import { createWorld, isDriveRoad, loadAreaWorld, loadWorld, streetProps } from '../map'
import { dist2 } from '../math'
import { createGtoState, stepGto } from '../sim'
import type { ShibuyaMap } from '../types'
import { cfg, DT, input } from './helpers'

// 新宿（東口・歌舞伎町・新宿三丁目）の地図（scripts/gto-bake-map.mjs --area shinjuku の出力）。
// 街として成り立っていること: 広さ・原点・道の名前・車道のつながり・ガードと地下街の扱い。

const map = shinjukuJson as unknown as ShibuyaMap
const world = createWorld(map, 'shinjuku')
const buildings = map.buildings

describe('新宿の地図', () => {
  it('エリアを選んで読める（渋谷とは別の地図から作った世界で、2 度目は使い回す）', async () => {
    const a = await loadAreaWorld('shinjuku')
    expect(a.area).toBe('shinjuku')
    expect(a.map.meta.title).toMatch(/Shinjuku/)
    expect(a.map).not.toBe(loadWorld().map)
    expect(await loadAreaWorld('shinjuku')).toBe(a)
  })

  it('渋谷と同じくらいの広さ・量で、上限（500KB）に収まる', () => {
    const b = map.meta.bounds
    const s = (shibuyaJson as unknown as ShibuyaMap).meta.bounds
    expect(b.maxX - b.minX).toBeCloseTo(s.maxX - s.minX, -1)
    expect(b.maxZ - b.minZ).toBeCloseTo(s.maxZ - s.minZ, -1)
    expect(buildings.length).toBeGreaterThan(1000)
    expect(map.roads.length).toBeGreaterThan(800)
    expect(JSON.stringify(map).length).toBeLessThan(500 * 1024)
  })

  it('原点は東口の交差点の地表（高さ 0、建物の外、車道の上）', () => {
    expect(Math.abs(world.groundY(0, 0))).toBeLessThan(0.3)
    expect(world.insideBuilding(0, 0)).toBe(false)
    expect(world.nearestRoad(0, 0, true, 10)?.dist).toBeLessThan(1)
    expect(map.spots[0]).toMatchObject({ key: 'east-exit', x: 0, z: 0 })
  })

  it('道の名前は通りの名前だけ（出入口・施設・連絡通路の名前は焼き込まない）', () => {
    const names = [...new Set(map.roads.filter((r) => r.name).map((r) => r.name!))]
    expect(names.length).toBeGreaterThan(30)
    for (const n of names) {
      expect(n, n).not.toMatch(/[;；]|出入口|入口$|出口$|駅$|番線|ホーム|改札|タワー|ビル|駐車場|待機場|エレベーター|連絡通路|歩道橋$/)
      // HUD の地名に出るのは、通りの名前として読める物だけ
      if (streetLabel(n)) expect(streetLabel(n)).toMatch(/(通り|街道|ロード|横丁|線)$/)
    }
    for (const n of ['新宿通り', '靖国通り', '明治通り', '花道通り', '区役所通り', 'セントラルロード', '歌舞伎町一番街通り']) expect(names, n).toContain(n)
  })

  it('地下街は建物として建てない（靖国通りの上に箱が無く、通りを端から端まで走れる）', () => {
    for (const r of map.roads) {
      if (r.name !== '靖国通り' || !isDriveRoad(r)) continue
      for (let i = 0; i < r.pts.length; i += 2) expect(world.insideBuilding(r.pts[i], r.pts[i + 1]), `靖国通り (${r.pts[i]}, ${r.pts[i + 1]})`).toBe(false)
    }
  })

  it('車道のグラフは、ほぼ 1 つにつながっている（東口・歌舞伎町・三丁目を車で行き来できる）', () => {
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
    // 歌舞伎町の奥・三丁目・靖国通りの東の端へ届く
    for (const [x, z] of [[148, -323], [262, 140], [449, -1], [-21, -165]]) expect(seen.has(nearest(x, z)), `(${x}, ${z})`).toBe(true)
  })

  it('下を車道がくぐる建物は、通りをまたぐ連絡通路などの数棟だけ（駅のガードのような大きな穴は無い）', () => {
    const under = buildings.filter((_, i) => world.passUnder[i])
    expect(under.length).toBeLessThanOrEqual(4)
  })

  it('線路は地表より上にあり、大ガードでは通りの路面より 3.5m 以上高い', () => {
    expect(map.rails.length).toBeGreaterThan(20)
    for (const r of map.rails) for (let i = 0; i < r.y.length; i++) expect(r.y[i]).toBeGreaterThanOrEqual(world.groundY(r.pts[i * 2], r.pts[i * 2 + 1]) + 0.3)
    // 靖国通りが線路の下をくぐる所（大ガード）: 通りの路面から、真上の線路までの高さ
    let clearance = 0
    for (const road of map.roads) {
      if (!isDriveRoad(road)) continue
      for (let i = 0; i < road.pts.length; i += 2) {
        // 靖国通りと青梅街道をつなぐ、線路の下の区間
        if (road.pts[i] < -235 || road.pts[i] > -125 || road.pts[i + 1] < -175 || road.pts[i + 1] > -135) continue
        for (const r of map.rails) {
          for (let k = 0; k < r.y.length; k++) {
            if (Math.hypot(r.pts[k * 2] - road.pts[i], r.pts[k * 2 + 1] - road.pts[i + 1]) < 12) clearance = Math.max(clearance, r.y[k] - world.groundY(road.pts[i], road.pts[i + 1]))
          }
        }
      }
    }
    expect(clearance).toBeGreaterThan(3.5)
  })

  it('街具は建物の外に立ち、渋谷の固定の街具（「渋谷センター街」の札の付く行灯の街灯）は 1 本も無い', () => {
    const props = streetProps(world)
    expect(props.length).toBeGreaterThan(200)
    for (const p of props) expect(world.insideBuilding(p.x, p.z), `${p.kind} (${p.x}, ${p.z})`).toBe(false)
    expect(props.filter((p) => p.kind === 'signal').length).toBeGreaterThan(20)
    expect(props.filter((p) => p.kind === 'lamp-center')).toHaveLength(0)
  })

  it('街が動く: 新宿の世界で始めると、交通と通行人が道の上に出て、歩いても建物にめり込まない', () => {
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
