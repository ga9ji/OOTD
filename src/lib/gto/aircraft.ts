// Grand Theft Outfit [部品: cheats] 飛行機の飛び方（裏コードで出す乗り物。lib/gto/cheats.ts）。
// 入口: stepRide(v, control, world, dt)（車も飛行機もこれで 1 歩進める） / stepAircraft / flying(v) / PLANE_TUNING
// 契約: 地上では車と同じ（vehicle.ts の stepVehicle で滑走する）。離陸できる速さで「上昇」を入れると浮く。
//       空では、アクセルで速さ、左右で旋回、上昇・下降で高さを変える。何も入れなければ水平のまま、少しずつ遅くなる。
//       失速の速さを下回ると高さを保てずに沈む。地面に触れたら着地して、また車として走る。
//       下降を入れたまま地面へ近づくと、沈む速さがゆるんでそっと着く。失速して落ちたときだけ、衝突として知らせる。
//       建物は、屋根より上なら越えられ、屋根より下で入ろうとすると壁として跳ね返される。
//       真上から降りてきたときは屋根の少し上で止まる（屋根には降りられない。降りた主人公が建物の中に立つことになるので）。
//       街の範囲の端へ近づくと、内側へ向きを戻される。高架・橋・クレーンには当たらない（すり抜ける）。
//       状態は VehicleState の alt（地面からの高さ）と climb（上下の速さ）。飛んでいるあいだ y は「地面＋alt」。
import { angleDiff, approach, clamp, dirOf, headingOf, lerp } from './math'
import type { GtoEvent, GtoWorld, VehicleControl, VehicleState } from './types'
import { stepVehicle, VEHICLE_SPECS } from './vehicle'

/** 手触りを決める数字 */
export const PLANE_TUNING = {
  /** 浮き上がれる速さ m/s（72km/h）と、これを下回ると高さを保てなくなる速さ m/s */
  takeoff: 20,
  stall: 15,
  /** 上昇・下降の速さ m/s と、失速しきったときに沈む速さ m/s、上下の速さの付き方 m/s² */
  climbRate: 15,
  sinkRate: 12,
  stallSink: 8,
  liftAccel: 16,
  /** 地面からの高さの上限 m（いちばん高い塔は 230m） */
  ceiling: 280,
  /** 空での旋回 rad/s と、その付き方 rad/s² */
  turnRate: 0.95,
  turnAccel: 2.6,
  /** 空での加速（地上の加速に対する割合）、ブレーキを入れたときの減速 m/s²、何も入れないときの減速 m/s² */
  airAccel: 0.8,
  airBrake: 9,
  glide: 1.4,
  /** ブレーキで落とせる速さの下限 m/s（ここまで落とすと沈んで降りられる） */
  minSpeed: 9,
  /** 地面が近づくと、下降をゆるめる（この高さ m から下で、沈む速さをここ m/s まで落とす）。下降を入れたままでも、そっと着く */
  flareHeight: 14,
  flareSink: 3,
  /** 屋根の上を通るときに空ける高さ m */
  roofGap: 2,
  /** 壁に当たったときに跳ね返る割合 */
  bounce: 0.25,
  /** これより速く沈んで地面に着いたら、衝突として知らせる m/s */
  hardLanding: 6.5,
  /** 街の範囲の端からこの距離で向きを戻し始める m */
  edge: 70,
  /** ほかの車・人に当たらなくなる高さ m */
  clear: 3,
}

/** 飛んでいる（車輪が地面から離れている）か */
export const flying = (v: Pick<VehicleState, 'alt'>): boolean => (v.alt ?? 0) > 0

/** ほかの車・人の頭の上を飛んでいるか（当たり判定から外す高さ） */
export const overhead = (v: Pick<VehicleState, 'alt'>): boolean => (v.alt ?? 0) > PLANE_TUNING.clear

/** 車も飛行機も、これで 1 歩進める */
export function stepRide(v: VehicleState, control: VehicleControl, world: GtoWorld, dt: number): { vehicle: VehicleState; events: GtoEvent[] } {
  return v.kind === 'plane' ? stepAircraft(v, control, world, dt) : stepVehicle(v, control, world, dt)
}

export function stepAircraft(v: VehicleState, control: VehicleControl, world: GtoWorld, dt: number): { vehicle: VehicleState; events: GtoEvent[] } {
  const T = PLANE_TUNING
  const spec = VEHICLE_SPECS[v.kind]
  const lift = clamp(control.lift ?? 0, -1, 1)

  // ---- 地上: 車として滑走する。離陸できる速さで上昇を入れたら浮く ----
  if (!flying(v)) {
    const rolled = stepVehicle(v, { ...control, handbrake: false }, world, dt)
    const car = rolled.vehicle
    if (car.speed >= T.takeoff && lift > 0) {
      return { vehicle: { ...car, slip: 0, alt: 0.05, climb: T.climbRate * 0.3, y: car.y + 0.05 }, events: rolled.events }
    }
    return { vehicle: { ...car, alt: 0, climb: 0 }, events: rolled.events }
  }

  const events: GtoEvent[] = []
  // ---- 速さ ----
  let speed = v.speed
  if (control.brake > 0) speed = approach(speed, T.minSpeed, T.airBrake * control.brake * dt)
  else if (control.throttle > 0) speed += spec.accel * T.airAccel * control.throttle * (1 - Math.pow(Math.max(0, speed) / spec.maxSpeed, 2)) * dt
  else speed = approach(speed, 0, T.glide * dt)
  speed = clamp(speed, -4, spec.maxSpeed)

  // ---- 向き: 左右で旋回。街の範囲の端では、内側へ戻す ----
  const b = world.bounds
  const toEdge = Math.min(v.x - b.minX, b.maxX - v.x, v.z - b.minZ, b.maxZ - v.z)
  const back = clamp(1 - toEdge / T.edge, 0, 1)
  const home = clamp(angleDiff(v.heading, headingOf((b.minX + b.maxX) / 2 - v.x, (b.minZ + b.maxZ) / 2 - v.z)) * 2, -1, 1)
  const steer = lerp(clamp(control.steer, -1, 1), home, back)
  const yawRate = approach(v.yawRate, steer * T.turnRate, T.turnAccel * dt)
  const heading = v.heading + yawRate * dt

  // ---- 高さ: 上昇・下降。遅いと上がれず、失速すると沈む ----
  const authority = clamp((speed - T.stall) / (T.takeoff - T.stall), 0, 1)
  const stalled = clamp((T.stall - speed) / (T.stall * 0.5), 0, 1)
  const sink = lerp(T.flareSink, T.sinkRate, clamp((v.alt ?? 0) / T.flareHeight, 0, 1))
  const asked = lift > 0 ? T.climbRate * lift * authority : sink * lift
  let climb = approach(v.climb ?? 0, stalled > 0 ? Math.min(asked, -T.stallSink * stalled) : asked, T.liftAccel * dt)

  // ---- 動かす ----
  const f = dirOf(heading)
  let x = clamp(v.x + f.x * speed * dt, b.minX + 2, b.maxX - 2)
  let z = clamp(v.z + f.z * speed * dt, b.minZ + 2, b.maxZ - 2)
  let y = v.y + climb * dt

  // ---- 建物: 屋根より上なら越える。屋根より下で入ろうとしたら壁 ----
  const roof = world.roofY(x, z)
  if (y < roof + T.roofGap) {
    if (world.roofY(v.x, v.z) === roof) {
      // もう上にいた建物へ降りてきた: 屋根の少し上で止める
      y = roof + T.roofGap
      climb = Math.max(0, climb)
    } else {
      // 横から入ろうとした: 元の場所へ戻して跳ね返す
      events.push({ type: 'crash', x, z, value: Math.abs(speed), ref: String(v.id) })
      x = v.x
      z = v.z
      speed = -speed * T.bounce
    }
  }

  // ---- 地面と、高さの上限 ----
  const ground = world.groundY(x, z)
  if (y > ground + T.ceiling) {
    y = ground + T.ceiling
    climb = Math.min(0, climb)
  }
  if (y <= ground) {
    // 着地: ここからは車として走る。強く落ちたら衝突として知らせる
    if (-climb > T.hardLanding) events.push({ type: 'crash', x, z, value: -climb, ref: String(v.id) })
    return { vehicle: { ...v, x, y: ground, z, heading, speed, slip: 0, yawRate, steer, accel: (speed - v.speed) / dt, alt: 0, climb: 0 }, events }
  }
  return { vehicle: { ...v, x, y, z, heading, speed, slip: 0, yawRate, steer, accel: (speed - v.speed) / dt, alt: y - ground, climb }, events }
}
