import { describe, expect, it } from 'vitest'
import { forkCrossing, FORK_109_MID, FORK_RED_PATCHES } from '../map109'
import { clipOutside, junctionClearings } from '../mapJunction'
import { photoStandpoint, photoTurn } from '../mapPhoto'
import { world } from './helpers'

describe('gto city 第13ラウンド: 交差点の中には車線の線を引かない（109_12 / scramble_08）', () => {
  const clearings = junctionClearings(world.map.roads)
  const at = (x: number, z: number) => clearings.find((c) => Math.hypot(c.x - x, c.z - z) < 1)

  it('車道が 3 本以上集まる点ごとに 1 つ', () => {
    expect(clearings.length).toBeGreaterThan(30)
    expect(at(0, 0)).toBeDefined()
    expect(at(-103, -2)).toBeDefined()
  })

  it('半径は、その交差点の横断歩道の外の端まで（停止線で線が切れる）', () => {
    // 109 前の分岐: 横断歩道は中心から 20m ほど先まである
    const fork = at(-103, -2)!
    expect(fork.r).toBeGreaterThan(18)
    expect(fork.r).toBeLessThan(30)
    // スクランブル交差点
    const scramble = at(0, 0)!
    expect(scramble.r).toBeGreaterThan(20)
    expect(scramble.r).toBeLessThan(36)
  })

  it('横断歩道の無い交差点でも、車道の幅ぶんは空ける', () => {
    for (const c of clearings) expect(c.r).toBeGreaterThanOrEqual(4)
  })

  it('折れ線から円の中を切り取る（外の区間だけが残る）', () => {
    const line: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
      [40, 0],
    ]
    const runs = clipOutside(line, [{ x: 20, z: 0, r: 6 }])
    expect(runs).toHaveLength(2)
    expect(runs[0][0]).toEqual([0, 0])
    expect(runs[0][runs[0].length - 1][0]).toBeCloseTo(14, 5)
    expect(runs[1][0][0]).toBeCloseTo(26, 5)
    expect(runs[1][runs[1].length - 1]).toEqual([40, 0])
    // 円に触れない線はそのまま
    expect(clipOutside(line, [{ x: 20, z: 30, r: 6 }])).toEqual([line])
    // 全部が円の中なら何も残らない
    expect(clipOutside(line, [{ x: 20, z: 0, r: 60 }])).toEqual([])
  })
})

describe('gto city 第13ラウンド: 109 前の分岐の横断歩道（109_12 / 109_07 / 109_08）', () => {
  const crossings = world.map.roads.filter((r) => r.crossing)

  it('分岐のまわりの横断歩道（分岐の 5 本と横道の口の 2 本）のうち、先端から正面へ延びる 1 本だけ縞を描かない（赤茶の帯は添えない）', () => {
    const near = crossings.filter((r) => forkCrossing(r) != null)
    expect(near).toHaveLength(7)
    expect(near.filter((r) => forkCrossing(r) === 'plain')).toHaveLength(6)
    expect(near.filter((r) => forkCrossing(r) === 'none')).toHaveLength(1)
  })

  it('赤茶の舗装は、横断歩道の付け根（歩道の角）だけ', () => {
    expect(FORK_RED_PATCHES.length).toBeGreaterThanOrEqual(3)
    for (const [x, z, r] of FORK_RED_PATCHES) {
      expect(r).toBeLessThanOrEqual(6)
      expect(Math.hypot(x - FORK_109_MID[0], z - FORK_109_MID[1])).toBeLessThan(26)
      // 付け根はどれかの横断歩道の端のそば
      const nearEnd = crossings.some((c) => [0, c.pts.length - 2].some((i) => Math.hypot(c.pts[i] - x, c.pts[i + 1] - z) < 5))
      expect(nearEnd).toBe(true)
    }
  })
})

describe('gto city 第13ラウンド: 写真の向きの起こし直し（109_12）', () => {
  it('109 前から駅向きは、推定の 95 度ではなくガードが画面の中央やや右に来る向き', () => {
    const turn = photoTurn(-142.4, 14.7, 95)
    expect(turn).toBeLessThan(0)
    expect(turn).toBeGreaterThanOrEqual(-6)
    // 立ち位置は分岐の先端（横断歩道の付け根）
    const p = photoStandpoint(-142.4, 14.7, 95)
    expect(Math.hypot(p.x + 121, p.z + 4.5)).toBeLessThan(3)
  })

  it('直しの無い写真は向きを変えない', () => {
    expect(photoTurn(0, 0, 0)).toBe(0)
    expect(photoTurn(-142.4, 14.7, 300)).toBe(0)
  })

  it('交差点の北西の角から駅向き（scramble_14/16）は、歩道の奥ではなく横断歩道の付け根に立つ', () => {
    const p = photoStandpoint(-28.3, -33.1, 150)
    expect(Math.hypot(p.x + 16, p.z + 18)).toBeLessThan(1)
    expect(world.insideBuilding(p.x, p.z)).toBe(false)
    // 北向き（センター街の入口向き）の写真には効かない
    const q = photoStandpoint(-28.3, -33.1, 300)
    expect(q).toEqual({ x: -28.3, z: -33.1 })
  })
})
