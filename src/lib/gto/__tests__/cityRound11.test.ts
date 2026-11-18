import { describe, expect, it } from 'vitest'
import { blockStyleOf, isScrambleCrossing, MIYAMASU_BARE, streetProps } from '../map'
import { isStubCrossing } from '../mapStreet'
import { ART, FACE_DECOS, facePanels } from '../mapFacade'
import { NORTH_PLAZA } from '../mapEast'
import { CANOPY_MEMBER, FORK_109_MID, forkCanopy, forkCrossing, forkTower } from '../map109'
import { photoStandpoint } from '../mapPhoto'
import { BRICK_WALK, brickFenceAt } from '../mapVista'
import { world } from './helpers'

const building = (id: number) => world.map.buildings.find((b) => b.id === id)!

describe('gto city 第11ラウンド: センター街の中と宮益坂下の決め手', () => {
  const props = streetProps(world)

  it('センター街の行灯の街灯は、通りの中ほどで 30m 以内ごとに立ち、車道の縁ではなく通りの中へ寄っている', () => {
    const road = world.map.roads.find((r) => r.name === '渋谷センター街' && !r.drive)!
    const lamps = props.filter((p) => p.kind === 'lamp-center' && p.x > -165 && p.x < -50 && p.z > -100 && p.z < -50)
    expect(lamps.length).toBeGreaterThanOrEqual(4)
    const xs = lamps.map((p) => p.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThan(30)
    for (const p of lamps) {
      const near = world.nearestRoad(p.x, p.z, false, 12)
      expect(near).not.toBeNull()
      expect(near!.dist).toBeLessThan(road.width / 2)
    }
  })

  it('通りの中から駅向きに見える分岐の角の棟は、明るいガラスの棟で、黒い帯の看板を巻く', () => {
    const corner = building(136690970)
    const style = blockStyleOf(corner)
    expect(style?.facade).toBe('curtain')
    // 駅直上の塔を隠さない高さ（center-gai_12: 通りの中から駅を振り返ると、この棟の真上に塔が大きく立つ）
    const tower = building(617560918)
    const eye: [number, number] = [-150, -90.2]
    const top = (corner.h + (style?.raise ?? 0) * 3.4 + corner.y - world.groundY(eye[0], eye[1]) - 1.6) / 44
    const towerTop = (tower.h + tower.y - world.groundY(eye[0], eye[1]) - 1.6) / Math.hypot(149 - eye[0], 124 - eye[1])
    expect(Math.atan(towerTop) - Math.atan(top)).toBeGreaterThan((8 * Math.PI) / 180)
    for (const q of facePanels(corner)) expect(q.y1).toBeLessThanOrEqual(corner.h + 0.5)
    const panels = facePanels(corner)
    expect(panels.filter((p) => p.kind === 'board' && p.ref === ART.blackBand).length).toBeGreaterThanOrEqual(2)
    // 通り（北西）へ向いた面に載る
    for (const p of panels) expect(p.nx < 0 || p.nz < 0).toBe(true)
  })

  it('Y 字路の角の棟には、提灯を格子に並べた面が通りへ向いて載る', () => {
    const panels = facePanels(building(136690966), FACE_DECOS[136690966])
    const lanterns = panels.filter((p) => p.ref === ART.lanterns && p.kind === 'board')
    expect(lanterns.length).toBeGreaterThanOrEqual(2)
    for (const p of lanterns) expect(p.y0).toBeGreaterThan(8)
  })

  it('center-gai_15 の立ち位置は、Y 字路の手前の通りの上へ移る', () => {
    const at = photoStandpoint(-87.5, -57.4, 110)
    expect(world.insideBuilding(at.x, at.z)).toBe(false)
    const near = world.nearestRoad(at.x, at.z, false, 10)
    expect(near && world.map.roads[near.road].name).toBe('渋谷センター街')
    expect(at.x).toBeGreaterThan(-95)
    expect(at.x).toBeLessThan(-72)
  })

  it('センター街の中ほどの写真の立ち位置は、桃色の棟（136690959）の手前へ引く（第14ラウンドで起こし直した）。ガードの写真は右手の壁が入らない所へ移る', () => {
    const cg = photoStandpoint(-151, -91, 110)
    expect(cg.x).toBeLessThan(-162)
    expect(world.insideBuilding(cg.x, cg.z)).toBe(false)
    // 批評役が自分で寄せた立ち位置は、さらには動かさない
    expect(photoStandpoint(-125, -80, 122)).toEqual({ x: -125, z: -80 })
    const v = photoStandpoint(92.9, -7.5, 265)
    // ガードから 25m 以上引いて、車道の南寄り（桁の上の塔まで入る）
    expect(v.x).toBeGreaterThan(104)
    expect(v.z).toBeGreaterThan(3)
    expect(world.insideBuilding(v.x, v.z)).toBe(false)
  })

  it('宮益坂下の交差点のまわりと坂の入口には、葉の茂った街路樹を立てない（正面の街区が壁として見える）', () => {
    const [x0, x1, z0, z1] = MIYAMASU_BARE
    expect(props.filter((p) => p.kind === 'tree' && p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1)).toEqual([])
    // 坂の上のほうには並木が残る
    expect(props.some((p) => p.kind === 'tree' && p.x > x1 && p.z < -20 && p.z > -80)).toBe(true)
  })

  it('緑の柵は、広場側（交差点の南西）では立てず、ガードの手前の北の歩道には残る', () => {
    expect(brickFenceAt(128, 8)).toBe(false)
    expect(brickFenceAt(150, 6)).toBe(false)
    expect(brickFenceAt(110, -10)).toBe(true)
    expect(brickFenceAt(240, -40)).toBe(true)
    // 交差点の北西の角（miyamasuzaka_08 の足元）にも無い
    expect(brickFenceAt(145, -12)).toBe(false)
    expect(brickFenceAt(124, -12)).toBe(true)
    // 第16ラウンド: 通りを渡る横断歩道（x=126.3〜133.7）の口も空ける
    expect(BRICK_WALK.fenceSkip.length).toBe(3)
    expect(brickFenceAt(130, -9)).toBe(false)
  })

  it('明治通りの東の並びは、白と灰の壁でつながる', () => {
    for (const id of [120105793, 120105798, 120105794]) {
      const style = blockStyleOf(building(id))
      expect(style, `id ${id}`).not.toBeNull()
      const c = style!.color
      const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
      expect(Math.min(r, g, b)).toBeGreaterThan(180)
    }
  })
})

describe('gto city 第11ラウンド: 109 前の分岐の路面と庇（109_07）', () => {
  const crossings = world.map.roads.filter((r) => r.crossing)

  it('分岐の縞は左右の通り・斜め 1 本・合わさった通りの 4 本（ほかに横道の口の 2 本）。先端から正面へ延びる線には縞を描かない（109_12 の足元は何も描かれていないアスファルト）', () => {
    const styles = crossings.map((r) => forkCrossing(r))
    expect(styles.filter((s) => s === 'plain').length).toBe(6)
    const none = crossings.filter((r) => forkCrossing(r) === 'none')
    expect(none).toHaveLength(1)
    // 縞を描かない線は、分岐の先端 (-121.8, -4.6) と南東の歩道 (-95.4, 7.5) を結ぶ
    const p = none[0].pts
    expect(Math.min(p[0], p[p.length - 2])).toBeCloseTo(-121.8, 0)
    expect(Math.max(p[0], p[p.length - 2])).toBeCloseTo(-95.4, 0)
  })

  it('スクランブル交差点や離れた交差点の横断歩道には触れない', () => {
    for (const r of crossings) {
      const far = r.pts.every((v, i) => i % 2 === 1 || Math.hypot(v - FORK_109_MID[0], r.pts[i + 1] - FORK_109_MID[1]) > 60)
      if (far) expect(forkCrossing(r)).toBeNull()
    }
  })

  it('庇の柱は細く、円筒から張り出しすぎない', () => {
    const tower = forkTower(building(55895868).pts)
    const canopy = forkCanopy(tower)
    for (const [x, z] of canopy.posts) expect(Math.hypot(x - tower.cx, z - tower.cz) - tower.r).toBeLessThanOrEqual(6.01)
    expect(CANOPY_MEMBER.post).toBeLessThanOrEqual(0.11)
    expect(CANOPY_MEMBER.chord).toBeLessThanOrEqual(0.06)
  })
})

describe('gto city 第11ラウンド: 宮益坂下の北の広場から南を見る手前の物（towers_16）', () => {
  it('角の丸い棟は映画館のビルの東の角に付き、案内塔はその前の歩道に、ガラスの出入口は歩道と車道の間に立つ', () => {
    const toei = building(NORTH_PLAZA.building)
    const { round, pylon, kiosk } = NORTH_PLAZA
    // 丸い角は棟の角を包む
    const corner = toei.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - round.x, toei.pts[i + 1] - round.z) < round.r)
    expect(corner).toBe(true)
    expect(round.top).toBeLessThanOrEqual(toei.h)
    // 案内塔は建物の外で、丸い角から 3m 以内、人の背の 3 倍より高い
    expect(world.insideBuilding(pylon.x, pylon.z)).toBe(false)
    expect(Math.hypot(pylon.x - round.x, pylon.z - round.z) - round.r).toBeLessThan(3)
    expect(pylon.h).toBeGreaterThan(5)
    expect(pylon.panels.length).toBeGreaterThanOrEqual(6)
    // ガラスの出入口は建物の外、車道の外
    for (const [x, z] of [[kiosk.x0, kiosk.z0], [kiosk.x1, kiosk.z0], [kiosk.x1, kiosk.z1], [kiosk.x0, kiosk.z1]]) {
      expect(world.insideBuilding(x, z)).toBe(false)
      const road = world.nearestRoad(x, z, true, 30)
      expect(road).not.toBeNull()
      expect(road!.dist).toBeGreaterThan(world.map.roads[road!.road].width / 2)
    }
    // 歩道から南を見て、右に丸い角と案内塔、左にガラス（歩道の線は x=148〜149）
    expect(pylon.x).toBeLessThan(148)
    expect(kiosk.x0).toBeGreaterThan(149.5)
  })
})

describe('gto city 第11ラウンド: スクランブル交差点の横断歩道の切れ端', () => {
  it('交差点の角で折れ曲がる 10m 未満のつなぎは縞を描かない。辺と対角の横断歩道は残る', () => {
    const scramble = world.map.roads.filter((r) => isScrambleCrossing(r))
    const stubs = scramble.filter((r) => isStubCrossing(r))
    expect(stubs.length).toBeGreaterThanOrEqual(3)
    expect(scramble.length - stubs.length).toBeGreaterThanOrEqual(5)
    for (const r of stubs) expect(Math.hypot(r.pts[0] - r.pts[r.pts.length - 2], r.pts[1] - r.pts[r.pts.length - 1])).toBeLessThan(10)
    // 交差点の外の横断歩道は対象外
    expect(world.map.roads.filter((r) => r.crossing && !isScrambleCrossing(r) && isStubCrossing(r))).toHaveLength(0)
  })
})
