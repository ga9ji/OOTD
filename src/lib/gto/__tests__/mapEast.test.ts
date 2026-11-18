import { describe, expect, it } from 'vitest'
import { BUS_APRON, BUS_BODY, JR_EAST, jrEastEdges, jrUpperSpan, parkedBuses, EAST_BRIDGE, EAST_TOWER, finOffset, finWidth, screenVisibleSpan, SITE_FRAMES, siteColumns, towerNorthFace } from '../mapEast'
import { pointInPolygon } from '../math'
import { parseLaunch } from '../shot'
import { world } from './helpers'

describe('gto mapEast: 東口（宮益坂下から南）の決まりごと', () => {
  const tower = world.map.buildings.find((b) => b.id === 617560918)

  it('いちばん高い塔の北の面を見つける。a が東の端で、法線は北を向く', () => {
    expect(tower).toBeTruthy()
    if (!tower) return
    const f = towerNorthFace(tower.pts)
    expect(f).not.toBeNull()
    if (!f) return
    expect(f.nz).toBeLessThan(-0.7)
    expect(f.ax).toBeGreaterThan(f.bx)
    expect(Math.hypot(f.nx, f.nz)).toBeCloseTo(1, 5)
    expect(Math.hypot(f.bx - f.ax, f.bz - f.az)).toBeGreaterThan(40)
    // 面は宮益坂下の広場から見える側にある（広場は面の法線の側）
    expect((140 - f.ax) * f.nx + (14 - f.az) * f.nz).toBeGreaterThan(0)
  })

  it('北を向いた辺の無い輪郭では面を返さない', () => {
    expect(towerNorthFace([0, 0, 10, 20, -10, 20])).toBeNull()
  })

  it('塔のビジョンは橋の屋根の陰から始まり、両下隅が裾に隠れて下すぼまりに見える', () => {
    const { screen, finWest, finEast } = EAST_TOWER
    expect(screen.y0).toBeLessThan(EAST_BRIDGE.ridge)
    const low = screenVisibleSpan(EAST_BRIDGE.ridge + 1)
    const top = screenVisibleSpan(screen.y1 - 0.5)
    expect(low).not.toBeNull()
    expect(top).not.toBeNull()
    if (!low || !top) return
    // 橋の屋根のすぐ上では、見える幅は上端の半分以下
    expect(low[1] - low[0]).toBeLessThan((top[1] - top[0]) * 0.5)
    expect(top[1] - top[0]).toBeGreaterThan(0.6)
    // 東の裾の頂点はビジョンの上端より低く、西の裾はビジョンのずっと上まで伸びる
    expect(finEast.height).toBeLessThan(screen.y1)
    expect(finWest.height).toBeGreaterThan(screen.y1 * 1.5)
    expect(top[0]).toBe(screen.t0)
    expect(screenVisibleSpan(screen.y1 + 1)).toBeNull()
  })

  it('裾は足元ほど広く、外へ張り出し、どの高さでもビジョンより手前にある', () => {
    for (const spec of [EAST_TOWER.finWest, EAST_TOWER.finEast]) {
      let prevW = Infinity
      let prevO = Infinity
      for (let k = 0; k <= 1.0001; k += 0.1) {
        const w = finWidth(spec, k)
        const o = finOffset(spec, k)
        expect(w).toBeLessThanOrEqual(prevW)
        expect(o).toBeLessThanOrEqual(prevO)
        expect(o).toBeGreaterThan(EAST_TOWER.screen.off + 0.5)
        prevW = w
        prevO = o
      }
      expect(finWidth(spec, 1)).toBeCloseTo(spec.tip, 6)
      expect(finOffset(spec, 0)).toBeCloseTo(EAST_TOWER.finGap + spec.out, 6)
    }
    // 西の裾の内側の縁は、下ほど寝て上ほど立つ
    const w = EAST_TOWER.finWest
    expect(finWidth(w, 0) - finWidth(w, 0.25)).toBeGreaterThan(finWidth(w, 0.75) - finWidth(w, 1))
  })

  it('工事中の躯体は建物と重ならず、柱は車道の上に立たない', () => {
    expect(SITE_FRAMES.length).toBeGreaterThan(0)
    for (const f of SITE_FRAMES) {
      for (let i = 0; i < f.pts.length; i += 2) expect(world.insideBuilding(f.pts[i], f.pts[i + 1]), `${f.pts[i]},${f.pts[i + 1]}`).toBe(false)
      const cols = siteColumns(world, f)
      expect(cols.length).toBeGreaterThanOrEqual(4)
      // 橋の白い腰より低く、下を人が通れる（橋の丸い端を隠さない）
      const top = f.sheetFrom + f.sheetH
      expect(top).toBeLessThan(EAST_BRIDGE.sill)
      expect(f.floors[0] - 0.7).toBeGreaterThan(2.5)
      for (const [x, z] of cols) {
        expect(pointInPolygon(f.pts, x, z)).toBe(true)
        expect(world.insideBuilding(x, z)).toBe(false)
        const road = world.nearestRoad(x, z, true, 20)
        if (road) expect(road.dist).toBeGreaterThan(world.map.roads[road.road].width / 2 + 0.5)
      }
    }
  })

  it('バス乗り場の路面は、建物に掛からず、橋の下と入口の車路を覆う', () => {
    const covers = (x: number, z: number) =>
      BUS_APRON.lanes.some(({ line, width }) => {
        for (let i = 2; i < line.length; i += 2) {
          const ax = line[i - 2]
          const az = line[i - 1]
          const dx = line[i] - ax
          const dz = line[i + 1] - az
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= width / 2) return true
        }
        return false
      })
    for (const { line } of [...BUS_APRON.lanes, BUS_APRON.crosswalk]) {
      for (let i = 2; i < line.length; i += 2) {
        for (let t = 0; t <= 1; t += 0.1) {
          const x = line[i - 2] + (line[i] - line[i - 2]) * t
          const z = line[i - 1] + (line[i + 1] - line[i - 1]) * t
          expect(world.insideBuilding(x, z), `${x},${z}`).toBe(false)
        }
      }
    }
    // 橋の真下（明治通りの西）と、上屋の列、横断歩道の両端
    expect(covers(150, 62)).toBe(true)
    expect(covers(180, 52)).toBe(true)
    const c = BUS_APRON.crosswalk.line
    expect(covers((c[0] + c[2]) / 2, (c[1] + c[3]) / 2)).toBe(true)
  })

  it('塔と橋を見る固定カメラは、建物の外に立ち、望遠寄りの画角で、目の前が開けている', () => {
    for (const key of ['viaduct-ginza', 'tower-scramble-square', 'tower-stream', 'tower-cerulean', 'bldg-parco']) {
      const launch = parseLaunch(new URLSearchParams(`gtoShot=${key}`), world)
      const cam = launch.photo
      expect(cam, key).not.toBeNull()
      if (!cam) continue
      expect(world.insideBuilding(cam.x, cam.z), key).toBe(false)
      // parseLaunch が「目の前が壁」とみなす距離（14m）より先まで開いている
      const far = 14
      const clear = world.segmentClear(cam.x, cam.z, cam.x + Math.sin(cam.heading) * far, cam.z - Math.cos(cam.heading) * far)
      expect(clear, key).toBe(1)
      expect(cam.fov, key).toBeLessThanOrEqual(50)
    }
  })

  it('橋の手前のバスは走っている 2 台までで、櫛形に並ばない（第16ラウンド: 何台も並ぶとバスターミナルに見える）', () => {
    const buses = parkedBuses(world)
    // 第17ラウンド: 橋と平行な車体は「駅舎の前に横一列のバス」に見えたので、置かない
    expect(buses.length).toBeLessThanOrEqual(2)
    const bridge = world.map.buildings.find((b) => b.id === 810356690)
    buses.forEach((b, i) => {
      expect(world.insideBuilding(b.x, b.z)).toBe(false)
      if (bridge) expect(pointInPolygon(bridge.pts, b.x, b.z)).toBe(false)
      // 同じ筋の上で、車体 2 台ぶん以上の間が空く（横に並ばない）
      buses.forEach((o, k) => {
        if (k !== i) expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThan(BUS_BODY.length * 2)
      })
    })
    expect(BUS_BODY.height + 0.4).toBeLessThan(EAST_BRIDGE.deck - 1.5)
  })

  it('JR の高架の東の面は、広場に面した辺だけを北から順に返す。電車は仮囲いの上、桁の下に収まる', () => {
    const station = world.map.buildings.find((b) => b.id === 904652357)
    expect(station).toBeTruthy()
    if (!station) return
    const edges = jrEastEdges(station.pts)
    expect(edges.length).toBeGreaterThanOrEqual(2)
    let total = 0
    let prev = -Infinity
    for (const e of edges) {
      expect(e.nx).toBeGreaterThan(0.7)
      expect(e.bz).toBeGreaterThanOrEqual(e.az)
      expect(e.az).toBeGreaterThanOrEqual(prev)
      expect(Math.max(e.az, e.bz)).toBeLessThanOrEqual(JR_EAST.zMax)
      // 外向き: 少し外へ出た点は駅舎の外
      expect(pointInPolygon(station.pts, (e.ax + e.bx) / 2 + e.nx * 1.5, (e.az + e.bz) / 2 + e.nz * 1.5)).toBe(false)
      total += Math.hypot(e.bx - e.ax, e.bz - e.az)
      prev = e.az
    }
    expect(total).toBeGreaterThan(45)
    expect(JR_EAST.rail).toBeGreaterThan(JR_EAST.hoard)
    expect(JR_EAST.girder0).toBeGreaterThan(JR_EAST.rail + 0.45 + 3.6)
    expect(jrEastEdges([0, 0, 10, 0, 10, 10, 0, 10])).toEqual([])
  })

  it('JR の工事中の躯体は電車の上に 2 層ぶん立ち上がり、宮益坂下から見て橋の屋根より高く見える（miyamasuzaka_06/07 の右端）', () => {
    const station = world.map.buildings.find((b) => b.id === 904652357)
    expect(station).toBeTruthy()
    if (!station) return
    expect(JR_EAST.deck2).toBeGreaterThan(JR_EAST.girder1 + 4)
    expect(JR_EAST.top).toBeGreaterThan(JR_EAST.deck2 + 4)
    expect(JR_EAST.top).toBeGreaterThan(EAST_BRIDGE.ridge + 5)
    // 立ち位置（横断歩道の北の端）から、いちばん南の辺の端の頂部を見上げる角度が、橋の西の端の棟より大きい
    const eye: [number, number] = [144.5, -11.5]
    const edges = jrEastEdges(station.pts)
    const last = edges[edges.length - 1]
    const elev = (x: number, z: number, h: number) => (Math.atan2(h - 1.6, Math.hypot(x - eye[0], z - eye[1])) * 180) / Math.PI
    expect(elev(last.bx, last.bz, JR_EAST.top)).toBeGreaterThan(elev(104, 68, EAST_BRIDGE.ridge) + 3)
    // 上の層は南寄りの辺だけ。宮益坂の下（miyamasuzaka_04/05 の立ち位置、向き 260 度・横の画角 80 度）の画面には入らない
    const spans = edges.map((e) => jrUpperSpan(e))
    expect(spans.filter(Boolean)).toHaveLength(1)
    expect(spans[spans.length - 1]).not.toBeNull()
    const span = spans[spans.length - 1]
    if (!span) return
    const len = Math.hypot(last.bx - last.ax, last.bz - last.az)
    const nx = last.ax + ((last.bx - last.ax) * span[0]) / len
    const nz = last.az + ((last.bz - last.az) * span[0]) / len
    expect(nz).toBeGreaterThanOrEqual(JR_EAST.upperZ - 0.01)
    const bearing = ((Math.atan2(nx - 130, -(nz + 9.6)) * 180) / Math.PI + 360) % 360
    expect(bearing).toBeLessThan(260 - 40)
    expect(jrUpperSpan({ ax: 0, az: 0, bx: 0, bz: 30, nx: 1, nz: 0 })).toBeNull()
  })
})
