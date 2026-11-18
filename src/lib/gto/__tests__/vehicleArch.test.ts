// [部品: vehicle] 車体の側面に開けるタイヤハウス（車輪が中で上下に動く、丸い切り欠き）の形のテスト。
import { describe, expect, it } from 'vitest'
import { archColumns, archCut, panelPoint } from '../vehicleArch'

const WHEELS = [-1.35, 1.35]
const R = 0.46
const AXLE = 0.34

describe('gto vehicleArch: 切り欠きの高さ', () => {
  it('車輪の真上がいちばん高く（車軸 + 半径）、前後へ丸く下がる', () => {
    expect(archCut(1.35, WHEELS, R, AXLE)).toBeCloseTo(AXLE + R, 6)
    expect(archCut(1.35 + R * 0.6, WHEELS, R, AXLE)).toBeCloseTo(AXLE + R * 0.8, 6)
    expect(archCut(-1.35 - R, WHEELS, R, AXLE)).toBeCloseTo(AXLE, 6)
  })

  it('車輪から離れた所は切らない', () => {
    expect(archCut(0, WHEELS, R, AXLE)).toBe(-Infinity)
    expect(archCut(1.35 + R + 0.01, WHEELS, R, AXLE)).toBe(-Infinity)
  })
})

describe('gto vehicleArch: 側面を割る位置', () => {
  it('車輪に掛からない区間は割らない', () => {
    expect(archColumns(-0.4, 0.3, WHEELS, R, 0.07)).toEqual([-0.4, 0.3])
  })

  it('車輪に掛かる区間は、切り欠きの両端とその少し外、あいだを細かく割る', () => {
    const cols = archColumns(0.5, 2.2, WHEELS, R, 0.07)
    expect(cols[0]).toBe(0.5)
    expect(cols[cols.length - 1]).toBe(2.2)
    for (const edge of [1.35 - R, 1.35 + R]) expect(cols.some((z) => Math.abs(z - edge) < 1e-9)).toBe(true)
    // 切り欠きの中は 7cm より粗くならない
    const inside = cols.filter((z) => Math.abs(z - 1.35) <= R + 1e-9)
    for (let i = 1; i < inside.length; i++) expect(inside[i] - inside[i - 1]).toBeLessThanOrEqual(0.07 + 1e-9)
    // 前から後ろへ並び、重ならない
    for (let i = 1; i < cols.length; i++) expect(cols[i]).toBeGreaterThan(cols[i - 1])
  })

  it('区間の途中から始まる切り欠きも、区間の中だけを割る', () => {
    const cols = archColumns(1.2, 1.5, WHEELS, R, 0.07)
    expect(cols[0]).toBe(1.2)
    expect(cols[cols.length - 1]).toBe(1.5)
    expect(cols.length).toBeGreaterThanOrEqual(5)
  })
})

describe('gto vehicleArch: 側面の折れ線の上の点', () => {
  // 裾（幅 0.8・高さ 0.2）→ 腰（0.9・0.55）→ 肩（0.87・0.9）
  const profile: [number, number][] = [
    [0.8, 0.2],
    [0.9, 0.55],
    [0.87, 0.9],
  ]

  it('高さから、折れ線の上の幅を返す', () => {
    expect(panelPoint(profile, 0.2)).toEqual({ x: 0.8, y: 0.2, above: 0 })
    const mid = panelPoint(profile, 0.375)
    expect(mid.x).toBeCloseTo(0.85, 6)
    expect(mid.above).toBe(0)
    const high = panelPoint(profile, 0.725)
    expect(high.x).toBeCloseTo(0.885, 6)
    expect(high.above).toBe(1)
  })

  it('裾より下は裾、肩より上は肩の少し下で止める', () => {
    expect(panelPoint(profile, -1).y).toBe(0.2)
    const top = panelPoint(profile, 5)
    expect(top.y).toBeLessThan(0.9)
    expect(top.y).toBeGreaterThan(0.85)
  })
})
