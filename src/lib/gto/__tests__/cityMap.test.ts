import { describe, expect, it } from 'vitest'
import { BLOCK_STYLES, blockStyleOf, boardSpecsOf, CRANES, isHiddenBuilding, centerGaiGate, facadeOf, fromLatLon, isScrambleCrossing, EAST_CORNER, EAST_VISTA, LANDMARK_IDS, landmarkOf, roofBoards, splitFootprint, streetProps } from '../map'
import { pointInPolygon } from '../math'
import { closestOnSegment } from '../math'
import { parseLaunch } from '../shot'
import { world } from './helpers'

describe('gto map: 街並みの決まりごと（目印の建物・壁の種類・街具の置き場所）', () => {
  it('目印の建物の表は、地図にある建物だけを指している', () => {
    const ids = new Set(world.map.buildings.map((b) => b.id))
    for (const id of Object.keys(LANDMARK_IDS)) expect(ids.has(Number(id)), `id ${id}`).toBe(true)
    const qfront = world.map.buildings.find((b) => b.id === 136691386)
    expect(qfront && landmarkOf(qfront)).toBe('qfront')
    const plain = world.map.buildings.find((b) => !LANDMARK_IDS[b.id])
    expect(plain && landmarkOf(plain)).toBeNull()
  })

  it('壁の種類は建物ごとに決まっていて、高層はガラス張りになる', () => {
    for (const b of world.map.buildings.slice(0, 200)) expect(facadeOf(b)).toBe(facadeOf(b))
    const tower = world.map.buildings.find((b) => b.h >= 120 && !b.part)
    expect(tower && facadeOf(tower)).toBe('curtain')
    const kinds = new Set(world.map.buildings.map(facadeOf))
    expect(kinds.size).toBeGreaterThanOrEqual(4)
  })

  it('スクランブル交差点の横断歩道だけを見分ける', () => {
    const crossings = world.map.roads.filter((r) => r.crossing)
    const scramble = crossings.filter(isScrambleCrossing)
    expect(scramble.length).toBeGreaterThanOrEqual(5)
    expect(scramble.length).toBeLessThan(crossings.length / 4)
    // 対角の横断歩道（交差点の中心を通る）が含まれる
    expect(scramble.some((r) => r.id === 754454449)).toBe(true)
  })

  it('街具は建物の中にも車道の上にも置かれない', () => {
    const props = streetProps(world)
    expect(props.length).toBeGreaterThan(200)
    expect(props.length).toBeLessThan(2600)
    for (const p of props) {
      expect(world.insideBuilding(p.x, p.z), `${p.kind} @${p.x},${p.z}`).toBe(false)
      if (p.kind === 'signal') continue
      const road = world.nearestRoad(p.x, p.z, true, 30)
      if (road) expect(road.dist, `${p.kind} @${p.x},${p.z}`).toBeGreaterThan(world.map.roads[road.road].width / 2 - 0.2)
    }
  })

  it('道玄坂には道玄坂の街灯と街路樹が並び、センター街には行灯の街灯が並ぶ', () => {
    const props = streetProps(world)
    const count = (kind: string) => props.filter((p) => p.kind === kind).length
    expect(count('lamp-dogenzaka')).toBeGreaterThan(12)
    expect(count('lamp-center')).toBeGreaterThan(6)
    expect(count('lamp-miyamasu')).toBeGreaterThan(8)
    expect(count('tree')).toBeGreaterThan(60)
    expect(count('signal')).toBeGreaterThan(20)
    // 道玄坂の街灯は、道玄坂の車道の縁から 3m 以内に立つ
    const dogenzaka = world.map.roads.filter((r) => r.name === '道玄坂')
    for (const p of props.filter((q) => q.kind === 'lamp-dogenzaka')) {
      let edge = Infinity
      for (const r of dogenzaka) {
        for (let i = 2; i < r.pts.length; i += 2) {
          const c = closestOnSegment(p.x, p.z, r.pts[i - 2], r.pts[i - 1], r.pts[i], r.pts[i + 1])
          edge = Math.min(edge, Math.sqrt(c.d2) - r.width / 2)
        }
      }
      expect(edge, `@${p.x},${p.z}`).toBeLessThan(3)
    }
  })

  it('同じ地図からは同じ並びになる', () => {
    expect(streetProps(world)).toEqual(streetProps(world))
  })
})

describe('gto map: 大きな街区を間口の狭いビルに割る', () => {
  const area = (pts: number[]) => {
    let a = 0
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1]
    return Math.abs(a) / 2
  }

  it('長方形は長辺に沿って等分され、面積は変わらない', () => {
    const rect = [0, 0, 60, 0, 60, 20, 0, 20]
    const parts = splitFootprint(rect, 12)
    expect(parts.length).toBe(5)
    expect(parts.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(1200, 3)
    for (const p of parts) {
      const xs = p.filter((_, i) => i % 2 === 0)
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12, 3)
    }
  })

  it('間口が狭い建物は割らない', () => {
    const small = [0, 0, 14, 0, 14, 10, 0, 10]
    expect(splitFootprint(small, 12)).toEqual([small])
  })

  it('センター街入口の雑居ビルの街区は、3 棟以上に割れて面積がほぼ保たれる', () => {
    const block = world.map.buildings.find((b) => b.id === 136690966)
    if (!block) throw new Error('block')
    const parts = splitFootprint(block.pts, 12)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(splitFootprint(block.pts, 9).length).toBeGreaterThan(parts.length)
    const total = parts.reduce((sum, p) => sum + area(p), 0)
    expect(Math.abs(total - area(block.pts)) / area(block.pts)).toBeLessThan(0.02)
    for (const p of parts) expect(p.length).toBeGreaterThanOrEqual(6)
  })
})

describe('gto shot: 固定カメラの立ち位置', () => {
  it('どのスポットも、建物の外に立ち、目の前 12m が壁で塞がっていない', () => {
    for (const spot of world.map.spots) {
      const launch = parseLaunch(new URLSearchParams(`gtoShot=${spot.key}`), world)
      const cam = launch.photo
      if (!cam) throw new Error(spot.key)
      expect(world.insideBuilding(cam.x, cam.z), spot.key).toBe(false)
      const clear = world.segmentClear(cam.x, cam.z, cam.x + Math.sin(cam.heading) * 12, cam.z - Math.cos(cam.heading) * 12)
      expect(clear, spot.key).toBe(1)
    }
  })
})

describe('gto map: センター街入口のゲート', () => {
  const gate = centerGaiGate(world)

  it('現地写真（center-gai_01）の立ち位置から、向いている先 8〜16m に立つ', () => {
    expect(gate).not.toBeNull()
    if (!gate) return
    const cam = fromLatLon(world.map, 35.659764, 139.700264)
    const dx = gate.x - cam.x
    const dz = gate.z - cam.z
    const dist = Math.hypot(dx, dz)
    expect(dist).toBeGreaterThan(8)
    expect(dist).toBeLessThan(16)
    // 写真の向き 300 度から左右 20 度以内に、ゲートの中心が来る
    const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
    expect(Math.abs(bearing - 300)).toBeLessThan(20)
  })

  it('左右の柱は通りの両脇に立ち、建物にめり込まない', () => {
    if (!gate) return
    expect(gate.half).toBeGreaterThanOrEqual(3)
    expect(gate.half).toBeLessThanOrEqual(5.5)
    const rx = Math.cos(gate.heading)
    const rz = Math.sin(gate.heading)
    for (const side of [-1, 1]) {
      const px = gate.x + rx * gate.half * side
      const pz = gate.z + rz * gate.half * side
      expect(world.insideBuilding(px, pz)).toBe(false)
      expect(world.resolveCircle(px, pz, 0.4).hit).toBe(false)
    }
  })
})

describe('gto map: 写真から起こした街区の外装と屋上の広告塔', () => {
  it('外装の表は地図にある建物だけを指し、看板役には目印として伝わる', () => {
    const byId = new Map(world.map.buildings.map((b) => [b.id, b]))
    for (const id of Object.keys(BLOCK_STYLES)) {
      const b = byId.get(Number(id))
      expect(b, `id ${id}`).toBeTruthy()
      if (!b) continue
      expect(blockStyleOf(b)).toBe(BLOCK_STYLES[b.id])
      expect(landmarkOf(b)).toBe('styled')
    }
    const plain = world.map.buildings.find((b) => !BLOCK_STYLES[b.id])
    expect(plain && blockStyleOf(plain)).toBeNull()
  })

  it('広告塔は屋上の縁の内側に立ち、見せたい相手のほうを向く', () => {
    let count = 0
    for (const b of world.map.buildings) {
      const specs = boardSpecsOf(b)
      const boards = roofBoards(b)
      expect(boards.length).toBe(specs.length)
      boards.forEach((board, i) => {
        count++
        const spec = specs[i]
        // 板の両端が屋上からはみ出さない（中心は必ず輪郭の内側）
        expect(pointInPolygon(b.pts, board.x, board.z), `id ${b.id} #${i}`).toBe(true)
        const dx = spec.toward[0] - board.x
        const dz = spec.toward[1] - board.z
        const dl = Math.hypot(dx, dz)
        // 表の向き（北 0・時計回り）が、相手への向きから 50 度以内
        const facing = (Math.sin(board.heading) * dx - Math.cos(board.heading) * dz) / dl
        expect(facing, `id ${b.id} #${i}`).toBeGreaterThan(Math.cos((50 * Math.PI) / 180))
        expect(board.w).toBeGreaterThan(3)
        expect(board.h).toBeGreaterThan(2)
      })
    }
    expect(count).toBeGreaterThanOrEqual(3)
  })

  it('宮益坂下の正面を塞ぐ街区に、屋上の広告塔が 2 基以上ある', () => {
    const corner = world.map.buildings.filter((b) => boardSpecsOf(b).length > 0 && Math.hypot(b.pts[0] - 190, b.pts[1] + 38) < 30)
    expect(corner.reduce((n, b) => n + roofBoards(b).length, 0)).toBeGreaterThanOrEqual(2)
  })

  it('スクランブル交差点のガラスの角ビルの左隣の街区にも、屋上の広告塔が立つ（scramble_08）', () => {
    const left = world.map.buildings.filter((b) => boardSpecsOf(b).length > 0 && Math.hypot(b.pts[0] + 60, b.pts[1] + 40) < 45)
    expect(left.reduce((n, b) => n + roofBoards(b).length, 0)).toBeGreaterThanOrEqual(3)
  })

  it('ハチ公前広場に木が立つ（交差点の広場の中でも、ここだけは植える）', () => {
    const trees = streetProps(world).filter((p) => p.kind === 'tree' && p.x > 10 && p.x < 46 && p.z > 12 && p.z < 52)
    expect(trees.length).toBeGreaterThanOrEqual(3)
    for (const t of trees) {
      const road = world.nearestRoad(t.x, t.z, true, 30)
      if (road) expect(road.dist, `${t.x},${t.z}`).toBeGreaterThan(world.map.roads[road.road].width / 2 + 0.25)
    }
  })

  it('センター街の奥の、地図では高さ 2m になっている棟は、外装を決めて建て直し、浮いた部品は描かない', () => {
    const b = world.map.buildings.find((x) => x.id === 136730000)!
    expect((blockStyleOf(b)?.raise ?? 0) * 3.4 + b.h).toBeGreaterThan(25)
    const parts = world.map.buildings.filter(isHiddenBuilding)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const part of parts) expect(part.part === 1 || part.roof === 1).toBe(true)
  })

  it('工事のクレーンは駅のまわりに 3 基以上あり、車道の上には立たない', () => {
    expect(CRANES.length).toBeGreaterThanOrEqual(3)
    for (const c of CRANES) {
      expect(Math.hypot(c.x, c.z), `${c.x},${c.z}`).toBeLessThan(260)
      const road = world.nearestRoad(c.x, c.z, true, 30)
      if (road) expect(road.dist, `${c.x},${c.z}`).toBeGreaterThan(world.map.roads[road.road].width / 2 + 1.5)
      expect(c.h).toBeGreaterThan(30)
    }
  })

  it('109 の分岐の先端のまわりには街路樹を植えない（円筒が隠れる）', () => {
    const trees = streetProps(world).filter((p) => p.kind === 'tree')
    // 駅側（東）は横断歩道のすぐ先から並木が始まる（第13ラウンド、109_12）
    for (const t of trees) expect(Math.hypot(t.x + 126, t.z + 5), `${t.x},${t.z}`).toBeGreaterThanOrEqual(t.x > -104 ? 27 : 36)
  })

  it('宮益坂下の固定カメラは、広場から正面の街区を向く（坂の道の真ん中には立たない）', () => {
    const launch = parseLaunch(new URLSearchParams('gtoShot=miyamasuzaka-bottom'), world)
    const spot = world.spot('miyamasuzaka-bottom')!
    expect(launch.photo).toBeTruthy()
    expect(Math.hypot(launch.start!.x - spot.x, launch.start!.z - spot.z)).toBeGreaterThan(15)
    // 遊ぶ画面とデモは、これまでどおり坂下の車道から始まる
    const play = parseLaunch(new URLSearchParams('gtoShot=miyamasuzaka-bottom&mode=drive'), world)
    expect(Math.hypot(play.start!.x - spot.x, play.start!.z - spot.z)).toBeLessThan(3)
    const demo = parseLaunch(new URLSearchParams('demo=drive-brake'), world)
    expect(Math.hypot(demo.start!.x - spot.x, demo.start!.z - spot.z)).toBeLessThan(3)
  })

  it('宮益坂下から橋までの見通しには街路樹が無く、角の立ち位置のそばに街灯が無い', () => {
    const props = streetProps(world)
    const trees = props.filter((p) => p.kind === 'tree' && p.x > EAST_VISTA[0] && p.x < EAST_VISTA[1] && p.z > EAST_VISTA[2] && p.z < EAST_VISTA[3])
    expect(trees).toEqual([])
    const lamps = props.filter((p) => p.kind.startsWith('lamp') && Math.hypot(p.x - EAST_CORNER[0], p.z - EAST_CORNER[1]) < EAST_CORNER[2])
    expect(lamps).toEqual([])
    // 信号柱は残る
    expect(props.some((p) => p.kind === 'signal' && Math.hypot(p.x - EAST_CORNER[0], p.z - EAST_CORNER[1]) < 40)).toBe(true)
  })
})
