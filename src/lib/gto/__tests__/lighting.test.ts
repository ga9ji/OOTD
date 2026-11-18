import { describe, expect, it } from 'vitest'
import { gradeColor, groundLift, hexToLinear, lampPools, LIGHTING, predictSurface, roadFresnel, roadSheen, shoulder, spillColor, windowLight, type Rgb } from '../lighting'
import { streetProps } from '../map'
import type { TimeOfDay } from '../types'
import { world } from './helpers'

/** 路面と壁の地の色（renderCity.ts の CITY_STYLE と同じ値） */
const ASPHALT = 0x3b3d42
const PALE_WALL = 0xd9d5cc
const TIMES: TimeOfDay[] = ['day', 'dusk', 'night']
const mean = (c: Rgb) => (c[0] + c[1] + c[2]) / 3

describe('gto lighting: 色調の曲線', () => {
  it('肩の曲線は暗い側をそのまま通し、明るい側を 1 未満に丸める', () => {
    expect(shoulder(0.2)).toBeCloseTo(0.2, 6)
    expect(shoulder(0.7)).toBeCloseTo(0.7, 6)
    expect(shoulder(1.5)).toBeLessThan(1)
    expect(shoulder(8)).toBeLessThan(1)
    expect(shoulder(2)).toBeGreaterThan(shoulder(1.2))
  })

  it('色調を掛けても黒は黒、明るい色は 0..1 に収まる', () => {
    for (const t of TIMES) {
      const black = gradeColor([0, 0, 0], LIGHTING[t])
      const hot = gradeColor([6, 6, 6], LIGHTING[t])
      expect(Math.max(...black)).toBeLessThan(0.001)
      expect(Math.max(...hot)).toBeLessThanOrEqual(1)
      expect(Math.min(...hot)).toBeGreaterThan(0.8)
    }
  })

  it('16進の色をリニアに直す', () => {
    expect(hexToLinear(0xffffff)).toEqual([1, 1, 1])
    expect(hexToLinear(0x808080)[0]).toBeCloseTo(0.2159, 3)
  })
})

describe('gto lighting: 画面に出る明るさ（バーの実測に合わせた目標）', () => {
  it('昼: 日なたの路面は沈まず、日陰は黒くならず茶色へ寄る', () => {
    const lit = predictSurface(LIGHTING.day, ASPHALT, 'up', true)
    const shade = predictSurface(LIGHTING.day, ASPHALT, 'up', false)
    expect(mean(lit)).toBeGreaterThan(90)
    expect(mean(lit)).toBeLessThan(140)
    expect(mean(shade)).toBeGreaterThan(50)
    expect(mean(shade)).toBeLessThan(mean(lit) - 20)
    // 影に青みを残さない
    expect(shade[0]).toBeGreaterThan(shade[2] + 8)
    expect(lit[0]).toBeGreaterThan(lit[2] + 8)
  })

  it('昼: 日の当たる白い壁も白飛びしない', () => {
    const wall = predictSurface(LIGHTING.day, PALE_WALL, 'side', true)
    expect(Math.max(...wall)).toBeLessThan(250)
    expect(mean(wall)).toBeGreaterThan(180)
  })

  it('夕: 日なたの路面は橙へ寄り、日陰は青紫へ寄って一段暗い（日なたと影の境目が、明るさと色相の両方で出る）', () => {
    const shade = predictSurface(LIGHTING.dusk, ASPHALT, 'up', false)
    const lit = predictSurface(LIGHTING.dusk, ASPHALT, 'up', true)
    expect(lit[0]).toBeGreaterThan(lit[2] * 1.8)
    expect(shade[2]).toBeGreaterThan(shade[0])
    expect(mean(shade)).toBeGreaterThan(30)
    expect(mean(lit)).toBeGreaterThan(mean(shade) + 25)
  })

  it('夕: 光は空の太陽と同じ方位から低く差し、落ち影が物の高さの2倍以上に伸びる', () => {
    const L = LIGHTING.dusk
    const light = L.lightDir ?? L.sunDir
    const elev = (d: readonly number[]) => Math.atan2(d[1], Math.hypot(d[0], d[2]))
    // 影の長さ ÷ 物の高さ
    expect(1 / Math.tan(elev(light))).toBeGreaterThan(2)
    // 低すぎると影が画面の外まで伸びて、ただの暗い路面になる
    expect(1 / Math.tan(elev(light))).toBeLessThan(4)
    expect(elev(light)).toBeGreaterThanOrEqual(elev(L.sunDir))
    // 方位は空の太陽から少しだけ南へ外す（通りの軸と重なると、通り沿いの壁がどちらも陰になる）。外しすぎると影の向きが太陽と合わない
    const off = Math.abs(Math.atan2(light[0], light[2]) - Math.atan2(L.sunDir[0], L.sunDir[2]))
    expect(off).toBeGreaterThan(0.1)
    expect(off).toBeLessThan(0.3)
  })

  it('夜: 街灯の無い路面でも明るさ 15% 以上を残し、30% は超えない', () => {
    const road = predictSurface(LIGHTING.night, ASPHALT, 'up', false)
    expect(mean(road) / 255).toBeGreaterThanOrEqual(0.15)
    expect(mean(road) / 255).toBeLessThan(0.3)
    // 夜の地の色は青紫
    expect(road[2]).toBeGreaterThan(road[0])
  })

  it('夜: 街灯の下と外で明暗の差が付く（地の明かりは白線を 48% より上へ持ち上げない）', () => {
    const L = LIGHTING.night
    const stripe = predictSurface(L, 0xe8e6e0, 'up', false)
    expect(mean(stripe) / 255).toBeLessThan(0.48)
    // 街灯の光だまりは地の路面の明るさ以上を足す
    expect(L.lampPool).toBeGreaterThanOrEqual(0.4)
    // 店先の光る面（窓明かりの 2.4 倍）もブルームの閾値は超えない
    expect(L.windowGlow * 2.4 + 0.15).toBeLessThan(L.bloom.threshold)
  })

  it('夕: 画面全体に色の膜を掛けず、陽の当たる面と陰の面の差で太陽の向きを見せる', () => {
    const L = LIGHTING.dusk
    // 逆光の膜は薄く（膜で染めると、日なたも陰も同じ橙になる）
    expect(L.sunVeil).toBeLessThanOrEqual(0.08)
    const wallLit = predictSurface(L, PALE_WALL, 'side', true)
    const wallShade = predictSurface(L, PALE_WALL, 'side', false)
    // 陰の壁は日なたの半分より暗い
    expect(mean(wallShade)).toBeLessThan(mean(wallLit) * 0.5)
    expect(mean(wallLit)).toBeGreaterThan(mean(wallShade) + 90)
    // 陰は橙ではなく、赤紫へ寄った暗い色（日なたの橙と色相でも分かれる）
    expect(wallLit[0] / Math.max(1, wallLit[2])).toBeGreaterThan((wallShade[0] / Math.max(1, wallShade[2])) * 1.4)
    // 陰の路面は日なたの路面の半分より暗い
    const roadLit = predictSurface(L, ASPHALT, 'up', true)
    const roadShade = predictSurface(L, ASPHALT, 'up', false)
    expect(mean(roadShade)).toBeLessThan(mean(roadLit) * 0.6)
  })

  it('夜: 窓明かりは壁より明るいが、ブルームの閾値は超えない（面で白く滲ませない）', () => {
    const L = LIGHTING.night
    const wall = predictSurface(L, PALE_WALL, 'side', false)
    const lit = predictSurface(L, PALE_WALL, 'side', false, L.windowGlow)
    expect(mean(lit)).toBeGreaterThan(mean(wall) + 40)
    expect(L.windowGlow + 0.3).toBeLessThan(L.bloom.threshold)
  })

  it('夜: 看板は色を保つ（赤い看板が白へ飛ばない）', () => {
    const L = LIGHTING.night
    const red = hexToLinear(0xe8412f).map((v) => v * L.neon) as Rgb
    const out = gradeColor(red, L).map((v) => v * 255)
    expect(out[0] - out[1]).toBeGreaterThan(90)
    // 白い文字だけが閾値を超えて滲む
    expect(L.neon).toBeGreaterThan(L.bloom.threshold)
    expect(red[0] * 0.2126 + red[1] * 0.7152 + red[2] * 0.0722).toBeLessThan(L.bloom.threshold)
  })

  it('どの時刻も、遠くの建物は地平線の空の色へ溶ける', () => {
    for (const t of TIMES) {
      expect(LIGHTING[t].fogColor, t).toBe(LIGHTING[t].skyHorizon)
      expect(LIGHTING[t].fogNear, t).toBeLessThan(0.2)
    }
  })
})

describe('gto lighting: 街灯とネオンの光だまり', () => {
  const props = streetProps(world)
  const pools = lampPools(props, true)

  it('光だまりは街灯の足元から車道の側へ寄り、街灯と同じ数だけできる', () => {
    const lamps = props.filter((p) => p.kind.startsWith('lamp-'))
    expect(pools.length).toBe(lamps.length)
    expect(pools.length).toBeGreaterThan(100)
    pools.forEach((pool, i) => {
      const lamp = lamps[i]
      const gap = Math.hypot(pool.x - lamp.x, pool.z - lamp.z)
      expect(gap).toBeGreaterThan(1)
      expect(gap).toBeLessThan(4)
      // 街灯が向いている側（車道の中心の側）へ寄る
      expect((pool.x - lamp.x) * Math.sin(lamp.heading) - (pool.z - lamp.z) * Math.cos(lamp.heading)).toBeCloseTo(gap, 5)
    })
  })

  it('軽量設定では、柱を描かないふつうの道路照明の光だまりを除く', () => {
    const light = lampPools(props, false)
    expect(light.length).toBeLessThan(pools.length)
    expect(light.length).toBe(props.filter((p) => p.kind.startsWith('lamp-') && p.kind !== 'lamp-plain').length)
  })

  it('街灯でない街具（街路樹・信号）には光だまりを作らない', () => {
    expect(lampPools([{ kind: 'tree', x: 0, z: 0, heading: 0 }, { kind: 'signal', x: 5, z: 5, heading: 0 }], true)).toEqual([])
  })

  it('ネオンが路面を染める色は、看板の2色のうち鮮やかな方', () => {
    const pink = spillColor('#151226', '#ff4fa3')
    expect(pink[0]).toBeGreaterThan(pink[1] * 2)
    const yellow = spillColor('#f7d51d', '#c81e1e')
    expect(yellow[0]).toBeGreaterThan(yellow[2] * 2)
    // 白黒の看板は白い光
    const white = spillColor('#ffffff', '#111111')
    expect(Math.abs(white[0] - white[2])).toBeLessThan(0.05)
  })
})

describe('gto lighting: 路面の照り返し', () => {
  const UP: Rgb = [0, 1, 0]
  const norm = (v: Rgb): Rgb => {
    const l = Math.hypot(...v)
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  // 太陽は -x の低い所。カメラは太陽の方（-x）を向いて路面を見下ろす
  const SUN = norm([-1, 0.25, 0])
  const look = (downDeg: number, yawDeg = 0): Rgb => {
    const d = (downDeg * Math.PI) / 180
    const y = (yawDeg * Math.PI) / 180
    return [-Math.cos(d) * Math.cos(y), -Math.sin(d), Math.cos(d) * Math.sin(y)]
  }

  it('浅い角度で見る遠くの路面ほどよく照り返す', () => {
    expect(roadFresnel(Math.cos((85 * Math.PI) / 180))).toBeGreaterThan(roadFresnel(Math.cos((50 * Math.PI) / 180)) * 3)
    expect(roadFresnel(1)).toBeLessThan(0.1)
    expect(roadFresnel(0)).toBeCloseTo(1, 5)
  })

  it('太陽の真下の路面が光り、横へ外れると消える（光の筋になる）', () => {
    const under = roadSheen(look(14), UP, SUN, 1)
    const side = roadSheen(look(14, 40), UP, SUN, 1)
    expect(under).toBeGreaterThan(0.8)
    expect(side).toBeLessThan(under * 0.15)
  })

  it('太陽を背にした路面と、壁は照り返さない。強さ 0 なら何も足さない', () => {
    expect(roadSheen([-look(14)[0], look(14)[1], 0], UP, SUN, 1)).toBeLessThan(0.01)
    expect(roadSheen(look(14), [1, 0, 0], SUN, 1)).toBe(0)
    expect(roadSheen(look(14), UP, SUN, 0)).toBe(0)
  })

  it('夕方がいちばん強く、昼は控えめ。どの時刻も路面を濡れた鏡にしない（落ち影が読める強さまで）', () => {
    expect(LIGHTING.dusk.roadGloss).toBeGreaterThan(LIGHTING.night.roadGloss)
    expect(LIGHTING.night.roadGloss).toBeGreaterThan(LIGHTING.day.roadGloss)
    expect(LIGHTING.dusk.roadGloss).toBeLessThanOrEqual(0.3)
    expect(LIGHTING.day.roadGloss).toBeGreaterThan(0)
  })
})

describe('gto lighting: 建物の壁は時刻の光で染まる', () => {
  const dayLit = predictSurface(LIGHTING.day, PALE_WALL, 'side', true)

  it('夜: 街灯の当たらない壁は昼の日なたの半分より暗く、青へ寄る', () => {
    const night = predictSurface(LIGHTING.night, PALE_WALL, 'side', false)
    expect(mean(night)).toBeLessThan(mean(dayLit) * 0.45)
    expect(mean(night)).toBeGreaterThan(22)
    expect(night[2]).toBeGreaterThan(night[0] * 1.2)
  })

  it('夕: 陰の壁は昼より一段暗い赤紫、日なたの壁は橙（同じ壁が向きで2色に分かれる）', () => {
    const shade = predictSurface(LIGHTING.dusk, PALE_WALL, 'side', false)
    const lit = predictSurface(LIGHTING.dusk, PALE_WALL, 'side', true)
    expect(mean(shade)).toBeLessThan(mean(dayLit) * 0.62)
    expect(shade[0]).toBeGreaterThan(shade[1])
    expect(lit[0]).toBeGreaterThan(lit[2] * 1.4)
    expect(mean(lit)).toBeGreaterThan(mean(shade) * 1.7)
  })

  it('窓と店先の明かりは白い板にならない（上限で頭を打ち、暖色へ寄り、窓ごとに濃淡が付く）', () => {
    for (const t of ['dusk', 'night'] as const) {
      const L = LIGHTING[t]
      // 店先の帯（renderCity.ts の GLOW_SCALE.shop = 2.4）の真っ白な発光
      const raw = L.windowGlow * 2.4
      const warm = windowLight([raw, raw, raw], L, 0, 1)
      const dim = windowLight([raw, raw, raw], L, 0, 0)
      const cool = windowLight([raw, raw, raw], L, 0.99, 1)
      expect(Math.max(...warm)).toBeLessThanOrEqual(L.windowLight.cap + 1e-6)
      expect(warm[0]).toBeGreaterThan(warm[2] * 1.5)
      expect(cool[2]).toBeGreaterThan(warm[2])
      expect(mean(dim)).toBeLessThan(mean(warm) * 0.75)
      // 画面に出たとき、白（230 以上）にならない
      const shown = gradeColor(warm, L)
      expect(Math.max(...shown)).toBeLessThan(0.78)
    }
  })

  it('昼は窓明かりを足さない', () => {
    expect(LIGHTING.day.windowGlow).toBe(0)
  })
})

describe('gto lighting: 路面の持ち上げ（上を向いた面）', () => {
  it('暗い面ほど強く持ち上げ、明るい面はほとんど変えない', () => {
    for (const t of TIMES) {
      const L = LIGHTING[t]
      expect(groundLift(0.01, L)).toBeGreaterThan(groundLift(1.5, L))
      expect(groundLift(1.5, L)).toBeGreaterThanOrEqual(1)
      expect(groundLift(1.5, L)).toBeLessThan(1.6)
      expect(groundLift(0, L)).toBeCloseTo(1 + L.groundLift.gain, 6)
    }
  })

  it('夕方の路面は、日なたと陰がはっきり分かれ、どちらも黒く沈まない', () => {
    const lit = predictSurface(LIGHTING.dusk, ASPHALT, 'up', true)
    const shade = predictSurface(LIGHTING.dusk, ASPHALT, 'up', false)
    expect(mean(lit)).toBeGreaterThan(mean(shade) * 1.9)
    expect(mean(lit)).toBeGreaterThan(78)
    expect(mean(lit)).toBeLessThan(175)
    expect(mean(shade)).toBeGreaterThan(36)
    // 日なたは橙、陰は赤紫寄り（色相でも分かれる）
    expect(lit[0] / lit[2]).toBeGreaterThan(shade[0] / shade[2] + 0.3)
  })

  it('夕方の壁は、日なたが陰の 2 倍以上明るい', () => {
    const lit = predictSurface(LIGHTING.dusk, PALE_WALL, 'side', true)
    const shade = predictSurface(LIGHTING.dusk, PALE_WALL, 'side', false)
    expect(mean(lit)).toBeGreaterThan(mean(shade) * 1.6)
    expect(mean(shade)).toBeLessThan(120)
  })

  it('昼の路面は日なたで中間の明るさ、陰でも黒くならない。夜の路面は 15% を下回らない', () => {
    const dayLit = predictSurface(LIGHTING.day, ASPHALT, 'up', true)
    const dayShade = predictSurface(LIGHTING.day, ASPHALT, 'up', false)
    expect(mean(dayLit)).toBeGreaterThan(105)
    expect(mean(dayLit)).toBeGreaterThan(mean(dayShade) * 1.35)
    expect(mean(dayShade)).toBeGreaterThan(55)
    expect(mean(predictSurface(LIGHTING.night, ASPHALT, 'up', false))).toBeGreaterThan(38)
  })
})
