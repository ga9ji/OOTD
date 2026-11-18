import { describe, expect, it } from 'vitest'
import { streetProps } from '../map'
import { nearPhotoStand, PHOTO_FIXES, PHOTO_STAND_CLEAR, PHOTO_STANDS, photoStandpoint, photoTurn } from '../mapPhoto'
import { sightTo } from '../mapSkyline'
import { parseLaunch } from '../shot'
import { DEG } from '../math'
import { world } from './helpers'

describe('現地写真の立ち位置の直し', () => {
  it('宮益坂下部の写真（推定位置は明治通りの東）は、ガードの手前の北の歩道へ移す', () => {
    const p = photoStandpoint(210.8, -40.8, 260)
    // 明治通り（x ≈ 165）より西、JR のガード（x ≈ 88）より東
    expect(p.x).toBeGreaterThan(115)
    expect(p.x).toBeLessThan(145)
    expect(world.insideBuilding(p.x, p.z)).toBe(false)
    // 向いた先 40m に壁が無い（ガードまで見通せる）
    expect(world.segmentClear(p.x, p.z, p.x + Math.sin(262 * DEG) * 40, p.z - Math.cos(262 * DEG) * 40)).toBeGreaterThanOrEqual(1)
  })

  it('109 前から駅方向の写真は分岐の先端の前へ移し、通りの谷間に箱を積んだ形の塔（ヒカリエ）が入る', () => {
    const p = photoStandpoint(-142.4, 14.7, 95)
    expect(world.insideBuilding(p.x, p.z)).toBe(false)
    const tower = world.map.buildings.find((b) => b.id === 521569267)
    expect(tower).toBeDefined()
    if (!tower) return
    const s = sightTo(tower, p.x, p.z, 1.6)
    // 通りの向き（東よりやや南）の右 15 度以内、見上げ 20 度より上
    expect(s.bearing).toBeGreaterThan(90)
    expect(s.bearing).toBeLessThan(105)
    expect(s.elevation).toBeGreaterThan(20)
    // 同じ場所から西を向いた写真は動かさない
    expect(photoStandpoint(-142.4, 14.7, 280)).toEqual({ x: -142.4, z: 14.7 })
  })

  it('宮益坂下から南の昼の写真は、見上げの角度によらず北の歩道の奥（ガラスの囲いと丸い角の間）へ移す', () => {
    const low = photoStandpoint(151.9, -18.6, 185, 15, 'day')
    const high = photoStandpoint(151.9, -18.6, 183, 27, 'day')
    expect(high).toEqual(low)
    // 40m 北、囲い（x 150.4〜152.1）の西
    expect(high.z).toBeLessThan(-50)
    expect(high.x).toBeLessThan(150)
    expect(world.insideBuilding(high.x, high.z)).toBe(false)
  })

  it('手で数 m ずらした位置は、同じだけずれた所へ移る', () => {
    const a = photoStandpoint(210.8, -40.8, 260)
    const b = photoStandpoint(207.8, -38.8, 265)
    expect(b.x - a.x).toBeCloseTo(-3, 5)
    expect(b.z - a.z).toBeCloseTo(2, 5)
  })

  it('離れた場所・逆向きの写真は動かさない', () => {
    expect(photoStandpoint(0, 0, 260)).toEqual({ x: 0, z: 0 })
    expect(photoStandpoint(210.8, -40.8, 75)).toEqual({ x: 210.8, z: -40.8 })
    // 宮益坂下の信号の写真（実測の位置）は範囲の外
    expect(photoStandpoint(179.6, -20.5, 250)).toEqual({ x: 179.6, z: -20.5 })
  })

  it('直しの表は、移す先が建物の外にある', () => {
    for (const f of PHOTO_FIXES) expect(world.insideBuilding(f.to[0], f.to[1])).toBe(false)
  })

  it('緯度経度の撮影クエリにも効く', () => {
    const { mPerDegLat, mPerDegLon, origin } = world.map.meta
    const lat = origin.lat + 40.8 / mPerDegLat
    const lon = origin.lon + 210.8 / mPerDegLon
    const l = parseLaunch(new URLSearchParams(`gtoShot=${lat},${lon},260`), world)
    expect(l.photo).not.toBeNull()
    if (!l.photo) return
    expect(l.photo.x).toBeLessThan(145)
    expect(l.photo.x).toBeGreaterThan(115)
  })

  it('起こし直した立ち位置はどれも建物の外で、向いた先 12m に壁が無い', () => {
    for (const f of PHOTO_FIXES) {
      const p = photoStandpoint(f.from[0], f.from[1], f.heading)
      expect(world.insideBuilding(p.x, p.z), `${f.to}`).toBe(false)
      expect(world.segmentClear(p.x, p.z, p.x + Math.sin(f.heading * DEG) * 12, p.z - Math.cos(f.heading * DEG) * 12), `${f.to}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('109 前から北向き・南向きの写真は、分岐の先端の前と文化村通りの北へ分けて移す', () => {
    const north = photoStandpoint(-142.4, 14.7, 10)
    // 分岐の先端の前（第16ラウンドの練習判定 2 回目。cityRound16b.test.ts）
    expect(Math.hypot(north.x + 124, north.z + 7)).toBeLessThan(1e-6)
    // 南向きは 2 枚で立ち位置が違う。向きで分ける: 170 度（109_10）は先端の真北の横断歩道、190〜205 度（109_13）は文化村通りの北の歩道の奥
    const south10 = photoStandpoint(-142.4, 14.7, 170)
    expect(Math.hypot(south10.x + 122, south10.z + 20)).toBeLessThan(1e-6)
    expect(170 + photoTurn(-142.4, 14.7, 170)).toBeCloseTo(155)
    for (const h of [190, 203]) {
      const south13 = photoStandpoint(-142.4, 14.7, h)
      expect(Math.hypot(south13.x + 128, south13.z + 30.5)).toBeLessThan(1e-6)
      // 赤い大看板とホテル棟の壁（方角 156〜174 度）が画面の中央の近くに来る
      expect(h + photoTurn(-142.4, 14.7, h)).toBeGreaterThan(155)
      expect(h + photoTurn(-142.4, 14.7, h)).toBeLessThan(176)
      // 向かいの棟の全身が入るよう、道玄坂の南の壁から 40m 以上引く
      expect(world.segmentClear(south13.x, south13.z, south13.x + Math.sin(165 * DEG) * 40, south13.z - Math.cos(165 * DEG) * 40)).toBeGreaterThanOrEqual(1)
    }
  })

  it('写真の立ち位置の目の前には、木も街灯も立たない', () => {
    const props = streetProps(world).filter((p) => p.kind !== 'signal')
    for (const [x, z] of PHOTO_STANDS) {
      const near = props.filter((p) => Math.hypot(p.x - x, p.z - z) < PHOTO_STAND_CLEAR)
      expect(near, `${x},${z}`).toEqual([])
    }
    expect(nearPhotoStand(20.6, 40)).toBe(true)
    expect(nearPhotoStand(60, 60)).toBe(false)
  })
})
