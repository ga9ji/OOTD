// 看板を縁取るネオン管と、看板が落とす光の色（signageNeon.ts）のテスト。
import { describe, expect, it } from 'vitest'
import { buildSignage, type Sign } from '../signage'
import { NEON_COLORS } from '../signageCatalog'
import { buildSignTubes, neonAccent, signSpill, SPILL_CELL, spillWeights } from '../signageNeon'
import { world } from './helpers'

const rgb = (css: string) => {
  const n = Number.parseInt(css.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const saturation = (css: string) => {
  const c = rgb(css)
  return (Math.max(...c) - Math.min(...c)) / Math.max(...c)
}

const base: Sign = { kind: 'fascia', x: 0, y: 4, z: 0, w: 6, h: 1, heading: 0, text: '', sub: '', bg: '#ffffff', fg: '#e23d6d', vertical: false, lit: true, design: 0 }

describe('gto signageNeon: 光の色', () => {
  it('白地に桃色の文字の看板は、桃色の光を出す（白い光にしない）', () => {
    const [r, g, b] = rgb(neonAccent(base))
    expect(r).toBe(255)
    expect(r).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(g)
    expect(saturation(neonAccent(base))).toBeGreaterThan(0.7)
  })
  it('緑の地に白い文字の看板は、緑の光を出す', () => {
    const [r, g, b] = rgb(neonAccent({ ...base, bg: '#3d7a3a', fg: '#ffffff' }))
    expect(g).toBe(255)
    expect(g).toBeGreaterThan(r * 1.5)
    expect(g).toBeGreaterThan(b * 1.5)
  })
  it('白と黒だけの看板は、決めたネオンの色から選ぶ', () => {
    const colors = new Set<string>(NEON_COLORS)
    expect(colors.has(neonAccent({ ...base, bg: '#ffffff', fg: '#111111' }))).toBe(true)
    expect(colors.has(neonAccent({ ...base, bg: '#111111', fg: '#ffffff', design: 5 }))).toBe(true)
  })
  it('どの看板の光も、色が濃く明るい', () => {
    for (const s of buildSignage(world)) {
      const c = neonAccent(s)
      expect(Math.max(...rgb(c))).toBe(255)
      expect(saturation(c)).toBeGreaterThan(0.6)
    }
  })
})

describe('gto signageNeon: 看板を縁取る管', () => {
  const signs = buildSignage(world)
  const tubes = buildSignTubes(signs)
  it('灯の入った店の看板には、看板の幅の水平の管が付く。色は看板の光の色', () => {
    const own = buildSignTubes([base])
    expect(own.length).toBeGreaterThanOrEqual(1)
    const flat = own.filter((t) => t.y0 === t.y1)
    expect(flat.length).toBeGreaterThanOrEqual(1)
    for (const t of flat) {
      expect(Math.hypot(t.x1 - t.x0, t.z1 - t.z0)).toBeGreaterThan(base.w * 0.9)
      expect(Math.abs(t.y0 - base.y)).toBeLessThan(base.h / 2 + 0.3)
    }
    for (const t of own) {
      expect(t.color).toBe(neonAccent(base))
      expect(t.frame).toBe(true)
    }
  })
  it('灯の入っていない看板と屋上の広告塔には付かない', () => {
    expect(buildSignTubes([{ ...base, lit: false }])).toEqual([])
    expect(buildSignTubes([{ ...base, kind: 'rooftop' }])).toEqual([])
  })
  it('管は看板の面より手前（見る側）にある', () => {
    for (const t of buildSignTubes([{ ...base, heading: Math.PI / 2 }])) {
      // 東向きの看板なので、管は看板より東
      expect((t.x0 + t.x1) / 2).toBeGreaterThan(base.x)
      expect(t.nx).toBeCloseTo(1, 5)
    }
  })
  it('街の店の看板のほとんどが管を持ち、軽量では数が減る', () => {
    const litFascia = signs.filter((s) => s.lit && s.kind === 'fascia').length
    expect(tubes.filter((t) => t.y0 === t.y1).length).toBeGreaterThan(litFascia * 0.9)
    const liteSigns = buildSignage(world, 'lite')
    expect(buildSignTubes(liteSigns, 'lite').length).toBeLessThan(tubes.length * 0.4)
  })
})

describe('gto signageNeon: 路面に落とす光', () => {
  it('店の看板は足元から道の反対側の車線の手前まで（7〜16m）を染める', () => {
    const spill = signSpill(base)
    expect(spill).not.toBeNull()
    expect(spill?.reach).toBeGreaterThanOrEqual(7)
    expect(spill?.reach).toBeLessThanOrEqual(16)
    expect(spill?.half).toBeGreaterThan(base.w / 2)
  })
  it('大きな広告とビジョンは、店の看板より遠くまで染める', () => {
    const shop = signSpill(base)
    const vision: Sign = { ...base, kind: 'vision', w: 16, h: 8, y: 20 }
    const big = signSpill(vision)
    expect(big?.reach ?? 0).toBeGreaterThan(shop?.reach ?? 99)
  })
  it('灯の入っていない看板・屋上の広告塔は路面を染めない', () => {
    expect(signSpill({ ...base, lit: false })).toBeNull()
    expect(signSpill({ ...base, kind: 'rooftop' })).toBeNull()
  })
})

describe('gto signageNeon: 光の重なり', () => {
  it('1枚だけの看板はそのままの強さ、同じ場所に重なる看板は後のものほど弱い', () => {
    expect(spillWeights([base])).toEqual([1])
    const stack = spillWeights([base, { ...base, y: 6 }, { ...base, y: 8 }])
    expect(stack[0]).toBe(1)
    expect(stack[1]).toBeLessThan(0.5)
    expect(stack[2]).toBeLessThan(stack[1])
    expect(spillWeights([{ ...base, lit: false }])).toEqual([0])
    // 緩い弱め方（路面の光の場）: 2枚目は半分
    expect(spillWeights([base, { ...base, y: 6 }], 1)).toEqual([1, 0.5])
  })
  it('街のどの升目でも、光の合計は白く飛ぶ手前で止まる', () => {
    const signs = buildSignage(world)
    const weights = spillWeights(signs)
    const sums = new Map<string, number>()
    signs.forEach((s, i) => {
      const key = `${Math.floor(s.x / SPILL_CELL)},${Math.floor(s.z / SPILL_CELL)}`
      sums.set(key, (sums.get(key) ?? 0) + weights[i])
    })
    expect(Math.max(...sums.values())).toBeLessThan(1.65)
  })
})
