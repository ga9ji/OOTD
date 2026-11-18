import { describe, expect, it } from 'vitest'
import { LIGHTING } from '../lighting'
import { casterHeight, GROUND_CELLS, groundGrid, sampleGround, shadowLength, SHADOW_CAP } from '../lightingShadow'
import type { TimeOfDay } from '../types'
import { world } from './helpers'

const TIMES: TimeOfDay[] = ['day', 'dusk', 'night']

describe('gto lightingShadow: 影を落とす高さの上限', () => {
  it('低い物（車・人・柱）はそのままの高さで影を落とす', () => {
    for (const t of TIMES) {
      const cap = SHADOW_CAP[t]
      expect(casterHeight(0, cap)).toBe(0)
      expect(casterHeight(1.5, cap)).toBeCloseTo(1.5, 6)
      expect(casterHeight(cap.keep, cap)).toBeCloseTo(cap.keep, 6)
      // 地面より下は触らない
      expect(casterHeight(-2, cap)).toBe(-2)
    }
  })

  it('高いビルは上限の高さまでしか影を落とさず、高さの順は保つ', () => {
    for (const t of TIMES) {
      const cap = SHADOW_CAP[t]
      expect(casterHeight(200, cap)).toBeLessThanOrEqual(cap.max)
      expect(casterHeight(200, cap)).toBeGreaterThan(cap.max * 0.98)
      expect(casterHeight(40, cap)).toBeGreaterThan(casterHeight(12, cap))
      expect(casterHeight(12, cap)).toBeGreaterThan(casterHeight(cap.keep, cap))
      // 上限の手前で折れ曲がらない（傾きが 1 から滑らかに減る）
      const step = casterHeight(cap.keep + 0.01, cap) - casterHeight(cap.keep, cap)
      expect(step).toBeGreaterThan(0.009)
    }
  })

  it('夕方は、車の影が車より長く伸び、ビルの影が通りを塞ぎきらない', () => {
    const L = LIGHTING.dusk
    const dir = L.lightDir ?? L.sunDir
    // セダンの屋根（1.4m）の影は 2.5m を超える（方向のある長い影）
    expect(shadowLength(1.4, dir, SHADOW_CAP.dusk)).toBeGreaterThan(2.5)
    // 街路樹（6m）の影は 9m を超える
    expect(shadowLength(6, dir, SHADOW_CAP.dusk)).toBeGreaterThan(9)
    // 40m のビルでも影は 22m まで（広い通りの路面に日が残る）
    expect(shadowLength(40, dir, SHADOW_CAP.dusk)).toBeLessThan(22)
    expect(shadowLength(40, dir, SHADOW_CAP.dusk)).toBeGreaterThan(12)
  })

  it('昼は影が短く、ビルの影でも通りの片側に収まる', () => {
    const L = LIGHTING.day
    expect(shadowLength(40, L.lightDir ?? L.sunDir, SHADOW_CAP.day)).toBeLessThan(14)
    expect(shadowLength(1.4, L.lightDir ?? L.sunDir, SHADOW_CAP.day)).toBeGreaterThan(0.8)
  })
})

describe('gto lightingShadow: 地面の高さの粗い格子', () => {
  const b = world.map.meta.bounds
  const grid = groundGrid(world.groundY, b, GROUND_CELLS)

  it('範囲の四隅と中を覆い、数は格子の点の数に合う', () => {
    expect(grid.cols).toBe(GROUND_CELLS + 1)
    expect(grid.rows).toBe(GROUND_CELLS + 1)
    expect(grid.data).toHaveLength((GROUND_CELLS + 1) ** 2)
    expect(grid.x0).toBeCloseTo(b.minX, 6)
    expect(grid.z0).toBeCloseTo(b.minZ, 6)
    expect(grid.x0 + grid.stepX * GROUND_CELLS).toBeCloseTo(b.maxX, 6)
  })

  it('格子から戻した高さは、もとの地面から大きく外れない', () => {
    let worst = 0
    for (let i = 0; i < 400; i++) {
      const x = b.minX + ((i * 37) % 400) / 400 * (b.maxX - b.minX)
      const z = b.minZ + ((i * 91) % 400) / 400 * (b.maxZ - b.minZ)
      worst = Math.max(worst, Math.abs(sampleGround(grid, x, z) - world.groundY(x, z)))
    }
    // 影を落とす高さの上限に対して十分小さい
    expect(worst).toBeLessThan(2.5)
  })

  it('範囲の外は端の値で止まる', () => {
    expect(sampleGround(grid, b.minX - 500, b.minZ - 500)).toBeCloseTo(grid.data[0], 6)
    expect(Number.isFinite(sampleGround(grid, b.maxX + 500, b.maxZ + 500))).toBe(true)
  })
})
