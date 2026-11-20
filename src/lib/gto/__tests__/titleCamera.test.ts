import { describe, expect, it } from 'vitest'
import { CRANES } from '../map'
import { pointInPolygon } from '../math'
import { TITLE_CAMERA, titleCamera } from '../titleCamera'
import { world } from './helpers'

// 題名の画面のカメラが、建物やクレーンの中を通らないこと。
// 以前は駅のまわりを 1 周していて、同じ高さの高層棟とクレーンのジブを通り抜けていた。

const buildings = world.map.buildings

/** (x, z) から pad m 以内にある屋根のうち、いちばん高いもの（無ければ -Infinity） */
function roofNear(x: number, z: number, pad: number): number {
  let top = -Infinity
  for (let dx = -pad; dx <= pad; dx += 4) {
    for (let dz = -pad; dz <= pad; dz += 4) {
      for (const b of buildings) if (pointInPolygon(b.pts, x + dx, z + dz)) top = Math.max(top, b.y + b.h)
    }
  }
  return top
}

/** 往復 1 回ぶんを 2 度きざみで */
const period = (Math.PI * 2) / TITLE_CAMERA.rate
const samples = Array.from({ length: 41 }, (_, i) => titleCamera((i / 40) * period))

describe('題名の画面のカメラ', () => {
  it('決めた弧の上を往復して、もとの位置へ戻る', () => {
    const start = titleCamera(0)
    const back = titleCamera(period)
    expect(Math.hypot(back.x - start.x, back.z - start.z)).toBeLessThan(0.01)
    for (const c of samples) {
      expect(Math.hypot(c.x, c.z)).toBeCloseTo(TITLE_CAMERA.radius, 6)
      expect(c.y).toBe(TITLE_CAMERA.height)
    }
    // 弧の両端まで振れる
    const angles = samples.map((c) => (Math.atan2(c.x, c.z) * 180) / Math.PI + 360)
    expect(Math.min(...angles)).toBeCloseTo(TITLE_CAMERA.mid - TITLE_CAMERA.swing, 1)
    expect(Math.max(...angles)).toBeCloseTo(TITLE_CAMERA.mid + TITLE_CAMERA.swing, 1)
  })

  it('カメラのまわり 12m に、カメラの高さへ届く建物が無い', () => {
    for (const c of samples) expect(roofNear(c.x, c.z, 12), `(${c.x.toFixed(0)}, ${c.z.toFixed(0)})`).toBeLessThan(c.y - 6)
  })

  it('クレーンから 60m 以上離れている（ジブは 23m 張り出す）', () => {
    for (const c of samples) for (const crane of CRANES) expect(Math.hypot(crane.x - c.x, crane.z - c.z)).toBeGreaterThan(60)
  })

  it('交差点までの見通しを、手前の建物が塞がない', () => {
    for (const c of samples) {
      for (let s = 0.05; s < 0.9; s += 0.03) {
        const x = c.x + (c.tx - c.x) * s
        const z = c.z + (c.tz - c.z) * s
        const y = c.y + (c.ty - c.y) * s
        expect(roofNear(x, z, 0), `(${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(y - 3)
      }
    }
  })
})
