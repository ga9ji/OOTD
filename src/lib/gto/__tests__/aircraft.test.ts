// [部品: cheats] 飛行機の飛び方（aircraft.ts）。平らな仮の世界で、離陸・上昇・水平・失速・着陸・建物との当たりを確かめる。
import { describe, expect, it } from 'vitest'
import { flying, overhead, PLANE_TUNING, stepAircraft, stepRide } from '../aircraft'
import { createVehicle, VEHICLE_SPECS } from '../vehicle'
import type { GtoWorld, VehicleControl, VehicleState } from '../types'

const DT = 1 / 60
const T = PLANE_TUNING

/** 平らな世界。tower があれば、その四角（x0..x1, z0..z1）に高さ h の建物が建っている */
const flatWorld = (tower?: { x0: number; x1: number; z0: number; z1: number; h: number }): GtoWorld =>
  ({
    bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 },
    groundY: () => 0,
    roofY: (x: number, z: number) => (tower && x >= tower.x0 && x <= tower.x1 && z >= tower.z0 && z <= tower.z1 ? tower.h : -Infinity),
    resolveCircle: (x: number, z: number) => ({ x, z, hit: false, nx: 0, nz: 0 }),
  }) as unknown as GtoWorld

const open = flatWorld()
const plane = (over: Partial<VehicleState> = {}): VehicleState => ({ ...createVehicle(1, 'plane', 0, 0, 0, open), ...over })
/** 高さ alt を速さ speed で北（−z）へ飛んでいる飛行機 */
const inAir = (alt: number, speed = 35, over: Partial<VehicleState> = {}): VehicleState => plane({ y: alt, alt, speed, climb: 0, ...over })

function fly(v0: VehicleState, control: Partial<VehicleControl>, seconds: number, world = open) {
  let v = v0
  const crashes: number[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = stepRide(v, { throttle: 0, brake: 0, steer: 0, handbrake: false, ...control }, world, DT)
    v = r.vehicle
    for (const e of r.events) if (e.type === 'crash') crashes.push(e.value ?? 0)
  }
  return { v, crashes }
}

describe('gto aircraft: 離陸', () => {
  it('アクセルだけでは、どれだけ速くなっても浮かない（車として滑走する）', () => {
    const { v } = fly(plane(), { throttle: 1 }, 8)
    expect(v.speed).toBeGreaterThan(T.takeoff)
    expect(flying(v)).toBe(false)
    expect(v.y).toBe(0)
  })

  it('遅いうちは、上昇を入れても浮かない', () => {
    const { v } = fly(plane(), { throttle: 1, lift: 1 }, 0.8)
    expect(v.speed).toBeLessThan(T.takeoff)
    expect(flying(v)).toBe(false)
  })

  it('離陸できる速さで上昇を入れると浮いて、上がっていく（数秒で屋根の高さを超える）', () => {
    const { v } = fly(plane(), { throttle: 1, lift: 1 }, 7)
    expect(flying(v)).toBe(true)
    expect(v.alt).toBeGreaterThan(30)
    expect(v.y).toBeCloseTo(v.alt ?? 0, 6)
    expect(v.climb).toBeGreaterThan(0)
  })

  it('浮いてしばらくは、ほかの車に当たる高さ。上がりきれば頭の上', () => {
    expect(overhead(inAir(1))).toBe(false)
    expect(overhead(inAir(T.clear + 1))).toBe(true)
    expect(overhead(plane())).toBe(false)
  })
})

describe('gto aircraft: 空での操作', () => {
  it('上昇も下降も入れなければ、高さを保つ', () => {
    const { v } = fly(inAir(80), { throttle: 1 }, 5)
    expect(v.alt).toBeCloseTo(80, 3)
  })

  it('上昇で上がり、下降で下がる。上限より上へは行かない', () => {
    expect(fly(inAir(80), { throttle: 1, lift: 1 }, 3).v.alt).toBeGreaterThan(100)
    expect(fly(inAir(80), { throttle: 1, lift: -1 }, 3).v.alt).toBeLessThan(60)
    expect(fly(inAir(T.ceiling - 5), { throttle: 1, lift: 1 }, 5).v.alt).toBeCloseTo(T.ceiling, 3)
  })

  it('左右で旋回する（右へ切れば時計回り）', () => {
    const right = fly(inAir(80), { throttle: 1, steer: 1 }, 2).v
    const left = fly(inAir(80), { throttle: 1, steer: -1 }, 2).v
    expect(right.heading).toBeGreaterThan(1)
    expect(left.heading).toBeLessThan(-1)
    expect(right.alt).toBeCloseTo(80, 3)
  })

  it('アクセルを離すと少しずつ遅くなり、失速の速さを下回ると沈む', () => {
    const { v } = fly(inAir(120, 20), {}, 8)
    expect(v.speed).toBeLessThan(T.stall)
    expect(v.alt).toBeLessThan(110)
    expect(v.climb).toBeLessThan(0)
  })

  it('失速していると、上昇を入れても上がれない', () => {
    const { v } = fly(inAir(120, T.stall - 4), { lift: 1 }, 1.5)
    expect(v.alt).toBeLessThan(120)
  })

  it('ブレーキでは、沈み始める速さまでしか落ちない（空中で止まらない）', () => {
    const { v } = fly(inAir(250, 40), { brake: 1 }, 6)
    expect(v.speed).toBeCloseTo(T.minSpeed, 3)
    expect(flying(v)).toBe(true)
  })
})

describe('gto aircraft: 着陸', () => {
  it('下降を入れ続けると地面に着き、そこからは車として止まれる', () => {
    const down = fly(inAir(30, 24), { lift: -1 }, 8)
    expect(flying(down.v)).toBe(false)
    expect(down.v.y).toBe(0)
    expect(down.v.alt).toBe(0)
    const stopped = fly(down.v, { brake: 1 }, 6).v
    expect(Math.abs(stopped.speed)).toBeLessThan(3.1)
  })

  it('下降を入れたままでも、地面の近くで沈む速さがゆるんで、衝突にならずに着く', () => {
    const soft = fly(inAir(60, 24), { lift: -1 }, 12)
    expect(flying(soft.v)).toBe(false)
    expect(soft.crashes).toEqual([])
  })

  it('失速して落ちると、衝突として知らせる', () => {
    const hard = fly(inAir(60, 4), {}, 12)
    expect(flying(hard.v)).toBe(false)
    expect(hard.crashes.length).toBe(1)
    expect(hard.crashes[0]).toBeGreaterThan(T.hardLanding)
  })

  it('乗り手のいない飛行機も、空に残らず降りてくる', () => {
    const { v } = fly(inAir(60, 30, { driver: 'none' }), {}, 40)
    expect(flying(v)).toBe(false)
  })
})

describe('gto aircraft: 建物', () => {
  // 北（−z）へ 100m 先に、高さ 60m の建物
  const town = flatWorld({ x0: -20, x1: 20, z0: -140, z1: -100, h: 60 })

  it('屋根より高ければ、上を越える', () => {
    const { v, crashes } = fly(inAir(90), { throttle: 1 }, 6, town)
    expect(v.z).toBeLessThan(-140)
    expect(crashes).toEqual([])
    expect(v.alt).toBeCloseTo(90, 3)
  })

  it('屋根より低いと、壁に跳ね返されて入れない', () => {
    const { v, crashes } = fly(inAir(30), { throttle: 1 }, 4, town)
    expect(crashes.length).toBeGreaterThan(0)
    expect(v.z).toBeGreaterThan(-100)
    expect(town.roofY(v.x, v.z)).toBe(-Infinity)
  })

  it('上を飛んでいて降りてきても、屋根の少し上で止まる（屋根には降りない）', () => {
    // 建物の真上を、ゆっくり下降しながら通る
    let v = inAir(70, 12, { z: -98 })
    let lowest = Infinity
    for (let i = 0; i < 180; i++) {
      v = stepAircraft(v, { throttle: 0, brake: 0, steer: 0, handbrake: false, lift: -1 }, town, DT).vehicle
      if (town.roofY(v.x, v.z) > 0) lowest = Math.min(lowest, v.y)
    }
    expect(lowest).toBeGreaterThanOrEqual(60 + T.roofGap - 1e-6)
  })
})

describe('gto aircraft: 街の範囲の端', () => {
  it('端へ近づくと内側へ向きを戻され、外へ出ない', () => {
    const small = { ...flatWorld(), bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } } as GtoWorld
    let v = inAir(100, 40, { z: -200 })
    let outside = false
    for (let i = 0; i < 60 * 20; i++) {
      v = stepAircraft(v, { throttle: 1, brake: 0, steer: 0, handbrake: false }, small, DT).vehicle
      if (Math.abs(v.x) > 300 || Math.abs(v.z) > 300) outside = true
    }
    expect(outside).toBe(false)
    // 北へ飛び続けていたのが、向きを変えて戻ってきている
    expect(v.z).toBeGreaterThan(-298)
    expect(Math.abs(v.heading)).toBeGreaterThan(1)
  })

  it('飛行機の寸法は、当たり判定を胴体と脚のぶんだけにしてある（翼の幅は入れない）', () => {
    expect(VEHICLE_SPECS.plane.width).toBeLessThan(3)
  })
})
