import { describe, expect, it } from 'vitest'
import { DEMOS } from '../demo'
import { buildInput, emptyTouch } from '../input'
import { LIGHTING, lightingFor } from '../lighting'
import { pickQuality, QUALITY } from '../quality'
import { parseLaunch } from '../shot'
import { ADS, buildSignage, SHOPS } from '../signage'
import { world } from './helpers'

const launch = (q: string) => parseLaunch(new URLSearchParams(q), world)
const raw = (keys: string[], pressed: string[] = []) => ({
  keys: new Set(keys),
  pressed: new Set(pressed),
  mouseDX: 0,
  mouseDY: 0,
  touch: emptyTouch(),
  pad: null,
})

describe('gto shot: 撮影用のクエリ', () => {
  it('クエリが無ければ、題名の画面から昼・徒歩で始まる', () => {
    const l = launch('')
    expect(l).toMatchObject({ start: null, photo: null, time: 'day', hud: true, mode: 'foot', demo: null, autostart: false })
  })

  it('スポットを指定すると、そこに立って通りの先を見る固定カメラになる', () => {
    // 写真の立ち位置を別に決めていないスポット（宮益坂下は東口の広場から撮るので、ここでは公園通りの入口で確かめる）
    const l = launch('gtoShot=koen-dori-bottom&time=night&quality=mobile&seed=7')
    expect(l.photo?.x).toBeCloseTo(8.1, 0)
    expect(l.photo?.heading).toBeCloseTo((332.8 * Math.PI) / 180, 3)
    expect(l).toMatchObject({ time: 'night', quality: 'mobile', seed: 7, hud: false, autostart: true })
  })

  it('地図のすべてのスポットが、建物の外から撮れる', () => {
    for (const spot of world.map.spots) {
      const l = launch(`gtoShot=${spot.key}`)
      expect(l.photo, spot.key).not.toBeNull()
      if (l.photo) expect(world.insideBuilding(l.photo.x, l.photo.z), spot.key).toBe(false)
    }
  })

  it('緯度・経度・向きを直接指定できる', () => {
    const o = world.map.meta.origin
    const l = launch(`gtoShot=${o.lat},${o.lon},90`)
    expect(l.photo?.x).toBeCloseTo(0, 3)
    expect(l.photo?.heading).toBeCloseTo(Math.PI / 2, 5)
    const m = launch(`lat=${o.lat}&lon=${o.lon}&heading=180&mode=drive`)
    expect(m.start?.heading).toBeCloseTo(Math.PI, 5)
    expect(m.photo).toBeNull()
    expect(m.mode).toBe('drive')
  })

  it('mode や demo を付けると、背後カメラで遊ぶ画面になる', () => {
    expect(launch('gtoShot=scramble&mode=drive')).toMatchObject({ photo: null, mode: 'drive', hud: true })
    const d = launch('demo=drive-brake&hud=0')
    expect(d.demo).toBe(DEMOS['drive-brake'])
    expect(d.mode).toBe('drive')
    expect(d.start).not.toBeNull()
    expect(d.hud).toBe(false)
    expect(launch('demo=nope').demo).toBeNull()
  })
})

describe('gto input: 入力の共通化', () => {
  it('キーボードの移動と、押した瞬間だけのボタン', () => {
    const i = buildInput(raw(['KeyW', 'KeyD', 'ShiftLeft'], ['KeyF']), 1 / 60)
    expect(i).toMatchObject({ moveX: 1, moveY: 1, run: true, enter: true, steal: false })
    expect(buildInput(raw(['KeyF']), 1 / 60).enter).toBe(false)
  })

  it('タッチとゲームパッドも同じ形にそろう', () => {
    const t = buildInput({ ...raw([]), touch: { ...emptyTouch(), moveY: 0.5, lookDX: 10, steal: true } }, 1 / 60)
    expect(t.moveY).toBe(0.5)
    expect(t.lookX).toBeGreaterThan(0)
    expect(t.steal).toBe(true)
    const pad = { axes: [0.05, -1, 0, 0], buttons: [], pressed: [false, false, false, true] }
    const p = buildInput({ ...raw([]), pad }, 1 / 60)
    expect(p).toMatchObject({ moveX: 0, moveY: 1, enter: true })
  })
})

describe('gto quality / lighting / signage', () => {
  it('指定が無ければ端末から決まり、スマホは軽い', () => {
    expect(pickQuality(null, { coarsePointer: true, shortSide: 390 }).id).toBe('mobile')
    expect(pickQuality(null, { coarsePointer: false, shortSide: 900 }).id).toBe('high')
    expect(pickQuality('high', { coarsePointer: true, shortSide: 390 }).id).toBe('high')
    expect(QUALITY.mobile.shadows).toBe(false)
    expect(QUALITY.mobile.maxPeds).toBeLessThan(QUALITY.high.maxPeds)
    expect(QUALITY.mobile.pixelRatio).toBeLessThan(QUALITY.high.pixelRatio)
  })

  it('夜は窓明かりとネオンが強い', () => {
    expect(lightingFor('night').windowGlow).toBeGreaterThan(LIGHTING.day.windowGlow)
    expect(lightingFor('night').neon).toBeGreaterThan(LIGHTING.day.neon)
    expect(lightingFor('dusk').lampsOn).toBe(true)
  })

  it('看板は建物の外・道の側に出て、建物の実名は使わない', () => {
    const signs = buildSignage(world)
    expect(signs.length).toBeGreaterThan(300)
    const names = new Set([...SHOPS, ...ADS].map((s) => s.name))
    const real = new Set(world.map.buildings.map((b) => b.name).filter(Boolean))
    for (const s of signs.slice(0, 400)) {
      expect(names.has(s.text)).toBe(true)
      expect(real.has(s.text)).toBe(false)
      expect(world.insideBuilding(s.x, s.z)).toBe(false)
    }
    // 交差点に近い順
    expect(Math.hypot(signs[0].x, signs[0].z)).toBeLessThan(Math.hypot(signs[300].x, signs[300].z))
  })
})
