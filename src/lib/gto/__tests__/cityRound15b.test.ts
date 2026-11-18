// Grand Theft Outfit [部品: city] 第15ラウンド 練習判定 1 回目（4/7）のあとの決まりごとの確かめ。
// 109 前から北（109_04/05/07/08）: 画面の右 3 分の 1 は、道玄坂がスクランブル交差点へ抜けていく通りの谷間。壁で塞がない。
// 道玄坂下から駅向き（dogenzaka_01）: 画面の左は開けた空と塔。北の棟の壁と袖看板を左手前に入れない。
import { describe, expect, it } from 'vitest'
import { streetProps } from '../map'
import { EAST_BRIDGE } from '../mapBridge'
import { inPhotoSight, photoStandpoint, photoTurn } from '../mapPhoto'
import { DEG } from '../math'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
const off = (heading: number, b: number) => ((b - heading + 540) % 360) - 180
/** 縦の画角 fov（度）・16:9 の画面の、横の半分の画角（度） */
const halfH = (fov: number) => (Math.atan((Math.tan((fov / 2) * DEG) * 16) / 9) / DEG)

describe('gto city 第15ラウンド: 109 前から北（道玄坂下の交差点越し）', () => {
  // index.json の推定位置（4 枚とも同じ、向き 5〜10 度。批評役は 18 度でも撮る）
  const raw: [number, number] = [-142.4, 14.7]

  // 第16ラウンドの練習判定 2 回目（109_08 が「特定できない」）のあと: 向かいの棟の南の面を正対で見る（cityRound16b.test.ts が細かく確かめる）。
  // ここでは、推定の向きがばらついても同じ向きに決まり、駅前が画面に入らないことだけを見る
  for (const given of [5, 10, 18]) {
    it(`向き ${given} 度（昼）: 向かいの棟の斜めの線の面が画面の中央の近くに来て、駅前は画面の外`, () => {
      const stand = photoStandpoint(raw[0], raw[1], given, 3, 'day')
      const heading = given + photoTurn(raw[0], raw[1], given, 3, 'day')
      expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
      const half = halfH(50)
      expect(Math.abs(off(heading, bearing(stand.x, stand.z, -102.2, -24.3)))).toBeLessThan(half)
      expect(Math.abs(off(heading, bearing(stand.x, stand.z, -113.8, -27.6)))).toBeLessThan(12)
      expect(Math.abs(off(heading, bearing(stand.x, stand.z, -30, -8)))).toBeGreaterThan(half)
      expect(world.segmentClear(stand.x, stand.z, stand.x + Math.sin(heading * DEG) * 15, stand.z - Math.cos(heading * DEG) * 15)).toBeGreaterThanOrEqual(1)
    })
  }
})

describe('gto city 第15ラウンド: 道玄坂下から駅向き（dogenzaka_01）', () => {
  const raw: [number, number] = [-42.5, 7.8]
  const bank = building(114755219)
  for (const given of [110, 118]) {
    it(`向き ${given} 度: 北の棟の壁が画面の左に入らない所（車道の縁）に立つ`, () => {
      const stand = photoStandpoint(raw[0], raw[1], given, 14)
      const heading = given + photoTurn(raw[0], raw[1], given, 14)
      expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
      const left = heading - halfH(50)
      // 棟の角は全部、画面の左の端より外（袖看板の張り出し 2m ぶんの余裕を見る）
      for (let i = 0; i < bank.pts.length; i += 2) {
        const o = off(left, bearing(stand.x, stand.z, bank.pts[i], bank.pts[i + 1] + 2))
        expect(o, `${bank.pts[i]},${bank.pts[i + 1]}`).toBeLessThan(0)
      }
      // 通りの抜けの先の塔への見通しに木を植えない
      for (const p of streetProps(world)) if (p.kind === 'tree') expect(inPhotoSight(p.x, p.z), `${p.x},${p.z}`).toBe(false)
    })
  }
})

describe('gto city 第15ラウンド: 東口の橋はガラスの駅舎に見える', () => {
  it('ガラスの帯は白い腰の 2 倍以上の高さ（miyamasuzaka_07: 2 段のガラスが塔の足元を横切る）', () => {
    const B = EAST_BRIDGE
    expect(B.eave - B.sill).toBeGreaterThan((B.sill - B.deck) * 2)
  })
})
