import { describe, expect, it } from 'vitest'
import { LIGHTING } from '../lighting'
import { boardLights, haloPixels, lampLights, pickLamps, plazaLights, scatterAmount, scatterTint, shopStrips, sunGlare, tailPoolOf, type LampLight } from '../lightingLocal'
import { streetProps } from '../map'
import { buildSignage } from '../signage'
import { world } from './helpers'

const lamp = (x: number, z: number): LampLight => ({ x, z, height: 5, range: 24 })

describe('gto lightingLocal: 近くの街灯を本物の光源にする', () => {
  it('街灯ごとに、灯具の高さと届く距離を持つ光源を返す', () => {
    const props = streetProps(world)
    const lights = lampLights(props, true)
    expect(lights.length).toBe(props.filter((p) => p.kind.startsWith('lamp-')).length)
    for (const l of lights) {
      expect(l.height).toBeGreaterThan(3.5)
      expect(Math.hypot(l.x - 0, l.z - 0)).toBeGreaterThan(0)
      expect(l.height).toBeLessThan(8)
      expect(l.range).toBeGreaterThan(l.height * 3)
    }
    // 軽量設定では柱を描かない道路照明を除く
    expect(lampLights(props, false).length).toBeLessThan(lights.length)
  })

  it('大型の光る看板は、面の前に色の付いた光源を置く', () => {
    const signs = buildSignage(world)
    const boards = boardLights(signs)
    expect(boards.length).toBeGreaterThan(3)
    expect(boards.length).toBeLessThan(signs.length / 4)
    for (const b of boards) {
      expect(Math.max(...b.color)).toBeCloseTo(1, 5)
      expect(Math.min(...b.color)).toBeGreaterThan(0.3)
      expect(b.power).toBeGreaterThanOrEqual(0.8)
    }
    const one = boardLights([{ kind: 'billboard', x: 0, y: 12, z: 0, w: 8, h: 5, heading: 0, bg: '#102030', fg: '#ff4fa3', lit: true }])
    // heading 0 は北（−z）向きの面。光源は面のすぐ裏（看板そのものは照らさない）
    expect(one[0].z).toBeGreaterThan(0)
    expect(one[0].z).toBeLessThan(2)
    expect(one[0].color[0]).toBeGreaterThan(one[0].color[1])
    expect(boardLights([{ kind: 'fascia', x: 0, y: 3, z: 0, w: 8, h: 5, heading: 0, bg: '#102030', fg: '#ff4fa3', lit: true }])).toEqual([])
  })

  it('街灯の無いスクランブル交差点の広場には、縁の高い所から照らす光源を置く', () => {
    const plaza = plazaLights(world)
    expect(plaza.length).toBe(3)
    for (const p of plaza) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(40)
      expect(p.y - world.groundY(p.x, p.z)).toBeGreaterThan(8)
      // 広場の中心まで届くが、周りのビル（60m 先）までは届かない
      expect(p.range).toBeGreaterThan(Math.hypot(p.x, p.z, p.y) + 10)
      expect(p.range).toBeLessThan(50)
    }
  })

  it('近い順に count 個を選び、足りない枠は重み 0 で埋める', () => {
    const lamps = [lamp(0, 50), lamp(0, 10), lamp(0, 30), lamp(0, 20), lamp(0, 40)]
    const slots = pickLamps(lamps, 0, 0, 3, 100)
    expect(slots.map((s) => s.index).sort()).toEqual([1, 2, 3])
    const few = pickLamps(lamps.slice(0, 2), 0, 0, 4, 100)
    expect(few.length).toBe(4)
    expect(few.filter((s) => s.index < 0).every((s) => s.weight === 0)).toBe(true)
  })

  it('選ばれる境目にいる街灯は重み 0（入れ替わりの瞬間に光が跳ねない）', () => {
    const lamps = [lamp(0, 10), lamp(0, 20), lamp(0, 30), lamp(0, 40)]
    const slots = pickLamps(lamps, 0, 0, 3, 100)
    const byIndex = new Map(slots.map((s) => [s.index, s.weight]))
    expect(byIndex.get(0)).toBe(1)
    // 4番目（距離 40）が境目。3番目（距離 30）は境目の手前で弱まり始めている
    expect(byIndex.get(2)).toBeGreaterThan(0)
    expect(byIndex.get(2)).toBeLessThan(1)
    // 境目ぎりぎりまで寄せると 0 に近づく
    const edge = pickLamps([lamp(0, 10), lamp(0, 20), lamp(0, 39.9), lamp(0, 40)], 0, 0, 3, 100)
    expect(edge.find((s) => s.index === 2)?.weight).toBeLessThan(0.01)
  })

  it('遠すぎる街灯は選んでも点けない', () => {
    const slots = pickLamps([lamp(0, 10), lamp(0, 200)], 0, 0, 2, 60)
    expect(slots.find((s) => s.index === 0)?.weight).toBe(1)
    expect(slots.find((s) => s.index === 1)?.weight ?? 0).toBe(0)
  })
})

describe('gto lightingLocal: 大気のかすみと逆光', () => {
  const lum = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722

  it('遠いほど、太陽の方を向くほど濃い。すぐ近くは掛からない', () => {
    const s = LIGHTING.dusk.scatter
    expect(scatterAmount(0, 1, s)).toBe(0)
    expect(scatterAmount(400, 1, s)).toBeGreaterThan(scatterAmount(60, 1, s))
    expect(scatterAmount(400, 1, s)).toBeGreaterThan(scatterAmount(400, 0, s) * 2)
    // 夕方は、太陽の方角の遠景がかすみの色へ寄る（近くと中景は、日なたと陰の差を残す）
    expect(scatterAmount(600, 1, s)).toBeGreaterThan(0.65)
    // 車のすぐ前（10m）は読める
    expect(scatterAmount(10, 1, s)).toBeLessThan(0.15)
  })

  it('どの時刻も、1ブロック先（80m）と3ブロック先（240m）でかすみの濃さに段が付く（空気の層）', () => {
    for (const t of ['day', 'dusk', 'night'] as const) {
      const s = LIGHTING[t].scatter
      // 太陽を背にしても層は残る
      expect(scatterAmount(240, -1, s), t).toBeGreaterThan(0.1)
      expect(scatterAmount(240, -1, s), t).toBeGreaterThan(scatterAmount(80, -1, s) + 0.05)
      expect(scatterAmount(15, 1, s), t).toBeLessThan(0.2)
    }
  })

  it('夕方は、画面の端から端（太陽から 30°と 90°）でかすみの濃さが変わり、太陽の方角が分かる', () => {
    const s = LIGHTING.dusk.scatter
    const near = scatterAmount(200, Math.cos((30 * Math.PI) / 180), s)
    const side = scatterAmount(200, Math.cos((90 * Math.PI) / 180), s)
    expect(near).toBeGreaterThan(side * 1.8)
  })

  it('かすみの色は、太陽の側は明るい光の色、反対側は沈んだ色', () => {
    const s = LIGHTING.dusk.scatter
    const sun = scatterTint(1, s)
    const back = scatterTint(-1, s)
    expect(lum(sun)).toBeGreaterThan(lum(back) * 2)
    // 太陽の側は橙（赤が青の2倍以上）
    expect(sun[0]).toBeGreaterThan(sun[2] * 2)
    // 夜のかすみは暗く、遠くを沈める
    expect(lum(scatterTint(1, LIGHTING.night.scatter))).toBeLessThan(0.05)
  })

  it('逆光のにじみは、太陽が見えている方角にだけ出て、隠れていれば出ない', () => {
    const L = LIGHTING.dusk
    expect(sunGlare(1, 1, L.sunShafts)).toBeGreaterThan(1)
    expect(sunGlare(1, 0, L.sunShafts)).toBe(0)
    expect(sunGlare(Math.cos(0.35), 1, L.sunShafts)).toBeGreaterThan(0.03)
    expect(sunGlare(Math.cos(0.35), 1, L.sunShafts)).toBeLessThan(sunGlare(Math.cos(0.1), 1, L.sunShafts))
    expect(sunGlare(0, 1, L.sunShafts)).toBe(0)
    // 昼の高い太陽と夜の月では、画面を白くしない
    expect(sunGlare(Math.cos(0.35), 1, LIGHTING.day.sunShafts)).toBeLessThan(0.05)
    expect(LIGHTING.night.sunShafts).toBe(0)
  })
})

describe('gto lightingLocal: 街灯の光の暈', () => {
  it('暈の画面上の大きさは距離に反比例し、近すぎても画面を覆わない', () => {
    // 縦 720px・縦の画角 60°で、20m 先の直径 6m の暈
    const at20 = haloPixels(6, 20, 720, 60)
    expect(at20).toBeCloseTo((6 / 20) * (360 / Math.tan(Math.PI / 6)), 3)
    expect(haloPixels(6, 40, 720, 60)).toBeCloseTo(at20 / 2, 3)
    expect(haloPixels(6, 0.5, 720, 60)).toBeLessThanOrEqual(720 * 0.45)
    expect(haloPixels(6, -3, 720, 60)).toBe(0)
  })

  it('夜と夕方だけ暈を出す', () => {
    expect(LIGHTING.day.lampHalo).toBe(0)
    expect(LIGHTING.night.lampHalo).toBeGreaterThan(LIGHTING.dusk.lampHalo)
    expect(LIGHTING.dusk.lampHalo).toBeGreaterThan(0)
  })
})

describe('gto lightingLocal: 店先の明かりと尾灯', () => {
  const strips = shopStrips(world)

  it('店先の帯は建物の外へ向き、道に面した壁にだけできる', () => {
    expect(strips.length).toBeGreaterThan(200)
    expect(strips.length).toBeLessThan(6000)
    for (const s of strips.slice(0, 400)) {
      expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 5)
      const mx = (s.ax + s.bx) / 2 + s.nx * 1.5
      const mz = (s.az + s.bz) / 2 + s.nz * 1.5
      expect(world.insideBuilding(mx, mz)).toBe(false)
    }
  })

  it('尾灯の光だまりは車の後ろにでき、ブレーキで強まる', () => {
    const base = { x: 10, z: 20, heading: 0, speed: 8, accel: 0, driver: 'traffic' as const, kind: 'sedan' as const }
    const pool = tailPoolOf(base)
    expect(pool).not.toBeNull()
    // heading 0 は北（−z）向き。後ろは +z
    expect(pool!.z).toBeGreaterThan(20 + 2)
    expect(pool!.x).toBeCloseTo(10, 5)
    const brake = tailPoolOf({ ...base, accel: -9 })
    expect(brake!.strength).toBeGreaterThan(pool!.strength * 1.8)
    // 乗り捨てた車は灯りを消す
    expect(tailPoolOf({ ...base, driver: 'none' })).toBeNull()
  })
})
