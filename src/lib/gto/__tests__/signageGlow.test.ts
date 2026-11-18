// 看板とネオン管が路面・人・車に落とす光（signageGlow.ts）のテスト。
import { describe, expect, it } from 'vitest'
import { TINT_TUNING, tintFactor } from '../signageGlow'
import { buildNeonTubes, buildSignage } from '../signage'
import { buildGlowEmitters, buildGlowField, emitterFalloff, GLOW_TUNING, glowColor, sampleGlow, softCap, type GlowEmitter } from '../signageGlow'
import { buildSignTubes } from '../signageNeon'
import { world } from './helpers'

const emitter: GlowEmitter = { ox: 0, oz: 0, nx: 0, nz: 1, half: 4, d0: 3.5, reach: 14, color: [1, 0.2, 0.5], power: 1 }
const saturation = (c: readonly number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c, 1e-6)

describe('gto signageGlow: 1枚の看板の光の減衰', () => {
  it('看板の直下（壁際の中央）がいちばん明るい', () => {
    const peak = emitterFalloff(emitter, 0, 0)
    expect(peak).toBeGreaterThan(0.9)
    for (let d = 0.5; d < 16; d += 0.5) {
      for (let lat = -8; lat <= 8; lat += 1) expect(emitterFalloff(emitter, d, lat)).toBeLessThanOrEqual(peak)
    }
  })
  it('道のほうへ離れるほど単調に暗くなり、届く距離で 0 になる', () => {
    let prev = emitterFalloff(emitter, 0, 0)
    for (let d = 0.25; d <= emitter.reach; d += 0.25) {
      const v = emitterFalloff(emitter, d, 0)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
    expect(emitterFalloff(emitter, emitter.reach, 0)).toBe(0)
    expect(emitterFalloff(emitter, emitter.reach + 3, 0)).toBe(0)
    // 半分の距離で、もう壁際の 3 割より暗い（べた塗りにしない）
    expect(emitterFalloff(emitter, emitter.reach / 2, 0)).toBeLessThan(0.3)
  })
  it('横の縁はくっきり切れず、なだらかに消える', () => {
    const center = emitterFalloff(emitter, 2, 0)
    const edge = emitterFalloff(emitter, 2, emitter.half)
    expect(edge).toBeGreaterThan(center * 0.25)
    expect(edge).toBeLessThan(center * 0.8)
    // 25cm 動いて変わる量は、中央の明るさの 1 割未満
    for (let lat = 0; lat < 14; lat += 0.25) {
      expect(Math.abs(emitterFalloff(emitter, 2, lat) - emitterFalloff(emitter, 2, lat + 0.25))).toBeLessThan(center * 0.1)
    }
    expect(emitterFalloff(emitter, 2, emitter.half * 4)).toBeLessThan(0.01)
  })
  it('壁の裏側（建物の中）へは回り込まない', () => {
    expect(emitterFalloff(emitter, -GLOW_TUNING.behind - 0.5, 0)).toBe(0)
  })
})

describe('gto signageGlow: 光の色', () => {
  it('看板の色より彩度を抑える（蛍光色のまま路面に落とさない）', () => {
    const c = glowColor('#3dffc0')
    expect(saturation(c)).toBeLessThan(0.72)
    expect(saturation(c)).toBeGreaterThan(0.3)
    // 色相は保つ: 緑がいちばん強く、赤がいちばん弱い
    expect(c[1]).toBeGreaterThan(c[2])
    expect(c[2]).toBeGreaterThan(c[0])
  })
  it('softCap は色相を保ったまま、上限を超えない', () => {
    const c = softCap([4, 1, 0.5], 0.6)
    expect(Math.max(...c)).toBeLessThan(0.6)
    expect(c[0] / c[1]).toBeCloseTo(4, 5)
    // 弱い光はほぼそのまま
    expect(softCap([0.02, 0.01, 0], 0.6)[0]).toBeCloseTo(0.02, 2)
  })
})

describe('gto signageGlow: 街の光の場', () => {
  const signs = buildSignage(world)
  const tubes = [...buildNeonTubes(world), ...buildSignTubes(signs)]
  const emitters = buildGlowEmitters(world, signs, tubes)
  const field = buildGlowField(world, emitters, 2)
  const level = (x: number, z: number) => Math.max(...sampleGlow(field, x, z))

  it('灯の入った看板と軒の管が光源になる（屋上の広告塔と、看板を縁取る管は数えない）', () => {
    expect(emitters.length).toBeGreaterThan(200)
    for (const e of emitters) {
      expect(Math.hypot(e.nx, e.nz)).toBeCloseTo(1, 5)
      expect(e.reach).toBeGreaterThan(1)
      expect(e.reach).toBeLessThanOrEqual(20)
      expect(saturation(e.color)).toBeLessThan(0.76)
      // 光の起点から道のほうへ出た先は建物の中ではない
      expect(world.insideBuilding(e.ox + e.nx * 3.5, e.oz + e.nz * 3.5)).toBe(false)
    }
  })
  it('光源の壁際がいちばん明るく、道のほうへ薄れる', () => {
    // 届く距離の先は向かいの店の壁際のこともあるので、1枚ずつではなく平均で比べる
    const picked = emitters.filter((e) => e.reach >= 12 && e.power >= 0.9).slice(0, 80)
    expect(picked.length).toBeGreaterThan(20)
    const mean = (out: (e: GlowEmitter) => number) => picked.reduce((sum, e) => sum + level(e.ox + e.nx * out(e), e.oz + e.nz * out(e)), 0) / picked.length
    const near = mean(() => 1)
    const mid = mean((e) => e.reach * 0.5)
    const far = mean((e) => e.reach)
    expect(near).toBeGreaterThan(0.25)
    expect(mid).toBeLessThan(near * 0.75)
    expect(far).toBeLessThan(near * 0.5)
  })
  it('どの升目も上限を超えず、蛍光色のままの升目が無い', () => {
    let lit = 0
    for (let i = 0; i < field.data.length; i += 3) {
      const c = [field.data[i], field.data[i + 1], field.data[i + 2]]
      const hi = Math.max(...c)
      expect(hi).toBeLessThanOrEqual(GLOW_TUNING.cap)
      if (hi > 0.05) {
        lit++
        expect(saturation(c)).toBeLessThan(0.78)
      }
    }
    expect(lit).toBeGreaterThan(500)
  })
  it('隣の升目との差が小さい（色面の境界がくっきり出ない）', () => {
    const { cols, rows, data, x0, z0, cell } = field
    let worst = 0
    for (let r = 0; r < rows; r++) {
      // 建物の中（壁の裏へにじませる 4m。路面には出ない）は数えない
      let prevOut = !world.insideBuilding(x0, z0 + r * cell)
      for (let c = 0; c + 1 < cols; c++) {
        const out = !world.insideBuilding(x0 + (c + 1) * cell, z0 + r * cell)
        if (prevOut && out) {
          for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(data[(r * cols + c) * 3 + k] - data[(r * cols + c + 1) * 3 + k]))
        }
        prevOut = out
      }
    }
    expect(worst).toBeLessThan(GLOW_TUNING.cap * 0.45)
  })
  it('範囲の外と、看板の無い場所は 0', () => {
    expect(sampleGlow(field, world.bounds.maxX + 500, 0)).toEqual([0, 0, 0])
    expect(sampleGlow(field, Number.NaN, 0)).toEqual([0, 0, 0])
  })
  it('灯の入っていない看板は光らない', () => {
    expect(buildGlowEmitters(world, signs.map((s) => ({ ...s, lit: false })), [])).toEqual([])
  })
  it('軽量（lite）の配置でも作れる', () => {
    const lite = buildSignage(world, 'lite')
    const liteField = buildGlowField(world, buildGlowEmitters(world, lite, buildNeonTubes(world, 'lite')), 4)
    expect(liteField.cols * liteField.rows).toBeLessThan(field.cols * field.rows)
    expect(liteField.data.some((v) => v > 0.05)).toBe(true)
  })
})

describe('gto signageGlow: 染める（下の色に掛ける倍率）', () => {
  const pink: [number, number, number] = [1, 0.05, 0.32]
  it('光が無ければ 1（下の色のまま）', () => {
    expect(tintFactor(pink, 0)).toEqual([1, 1, 1])
    expect(tintFactor([0, 0, 0], 1)).toEqual([1, 1, 1])
  })
  it('白いシャッターが看板の色に寄る: 光の色の成分は保ち（明るい光だまりを倍にしない）、補色の成分は半分以下に落ちる', () => {
    const f = tintFactor(pink, 1)
    expect(f[0]).toBeGreaterThanOrEqual(1)
    expect(f[0]).toBeLessThan(1.2)
    expect(f[1]).toBeLessThan(0.5)
    expect(f[2]).toBeGreaterThan(f[1])
    expect(f[2]).toBeLessThan(f[0])
  })
  it('強さに比例して寄り、上限（TINT_TUNING.max）で止まる。倍率は負にならない', () => {
    const half = tintFactor(pink, 0.4)
    const full = tintFactor(pink, 0.8)
    expect(half[1]).toBeGreaterThan(full[1])
    expect(tintFactor(pink, 5)).toEqual(tintFactor(pink, TINT_TUNING.max))
    for (const v of tintFactor([0, 1, 0], 5)) expect(v).toBeGreaterThanOrEqual(0)
  })
  it('残す割合（1 − cut × s）は 0..1 に収まる（8bit の画面でもアルファで送れる）', () => {
    const keep = 1 - TINT_TUNING.cut * TINT_TUNING.max
    expect(keep).toBeGreaterThan(0)
    expect(keep).toBeLessThan(1)
  })
})
