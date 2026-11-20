import { describe, expect, it } from 'vitest'
import { angleDiff, dirOf } from '../math'
import {
  drivingSeat,
  BOARD_TUNING,
  boardingPose,
  canDrive,
  cameraSubject,
  crowdExempt,
  createPlayer,
  DOOR_FRAME,
  doorFrame,
  doorPoint,
  FOOT_TUNING,
  gaitOf,
  stepBoarding,
  stepOnFoot,
  type CarSize,
} from '../onFoot'
import { createVehicle, isCar, VEHICLE_SPECS } from '../vehicle'
import type { GtoEventType, InputFrame, PlayMode, PlayerState, VehicleState } from '../types'
import { CAMERA_TUNING, createCamera, stepCamera } from '../camera'
import { cabinLayout, doorSwing } from '../vehicleCabin'
import { VEHICLE_LOOK } from '../../../components/gto/vehicleShape'
import { DT, input, run, start, world } from './helpers'

const sizeOf = (v: VehicleState): CarSize => VEHICLE_SPECS[v.kind]
// 明治通り（南北にまっすぐな広い道。建物に当たらない場所）
const ROAD = (() => {
  const road = world.nearestRoad(200, 150, true, 80)
  if (!road) throw new Error('road')
  return { x: road.x, z: road.z, heading: road.heading }
})()

interface Scene {
  p: PlayerState
  mode: PlayMode
  vehicles: VehicleState[]
  seen: GtoEventType[]
  ejected: number
  t: number
}

/** 乗り降りと徒歩の移動だけを sim と同じ順で回す */
function advance(s: Scene, seconds: number, over: Partial<InputFrame> = {}, pressAt = -1): Scene {
  let cur = s
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    const inp = input({ ...over, enter: i === pressAt })
    const b = stepBoarding(cur.p, cur.mode, cur.vehicles, sizeOf, inp, world, DT)
    const p = b.mode === 'foot' ? stepOnFoot(b.player, inp, 0, world, [], DT) : b.player
    cur = {
      p,
      mode: b.mode,
      vehicles: b.vehicles,
      seen: [...cur.seen, ...b.events.map((e) => e.type)],
      ejected: cur.ejected + (b.ejected ? 1 : 0),
      t: cur.t + DT,
    }
  }
  return cur
}

const scene = (driver: VehicleState['driver'] = 'none', offset = 3): Scene => {
  const car = { ...createVehicle(1, 'sedan', ROAD.x, ROAD.z, ROAD.heading, world), driver }
  // offset は車の右が＋。少し後ろ寄りに立つ
  const f = dirOf(ROAD.heading)
  const at = { x: ROAD.x - f.z * offset - f.x * 0.5, z: ROAD.z + f.x * offset - f.z * 0.5 }
  return { p: createPlayer(at.x, at.z, ROAD.heading, world), mode: 'foot', vehicles: [car], seen: [], ejected: 0, t: 0 }
}

/** 条件が成り立つまで進めて、掛かった秒を返す */
function until(s: Scene, done: (s: Scene) => boolean, limit = 8): Scene {
  let cur = s
  while (!done(cur) && cur.t < limit) cur = advance(cur, DT)
  return cur
}

describe('gto onFoot: 歩きと走り', () => {
  it('歩きは小走り、走りはその倍近く。歩幅は速さで伸びる', () => {
    expect(FOOT_TUNING.walkSpeed).toBeGreaterThan(2.5)
    expect(FOOT_TUNING.runSpeed).toBeGreaterThan(FOOT_TUNING.walkSpeed * 1.6)
    expect(gaitOf(FOOT_TUNING.runSpeed).strideLength).toBeGreaterThan(gaitOf(FOOT_TUNING.walkSpeed).strideLength * 1.3)
    // 1秒あたりの歩数は人の範囲（歩き 1.6〜2.4 歩、走り 2.6〜3.6 歩）。stride は左右1組で 1
    const walkSteps = (FOOT_TUNING.walkSpeed / gaitOf(FOOT_TUNING.walkSpeed).strideLength) * 2
    const runSteps = (FOOT_TUNING.runSpeed / gaitOf(FOOT_TUNING.runSpeed).strideLength) * 2
    expect(walkSteps).toBeGreaterThan(1.6)
    expect(walkSteps).toBeLessThan(3)
    expect(runSteps).toBeGreaterThan(2.6)
    expect(runSteps).toBeLessThan(3.8)
  })

  it('向きは 0.2 秒以内に 90° 変わる', () => {
    let p = createPlayer(ROAD.x, ROAD.z, 0, world)
    for (let i = 0; i < 12; i++) p = stepOnFoot(p, input({ moveX: 1 }), 0, world, [], DT)
    expect(Math.abs(p.heading - Math.PI / 2)).toBeLessThan(0.05)
  })

  it('上り坂は遅く、同じ入力でも平地より進まない', () => {
    // ほぼ平らな明治通りでは、走りの速さがそのまま出る
    const flat = (() => {
      let p = createPlayer(ROAD.x, ROAD.z, ROAD.heading, world)
      for (let i = 0; i < 120; i++) p = stepOnFoot(p, input({ moveY: 1, run: true }), ROAD.heading, world, [], DT)
      return Math.hypot(p.x - ROAD.x, p.z - ROAD.z)
    })()
    expect(flat).toBeGreaterThan(FOOT_TUNING.runSpeed * 1.6)
    // 合成の坂: 高さだけ差し替えた世界で確かめる（勾配 15%）
    const hill = { ...world, groundY: (_x: number, z: number) => -z * 0.15, resolveCircle: (x: number, z: number) => ({ x, z, hit: false, nx: 0, nz: 0 }) }
    let up = createPlayer(0, 0, 0, hill)
    let down = createPlayer(0, 0, Math.PI, hill)
    for (let i = 0; i < 120; i++) {
      up = stepOnFoot(up, input({ moveY: 1, run: true }), 0, hill, [], DT)
      down = stepOnFoot(down, input({ moveY: 1, run: true }), Math.PI, hill, [], DT)
    }
    expect(-up.z).toBeLessThan(down.z * 0.93)
    expect(up.y).toBeCloseTo(-up.z * 0.15, 3)
  })

  it('車は箱として当たる（ボンネットを通り抜けない、横は車幅ぶんで通れる）', () => {
    const box = { x: 0, z: 0, r: 1.1, box: { heading: 0, halfLength: 2.3, halfWidth: 0.9 } }
    const flatWorld = { ...world, groundY: () => 0, resolveCircle: (x: number, z: number) => ({ x, z, hit: false, nx: 0, nz: 0 }) }
    // 車の前端（北 z=-2.3）へ東から歩いて突っ込む
    let p = createPlayer(3, -1.9, 0, flatWorld)
    for (let i = 0; i < 120; i++) p = stepOnFoot(p, input({ moveX: -1 }), 0, flatWorld, [box], DT)
    expect(p.x).toBeGreaterThanOrEqual(0.9 + FOOT_TUNING.radius - 0.02)
    // 車の横 1.3m は当たらずに通れる
    let q = createPlayer(1.3, 4, 0, flatWorld)
    for (let i = 0; i < 90; i++) q = stepOnFoot(q, input({ moveY: 1 }), 0, flatWorld, [box], DT)
    expect(q.z).toBeLessThan(0)
    expect(Math.abs(q.x - 1.3)).toBeLessThan(0.05)
  })
})

describe('gto onFoot: 乗り降り', () => {
  it('ボタンを押してもすぐには乗らない。ドアへ走り、開け、座ってから運転できる', () => {
    let s = advance(scene(), DT, {}, 0)
    expect(s.mode).toBe('foot')
    expect(s.p.boarding?.phase).toBe('approach')
    s = until(s, (c) => c.p.boarding?.phase === 'open')
    // ドアの横に立っている
    const car = s.vehicles[0]
    const door = doorPoint(car, sizeOf(car), s.p.boarding!.side)
    expect(Math.hypot(s.p.x - door.x, s.p.z - door.z)).toBeLessThan(0.3)
    expect(s.p.vehicleId).toBeNull()
    const opened = s.t
    s = until(s, (c) => c.mode === 'drive')
    expect(s.seen).toContain('enter')
    expect(s.vehicles[0].driver).toBe('player')
    s = until(s, (c) => c.mode === 'drive' && canDrive(c.p))
    // ドアが開き始めてから発進できるまで 1.6〜2.0 秒（体が座席に入ったら、脚を引き込みながらもう走り出せる）
    expect(s.t - opened).toBeGreaterThan(1.6)
    expect(s.t - opened).toBeLessThan(2.0)
    // 発進できるようになった時点では、ドアはまだ開いている（走り出しながら閉まる）
    expect(s.p.boarding?.phase).toBe('sit')
    expect(boardingPose(s.p, s.vehicles[0], sizeOf(s.vehicles[0]))?.inside).toBeGreaterThan(0.95)
    // アクセルを踏めば、ドアが閉まりきる前から車は進む
    // （乗り降りの1歩は、もう車の速さを 0 に戻さない。sim はこのあと車を入力で進める）
    const rolling = advance({ ...s, vehicles: [{ ...s.vehicles[0], speed: 3 }] }, DT * 3)
    expect(rolling.vehicles[0].speed).toBe(3)
    expect(rolling.p.boarding).not.toBeNull()
    s = until(s, (c) => c.p.boarding == null)
    // 停まったままなら、閉まったあとの間（shutHold）まで含めて終わる
    expect(s.t - opened).toBeLessThan(3.3 + BOARD_TUNING.shutHold)
    expect(s.ejected).toBe(0)
  })

  it('近い側のドアを使う（左から近づけば左のドア）', () => {
    const s = advance(scene('none', -3), DT, {}, 0)
    expect(s.p.boarding?.side).toBe(-1)
    expect(advance(scene('none', 3), DT, {}, 0).p.boarding?.side).toBe(1)
  })

  it('近づく途中でスティックを倒すと取りやめる', () => {
    let s = advance(scene('none', 3.2), DT, {}, 0)
    s = advance(s, 0.4, { moveX: 1 })
    expect(s.p.boarding ?? null).toBeNull()
    expect(s.mode).toBe('foot')
  })

  it('運転手のいる車は、降ろす動作が入って 2.3〜3.3 秒かかる', () => {
    let s = advance(scene('traffic'), DT, {}, 0)
    expect(s.vehicles[0].driver).toBe('none')
    s = until(s, (c) => c.p.boarding?.phase === 'open')
    const opened = s.t
    s = until(s, (c) => c.mode === 'drive' && canDrive(c.p))
    expect(s.seen).toContain('carjack')
    expect(s.ejected).toBe(1)
    expect(s.mode).toBe('drive')
    expect(s.t - opened).toBeGreaterThan(2.3)
    expect(s.t - opened).toBeLessThan(3.3)
  })

  it('降りるときも間がある。ドアの外へ出てから歩ける', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.mode === 'drive' && c.p.boarding == null)
    const t0 = s.t
    s = advance(s, DT, {}, 0)
    expect(s.mode).toBe('drive')
    expect(s.p.boarding?.phase).toBe('unlatch')
    s = until(s, (c) => c.mode === 'foot')
    expect(s.seen).toContain('exit')
    expect(s.vehicles[0].driver).toBe('none')
    s = until(s, (c) => c.p.boarding == null || c.p.boarding.phase === 'leave')
    // 手で押してドアが開く 0.45s ＋ 外へ出る 1.75s ＋ ドアの横に立って押して閉める 1.2s（スティックで切り上げられる）
    // （0.5 秒刻みの録画でも、押し開ける・脚を出す・上体を出す・立ち上がる・押して閉める、が別々のコマに残る）
    expect(s.t - t0).toBeGreaterThan(2.6)
    expect(s.t - t0).toBeLessThan(3.6)
    const car = s.vehicles[0]
    const r = { x: -dirOf(car.heading).z, z: dirOf(car.heading).x }
    expect(Math.abs((s.p.x - car.x) * r.x + (s.p.z - car.z) * r.z)).toBeGreaterThan(sizeOf(car).width / 2 + 0.3)
    expect(world.insideBuilding(s.p.x, s.p.z)).toBe(false)
    // 降りたあとは歩ける
    const before = { x: s.p.x, z: s.p.z }
    s = advance(s, 1, { moveY: 1 })
    expect(Math.hypot(s.p.x - before.x, s.p.z - before.z)).toBeGreaterThan(1.5)
    expect(s.p.boarding ?? null).toBeNull()
  })

  it('乗り降りの見た目: ドアは開いて閉じ、主人公は車へ沈む', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'open')
    s = advance(s, BOARD_TUNING.open * 0.9)
    const car = s.vehicles[0]
    const open = boardingPose(s.p, car, sizeOf(car))
    expect(open?.door).toBeGreaterThan(0.7)
    expect(open?.sink).toBe(0)
    s = until(s, (c) => c.p.boarding?.phase === 'sit')
    s = advance(s, BOARD_TUNING.sit * 0.9)
    const sit = boardingPose(s.p, s.vehicles[0], sizeOf(car))
    expect(sit?.sink).toBeGreaterThan(0.7)
    expect(Math.hypot(sit!.x - car.x, sit!.z - car.z)).toBeLessThan(sizeOf(car).width / 2)
    s = until(s, (c) => c.p.boarding?.phase === 'shut')
    s = advance(s, BOARD_TUNING.shut * 0.8)
    const shut = boardingPose(s.p, s.vehicles[0], sizeOf(car))
    expect(shut?.door).toBeLessThan(0.4)
    // 座った体は、ドアが閉まりきる直前まで開口越しに見えている。閉まれば描かない
    expect(shut?.visible).toBe(true)
    expect(shut?.inside).toBe(1)
    s = advance(s, BOARD_TUNING.shut * 0.19)
    expect(boardingPose(s.p, s.vehicles[0], sizeOf(car))?.visible ?? false).toBe(false)
  })

  it('ドアが閉まったあと、停まっていれば少しのあいだ同じ段階に留まる（窓越しの座った姿を見せる間）。走り出せばすぐ切り上げる', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'shut')
    s = advance(s, BOARD_TUNING.shut + BOARD_TUNING.shutHold * 0.5)
    expect(s.p.boarding?.phase).toBe('shut')
    // その間も運転はできる（操作は止めない）。ドアは閉まりきっていて、体は本当の座席
    expect(canDrive(s.p)).toBe(true)
    const held = boardingPose(s.p, s.vehicles[0], sizeOf(s.vehicles[0]))!
    expect(held.door).toBe(0)
    expect(held.inside).toBe(1)
    // 走り出したら、残りの間を早送りして切り上げる（段の画から運転の画へ、飛ばずに早く移る）
    const rolling = { ...s, vehicles: s.vehicles.map((v) => ({ ...v, speed: BOARD_TUNING.shutHoldSpeed + 1 })) }
    const rest = (BOARD_TUNING.shutHold * 0.5) / BOARD_TUNING.shutHoldRush
    expect(advance(rolling, rest * 0.5).p.boarding?.phase).toBe('shut')
    expect(advance(rolling, rest + 2 * DT).p.boarding).toBeNull()
    expect(BOARD_TUNING.shutHoldRush).toBeGreaterThanOrEqual(2)
    // 停まったままなら、間が過ぎてから乗り終える
    s = advance(s, BOARD_TUNING.shutHold * 0.5 + 2 * DT)
    expect(s.p.boarding).toBeNull()
    expect(BOARD_TUNING.shutHold * 8).toBeGreaterThanOrEqual(4)
  })
})

describe('gto onFoot: 乗り降りの途中の姿（車の外から見える中間の姿勢）', () => {
  /** 車の中心から横へどれだけ離れているか */
  const lateral = (car: VehicleState, x: number, z: number) => {
    const f = dirOf(car.heading)
    return Math.abs((x - car.x) * -f.z + (z - car.z) * f.x)
  }
  /** その段階のあいだ、車体の外（体の中心が側面から 0.1m 以上外）で屈んでいる（sink が min 以上）秒数 */
  const crouchedOutside = (from: Scene, phase: 'sit' | 'out', min: number): number => {
    let s = from
    let seconds = 0
    while (s.p.boarding?.phase === phase) {
      const car = s.vehicles[0]
      const pose = boardingPose(s.p, car, sizeOf(car))!
      if (pose.visible && pose.sink >= min && lateral(car, pose.x, pose.z) > sizeOf(car).width / 2 + 0.1) seconds += DT
      s = advance(s, DT)
    }
    return seconds
  }

  it('乗るとき: 車体の外では腰を半分までしか落とさず（地面へしゃがまない）、腰を落としながら車内へ入って座る', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'sit')
    const car = s.vehicles[0]
    // 座り始めは立ったままドアの外にいる
    const first = boardingPose(s.p, car, sizeOf(car))!
    expect(first.sink).toBeLessThan(0.1)
    expect(lateral(car, first.x, first.z)).toBeGreaterThan(sizeOf(car).width / 2 + 0.3)
    // 車体の外で深く屈んだ姿（腰を 7 割以上落とした姿）は無い。浅く屈んだ姿は 0.2 秒以上ある
    expect(crouchedOutside(s, 'sit', 0.7)).toBe(0)
    expect(crouchedOutside(s, 'sit', 0.15)).toBeGreaterThan(0.2)
    // 体は 0.4 秒以上かけて、車体の側面から座席まで横へ入っていく（真下へ沈んで消えない）
    let crossing = 0
    for (let c = s; c.p.boarding?.phase === 'sit'; c = advance(c, DT)) {
      const pose = boardingPose(c.p, c.vehicles[0], sizeOf(car))!
      if (pose.inside > 0.05 && pose.inside < 0.95) crossing += DT
    }
    expect(crossing).toBeGreaterThan(0.4)
    // 最後は座席（車体の中）
    s = advance(s, BOARD_TUNING.sit - 2 * DT)
    const last = boardingPose(s.p, s.vehicles[0], sizeOf(car))!
    expect(last.sink).toBeGreaterThan(0.95)
    expect(lateral(car, last.x, last.z)).toBeLessThan(sizeOf(car).width / 2 - 0.2)
  })

  it('乗るとき: ドアを開けるあいだから斜め前を向いていて、座るまでに向きが大きく切り替わらない', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'open')
    const car = s.vehicles[0]
    let prev = boardingPose(s.p, car, sizeOf(car))!.heading
    // 立っているときの向きは、車の前から 45° 以内
    expect(Math.abs(angleDiff(car.heading, prev))).toBeLessThan(Math.PI / 4 + 0.01)
    let worst = 0
    while (s.p.boarding?.phase === 'open' || s.p.boarding?.phase === 'sit') {
      s = advance(s, 1 / 8)
      const pose = boardingPose(s.p, s.vehicles[0], sizeOf(car))
      if (!pose) break
      worst = Math.max(worst, Math.abs(angleDiff(prev, pose.heading)))
      prev = pose.heading
    }
    // 1/8 秒のコマのあいだに 25° 以上は回らない
    expect(worst).toBeLessThan(0.45)
  })

  it('乗るとき: 体が車の前のほうへ向く（座る向きへ回る）', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'sit')
    const car = s.vehicles[0]
    const f = dirOf(car.heading)
    const facing = (c: Scene) => {
      const d = dirOf(boardingPose(c.p, c.vehicles[0], sizeOf(car))!.heading)
      return d.x * f.x + d.z * f.z
    }
    const before = facing(s)
    s = advance(s, BOARD_TUNING.sit * 0.9)
    expect(facing(s)).toBeGreaterThan(before + 0.05)
    expect(facing(s)).toBeGreaterThan(0.99)
  })

  it('降りるとき: 座った姿（車体の中）から始まり、体が横へ出てから立ち、ドアの外に立つ', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.mode === 'drive' && c.p.boarding == null)
    s = until(advance(s, DT, {}, 0), (c) => c.p.boarding?.phase === 'out')
    const car = s.vehicles[0]
    const first = boardingPose(s.p, car, sizeOf(car))!
    expect(first.sink).toBeGreaterThan(0.95)
    expect(lateral(car, first.x, first.z)).toBeLessThan(sizeOf(car).width / 2)
    expect(first.visible).toBe(true)
    expect(first.inside).toBeGreaterThan(0.95)
    // 地面にしゃがんだ姿では現れない
    expect(crouchedOutside(s, 'out', 0.7)).toBe(0)
    expect(crouchedOutside(s, 'out', 0.15)).toBeGreaterThan(0.2)
    s = advance(s, BOARD_TUNING.out - 2 * DT)
    const last = boardingPose(s.p, s.vehicles[0], sizeOf(car))!
    const door = doorPoint(car, sizeOf(car), s.p.boarding!.side)
    expect(last.sink).toBeLessThan(0.05)
    expect(Math.hypot(last.x - door.x, last.z - door.z)).toBeLessThan(0.1)
  })
})

describe('gto onFoot: 降りるときのカメラの相手と、ドアの側', () => {
  /** 乗って、降りるボタンを押した直後まで進める */
  const exiting = (base: Scene = scene()): Scene => advance(until(advance(base, DT, {}, 0), (c) => c.mode === 'drive' && c.p.boarding == null), DT, {}, 0)

  it('降りた車は、カメラが落ち着くまでよける相手から外す。しばらくしたら戻す', () => {
    let s = until(exiting(), (c) => c.p.boarding?.phase === 'leave')
    const id = s.vehicles[0].id
    expect(crowdExempt(s.p)).toBe(id)
    s = until(s, (c) => c.p.boarding == null)
    expect(crowdExempt(s.p)).toBe(id)
    s = advance(s, BOARD_TUNING.settle * 0.5)
    expect(crowdExempt(s.p)).toBe(id)
    s = advance(s, BOARD_TUNING.settle * 0.6)
    expect(crowdExempt(s.p)).toBeNull()
  })

  it('ふだんの歩きでは、カメラの相手は主人公そのもので、段は無い', () => {
    const s = scene()
    const sub = cameraSubject(s.p, s.mode, s.vehicles)
    expect(sub).toEqual({ x: s.p.x, y: s.p.y, z: s.p.z, heading: s.p.heading, speed: s.p.speed, mode: 'foot' })
    expect(crowdExempt(createPlayer(ROAD.x, ROAD.z, 0, world))).toBeNull()
  })

  it('運転席の側に別の車が並んでいたら、反対のドアから降りる（車の中へ出ない）', () => {
    const base = scene()
    const car = base.vehicles[0]
    const f = dirOf(car.heading)
    const gap = sizeOf(car).width + 0.3
    const beside = createVehicle(2, 'sedan', car.x - f.z * gap, car.z + f.x * gap, car.heading, world)
    // 乗るのは左から（右は塞がっている）
    let s = advance({ ...scene('none', -3), vehicles: [car, beside] }, DT, {}, 0)
    s = until(s, (c) => c.mode === 'drive' && c.p.boarding == null)
    s = advance(s, DT, {}, 0)
    expect(s.p.boarding?.side).toBe(-1)
    // 右が空いていれば右
    expect(exiting().p.boarding?.side).toBe(1)
  })

  it('両側に車が並んでいたら、後ろへ降りる', () => {
    const base = scene()
    const car = base.vehicles[0]
    const f = dirOf(car.heading)
    const gap = sizeOf(car).width + 0.3
    const right = createVehicle(2, 'sedan', car.x - f.z * gap, car.z + f.x * gap, car.heading, world)
    const left = createVehicle(3, 'sedan', car.x + f.z * gap, car.z - f.x * gap, car.heading, world)
    const seated: Scene = { ...base, mode: 'drive', p: { ...base.p, x: car.x, z: car.z, vehicleId: car.id }, vehicles: [{ ...car, driver: 'player' }, right, left] }
    const s = advance(seated, DT, {}, 0)
    expect(s.p.boarding?.phase).toBe('unlatch')
    expect(s.p.boarding?.side).toBe(0)
  })
})

describe('gto sim: 乗り降りの統合', () => {
  it('座るまで車は動かず、座ったら走り出せる', () => {
    let s = start({ seed: 3, stage: { parkedAhead: true } }, { maxVehicles: 0, maxPeds: 0, outfitKeys: ['a', 'b'] })
    const car0 = s.vehicles[0]
    s = run(s, 0.5, { moveY: 1 })
    s = run(s, DT, { enter: true })
    expect(s.mode).toBe('foot')
    expect(s.player.boarding?.phase).toBe('approach')
    s = run(s, 4.6, {})
    expect(s.mode).toBe('drive')
    expect(s.player.boarding ?? null).toBeNull()
    expect(Math.hypot(s.vehicles[0].x - car0.x, s.vehicles[0].z - car0.z)).toBeLessThan(0.3)
    s = run(s, 2, { moveY: 1 })
    expect(Math.abs(s.player.speed)).toBeGreaterThan(3)
  })
})

describe('gto onFoot: 乗り降りの段（カメラは車の斜め後ろ外側に留まる。camera.ts へ渡す効き）', () => {
  const stageOf = (c: Scene) => cameraSubject(c.p, c.mode, c.vehicles).stage
  const kOf = (c: Scene) => stageOf(c)?.k ?? 0

  it('相手の点はいつも主人公（運転中は車）そのもの。段は相手の車の中心・向き・幅と、使うドアの側を添えるだけ', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'open')
    const car = s.vehicles[0]
    const sub = cameraSubject(s.p, s.mode, s.vehicles)
    expect(sub.x).toBe(s.p.x)
    expect(sub.z).toBe(s.p.z)
    expect(sub.mode).toBe('foot')
    expect(sub.stage).toEqual({ x: car.x, y: car.y, z: car.z, heading: car.heading, width: sizeOf(car).width, side: s.p.boarding!.side, k: 1 })
    s = until(s, (c) => c.p.boarding?.phase === 'sit')
    expect(cameraSubject(s.p, s.mode, s.vehicles).mode).toBe('drive')
    expect(cameraSubject(s.p, s.mode, s.vehicles).x).toBe(s.p.x)
  })

  it('乗る: ドアへ近づくあいだに入り、開ける・座る・閉めるあいだは満額。閉まったあとの間の後半で抜け、乗り終えたら段は無い', () => {
    // 遠くから走り出した直後は背後カメラのまま
    let s = advance(scene('none', 3.4), DT, {}, 0)
    expect(s.p.boarding?.phase).toBe('approach')
    expect(kOf(s)).toBeLessThan(0.05)
    let last = kOf(s)
    const phases = new Map<string, number[]>()
    while (s.p.boarding != null && s.t < 12) {
      s = advance(s, DT)
      const k = kOf(s)
      // 1コマで効きが飛ばない（カメラが切り替わって見えない）
      expect(Math.abs(k - last)).toBeLessThan(0.12)
      last = k
      const ph = s.p.boarding?.phase
      if (ph) phases.set(ph, [...(phases.get(ph) ?? []), k])
    }
    for (const ph of ['open', 'sit']) expect(Math.min(...phases.get(ph)!)).toBe(1)
    const shut = phases.get('shut')!
    // ドアが閉まりきるまで（shut 秒）は満額
    expect(Math.min(...shut.slice(0, Math.floor(BOARD_TUNING.shut / DT)))).toBe(1)
    expect(shut[shut.length - 1]).toBeLessThan(0.05)
    expect(stageOf(s)).toBeUndefined()
  })

  it('降りる: ドアが開き始めたら入り、体が出る・ドアを閉めるあいだは満額。歩けるようになってから settle 秒で抜ける', () => {
    let s = until(advance(scene(), DT, {}, 0), (c) => c.mode === 'drive' && c.p.boarding == null)
    s = advance(s, DT, {}, 0)
    expect(s.p.boarding?.phase).toBe('unlatch')
    const side = s.p.boarding!.side
    expect(kOf(s)).toBeLessThan(0.05)
    let last = kOf(s)
    const phases = new Map<string, number[]>()
    while (s.p.boarding != null && s.t < 12) {
      s = advance(s, DT)
      const k = kOf(s)
      expect(Math.abs(k - last)).toBeLessThan(0.12)
      last = k
      const ph = s.p.boarding?.phase
      if (ph) phases.set(ph, [...(phases.get(ph) ?? []), k])
    }
    // 体が出はじめる前（座ったままの間 outHold のうち）に満額になっている
    const out = phases.get('out')!
    expect(out[Math.ceil(BOARD_TUNING.outHold / DT)]).toBe(1)
    expect(Math.min(...phases.get('leave')!)).toBe(1)
    // 歩けるようになった直後は満額のまま、同じ側のドアを向いたまま抜けていく
    expect(kOf(s)).toBeGreaterThan(0.95)
    expect(stageOf(s)?.side).toBe(side)
    s = advance(s, BOARD_TUNING.settle * 0.5)
    expect(kOf(s)).toBeGreaterThan(0.2)
    expect(kOf(s)).toBeLessThan(0.8)
    s = advance(s, BOARD_TUNING.settle * 0.5 + 2 * DT)
    expect(stageOf(s)).toBeUndefined()
  })

  it('座りかけ・ドアを閉めている最中に走り出したら、速さに沿って段を抜く（走る車に斜め後ろの画が貼り付かない。乗り終えた瞬間に飛ばない）', () => {
    const s = until(advance(scene(), DT, {}, 0), (c) => c.p.boarding?.phase === 'shut')
    const at = (speed: number) => kOf({ ...s, vehicles: s.vehicles.map((v) => ({ ...v, speed })) })
    expect(at(0)).toBe(1)
    expect(at(BOARD_TUNING.shutHoldSpeed)).toBe(1)
    const mid = at(BOARD_TUNING.shutHoldSpeed + BOARD_TUNING.stageRollOff * 0.5)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(at(BOARD_TUNING.shutHoldSpeed + BOARD_TUNING.stageRollOff)).toBe(0)
    expect(at(-(BOARD_TUNING.shutHoldSpeed + BOARD_TUNING.stageRollOff))).toBe(0)
    // 降りるときは、転がっていても段を保つ（停まりながら降りる）
    let out = until(advance(scene(), DT, {}, 0), (c) => c.mode === 'drive' && c.p.boarding == null)
    out = until(advance(out, DT, {}, 0), (c) => c.p.boarding?.phase === 'out')
    out = advance(out, BOARD_TUNING.outHold + 0.2)
    expect(kOf({ ...out, vehicles: out.vehicles.map((v) => ({ ...v, speed: 6 })) })).toBe(1)
  })

  it('乗り始めから発進まで・降り始めから歩き出すまで、カメラは 1 コマも車体へめり込まず、一気に飛ばない', () => {
    let s = advance(scene(), DT, {}, 0)
    let cam = createCamera(cameraSubject(s.p, s.mode, s.vehicles))
    const car = s.vehicles[0]
    const size = sizeOf(car)
    const f = dirOf(car.heading)
    /** カメラから車体の箱までの水平距離 */
    const gap = () => {
      const fw = (cam.x - car.x) * f.x + (cam.z - car.z) * f.z
      const rt = (cam.x - car.x) * -f.z + (cam.z - car.z) * f.x
      return Math.hypot(Math.max(0, Math.abs(fw) - size.length / 2), Math.max(0, Math.abs(rt) - size.width / 2))
    }
    let prev = cam
    const tick = (press = false) => {
      s = advance(s, DT, {}, press ? 0 : -1)
      cam = stepCamera(cam, cameraSubject(s.p, s.mode, s.vehicles), input(), world, DT)
      expect(gap()).toBeGreaterThan(1)
      expect(Math.hypot(cam.x - prev.x, cam.y - prev.y, cam.z - prev.z)).toBeLessThan(0.4)
      prev = cam
    }
    while (s.p.boarding != null && s.t < 12) tick()
    expect(s.mode).toBe('drive')
    for (let i = 0; i < 60; i++) tick()
    tick(true)
    while (s.p.boarding != null && s.t < 20) tick()
    expect(s.mode).toBe('foot')
    for (let i = 0; i < 90; i++) tick()
    // 落ち着けばふだんの徒歩の背後カメラ
    expect(cam.dist).toBeCloseTo(CAMERA_TUNING.foot.dist, 0)
  })
})

describe('gto onFoot: 車のドアの枠と体の位置（車の担当のドア部品と噛み合う）', () => {
  // 戦車と飛行機（裏コードの乗り物）にはドアが無いので、ここでは見ない
  const KINDS = (Object.keys(VEHICLE_SPECS) as (keyof typeof VEHICLE_SPECS)[]).filter(isCar)
  /** 車を原点に北向き（前が −z）で置く。車体の座標と世界の座標が一致する */
  const carOf = (kind: (typeof KINDS)[number]): VehicleState => ({ ...createVehicle(1, kind, ROAD.x, ROAD.z, 0, world) })
  /** 世界の点を、車体の座標（右が ＋x・後ろが ＋z）へ */
  const local = (car: VehicleState, x: number, z: number) => {
    const f = dirOf(car.heading)
    return { x: (x - car.x) * -f.z + (z - car.z) * f.x, z: -((x - car.x) * f.x + (z - car.z) * f.z) }
  }

  it('ドアの枠の表は、車の担当の寸法（cabinLayout）と一致する', () => {
    for (const kind of KINDS) {
      const spec = VEHICLE_SPECS[kind]
      const cabin = cabinLayout(spec, VEHICLE_LOOK[kind])
      expect(DOOR_FRAME[kind].hinge * spec.length).toBeCloseTo(cabin.door.hingeZ, 2)
      expect(DOOR_FRAME[kind].rear * spec.length).toBeCloseTo(cabin.door.rearZ, 2)
      const frame = doorFrame(carOf(kind), spec)
      expect(-frame.seatFw).toBeCloseTo(cabin.seat.z, 2)
      expect(frame.seatOut).toBeCloseTo(cabin.seat.x, 1)
    }
  })

  it('ドアの外で待つ位置は、どの車種でもドアの後ろの端の外。開くドアの弧に体が掛からない', () => {
    for (const kind of KINDS) {
      const spec = VEHICLE_SPECS[kind]
      const car = carOf(kind)
      const cabin = cabinLayout(spec, VEHICLE_LOOK[kind])
      for (const side of [1, -1] as const) {
        const d = doorPoint(car, spec, side)
        const q = local(car, d.x, d.z)
        expect(q.x * side).toBeGreaterThan(spec.width / 2 + 0.3)
        expect(q.z).toBeGreaterThan(cabin.door.rearZ)
        // ヒンジからの距離が、ドアの長さ＋体の半径より大きい
        const reach = Math.hypot(q.x * side - cabin.door.halfBelt, q.z - cabin.door.hingeZ)
        expect(reach).toBeGreaterThan(cabin.door.rearZ - cabin.door.hingeZ + 0.2)
      }
    }
  })

  it('屈むのはドアの開口の前（開いたドアと車体のあいだ）。開いたドアの板に体が重ならない', () => {
    for (const kind of KINDS) {
      const spec = VEHICLE_SPECS[kind]
      const car = carOf(kind)
      const cabin = cabinLayout(spec, VEHICLE_LOOK[kind])
      const p0 = createPlayer(car.x + spec.width / 2 + 1, car.z, 0, world)
      for (const phase of ['sit', 'out'] as const) {
        for (let i = 0; i <= 20; i++) {
          const span = phase === 'sit' ? BOARD_TUNING.sit : BOARD_TUNING.out
          const p = { ...p0, boarding: { phase, vehicleId: car.id, side: 1 as const, t: (span * i) / 20, jack: false } }
          const pose = boardingPose(p, car, spec)!
          const q = local(car, pose.x, pose.z)
          if (pose.sink < 0.5 || q.x < spec.width / 2) continue
          // 開口の前後の範囲にいる
          expect(q.z).toBeGreaterThan(cabin.door.hingeZ + 0.3)
          expect(q.z).toBeLessThan(cabin.door.rearZ + 0.1)
          // 開いたドアの板（ヒンジから伸びる線分）から 0.25m 以上離れている
          const a = doorSwing(pose.door)
          const len = cabin.door.rearZ - cabin.door.hingeZ
          const rx = q.x - cabin.door.halfBelt
          const rz = q.z - cabin.door.hingeZ
          const along = clamp01((rx * Math.sin(a) + rz * Math.cos(a)) / len) * len
          expect(Math.hypot(rx - Math.sin(a) * along, rz - Math.cos(a) * along)).toBeGreaterThan(0.25)
        }
      }
    }
  })

  it('乗る側も降りる側も、8fps のコマで「立った姿でも座りきった姿でもない途中の姿」が4コマ以上あり、うち体が車体の面をまたいでいるコマが2コマ以上ある', () => {
    const spec = VEHICLE_SPECS.sedan
    const car = carOf('sedan')
    const p0 = createPlayer(car.x + 2, car.z, 0, world)
    for (const phase of ['sit', 'out'] as const) {
      const span = phase === 'sit' ? BOARD_TUNING.sit : BOARD_TUNING.out
      let frames = 0
      let straddling = 0
      for (let t = 0.03; t < span; t += 1 / 8) {
        const pose = boardingPose({ ...p0, boarding: { phase, vehicleId: car.id, side: 1, t, jack: false } }, car, spec)!
        const q = local(car, pose.x, pose.z)
        if (pose.visible && pose.sink > 0.1 && pose.sink < 0.97) frames += 1
        // 体の幅（肩幅の半分 0.22m）が車体の側面に掛かっている
        if (pose.visible && Math.abs(q.x - spec.width / 2) < 0.22) straddling += 1
      }
      expect(frames).toBeGreaterThanOrEqual(4)
      expect(straddling).toBeGreaterThanOrEqual(2)
    }
  })

  it('座りきるまで主人公は描かれ、座りきった位置は座席（車体の中）', () => {
    const spec = VEHICLE_SPECS.sedan
    const car = carOf('sedan')
    const p0 = createPlayer(car.x + 2, car.z, 0, world)
    const end = boardingPose({ ...p0, boarding: { phase: 'sit', vehicleId: car.id, side: 1, t: BOARD_TUNING.sit - 0.01, jack: false } }, car, spec)!
    expect(end.visible).toBe(true)
    // 座った体を描くのは、開口越しに見える深さ（側面から 0.2〜0.5m 内側）
    expect(local(car, end.x, end.z).x).toBeLessThan(spec.width / 2 - 0.2)
    expect(local(car, end.x, end.z).x).toBeGreaterThan(spec.width / 2 - 0.5)
    // 降り始め（ドアが開きかけ）にも、座った体が描かれる
    const start = boardingPose({ ...p0, boarding: { phase: 'unlatch', vehicleId: car.id, side: 1, t: BOARD_TUNING.unlatch * 0.8, jack: false } }, car, spec)!
    expect(start.visible).toBe(true)
    expect(start.inside).toBe(1)
  })
})

describe('運転中に窓越しに見せる体の位置', () => {
  it('ドアが閉まりきったときの位置・向きと同じ（閉まった瞬間に体が跳ばない）。開いているあいだより車の内側で、左のドアなら左の席', () => {
    const spec = VEHICLE_SPECS.sedan
    const car: VehicleState = { ...createVehicle(1, 'sedan', ROAD.x, ROAD.z, 0.7, world), driver: 'player' }
    const p0 = createPlayer(car.x, car.z, 0, world)
    const f = dirOf(car.heading)
    const out = (q: { x: number; z: number }) => (q.x - car.x) * -f.z + (q.z - car.z) * f.x
    for (const side of [1, -1] as const) {
      const at = (phase: 'shut' | 'unlatch', t: number) => boardingPose({ ...p0, boarding: { phase, vehicleId: car.id, side, t, jack: false } }, car, spec)!
      const seat = drivingSeat(car, spec, side)
      for (const end of [at('shut', BOARD_TUNING.shut), at('unlatch', 0)]) {
        expect(seat.x).toBeCloseTo(end.x, 6)
        expect(seat.z).toBeCloseTo(end.z, 6)
      }
      expect(seat.heading).toBeCloseTo(car.heading, 6)
      // 肩幅の半分（0.22m）を足しても、車体の側面より内側
      expect(out(seat) * side + 0.22).toBeLessThan(spec.width / 2 - 0.1)
      // ドアが開いているあいだは開口寄り（座りきったときの位置とつながる）
      const open = at('shut', 0)
      const sat = boardingPose({ ...p0, boarding: { phase: 'sit', vehicleId: car.id, side, t: BOARD_TUNING.sit, jack: false } }, car, spec)!
      expect(open.x).toBeCloseTo(sat.x, 6)
      expect(out(open) * side).toBeGreaterThan(out(seat) * side + 0.1)
      expect(out(seat) * side).toBeGreaterThan(0.2)
    }
  })

  it('乗り込みは、8fps の録画で各段が複数コマに残る長さ（開ける 3 コマ・座る 10 コマ以上・閉める 3 コマ以上）で、全体は 3.2 秒以内', () => {
    expect(BOARD_TUNING.open * 8).toBeGreaterThanOrEqual(3)
    expect(BOARD_TUNING.sit * 8).toBeGreaterThanOrEqual(10)
    expect(BOARD_TUNING.shut * 8).toBeGreaterThanOrEqual(3)
    expect(BOARD_TUNING.open + BOARD_TUNING.sit + BOARD_TUNING.shut).toBeLessThanOrEqual(3.2)
  })
})

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
