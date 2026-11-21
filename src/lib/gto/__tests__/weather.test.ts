import { describe, expect, it } from 'vitest'
import { createWeatherClock, parseWeather, WEATHER_BLEND, WEATHER_KINDS, weatherLook, windDir, type WeatherKind, type WeatherView } from '../weather'

/** 1時間ぶんの天気を 1 秒刻みで並べる */
const hour = (seed: number) => {
  const clock = createWeatherClock(seed)
  return Array.from({ length: 3600 }, (_, t) => clock.at(t))
}
const view = (patch: Partial<WeatherView>): WeatherView => ({ kind: 'clear', overcast: 0, rain: 0, fog: 0, wind: 0, wet: 0, flash: 0, strike: null, ...patch })

describe('gto weather', () => {
  it('同じ種なら同じ移り変わりになり、種が違えば別の移り変わりになる', () => {
    const a = hour(7).map((w) => w.kind)
    expect(hour(7).map((w) => w.kind)).toEqual(a)
    expect(hour(8).map((w) => w.kind)).not.toEqual(a)
  })

  it('数分おきに別の天気へ変わり、同じ天気は続かない', () => {
    for (const seed of [1, 2, 3, 99, 20261121]) {
      const kinds = hour(seed).map((w) => w.kind)
      const runs: { kind: WeatherKind; length: number }[] = []
      for (const kind of kinds) {
        const last = runs[runs.length - 1]
        if (last && last.kind === kind) last.length++
        else runs.push({ kind, length: 1 })
      }
      // 最後の区間は途中で切れているので除く
      for (const run of runs.slice(0, -1)) {
        expect(run.length).toBeGreaterThanOrEqual(40)
        expect(run.length).toBeLessThanOrEqual(111)
      }
      expect(runs.length).toBeGreaterThan(30)
    }
  })

  it('長く遊べば、どの天気にも出会う', () => {
    const seen = new Set<WeatherKind>()
    for (const seed of [1, 2, 3]) for (const w of hour(seed)) seen.add(w.kind)
    expect([...seen].sort()).toEqual([...WEATHER_KINDS].sort())
  })

  it('最初の天気も種で変わる', () => {
    const first = new Set(Array.from({ length: 200 }, (_, seed) => createWeatherClock(seed).at(0).kind))
    expect(first.size).toBeGreaterThanOrEqual(4)
  })

  it('量はなめらかに変わる（切り替わりで空の色が飛ばない）', () => {
    const clock = createWeatherClock(5)
    let prev = clock.at(0)
    for (let t = 0.1; t < 1800; t += 0.1) {
      const next = clock.at(t)
      for (const key of ['overcast', 'rain', 'fog', 'wind', 'wet'] as const) {
        expect(next[key]).toBeGreaterThanOrEqual(0)
        expect(next[key]).toBeLessThanOrEqual(1)
        expect(Math.abs(next[key] - prev[key])).toBeLessThan(0.03)
      }
      prev = next
    }
  })

  it('路面は雨より遅れて濡れ、止んだあともしばらく濡れている', () => {
    const clock = createWeatherClock(11)
    let checkedDry = false
    let checkedWet = false
    let prev = clock.at(0)
    for (let t = 1; t < 3600; t++) {
      const now = clock.at(t)
      if (prev.kind !== now.kind) {
        const rained = prev.kind === 'rain' || prev.kind === 'storm'
        const raining = now.kind === 'rain' || now.kind === 'storm'
        const after = clock.at(t + WEATHER_BLEND + 1)
        if (rained && !raining && after.kind === now.kind) {
          // 雨は止んでいるが、路面はまだ濡れている
          expect(after.rain).toBe(0)
          expect(after.wet).toBeGreaterThan(0.5)
          checkedWet = true
        }
        if (!rained && raining && prev.wet === 0) {
          // 降り始めの1秒では、まだ濡れきっていない
          expect(clock.at(t + 1).wet).toBeLessThan(0.5)
          expect(after.wet).toBe(1)
          checkedDry = true
        }
      }
      prev = now
    }
    expect(checkedDry && checkedWet).toBe(true)
  })

  it('稲光は雷雨のときだけ出て、1回ごとに別の番号が付く', () => {
    const storm = createWeatherClock(3, 'storm')
    const strikes = new Set<number>()
    let peak = 0
    for (let t = 0; t < 120; t += 1 / 60) {
      const w = storm.at(t)
      if (w.strike != null) strikes.add(w.strike)
      else expect(w.flash).toBe(0)
      peak = Math.max(peak, w.flash)
    }
    expect(strikes.size).toBeGreaterThan(6)
    expect(peak).toBeGreaterThan(0.8)
    for (const kind of ['clear', 'cloudy', 'rain', 'fog'] as const) {
      const calm = createWeatherClock(3, kind)
      for (let t = 0; t < 60; t += 0.05) expect(calm.at(t).strike).toBeNull()
    }
  })

  it('天気を固定すると変わらない（撮影用）', () => {
    const clock = createWeatherClock(1, 'rain')
    expect(clock.at(0)).toEqual(clock.at(5000))
    expect(clock.at(0)).toMatchObject({ kind: 'rain', rain: 0.6, wet: 1 })
    expect(createWeatherClock(1, 'clear').at(999)).toMatchObject({ kind: 'clear', overcast: 0, rain: 0, fog: 0, wet: 0 })
  })

  it('時刻が戻っても、同じ時刻なら同じ天気を返す', () => {
    const clock = createWeatherClock(42)
    const early = clock.at(30)
    clock.at(2000)
    expect(clock.at(30)).toEqual(early)
  })

  it('URL の指定を読む', () => {
    expect(parseWeather('storm')).toBe('storm')
    expect(parseWeather('random')).toBe('random')
    expect(parseWeather('snow')).toBeNull()
    expect(parseWeather(null)).toBeNull()
  })

  it('晴れは光に何も足さない（晴れの絵は天気を入れる前と同じ）', () => {
    for (const time of ['day', 'dusk', 'night'] as const) {
      expect(weatherLook(time, view({}))).toMatchObject({ gray: 0, sun: 1, hemi: 1, flash: 0, clouds: 0, stars: 1, fogNear: 1, fogFar: 1, haze: 0, desaturate: 0, bloom: 1, gloss: 0, mirror: 0, wetDark: 0 })
    }
  })

  it('くもるほど直射が弱まり、霧は見通しを縮め、濡れた路面は照り返す', () => {
    const cloudy = weatherLook('day', view({ overcast: 0.75 }))
    const storm = weatherLook('day', view({ overcast: 1, rain: 1, fog: 0.4, wet: 1 }))
    const fog = weatherLook('night', view({ overcast: 0.6, fog: 1 }))
    expect(cloudy.sun).toBeLessThan(0.5)
    expect(storm.sun).toBeLessThan(cloudy.sun)
    expect(fog.fogFar).toBeLessThan(0.5)
    expect(fog.haze).toBeGreaterThan(0.8)
    expect(fog.stars).toBe(0)
    expect(storm.gloss).toBeGreaterThan(0.4)
    expect(storm.bloom).toBeGreaterThan(1)
  })

  it('風の向きは長さ 1', () => {
    const [x, z] = windDir(9)
    expect(Math.hypot(x, z)).toBeCloseTo(1)
  })
})
