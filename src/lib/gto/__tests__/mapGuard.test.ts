// JR の鉄桁ガードの裏の骨組み（viaduct_05: 桁の下から西を見ると、上半分を主桁・横桁・斜材が覆う）
import { describe, expect, it } from 'vitest'
import { loadWorld } from '../map'
import { GUARD_SOFFIT, guardSoffit, soffitFrame, soffitPoint } from '../mapGuard'
import { photoStandpoint } from '../mapPhoto'

const world = loadWorld()
const q = guardSoffit(world.map)

describe('ガードの裏', () => {
  it('道をまたぐ区間で、4 本の線路を全部覆う', () => {
    expect(q).not.toBeNull()
    if (!q) return
    expect(q.nw[0]).toBeLessThan(52)
    expect(q.ne[0]).toBeGreaterThan(74)
    expect(q.sw[0]).toBeLessThan(55)
    expect(q.se[0]).toBeGreaterThan(77)
    expect(q.nw[1]).toBe(GUARD_SOFFIT.zMin)
    expect(q.sw[1]).toBe(GUARD_SOFFIT.zMax)
  })

  it('桁の下端は、車が通れる高さに残る', () => {
    if (!q) return
    const [x, z] = soffitPoint(q, 0.5, 0.6)
    const clear = q.y + GUARD_SOFFIT.plate - GUARD_SOFFIT.beam - world.groundY(x, z)
    expect(clear).toBeGreaterThan(3.8)
    expect(clear).toBeLessThan(5.2)
  })

  it('主桁と横桁の格子に、X 字の斜材と灯具が付く', () => {
    if (!q) return
    const f = soffitFrame(q)
    expect(f.mains.length).toBeGreaterThanOrEqual(10)
    expect(f.crosses.length).toBeGreaterThanOrEqual(7)
    expect(f.braces.length).toBe(f.gussets.length * 2)
    expect(f.braces.length).toBeGreaterThan(40)
    expect(f.lamps.length).toBeGreaterThanOrEqual(4)
    // 主桁は線路の向き（南北）、横桁は道の向き（東西）
    for (const m of f.mains) expect(Math.abs(m.bz - m.az)).toBeGreaterThan(Math.abs(m.bx - m.ax) * 3)
    for (const c of f.crosses) expect(Math.abs(c.bx - c.ax)).toBeGreaterThan(Math.abs(c.bz - c.az) * 3)
  })

  it('夕方の真西向きの写真（viaduct_05）は桁の下に立ち、昼と 265 度の写真（viaduct_02 / 10）は東へ引いた所に立つ', () => {
    if (!q) return
    const under = photoStandpoint(92.9, -7.5, 270, 5, 'dusk')
    expect(under.x).toBeGreaterThan(q.nw[0] + 4)
    expect(under.x).toBeLessThan(q.ne[0] - 4)
    expect(under.z).toBeGreaterThan(GUARD_SOFFIT.zMin + 2)
    expect(world.insideBuilding(under.x, under.z)).toBe(false)
    for (const [h, t] of [[265, 'dusk'], [270, 'day'], [258, 'dusk']] as const) {
      const east = photoStandpoint(92.9, -7.5, h, 10, t)
      expect(east.x).toBeGreaterThan(q.ne[0] + 20)
    }
  })
})

describe('宮益坂下から南: 時間帯で立ち位置を分ける（第15ラウンド 練習判定 2 回目）', () => {
  const raw: [number, number] = [151.9, -18.6]
  it('昼と夜は、見上げの角度によらず北の歩道の奥の隙間から（第17ラウンド: 開けた横断歩道の絵は西口のバス乗り場と読まれた）', () => {
    for (const t of ['day', 'night'] as const) {
      for (const h of [170, 185, 190]) {
        const p = photoStandpoint(raw[0], raw[1], h, 16, t)
        expect(p.z).toBeLessThan(-50)
        expect(p.x).toBeLessThan(150)
        expect(world.insideBuilding(p.x, p.z)).toBe(false)
      }
    }
  })
  it('夕方（miyamasuzaka_06/07）は交差点とガードの間から。高架が右の端に入る', () => {
    const p = photoStandpoint(raw[0], raw[1], 185, 14, 'dusk')
    expect(p.x).toBeLessThan(132)
  })
  it('見上げ 20 度の指定（towers_16）は、右手前に丸い角の棟が入る北の歩道の奥', () => {
    for (const t of ['day', 'night'] as const) expect(photoStandpoint(raw[0], raw[1], 178, 20, t).z).toBeLessThan(-50)
  })
})
