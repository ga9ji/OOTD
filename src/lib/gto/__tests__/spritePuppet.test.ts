import { describe, expect, it } from 'vitest'
import { buildBackSprite } from '../spriteBack'
import { buildPuppetAtlas, PUPPET_ATLAS, PUPPET_CELLS, type PuppetCell } from '../spritePuppet'

/** 黒い髪・灰色の上着・青いズボン（左右の脚のあいだにすきま）・赤い靴の人。体の中心は x=24 */
function figure() {
  const w = 60
  const h = 120
  const px = new Uint8ClampedArray(w * h * 4)
  const set = (x: number, y: number, c: number[]) => px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 24
      if (y < 15 && Math.abs(dx) <= 6) set(x, y, y < 6 ? [30, 30, 30] : [220, 180, 150])
      else if (y >= 15 && y < 20 && Math.abs(dx) <= 3) set(x, y, [220, 180, 150])
      else if (y >= 20 && y < 60 && Math.abs(dx) <= 13) set(x, y, [120, 120, 120])
      else if (y >= 60 && y < 114 && Math.abs(dx) <= 10 && Math.abs(dx) >= 2) set(x, y, [40, 60, 160])
      else if (y >= 114 && Math.abs(dx) <= 10 && Math.abs(dx) >= 2) set(x, y, [200, 30, 30])
    }
  }
  return { px, w, h }
}

describe('gto spritePuppet: 写真を部位の升目に切り分ける', () => {
  const { px, w, h } = figure()
  const atlas = buildPuppetAtlas(px, w, h, buildBackSprite(px, w, h))
  const at = (cell: PuppetCell, u: number, v: number) => {
    const [x, y, cw, ch] = PUPPET_CELLS[cell]
    const i = ((y + Math.floor(v * (ch - 1))) * PUPPET_ATLAS + x + Math.floor(u * (cw - 1))) * 4
    return Array.from(atlas.data.slice(i, i + 4))
  }
  const near = (c: number[], want: number[], tol = 40) => want.every((v, k) => Math.abs(c[k] - v) <= tol)

  it('升目はどこも不透明（すきまは隣の色で埋まる）', () => {
    for (const cell of Object.keys(PUPPET_CELLS) as PuppetCell[]) {
      for (const [u, v] of [
        [0, 0],
        [0.5, 0.5],
        [1, 1],
        [0, 1],
        [1, 0],
      ]) {
        expect(at(cell, u, v)[3]).toBe(255)
      }
    }
  })

  it('胴は上着、腿とすねはズボン、足は靴の色', () => {
    expect(near(at('torsoBack', 0.5, 0.5), [120, 120, 120])).toBe(true)
    expect(near(at('torsoFront', 0.3, 0.6), [120, 120, 120])).toBe(true)
    for (const cell of ['thighL', 'thighR', 'shinL', 'shinR'] as PuppetCell[]) {
      // 脚のあいだのすきまにあたる所も、ズボンの色で埋まっている
      expect(near(at(cell, 0.5, 0.5), [40, 60, 160])).toBe(true)
      expect(near(at(cell, 0, 0.5), [40, 60, 160])).toBe(true)
      expect(near(at(cell, 1, 0.5), [40, 60, 160])).toBe(true)
    }
    expect(near(at('shoe', 0.5, 0.5), [200, 30, 30], 60)).toBe(true)
  })

  it('頭の後ろは髪の色、前は顔が残る', () => {
    expect(at('headBack', 0.5, 0.5)[0]).toBeLessThan(90)
    expect(at('headFront', 0.5, 0.6)[0]).toBeGreaterThan(180)
  })

  it('寸法: 肩幅・脚の太さ・頭の切り抜きが体に合う', () => {
    const d = atlas.dims
    expect(d.tall).toBeCloseTo(1, 1)
    expect(d.shoulderHalf).toBeGreaterThan(0.08)
    expect(d.shoulderHalf).toBeLessThan(0.14)
    expect(d.legHalf).toBeGreaterThan(0.03)
    expect(d.legHalf).toBeLessThan(0.075)
    expect(d.skirt).toBe(false)
    // 頭の切り抜きは体の中心（x=24。後ろ姿の絵では左右が裏返って x=35）を挟む
    expect((d.head.u0 + d.head.u1) / 2).toBeCloseTo(35.5 / w, 1)
    expect(d.head.v0).toBe(0)
    expect(d.head.high).toBeGreaterThan(0.12)
    expect(d.head.lift).toBeGreaterThan(0)
  })

  it('股が割れていない服は、裾の広い服として扱う', () => {
    const f = figure()
    for (let y = 60; y < 100; y++) for (let x = 14; x <= 34; x++) f.px.set([90, 30, 30, 255], (y * f.w + x) * 4)
    expect(buildPuppetAtlas(f.px, f.w, f.h, buildBackSprite(f.px, f.w, f.h)).dims.skirt).toBe(true)
  })
})
