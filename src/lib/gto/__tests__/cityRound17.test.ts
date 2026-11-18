import { describe, expect, it } from 'vitest'
import { fromLatLon } from '../map'
import { NORTH_PLAZA, parkedBuses } from '../mapEast'
import { frontBuses } from '../mapEastFront'
import { EAST_PASSAGE_FACE, EAST_PASSAGE_STAND, EAST_SOUTH_STAND, photoStandpoint, photoTurn } from '../mapPhoto'
import { pointInPolygon } from '../math'
import { world } from './helpers'

/** 宮益坂下の写真の推定位置（index.json の towers_15/16・viaduct_01・miyamasuzaka_06〜09） */
const raw = fromLatLon(world.map, 35.65965, 139.70225)

describe('gto city 第17ラウンド: 宮益坂下から南（東口）を、見上げの角度や位置のずれで別の絵にしない', () => {
  it('昼と夜の南向きの指定は、見上げの角度・向き・位置がずれても、ガラスの囲いと丸い角の棟の隙間から同じ向きで撮る', () => {
    for (const time of ['day', 'night'] as const) {
      for (const pitch of [0, 4, 10, 16, 19, 27, 35]) {
        for (const given of [170, 180, 185, 190, 200, 210]) {
          for (const [dx, dz] of [[0, 0], [9, 0], [-9, 4], [0, -10], [6, 8]]) {
            const p = photoStandpoint(raw.x + dx, raw.z + dz, given, pitch, time)
            expect([p.x, p.z], `${time} ${pitch} ${given} ${dx},${dz}`).toEqual(EAST_PASSAGE_STAND)
            expect((given + photoTurn(raw.x + dx, raw.z + dz, given, pitch, time) + 360) % 360).toBeCloseTo(EAST_PASSAGE_FACE, 5)
          }
        }
      }
    }
  })

  it('夕方の指定は、交差点とガードの間の北の歩道の縁から（右の端に高架と電車）。これも位置と向きのずれで変わらない', () => {
    for (const given of [178, 185, 195]) {
      const p = photoStandpoint(raw.x + 5, raw.z - 4, given, 12, 'dusk')
      expect([p.x, p.z]).toEqual(EAST_SOUTH_STAND)
      expect(given + photoTurn(raw.x + 5, raw.z - 4, given, 12, 'dusk')).toBeCloseTo(187, 5)
    }
  })

  it('隙間の立ち位置は建物の外で、右に丸い角・白い円柱・案内塔、左にガラスの囲いが 12m 以内にある', () => {
    const [sx, sz] = EAST_PASSAGE_STAND
    expect(world.insideBuilding(sx, sz)).toBe(false)
    const { round, kiosk, columns, pylon } = NORTH_PLAZA
    // 南を向いて右 = 西（x が小さい）、左 = 東
    expect(round.x).toBeLessThan(sx)
    expect(Math.hypot(round.x - sx, round.z - sz)).toBeLessThan(13)
    expect(kiosk.x0).toBeGreaterThan(sx)
    expect(kiosk.x0 - sx).toBeLessThan(3)
    expect(pylon.x).toBeLessThan(sx)
    const toei = world.map.buildings.find((b) => b.id === NORTH_PLAZA.building)
    expect(toei).toBeTruthy()
    for (const [x, z, r] of columns) {
      expect(x).toBeLessThan(sx - r)
      // 柱は棟の外（歩道の上）に立ち、通り道を 1.5m 以上残す
      if (toei) expect(pointInPolygon(toei.pts, x, z)).toBe(false)
      expect(z).toBeGreaterThan(sz)
    }
  })

  it('橋の手前に、止まったバスの列を置かない', () => {
    expect(frontBuses(world)).toHaveLength(0)
    expect(parkedBuses(world)).toHaveLength(0)
  })
})
