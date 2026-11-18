// Grand Theft Outfit [部品: city] 第12ラウンドの決まりごとの確かめ。
// towers_15/16（宮益坂下の北の歩道から南）: ガラスの囲いは透明で、その向こうに塔の裾と赤い大型ビジョンが見える。
// scramble_14/16/17/18（交差点から駅向き）: 右に白い枠のガラス張りの連絡通路と、屋上の板。
import { describe, expect, it } from 'vitest'
import { LANDMARK_IDS, blockStyleOf, boardSpecsOf, roofBoards } from '../map'
import { EAST_TOWER, NORTH_PLAZA, towerNorthFace } from '../mapEast'
import { CONCOURSE, SUBWAY_KIOSK } from '../mapVista'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}

/** 立ち位置 (x, z) から点 (px, pz) を見る向き（度、北 0・時計回り） */
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360

describe('gto city 第12ラウンド: 宮益坂下の北の歩道から南（towers_15/16）', () => {
  const { kiosk, pylon, round } = NORTH_PLAZA
  /** 写真の立ち位置（囲いの北西の角のすぐ外、歩道の上） */
  const stand: [number, number] = [149.8, -58]

  it('ガラスの囲いは腰壁が目の高さより低く、その上は透明なガラスで、北が高い片流れ', () => {
    expect(kiosk.base).toBeLessThan(1.2)
    expect(kiosk.hNorth).toBeGreaterThan(kiosk.hSouth)
    expect(kiosk.hSouth).toBeGreaterThan(3)
    expect(kiosk.bay).toBeGreaterThan(2)
  })

  it('立ち位置は建物と囲いの外で、囲いは左手、案内塔と丸い角は右手にある', () => {
    expect(world.insideBuilding(stand[0], stand[1])).toBe(false)
    expect(stand[0]).toBeLessThan(kiosk.x0)
    expect(stand[1]).toBeLessThan(kiosk.z0)
    expect(pylon.x).toBeLessThan(stand[0])
    expect(round.x + round.r).toBeLessThan(stand[0])
  })

  it('塔の北の面は、案内塔より左（東）に画角 15 度ぶん以上見えている（塔が囲いと棟の隙間の細い帯にならない）', () => {
    const face = towerNorthFace(building(617560918).pts)
    expect(face).not.toBeNull()
    const east = bearing(stand[0], stand[1], face!.ax, face!.az)
    const west = bearing(stand[0], stand[1], face!.bx, face!.bz)
    const post = bearing(stand[0], stand[1], pylon.x - pylon.w / 2, pylon.z)
    expect(east).toBeLessThan(west)
    // 案内塔は塔の西の角のあたりに立つ（写真では西の裾の右端に重なる）
    expect(post).toBeGreaterThan(east + 15)
    // 第17ラウンド: 西の裾を隠さないよう、塔の西の角より右（西の角から 4 度左までは許す）
    expect(post).toBeGreaterThan(west - 4)
    expect(post).toBeLessThan(west + 12)
  })

  it('大型ビジョンは赤地の絵で、塔の北の面の東寄りに付く', () => {
    expect(EAST_TOWER.screen.tile).toBe(4)
    expect(EAST_TOWER.screen.t0).toBeLessThan(0.1)
    expect(EAST_TOWER.screen.y1 - EAST_TOWER.screen.y0).toBeGreaterThan(25)
  })
})

describe('gto city 第12ラウンド: 交差点から駅向き（scramble_14/16/17/18）', () => {
  it('広場の南西の連絡通路は目印の建物で、屋上に交差点へ向いた板が 1 枚載る', () => {
    const bd = building(355250634)
    expect(LANDMARK_IDS[bd.id]).toBe('concourse')
    expect(blockStyleOf(bd)).toBeNull()
    expect(boardSpecsOf(bd)).toHaveLength(1)
    const [board] = roofBoards(bd)
    // 板は交差点の北西の角（写真の立ち位置）のほうを向く
    const toStand = bearing(board.x, board.z, -28, -33)
    expect(Math.abs(((board.heading * 180) / Math.PI - toStand + 540) % 360 - 180)).toBeLessThan(5)
  })

  it('連絡通路はガラスの層が 2 階ぶん以上あり、地図の高さより低く納まる', () => {
    const bd = building(355250634)
    expect(CONCOURSE.glassTop - CONCOURSE.sill - (bd.minH ?? 0)).toBeGreaterThan(7)
    expect(CONCOURSE.roof).toBeLessThan(bd.h)
    expect(CONCOURSE.roof).toBeGreaterThan(CONCOURSE.glassTop)
  })

  it('地下鉄出入口は腰壁が低く、屋根までの間が透ける', () => {
    expect(SUBWAY_KIOSK.base).toBeLessThan(1)
    expect(SUBWAY_KIOSK.top - SUBWAY_KIOSK.roof - SUBWAY_KIOSK.base).toBeGreaterThan(2)
    expect(SUBWAY_KIOSK.post).toBeLessThan(0.12)
  })
})

describe('gto city 第12ラウンド: 夜に外装ごと光る棟', () => {
  it('センター街の桃色の棟は、夜も壁の色のまま光る', () => {
    expect(blockStyleOf(building(136690959))?.lit).toBe(true)
  })
})
