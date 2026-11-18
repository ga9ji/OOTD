// [部品: vehicle] 車の手触りの数値テスト。バーの実測（加速 3〜5 秒で頭打ち、0.2〜0.3 秒で 30° 向きが変わる、
// 壁への正面衝突は即停止、他車に当たると向きを振られる）を、平らな仮の世界で確かめる。
import { describe, expect, it } from 'vitest'
import { angleDiff } from '../math'
import { collideVehicles, createVehicle, stepVehicle, VEHICLE_SPECS } from '../vehicle'
import { applyImpact, damageStage, DENT, VEHICLE_DAMAGE } from '../vehicleDamage'
import { hitPole, setPoles } from '../vehiclePoles'
import type { GtoWorld, VehicleControl, VehicleKind, VehicleState } from '../types'

const DT = 1 / 60
const DEG = Math.PI / 180

/** 平らで、x = wallX より東が壁の世界 */
const flatWorld = (wallX = Infinity): GtoWorld =>
  ({
    groundY: () => 0,
    resolveCircle: (x: number, z: number, r: number) =>
      x + r > wallX ? { x: wallX - r, z, hit: true, nx: -1, nz: 0 } : { x, z, hit: false, nx: 0, nz: 0 },
  }) as unknown as GtoWorld

const open = flatWorld()
const car = (kind: VehicleKind = 'sedan', over: Partial<VehicleState> = {}): VehicleState => ({
  ...createVehicle(1, kind, 0, 0, 0, open),
  ...over,
})

interface Sample {
  t: number
  v: VehicleState
}

/** 同じ操作で seconds 秒進め、1歩ごとの車を返す */
function drive(v0: VehicleState, control: Partial<VehicleControl>, seconds: number, world = open) {
  const samples: Sample[] = []
  const crashes: number[] = []
  let v = v0
  const steps = Math.round(seconds / DT)
  for (let i = 1; i <= steps; i++) {
    const r = stepVehicle(v, { throttle: 0, brake: 0, steer: 0, handbrake: false, ...control }, world, DT)
    v = r.vehicle
    for (const e of r.events) if (e.type === 'crash') crashes.push(e.value ?? 0)
    samples.push({ t: i * DT, v })
  }
  return { v, samples, crashes }
}

const firstTime = (samples: Sample[], test: (v: VehicleState) => boolean) => samples.find((s) => test(s.v))?.t ?? Infinity

describe('gto vehicle: 加速と最高速', () => {
  it('セダンは 3〜5 秒で最高速の 9 割に届き、最高速は超えない', () => {
    const run = drive(car('sedan'), { throttle: 1 }, 12)
    const max = VEHICLE_SPECS.sedan.maxSpeed
    const t90 = firstTime(run.samples, (v) => v.speed >= max * 0.9)
    expect(t90).toBeGreaterThan(3)
    expect(t90).toBeLessThan(5)
    expect(run.v.speed).toBeLessThanOrEqual(max)
    expect(run.v.speed).toBeGreaterThan(max * 0.97)
  })

  it('発進の 1 秒で 30km/h を超える（出足が鈍くない）', () => {
    expect(drive(car('sedan'), { throttle: 1 }, 1).v.speed).toBeGreaterThan(30 / 3.6)
  })

  it('車種で速さが違う（警察 > セダン > タクシー > 軽・バン）', () => {
    const at3 = (kind: VehicleKind) => drive(car(kind), { throttle: 1 }, 3).v.speed
    expect(at3('police')).toBeGreaterThan(at3('sedan'))
    expect(at3('sedan')).toBeGreaterThan(at3('taxi'))
    expect(at3('taxi')).toBeGreaterThan(at3('kei'))
    expect(at3('taxi')).toBeGreaterThan(at3('van'))
  })

  it('アクセルを離すと、ゆっくり惰性で減速して止まる', () => {
    const run = drive(car('sedan', { speed: 20 }), {}, 30)
    expect(run.samples[59].v.speed).toBeGreaterThan(16)
    expect(run.v.speed).toBe(0)
  })
})

describe('gto vehicle: ブレーキ', () => {
  it('90km/h から 2.2 秒・35m 以内で止まる', () => {
    const run = drive(car('sedan', { speed: 25 }), { brake: 1 }, 2.2)
    const stop = firstTime(run.samples, (v) => v.speed <= 0.2)
    expect(stop).toBeLessThan(2.2)
    const at = run.samples.find((s) => s.t === stop)
    expect(Math.abs(at?.v.z ?? 99)).toBeLessThan(35)
  })

  it('止まってから踏み続けると後退し、後退の上限を超えない', () => {
    const run = drive(car('sedan'), { brake: 1 }, 6)
    expect(run.v.speed).toBeLessThan(-3)
    expect(run.v.speed).toBeGreaterThanOrEqual(-VEHICLE_SPECS.sedan.reverseMax)
  })
})

describe('gto vehicle: ハンドルの遅れと旋回', () => {
  it('切り始めの 0.05 秒はほとんど向きが変わらない（溜めがある）', () => {
    const v0 = car('sedan', { speed: 12 })
    const run = drive(v0, { throttle: 0.5, steer: 1 }, 0.05)
    expect(Math.abs(angleDiff(v0.heading, run.v.heading))).toBeLessThan(1.5 * DEG)
  })

  it('街なかの速さ（43km/h）で、切ってから 0.45 秒以内に 30° 向きが変わる', () => {
    const v0 = car('sedan', { speed: 12 })
    const run = drive(v0, { throttle: 0.5, steer: 1 }, 1)
    const t30 = firstTime(run.samples, (v) => angleDiff(v0.heading, v.heading) >= 30 * DEG)
    expect(t30).toBeLessThan(0.45)
    expect(t30).toBeGreaterThan(0.15)
  })

  it('高速では舵の効きが落ちる（同じ時間で回る角度が小さい）', () => {
    const turn = (speed: number) => {
      const v0 = car('sedan', { speed })
      return angleDiff(v0.heading, drive(v0, { throttle: 1, steer: 1 }, 0.6).v.heading)
    }
    expect(turn(30)).toBeLessThan(turn(12) * 0.75)
  })

  it('ハンドルを戻すと 0.3 秒以内に旋回が止まる', () => {
    const turning = drive(car('sedan', { speed: 12 }), { throttle: 0.5, steer: 1 }, 0.5).v
    const run = drive(turning, { throttle: 0.5 }, 0.6)
    expect(firstTime(run.samples, (v) => Math.abs(v.yawRate) < 0.1)).toBeLessThan(0.35)
  })

  it('後退中は舵が逆に効く', () => {
    const v0 = car('sedan', { speed: -5 })
    expect(angleDiff(v0.heading, drive(v0, { brake: 0.5, steer: 1 }, 0.8).v.heading)).toBeLessThan(-0.2)
  })

  it('半分だけ切ると、いっぱいに切るより緩く曲がる', () => {
    const turn = (steer: number) => {
      const v0 = car('sedan', { speed: 15 })
      return angleDiff(v0.heading, drive(v0, { throttle: 0.6, steer }, 0.8).v.heading)
    }
    expect(turn(0.5)).toBeLessThan(turn(1) * 0.75)
    expect(turn(0.5)).toBeGreaterThan(turn(1) * 0.25)
  })
})

describe('gto vehicle: ドリフト', () => {
  it('サイドブレーキで切ると、0.8 秒以内に 60° 以上回って横に 5m/s 以上滑る', () => {
    const v0 = car('sedan', { speed: 17 })
    const run = drive(v0, { steer: 1, handbrake: true }, 0.8)
    expect(angleDiff(v0.heading, run.v.heading)).toBeGreaterThan(60 * DEG)
    expect(Math.max(...run.samples.map((s) => Math.abs(s.v.slip)))).toBeGreaterThan(5)
  })

  it('普通に曲がるだけなら大きくは滑らない', () => {
    const run = drive(car('sedan', { speed: 12 }), { throttle: 0.6, steer: 1 }, 0.8)
    expect(Math.max(...run.samples.map((s) => Math.abs(s.v.slip)))).toBeLessThan(4)
  })

  it('サイドブレーキを離してアクセルを踏めば 1.5 秒以内に滑りが収まり、回り過ぎない', () => {
    const sliding = drive(car('sedan', { speed: 17 }), { steer: 1, handbrake: true }, 0.6).v
    const run = drive(sliding, { throttle: 1 }, 1.5)
    expect(Math.abs(run.v.slip)).toBeLessThan(0.5)
    expect(Math.abs(angleDiff(sliding.heading, run.v.heading))).toBeLessThan(55 * DEG)
    expect(run.v.speed).toBeGreaterThan(4)
  })

  it('尻を出したあとアクセルと舵を入れ続けると、進む向きに対して 30° 以上斜めを向いたまま 1 秒以上滑り続ける（パワースライド）', () => {
    const flicked = drive(car('sedan', { speed: 13 }), { steer: 1, handbrake: true }, 0.2).v
    const run = drive(flicked, { throttle: 1, steer: 0.8 }, 1.6)
    const angle = (v: VehicleState) => Math.atan2(Math.abs(v.slip), Math.abs(v.speed)) / DEG
    const held = run.samples.filter((s) => angle(s.v) >= 30 && Math.hypot(s.v.speed, s.v.slip) > 6)
    expect(held.length * DT).toBeGreaterThan(1)
    // 回り切って止まらない（横を向いて失速するのはサイドブレーキを引き続けたときだけ）
    expect(Math.max(...run.samples.map((s) => angle(s.v)))).toBeLessThan(65)
    expect(Math.hypot(run.v.speed, run.v.slip)).toBeGreaterThan(6)
  })

  it('パワースライド中にアクセルと舵を戻せば、0.8 秒以内に滑りが収まる', () => {
    const flicked = drive(car('sedan', { speed: 13 }), { steer: 1, handbrake: true }, 0.2).v
    const sliding = drive(flicked, { throttle: 1, steer: 0.8 }, 0.8).v
    expect(Math.abs(sliding.slip)).toBeGreaterThan(4)
    expect(Math.abs(drive(sliding, {}, 0.8).v.slip)).toBeLessThan(0.5)
  })

  it('滑っているあいだは前向きの速さを失う', () => {
    const v0 = car('sedan', { speed: 17 })
    const straight = drive(v0, {}, 0.8).v
    const drift = drive(v0, { steer: 1, handbrake: true }, 0.8).v
    expect(Math.hypot(drift.speed, drift.slip)).toBeLessThan(straight.speed - 2)
  })
})

describe('gto vehicle: 壁との衝突', () => {
  it('正面からぶつかると弾き返され、1〜2m 下がって止まる。当たった速さの衝突が1回起きる', () => {
    const world = flatWorld(30)
    const v0 = { ...createVehicle(1, 'sedan', 0, 0, Math.PI / 2, world), speed: 20 }
    const run = drive(v0, {}, 3, world)
    const hitAt = firstTime(run.samples, (v) => v.speed < 15)
    // 当たった直後は後ろへ弾かれている（鼻を壁に付けたまま止まらない）
    const after = run.samples.find((s) => s.t >= hitAt + 0.05)
    expect(after?.v.speed ?? 0).toBeLessThan(-1.5)
    expect(after?.v.speed ?? -99).toBeGreaterThan(-6)
    expect(run.crashes.length).toBe(1)
    expect(run.crashes[0]).toBeGreaterThan(15)
    // 車体は壁の手前に留まり、最後は壁から 0.5〜3m 離れて止まっている
    const half = VEHICLE_SPECS.sedan.length / 2
    for (const s of run.samples) expect(s.v.x + half).toBeLessThan(30 + 0.2)
    expect(run.v.speed).toBe(0)
    expect(30 - (run.v.x + half)).toBeGreaterThan(0.5)
    expect(30 - (run.v.x + half)).toBeLessThan(3)
  })

  it('浅い角度で擦ると、速さの半分以上を残して壁沿いへ向きを変える', () => {
    const world = flatWorld(6)
    // ほぼ北向き、少しだけ東（壁）へ向いている
    const v0 = { ...createVehicle(1, 'sedan', 3, 0, 15 * DEG, world), speed: 18 }
    const run = drive(v0, {}, 1.2, world)
    expect(run.v.speed).toBeGreaterThan(9)
    expect(Math.abs(angleDiff(0, run.v.heading))).toBeLessThan(11 * DEG)
  })
})

describe('gto vehicle: 車どうしの衝突', () => {
  it('隣の車線をすれ違うだけなら当たらない（車体の幅で判定する）', () => {
    const a = car('sedan', { speed: 10 })
    const b = { ...createVehicle(2, 'sedan', 2.6, -1, Math.PI, open), speed: 10 }
    expect(collideVehicles(a, b)).toBeNull()
  })

  it('追突すると前の車が押し出され、自分は減速する', () => {
    const a = car('sedan', { speed: 14 })
    const b = createVehicle(2, 'sedan', 0, -4.2, 0, open)
    const hit = collideVehicles(a, b)
    expect(hit).not.toBeNull()
    expect(hit?.impact).toBeCloseTo(14, 0)
    expect(hit?.b.speed).toBeGreaterThan(5)
    expect(hit?.a.speed).toBeLessThan(10)
    expect(hit?.a.speed).toBeGreaterThan(0)
  })

  it('重い車は軽い車より動かされにくい', () => {
    const a = car('sedan', { speed: 14 })
    const pushed = (kind: VehicleKind) => {
      const half = (VEHICLE_SPECS.sedan.length + VEHICLE_SPECS[kind].length) / 2
      return collideVehicles(a, createVehicle(2, kind, 0, -(half - 0.3), 0, open))?.b.speed ?? 0
    }
    expect(pushed('kei')).toBeGreaterThan(pushed('van') + 1)
  })

  it('角に当てると、当てられた車は向きを振られる（20〜30° 回る勢い）', () => {
    const a = car('sedan', { speed: 12 })
    // 相手は東向きで前を横切っている。その後ろ寄りに当たる
    const b = { ...createVehicle(2, 'sedan', -1.2, -3.2, Math.PI / 2, open), speed: 3 }
    const hit = collideVehicles(a, b)
    expect(hit).not.toBeNull()
    expect(Math.abs(hit?.b.yawRate ?? 0)).toBeGreaterThan(0.8)
    // 勢いを残したまま惰性で回り、0.5〜1.5 秒で収まる
    const spun = drive(hit!.b, {}, 1.5)
    const swing = Math.abs(angleDiff(b.heading, spun.v.heading))
    expect(swing).toBeGreaterThan(12 * DEG)
    expect(swing).toBeLessThan(75 * DEG)
    expect(Math.abs(spun.v.yawRate)).toBeLessThan(0.05)
  })

  it('斜めに当てた自分も向きを振られ、0.5 秒ほどで立て直せる', () => {
    const a = car('sedan', { speed: 14, x: 0.9 })
    const b = createVehicle(2, 'van', 0, -4.6, 0, open)
    const hit = collideVehicles(a, b)
    expect(hit).not.toBeNull()
    expect(Math.abs(hit?.a.yawRate ?? 0)).toBeGreaterThan(0.3)
    const after = drive(hit!.a, { throttle: 1 }, 0.7)
    expect(Math.abs(after.v.yawRate)).toBeLessThan(0.15)
    expect(Math.abs(angleDiff(a.heading, after.v.heading))).toBeLessThan(40 * DEG)
  })

  it('重なりは解消される', () => {
    const a = car('sedan', { speed: 6 })
    const b = createVehicle(2, 'kei', 0.3, -3, 0.4, open)
    const hit = collideVehicles(a, b)
    expect(hit).not.toBeNull()
    expect(collideVehicles({ ...hit!.a, speed: 0, slip: 0 }, { ...hit!.b, speed: 0, slip: 0 })?.impact ?? 0).toBeLessThan(0.01)
  })
})

describe('gto vehicle: 純粋さ', () => {
  it('渡した車と操作を書き換えない', () => {
    const v0 = Object.freeze(car('sedan', { speed: 10 }))
    const control = Object.freeze({ throttle: 1, brake: 0, steer: 0.5, handbrake: false })
    const r = stepVehicle(v0, control, open, DT)
    expect(r.vehicle).not.toBe(v0)
    expect(v0.speed).toBe(10)
    const b = Object.freeze(createVehicle(2, 'kei', 0, -3, 0, open))
    expect(() => collideVehicles(v0, b)).not.toThrow()
  })
})

describe('gto vehicle: 損傷（当たった結果が車体に残る）', () => {
  it('壁に正面から強く当たると、前の全幅が凹み、壊れ具合が進む', () => {
    const world = flatWorld(30)
    const v0 = { ...createVehicle(1, 'sedan', 0, 0, Math.PI / 2, world), speed: 20 }
    const run = drive(v0, {}, 1.6, world)
    const d = run.v.dents ?? []
    expect(run.v.damage ?? 0).toBeGreaterThan(0.2)
    for (const zone of [DENT.frontL, DENT.frontC, DENT.frontR]) expect(d[zone]).toBeGreaterThan(0.5)
    for (const zone of [DENT.rearL, DENT.rearC, DENT.rearR, DENT.left, DENT.right]) expect(d[zone]).toBe(0)
  })

  it('ゆっくり触れただけ・浅く擦っただけでは傷まない', () => {
    const slow = drive({ ...createVehicle(1, 'sedan', 26, 0, Math.PI / 2, flatWorld(30)), speed: 2.5 }, {}, 1, flatWorld(30))
    expect(slow.v.damage).toBeUndefined()
    const scrape = drive({ ...createVehicle(1, 'sedan', 3, 0, 8 * DEG, flatWorld(6)), speed: 18 }, {}, 1.2, flatWorld(6))
    expect(scrape.v.damage ?? 0).toBe(0)
  })

  it('当たるたびに段階が進み（無傷 → 白煙 → 黒煙 → 炎）、1 を超えない', () => {
    let v = car('sedan')
    const stages = [damageStage(v.damage)]
    for (let i = 0; i < 8; i++) {
      v = applyImpact(v, 16, 0, 2.3, 2.3, 0.9)
      stages.push(damageStage(v.damage))
    }
    expect(stages[0]).toBe('ok')
    expect(stages.indexOf('smoke')).toBeGreaterThan(0)
    expect(stages.indexOf('black')).toBeGreaterThan(stages.indexOf('smoke'))
    expect(stages.indexOf('fire')).toBeGreaterThan(stages.indexOf('black'))
    expect(v.damage).toBe(1)
    expect(Math.max(...(v.dents ?? []))).toBeLessThanOrEqual(1)
    // 1回の事故では燃えない
    expect((applyImpact(car('sedan'), 40, 0, 2.3, 2.3, 0.9).damage ?? 0)).toBeLessThan(VEHICLE_DAMAGE.blackSmoke)
  })

  it('追突すると、当てた車は前が、当てられた車は後ろが凹む', () => {
    const a = car('sedan', { speed: 14 })
    const b = createVehicle(2, 'sedan', 0, -4.2, 0, open)
    const hit = collideVehicles(a, b)
    expect(hit?.a.dents?.[DENT.frontC]).toBeGreaterThan(0.3)
    expect(hit?.b.dents?.[DENT.rearC]).toBeGreaterThan(0.3)
    expect(hit?.b.dents?.[DENT.frontC]).toBe(0)
  })
})

describe('gto vehicle: 柱との衝突', () => {
  const poleWorld = (x: number, z: number) => {
    const world = flatWorld()
    setPoles(world, [{ x, z, r: 0.14 }])
    return world
  }
  const half = VEHICLE_SPECS.sedan.length / 2

  it('正面から当たると突き抜けずに止まり、跳ね返って、鼻の真ん中が凹む', () => {
    // 北（−z）へ 54km/h、20m 先に柱
    const world = poleWorld(0, -20)
    const run = drive({ ...createVehicle(1, 'sedan', 0, 0, 0, world), speed: 15 }, { throttle: 1 }, 3, world)
    // 車体の前端は柱より先へ出ない（重ならない）
    for (const s of run.samples) expect(s.v.z - half).toBeGreaterThan(-20 + 0.14 - 0.02)
    expect(run.crashes.length).toBeGreaterThanOrEqual(1)
    expect(run.crashes[0]).toBeGreaterThan(12)
    const hitAt = firstTime(run.samples, (v) => v.speed < 10)
    // 当たった直後は後ろへ跳ね返っている
    expect(run.samples.find((s) => s.t > hitAt)?.v.speed ?? 0).toBeLessThan(0)
    const d = run.v.dents ?? []
    expect(d[DENT.frontC]).toBeGreaterThan(0.5)
    expect(d[DENT.frontC]).toBeGreaterThan(d[DENT.frontL] * 2)
  })

  it('鼻の角に当たると、当たった側を軸に向きを振られる', () => {
    // 柱は進路の右寄り（車体の右の角に当たる）
    const world = poleWorld(0.7, -20)
    const v0 = { ...createVehicle(1, 'sedan', 0, 0, 0, world), speed: 15 }
    const run = drive(v0, {}, 2.2, world)
    // 右の角を止められるので、時計回り（右）へ振られる
    expect(angleDiff(v0.heading, run.v.heading)).toBeGreaterThan(6 * DEG)
    expect(run.v.dents?.[DENT.frontR]).toBeGreaterThan(0.4)
    expect(run.v.dents?.[DENT.frontL]).toBe(0)
  })

  it('柱の横を通るだけなら当たらない', () => {
    const world = poleWorld(1.2, -20)
    const run = drive({ ...createVehicle(1, 'sedan', 0, 0, 0, world), speed: 15 }, {}, 2.2, world)
    expect(run.crashes.length).toBe(0)
    expect(run.v.z).toBeLessThan(-25)
  })

  it('横滑りで側面から当たると、側面が凹む', () => {
    const world = poleWorld(6, 0)
    const run = drive({ ...createVehicle(1, 'sedan', 0, 0, 0, world), slip: 12 }, { handbrake: true }, 1.2, world)
    expect(run.v.x + VEHICLE_SPECS.sedan.width / 2).toBeLessThan(6 - 0.1)
    expect(run.v.dents?.[DENT.right]).toBeGreaterThan(0.3)
  })

  it('柱が車体の中まで入っていても、重なりが無くなる向きへ押し出す', () => {
    const hit = hitPole(0, 0, 0, -1, half, 0.9, { x: 0.2, z: -(half - 0.3), r: 0.14 })
    expect(hit).not.toBeNull()
    // 北向きの車の鼻に刺さっているので、南（＋z）へ押し戻す
    expect(hit?.nz).toBeCloseTo(1, 5)
    expect(hit?.push).toBeCloseTo(0.3 + 0.14, 5)
    expect(hitPole(0, 0, 0, -1, half, 0.9, { x: 3, z: 0, r: 0.14 })).toBeNull()
  })
})
