// 看板とネオン（signage.ts）の配置と明るさのテスト。
import { describe, expect, it } from 'vitest'
import { LIGHTING } from '../lighting'
import { ADS, buildNeonTubes, buildSignage, buildStorefrontShades, NEON_WORDS, NIGHT_CELLS, signCell, signGain, signLook, SHOPS, SIGN_CELLS, SIGNAGE_TUNING, UPPER_SHOPS, wallNormalOf } from '../signage'
import { NEON_COLORS } from '../signageCatalog'
import { world } from './helpers'

const full = buildSignage(world)
const lite = buildSignage(world, 'lite')
const near = (x: number, z: number, r: number) => full.filter((s) => Math.hypot(s.x - x, s.z - z) < r)

describe('gto signage: 配置', () => {
  it('店名・広告は一覧にある架空の名前だけで、一覧の中で重ならない', () => {
    const all = [...SHOPS, ...UPPER_SHOPS, ...ADS, ...NEON_WORDS]
    const names = new Set(all.map((s) => s.name))
    expect(new Set(SHOPS.map((s) => s.name)).size).toBe(SHOPS.length)
    expect(new Set(UPPER_SHOPS.map((s) => s.name)).size).toBe(UPPER_SHOPS.length)
    const real = new Set(world.map.buildings.map((b) => b.name).filter(Boolean))
    for (const s of full) {
      expect(names.has(s.text)).toBe(true)
      expect(real.has(s.text)).toBe(false)
    }
  })

  it('看板は建物の外にあり、地面より上・人の頭より上に出る', () => {
    for (const s of full) {
      expect(world.insideBuilding(s.x, s.z)).toBe(false)
      expect(s.y - s.h / 2).toBeGreaterThan(world.groundY(s.x, s.z) + 2)
      expect(s.w).toBeGreaterThan(0.4)
      expect(s.h).toBeGreaterThan(0.4)
    }
  })

  it('先頭は路面を染める主な看板で、交差点に近い順。駅前だけに固まらない', () => {
    const head = full.slice(0, 240)
    expect(head.every((s) => s.kind !== 'blade' && s.kind !== 'rooftop')).toBe(true)
    expect(head.every((s) => s.lit)).toBe(true)
    for (let i = 1; i < head.length; i++) expect(Math.hypot(head[i].x, head[i].z)).toBeGreaterThanOrEqual(Math.hypot(head[i - 1].x, head[i - 1].z) - 30)
    // 大きな広告は少し手前に繰り上げる（30m まで）。土台は 240 枚で半径 191m までしか届かなかった
    expect(Math.hypot(head[239].x, head[239].z)).toBeGreaterThan(230)
  })

  it('センター街と道玄坂下は袖看板が縦に重なって並ぶ（写真の密度: 1棟 5〜10 枚）', () => {
    const count = (list: typeof full, kind: string) => list.filter((s) => s.kind === kind).length
    const center = near(-70, -60, 45)
    expect(count(center, 'blade')).toBeGreaterThan(60)
    expect(count(center, 'fascia')).toBeGreaterThan(25)
    const dogenzaka = near(-110, 10, 60)
    expect(count(dogenzaka, 'blade')).toBeGreaterThan(50)
    expect(count(full, 'rooftop')).toBeGreaterThan(40)
    expect(count(full, 'vision')).toBeGreaterThan(8)
  })

  it('同じ柱の袖看板は上下に重ならない', () => {
    const cols = new Map<string, { lo: number; hi: number }[]>()
    for (const s of full) {
      if (s.kind !== 'blade') continue
      const n = wallNormalOf(s)
      const key = `${Math.round((s.x - n.x * s.w * 0.5) * 20)},${Math.round((s.z - n.z * s.w * 0.5) * 20)}`
      cols.set(key, [...(cols.get(key) ?? []), { lo: s.y - s.h / 2, hi: s.y + s.h / 2 }])
    }
    let stacked = 0
    for (const list of cols.values()) {
      const sorted = [...list].sort((a, b) => a.lo - b.lo)
      if (sorted.length >= 3) stacked++
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].lo).toBeGreaterThanOrEqual(sorted[i - 1].hi - 1e-6)
    }
    expect(stacked).toBeGreaterThan(200)
  })

  it('軽量の配置は数が少なく、主な看板は同じ', () => {
    expect(lite.length).toBeLessThan(full.length * 0.4)
    expect(lite.length).toBeGreaterThan(600)
    expect(lite.slice(0, 96)).toEqual(full.slice(0, 96))
  })

  it('同じ世界なら同じ配置を返す', () => {
    expect(buildSignage(world)).toBe(full)
  })

  it('どの看板もアトラスの絵（SIGN_CELLS）を指している', () => {
    const keys = new Set(SIGN_CELLS.map((c) => c.key))
    expect(keys.size).toBe(SIGN_CELLS.length)
    // 筆記体のネオン文字は別の絵（renderSignsNeonText.ts）を使う
    for (const s of full) if (s.kind !== 'neon') expect(keys.has(signCell(s))).toBe(true)
  })
})

describe('gto signage: ネオン管', () => {
  const tubes = buildNeonTubes(world)
  it('軒をなぞる管は建物の外にあり、色は決めた数色だけ', () => {
    expect(tubes.length).toBeGreaterThan(80)
    const colors = new Set<string>(NEON_COLORS)
    for (const t of tubes) {
      expect(colors.has(t.color)).toBe(true)
      // 縦の管は建物の角に立つので、管そのものの位置で確かめる
      const probe = t.y0 === t.y1 ? 0.5 : 0
      expect(world.insideBuilding((t.x0 + t.x1) / 2 + t.nx * probe, (t.z0 + t.z1) / 2 + t.nz * probe)).toBe(false)
      expect(Math.hypot(t.x1 - t.x0, t.z1 - t.z0, t.y1 - t.y0)).toBeGreaterThan(3)
    }
    // 桃と薄緑が主
    const main = tubes.filter((t) => t.color === '#ff3d9a' || t.color === '#3dffc0').length
    expect(main / tubes.length).toBeGreaterThan(0.55)
  })
  it('軽量では減る', () => {
    expect(buildNeonTubes(world, 'lite').length).toBeLessThan(tubes.length * 0.6)
  })
})

describe('gto signage: 夜の明るさ', () => {
  const night = LIGHTING.night.neon
  const day = LIGHTING.day.neon
  const lin = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
  }
  it('白い内照式の看板は夜でも白飛びしない（ブルームのしきい値より下）', () => {
    for (const s of [...SHOPS, ...UPPER_SHOPS, ...ADS]) {
      const g = signGain({ ...s, lit: true }, night)
      const bg = Math.max(...lin(s.bg)) * g
      expect(bg).toBeLessThanOrEqual(0.86)
      // 地が明るい看板は文字が読める差を保つ
      expect(g).toBeGreaterThan(0.6)
    }
  })
  it('濃い地にネオン色の文字は、夜は文字のほうが光る', () => {
    const bar = SHOPS.find((s) => s.name === '夜更かし')
    expect(bar).toBeDefined()
    if (!bar) return
    const g = signGain({ ...bar, lit: true }, night)
    expect(Math.max(...lin(bar.fg)) * g).toBeGreaterThan(1.1)
    expect(g).toBeGreaterThan(signGain({ ...bar, lit: true }, day))
  })
  it('昼は発光させず、灯の入っていない看板は夜に沈む', () => {
    for (const s of SHOPS) expect(signGain({ ...s, lit: true }, day)).toBeLessThanOrEqual(1)
    expect(signGain({ ...SHOPS[0], lit: false }, night)).toBeLessThan(0.5)
  })
})

describe('gto signage: 筆記体のネオン文字', () => {
  const words = full.filter((s) => s.kind === 'neon')

  it('センター街と道玄坂下に何枚も出て、街ぜんたいでは看板のごく一部', () => {
    const at = (x: number, z: number, r: number) => words.filter((s) => Math.hypot(s.x - x, s.z - z) < r).length
    expect(at(-70, -60, 60)).toBeGreaterThanOrEqual(4)
    expect(at(-110, 10, 70)).toBeGreaterThanOrEqual(4)
    expect(words.length).toBeGreaterThan(40)
    expect(words.length).toBeLessThan(full.length * 0.05)
  })

  it('屋号は一覧の架空の言葉で、色は2色まで。灯が入り、絵の名前は neon:番号', () => {
    for (const s of words) {
      const word = NEON_WORDS[s.design]
      expect(s.text).toBe(word.name)
      expect([s.fg, s.bg]).toEqual([word.fg, word.bg])
      expect(s.lit).toBe(true)
      expect(signCell(s)).toBe(`neon:${s.design}`)
    }
    expect(new Set(NEON_WORDS.map((w) => w.name)).size).toBe(NEON_WORDS.length)
  })

  it('店の看板より上の壁にあり、屋上より下。同じ壁の2階の看板・縦長の広告と重ならない', () => {
    for (const s of words) {
      const foot = world.groundY(s.x, s.z)
      expect(s.y - s.h / 2).toBeGreaterThan(foot + SIGNAGE_TUNING.fasciaY + 0.7)
      expect(s.h / s.w).toBeCloseTo(SIGNAGE_TUNING.neonAspect, 5)
      const n = wallNormalOf(s)
      const clash = full.filter((o) => {
        if (o === s || (o.kind !== 'fascia' && o.kind !== 'banner' && o.kind !== 'billboard' && o.kind !== 'vision')) return false
        if (Math.abs(wallNormalOf(o).x * n.x + wallNormalOf(o).z * n.z) < 0.99) return false
        const dx = o.x - s.x
        const dz = o.z - s.z
        // 同じ壁の面の上で、横と縦の両方が重なる
        if (Math.abs(dx * n.x + dz * n.z) > 0.5) return false
        const lateral = Math.abs(dx * -n.z + dz * n.x)
        return lateral < (o.w + s.w) / 2 && Math.abs(o.y - s.y) < (o.h + s.h) / 2
      })
      expect(clash).toEqual([])
    }
  })

  it('軽量の配置にも駅前のネオン文字は残る', () => {
    expect(lite.filter((s) => s.kind === 'neon').length).toBeGreaterThanOrEqual(6)
  })
})

describe('gto signage: 夜の見え方（色面ではなく管の文字）', () => {
  const night = LIGHTING.night.neon
  const day = LIGHTING.day.neon

  it('夜、灯の入った店の看板と袖看板は「暗い板に管の文字」の絵を使い、板そのものは光らせない', () => {
    const lit = full.filter((s) => s.lit && (s.kind === 'fascia' || s.kind === 'blade'))
    expect(lit.length).toBeGreaterThan(500)
    const keys = new Set(NIGHT_CELLS.map((c) => c.key))
    for (const s of lit.slice(0, 400)) {
      const look = signLook(s, night)
      expect(look.tube).toBe(true)
      expect(keys.has(look.cell)).toBe(true)
      // 管の芯がブルームに乗る明るさ
      expect(look.gain).toBeGreaterThan(1.2)
    }
  })

  it('夜の絵は店の看板・袖看板の形だけで、昼の絵と名前が重ならない', () => {
    const dayKeys = new Set(SIGN_CELLS.map((c) => c.key))
    expect(NIGHT_CELLS.length).toBe(SIGN_CELLS.filter((c) => c.shape === 'wide' || c.shape === 'tall' || c.shape === 'mid').length)
    for (const c of NIGHT_CELLS) {
      expect(dayKeys.has(c.key)).toBe(false)
      expect(['wide', 'tall', 'mid']).toContain(c.shape)
    }
  })

  it('夜、広告の板と灯の入っていない看板は暗く沈める（発光する色面にしない）', () => {
    for (const s of full.filter((s) => s.kind === 'billboard' || s.kind === 'banner' || s.kind === 'rooftop' || !s.lit).slice(0, 300)) {
      if (s.kind === 'neon' || s.kind === 'vision') continue
      const look = signLook(s, night)
      expect(look.tube).toBe(false)
      expect(look.gain).toBeLessThanOrEqual(0.5)
      expect(look.cell).toBe(signCell(s))
    }
  })

  it('昼は今までどおり印刷の看板（管の絵は使わない）', () => {
    for (const s of full.slice(0, 300)) {
      if (s.kind === 'neon' || s.kind === 'vision') continue
      const look = signLook(s, day)
      expect(look.tube).toBe(false)
      expect(look.cell).toBe(signCell(s))
      expect(look.gain).toBeCloseTo(signGain(s, day), 6)
    }
  })
})

describe('gto signage: 店先の陰', () => {
  const shades = buildStorefrontShades(world)

  it('店の看板を出した壁の1階ぶんを覆い、壁の外向きを持つ', () => {
    expect(shades.length).toBeGreaterThan(200)
    for (const s of shades) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
      expect(len).toBeGreaterThanOrEqual(SIGNAGE_TUNING.minEdge)
      expect(s.h).toBeGreaterThan(2)
      expect(s.h).toBeLessThanOrEqual(SIGNAGE_TUNING.eaveY)
      expect(s.ya).toBeGreaterThanOrEqual(world.groundY(s.ax + s.nx * 0.12, s.az + s.nz * 0.12) - 1e-6)
      expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 5)
      // 外向きは壁と直角
      expect(Math.abs((s.bx - s.ax) * s.nx + (s.bz - s.az) * s.nz)).toBeLessThan(1e-6 * len + 1e-6)
    }
  })

  it('灯の入った1階の店の看板は、どれかの陰の前にある', () => {
    const ground = full.filter((s) => s.kind === 'fascia' && s.lit && s.y - world.groundY(s.x, s.z) < 4.2).slice(0, 200)
    expect(ground.length).toBeGreaterThan(100)
    for (const g of ground) {
      const hit = shades.some((s) => {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
        const t = ((g.x - s.ax) * (s.bx - s.ax) + (g.z - s.az) * (s.bz - s.az)) / (len * len)
        const out = (g.x - s.ax) * s.nx + (g.z - s.az) * s.nz
        return t >= 0 && t <= 1 && out > 0 && out < 0.5
      })
      expect(hit).toBe(true)
    }
  })

  it('同じ世界なら同じ配列を返す', () => {
    expect(buildStorefrontShades(world)).toBe(shades)
  })
})
