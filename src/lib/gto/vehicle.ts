// Grand Theft Outfit [部品: vehicle] 車の挙動。
// 入口: VEHICLE_SPECS / VEHICLE_TUNING / createVehicle / controlFromInput / stepVehicle / collideVehicles
// 契約: 車1台と操作（VehicleControl）と世界を受け取り、次の車と起きたこと（衝突）を返す。
//       誰が運転しているか（プレイヤー・警察・乗り捨て）は問わない。交通の車は traffic.ts が動かす。
//
// 手触りの作り:
//   ・舵は入力に遅れて切れ（steerIn）、車体の回る速さ（yawRate）は舵にさらに遅れて付いてくる（yawResponse）。
//   ・回る速さの上限は「タイヤの踏ん張り ÷ 速さ」。上限を少し超えて回すので、切り続けると外へ滑る。
//   ・速度は車体の前後（speed）と横（slip）に分けて持つ。向きを変えるたびに分け直すので、
//     向きだけ先に回ると横の成分が残り、それがドリフトになる。横の成分は踏ん張り（grip）で消える。
//   ・滑っているあいだは回る勢いが残る（yawResponse が弱まる）。衝突で振られた向きもこれで尾を引く。
//   ・滑りながら舵とアクセルを入れ続けると踏ん張りが戻らず（powerGrip）、斜めを向いたまま弧を描く。
//     斜めを向きすぎると舵の効きが弱まり（driftEase）、サイドブレーキを引かない限り回り切らない。
//   ・壁には前後の大きな円と四隅の小さな円で当たる（角が壁へめり込まない）。街灯・信号柱・街路樹の幹
//     （vehiclePoles.ts）には車体の長方形で当たり、止められて跳ね返る。当たった強さは損傷（vehicleDamage.ts）に積む。
//   ・当たった車は弾き返され、当たった点を軸に向きを振られる。輪ごと跳ねる・部品が落ちる（vehicleCrash.ts）は、
//     描画が速度の急な変化を見て作る（状態には持たない）。
import { approach, clamp, dirOf, lerp } from './math'
import type { CarKind, GtoEvent, GtoWorld, InputFrame, SpecialKind, VehicleControl, VehicleKind, VehicleState } from './types'
import { applyImpact } from './vehicleDamage'
import { hitPole, polesNear } from './vehiclePoles'

export interface VehicleSpec {
  length: number
  width: number
  height: number
  wheelbase: number
  /** 最高速 m/s */
  maxSpeed: number
  /** 発進の加速 m/s²（最高速に近づくほど弱まる） */
  accel: number
  /** 制動 m/s² */
  brake: number
  reverseMax: number
  /** 横の踏ん張り m/s²（大きいほど滑らない） */
  grip: number
  /** 最大の舵角（ラジアン） */
  steerMax: number
  /** 重さ kg（衝突で押し負けるかどうか） */
  mass: number
  /** [cheats] 履帯: 舵だけで向きを変える速さ rad/s（止まっていてもその場で回る）。無ければタイヤの車 */
  pivot?: number
  /** [cheats] 装甲: 当たっても凹まず、壊れない。街灯や街路樹にも止められない（押しのけて進む） */
  armor?: boolean
}

// 加速は v = max·tanh(accel·t / max) になる。9 割に届く時間は 1.47·max / accel 秒。
// セダン 4.2 秒・警察 3.7 秒・タクシー 4.9 秒・軽 4.9 秒・バン 5.7 秒（バーの実測: セダン 3〜5 秒）。
export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: { length: 4.6, width: 1.8, height: 1.42, wheelbase: 2.7, maxSpeed: 32, accel: 11.2, brake: 17, reverseMax: 9, grip: 19, steerMax: 0.6, mass: 1400 },
  kei: { length: 3.4, width: 1.48, height: 1.62, wheelbase: 2.45, maxSpeed: 26, accel: 7.8, brake: 15, reverseMax: 8, grip: 17, steerMax: 0.66, mass: 900 },
  taxi: { length: 4.4, width: 1.7, height: 1.72, wheelbase: 2.75, maxSpeed: 30, accel: 9, brake: 15, reverseMax: 9, grip: 17, steerMax: 0.6, mass: 1500 },
  van: { length: 5.2, width: 1.9, height: 2.1, wheelbase: 3.1, maxSpeed: 27, accel: 7, brake: 13, reverseMax: 8, grip: 15, steerMax: 0.55, mass: 2100 },
  police: { length: 4.7, width: 1.8, height: 1.46, wheelbase: 2.75, maxSpeed: 35, accel: 13.8, brake: 18, reverseMax: 10, grip: 20, steerMax: 0.6, mass: 1600 },
  // [cheats] 裏コードで出す乗り物（lib/gto/cheats.ts）。形は専用（components/gto/renderSpecials.ts）
  // 戦車: 遅くて重い。履帯なのでその場で回り、横へは滑らない。ほかの車は押しのける
  tank: { length: 6.4, width: 3.1, height: 2.4, wheelbase: 3.8, maxSpeed: 13, accel: 5.5, brake: 16, reverseMax: 6, grip: 40, steerMax: 0.5, mass: 30000, pivot: 1.15, armor: true },
  // 飛行機: 幅は胴体と脚のぶんだけ（翼は当たり判定に入れない。道幅より広いので、入れると走れない）。飛び方は aircraft.ts
  plane: { length: 7.2, width: 2, height: 2.5, wheelbase: 2.2, maxSpeed: 52, accel: 12, brake: 14, reverseMax: 3, grip: 24, steerMax: 0.5, mass: 900 },
}

/** [cheats] 裏コードで出す乗り物か（専用の形で描き、ドアの演技なしで乗り降りする） */
export const isSpecial = (kind: VehicleKind): kind is SpecialKind => kind === 'tank' || kind === 'plane'
/** ふつうの車か（ドア・車室のある形で描く） */
export const isCar = (kind: VehicleKind): kind is CarKind => !isSpecial(kind)

/** 手触りを決める数字 */
export const VEHICLE_TUNING = {
  /** ハンドルを切る速さ・戻す速さ（1/s）。切るほうが遅い＝切り始めに溜めがある */
  steerIn: 6.5,
  steerOut: 10,
  /** 車体の回る速さが舵に付いてくる強さ（rad/s²）。滑っているあいだは slide まで弱まる */
  yawResponse: 18,
  yawResponseSlide: 5,
  /** 横滑りがこの速さ（m/s）で「完全に滑っている」とみなす */
  slideRef: 7,
  /** 回る速さの上限 = grip × overdrive ÷ 速さ。1 を超えた分だけ外へ滑る */
  overdrive: 1.2,
  /** 空気抵抗（1/m）と、転がり・エンジンブレーキ（m/s²） */
  drag: 0.0018,
  rolling: 0.85,
  /** 後退のブレーキを踏んでいないのに後ろへ動いているとき（弾き返された・坂でずり落ちる）の減速 m/s²。
   *  前進のギアに入ったままなので、惰性より強く止まる（壁に弾かれた車が 1〜2m で止まる） */
  reverseHold: 5,
  /** サイドブレーキ中の踏ん張りの倍率、旋回の増し、減速（制動に対する割合） */
  handbrakeGrip: 0.26,
  handbrakeYaw: 2.1,
  handbrakeDecel: 0.32,
  /** 大きく滑っているあいだの踏ん張りの倍率と、落ち始める横滑り・落ち切る横滑り m/s */
  slideGrip: 0.6,
  slideLooseFrom: 2.5,
  slideLooseFull: 8,
  /** パワースライド: 滑っているあいだ、流れている側へ舵を入れたままアクセルを踏むと後輪が空転して踏ん張りがここまで落ちる
   *  （斜めを向いたまま弧を描いて滑り続ける。アクセルか舵を戻せば slideGrip に戻って収まる） */
  powerGrip: 0.5,
  /** パワースライド中に踏ん張りが落ち切る横滑り m/s（slideLooseFull より手前で落ち切る） */
  powerLooseFull: 5,
  /** サイドブレーキを引いていないとき、進む向きに対する車体の斜め（rad）がここから舵の効きが弱まり、ここで弱まり切る。
   *  弱まり切ったときに残る効きの割合（回り切って横を向いたまま失速しない。真横まで回すのはサイドブレーキ） */
  driftEaseFrom: 0.55,
  driftEaseFull: 1.0,
  driftEaseKeep: 0.25,
  /** 舵で出せる回る速さの上限 rad/s */
  maxYaw: 3.3,
  /** 横滑り 1m/s あたりに失う前向きの速さ（m/s²） */
  scrub: 0.45,
  /** 坂の重力の効き */
  slope: 6.5,
  /** 壁の跳ね返りと、擦るときの摩擦（壁へ向かう速さに対する割合）、壁に沿う向きへ回る速さ（1/s）。
   *  72km/h で正面から当たると 4m/s で弾き返され、1m ほど下がって止まる（鼻を壁に付けたまま止まらない） */
  bounce: 0.2,
  wallFriction: 0.22,
  wallAlign: 13,
  /** 壁や車に当たったとき、向きを振られる強さ（rad/s ÷ m/s） */
  wallYaw: 0.26,
  carYaw: 0.5,
  /** 1回の衝突で付く回転の上限 rad/s */
  maxKick: 3.2,
  /** 柱の跳ね返りと、柱に擦るときの摩擦 */
  poleBounce: 0.3,
  poleFriction: 0.5,
  /** 四隅の円の半径（車幅に対する割合）と、四隅が壁に沿う向きへ回す強さ（前後の円に対する割合） */
  cornerRadius: 0.2,
  cornerAlign: 0.5,
  /** 車どうしの跳ね返り */
  carBounce: 0.18,
  /** 強く当たったとき（hardFrom〜hardFull m/s）の、車どうしの跳ね返りと、向きを振られる強さの倍率。
   *  軽く触れただけなら上の値のまま。72km/h で当てると相手は押し出されて大きく回り、自分も弾かれて横を向く */
  hardFrom: 5,
  hardFull: 13,
  hardBounce: 0.28,
  hardYaw: 1.3,
  /** これより強く当たったら衝突として知らせる m/s */
  crashSpeed: 2,
}

const NO_CONTROL: VehicleControl = { throttle: 0, brake: 0, steer: 0, handbrake: false }
export const idleControl = (): VehicleControl => NO_CONTROL

export function createVehicle(
  id: number,
  kind: VehicleKind,
  x: number,
  z: number,
  heading: number,
  world: GtoWorld,
  color = 0xd8d8d8,
): VehicleState {
  return {
    id,
    kind,
    color,
    x,
    y: world.groundY(x, z),
    z,
    heading,
    speed: 0,
    slip: 0,
    steer: 0,
    yawRate: 0,
    driver: 'none',
    route: null,
    accel: 0,
  }
}

/** プレイヤーの入力を車への操作に直す */
export function controlFromInput(input: InputFrame): VehicleControl {
  return {
    throttle: Math.max(0, input.moveY),
    brake: Math.max(0, -input.moveY),
    steer: clamp(input.moveX, -1, 1),
    handbrake: input.handbrake,
  }
}

/** 当たり判定に使う、車体の前後2つの円（半径と、中心から前後への距離） */
const hull = (spec: VehicleSpec) => {
  const radius = spec.width * 0.55
  return { radius, reach: spec.length * 0.5 - radius }
}

interface HullCircle {
  /** 中心の位置（車体の座標。前が＋a、右が＋c） */
  a: number
  c: number
  radius: number
  /** 壁に沿う向きへ回す強さの割合 */
  align: number
}

/** 壁に当てる円: 前後の大きな円と、四隅の小さな円（車体の角が壁に入らないようにする） */
function hullCircles(spec: VehicleSpec): HullCircle[] {
  const { radius, reach } = hull(spec)
  const rc = spec.width * VEHICLE_TUNING.cornerRadius
  const ca = spec.length / 2 - rc
  const cc = spec.width / 2 - rc
  const corner = (sa: number, sc: number): HullCircle => ({ a: ca * sa, c: cc * sc, radius: rc, align: VEHICLE_TUNING.cornerAlign })
  return [{ a: reach, c: 0, radius, align: 1 }, { a: -reach, c: 0, radius, align: 1 }, corner(1, -1), corner(1, 1), corner(-1, -1), corner(-1, 1)]
}

/** 舵と速さから、車体が回ろうとする速さ（rad/s）を出す */
function yawTarget(spec: VehicleSpec, steer: number, speed: number, handbrake: boolean): number {
  const tune = VEHICLE_TUNING
  // 履帯は左右の回る速さの差で曲がる（速さに関係なく、止まっていても回る）
  if (spec.pivot != null) return steer * spec.pivot
  const kinematic = (speed / spec.wheelbase) * Math.tan(steer * spec.steerMax)
  // 速いほどタイヤが耐えられる旋回は小さい。舵の量に比例して上限を下げ、アナログ操作を生かす
  const limit = ((spec.grip * tune.overdrive) / Math.max(Math.abs(speed), 1)) * Math.abs(steer)
  const boost = handbrake && Math.abs(speed) > 3 ? tune.handbrakeYaw : 1
  return clamp(clamp(kinematic, -limit, limit) * boost, -tune.maxYaw, tune.maxYaw)
}

/** 前後の加速度（操作と坂と抵抗） */
function driveAccel(spec: VehicleSpec, control: VehicleControl, speed: number, grade: number): number {
  const tune = VEHICLE_TUNING
  let a = -grade * tune.slope
  if (control.throttle > 0) {
    // 後退中のアクセルはブレーキとして効く
    a += speed < -0.5 ? spec.brake * control.throttle : spec.accel * control.throttle * (1 - Math.pow(Math.max(0, speed) / spec.maxSpeed, 2))
  }
  if (control.brake > 0) {
    a -= speed > 0.5 ? spec.brake * control.brake : spec.accel * 0.6 * control.brake * (1 - Math.pow(Math.min(1, Math.abs(Math.min(0, speed)) / spec.reverseMax), 2))
  }
  // 空気抵抗は惰性のときだけ効かせる（踏んでいるあいだは上の曲線が最高速を決める）
  return a - tune.drag * speed * Math.abs(speed) * (1 - control.throttle)
}

export function stepVehicle(
  v: VehicleState,
  control: VehicleControl,
  world: GtoWorld,
  dt: number,
): { vehicle: VehicleState; events: GtoEvent[] } {
  const spec = VEHICLE_SPECS[v.kind]
  const tune = VEHICLE_TUNING
  const events: GtoEvent[] = []

  // ---- ハンドル（入力に遅れて切れる）と、車体の回る速さ（舵に遅れて付いてくる） ----
  const wanted = clamp(control.steer, -1, 1)
  const steerRate = Math.abs(wanted) > Math.abs(v.steer) && wanted * v.steer >= 0 ? tune.steerIn : tune.steerOut
  const steer = approach(v.steer, wanted, steerRate * dt)
  const sliding = clamp(Math.abs(v.slip) / tune.slideRef, 0, 1)
  const response = lerp(tune.yawResponse, tune.yawResponseSlide, sliding)
  // 横を向くほど滑っているときは、前後の速さではなく滑っている速さで舵が効く
  // （90° を超えて回っても、切った向きへ回り続ける。後退で舵が逆になるのは滑っていないときだけ）
  const steerSpeed = lerp(v.speed, Math.hypot(v.speed, v.slip), sliding)
  // サイドブレーキなしで斜めを向きすぎたら、それ以上は回りにくくする（滑りながら弧を描ける角度に留まる）
  const drift = Math.atan2(Math.abs(v.slip), Math.abs(v.speed))
  const intoSlide = steer * v.slip < 0
  const ease = control.handbrake || !intoSlide ? 1 : lerp(1, tune.driftEaseKeep, clamp((drift - tune.driftEaseFrom) / (tune.driftEaseFull - tune.driftEaseFrom), 0, 1) * sliding)
  let yawRate = approach(v.yawRate, yawTarget(spec, steer, steerSpeed, control.handbrake) * ease, response * dt)

  // ---- 前後の加速 ----
  const fwd = dirOf(v.heading)
  const grade = (world.groundY(v.x + fwd.x * 1.5, v.z + fwd.z * 1.5) - world.groundY(v.x - fwd.x * 1.5, v.z - fwd.z * 1.5)) / 3
  let speed = v.speed + driveAccel(spec, control, v.speed, grade) * dt
  // 転がり抵抗と、滑りで失う分と、サイドブレーキは「0 へ寄せる」（向きが反転しない）
  const recoil = speed < 0 && control.brake === 0 && control.throttle === 0 && Math.abs(v.slip) < 2 ? tune.reverseHold : 0
  const hold = tune.rolling * (1 - Math.max(control.throttle, control.brake)) + recoil + Math.abs(v.slip) * tune.scrub + (control.handbrake ? spec.brake * tune.handbrakeDecel : 0)
  speed = approach(speed, 0, hold * dt)
  speed = clamp(speed, -spec.reverseMax, spec.maxSpeed)
  // 何も踏んでいなければ、ごく低速で止め切る（坂でずるずる動かない）
  if (control.throttle === 0 && control.brake === 0 && Math.abs(speed) < 0.35 && Math.abs(grade) < 0.12) speed = 0

  // ---- 向きを変えてから、速度を新しい向きの前後と横へ分け直す（横の成分がドリフトになる） ----
  const right0 = { x: -fwd.z, z: fwd.x }
  const vx = fwd.x * speed + right0.x * v.slip
  const vz = fwd.z * speed + right0.z * v.slip
  const heading = v.heading + yawRate * dt
  const f = dirOf(heading)
  const r = { x: -f.z, z: f.x }
  let forward = vx * f.x + vz * f.z
  let lateral = vx * r.x + vz * r.z
  // 大きく滑り出したタイヤは踏ん張りが落ちる（滑りが尾を引き、逆へ切って立て直す間ができる）
  // 流れている側へ舵を入れたままアクセルを踏んでいれば、後輪が空転して滑りが続く
  const power = clamp(control.throttle * 1.6, 0, 1) * clamp(-steer * Math.sign(lateral) * 1.25, 0, 1)
  const looseFull = lerp(tune.slideLooseFull, tune.powerLooseFull, power)
  const loose = clamp((Math.abs(lateral) - tune.slideLooseFrom) / (looseFull - tune.slideLooseFrom), 0, 1)
  const grip = spec.grip * (control.handbrake ? tune.handbrakeGrip : lerp(1, lerp(tune.slideGrip, tune.powerGrip, power), loose))
  lateral = approach(lateral, 0, grip * dt)

  // ---- 動かして、建物から押し出す（前後の大きな円と、四隅の小さな円で当てる） ----
  let x = v.x + (f.x * forward + r.x * lateral) * dt
  let z = v.z + (f.z * forward + r.z * lateral) * dt
  const { reach } = hull(spec)
  const halfL = spec.length / 2
  const halfW = spec.width / 2
  /** 当たりを積んでいく車（損傷だけを見る） */
  let hurt: VehicleState = v
  let twist = 0
  /** 当たった面（外向きの法線 n）に対して、速度を跳ね返し・摩擦で直す。面へ向かう速さを返す（離れていれば 0 以上） */
  const rebound = (nx: number, nz: number, bounce: number, friction: number): number => {
    const wx = f.x * forward + r.x * lateral
    const wz = f.z * forward + r.z * lateral
    const into = wx * nx + wz * nz
    if (into >= 0) return into
    // 面へ向かう成分は小さく跳ね返し、面に沿う成分は当たりの強さに応じて削る（正面なら止まり、浅ければ擦って進む）
    const tx = wx - into * nx
    const tz = wz - into * nz
    const along = Math.hypot(tx, tz)
    const keep = along > 1e-6 ? Math.max(0, along + into * friction) / along : 0
    const bx = tx * keep - bounce * into * nx
    const bz = tz * keep - bounce * into * nz
    forward = bx * f.x + bz * f.z
    lateral = bx * r.x + bz * r.z
    return into
  }
  for (const c of hullCircles(spec)) {
    const cx = x + f.x * c.a + r.x * c.c
    const cz = z + f.z * c.a + r.z * c.c
    const res = world.resolveCircle(cx, cz, c.radius)
    if (!res.hit) continue
    x += res.x - cx
    z += res.z - cz
    // 壁に刺さっている端は、刺さり具合に応じて壁に沿う向きへ回る（擦りながら走り抜けられる。正面なら回らない）
    const nf = res.nx * f.x + res.nz * f.z
    const nr = res.nx * r.x + res.nz * r.z
    const lever = (c.a * nr - c.c * nf) / reach
    const poke = Math.max(0, -(c.a * nf + c.c * nr) / Math.hypot(c.a, c.c))
    // 沿わせる向きは「端が壁から離れる向き」だけを見る（角を軸に壁へ回り込まない）
    twist += ((c.a * nr) / reach) * poke * tune.wallAlign * c.align * Math.min(1, Math.hypot(forward, lateral) / 4) * dt
    const into = rebound(res.nx, res.nz, tune.bounce, tune.wallFriction)
    if (into >= 0) continue
    yawRate = clamp(yawRate + lever * -into * tune.wallYaw, -tune.maxKick, tune.maxKick)
    if (-into > tune.crashSpeed) {
      // 知らせる場所は当たった点（煙と破片がそこから出る）
      events.push({ type: 'crash', x: cx + (res.x - cx) - res.nx * c.radius, z: cz + (res.z - cz) - res.nz * c.radius, value: -into, ref: String(v.id) })
      if (!spec.armor) hurt = applyImpact(hurt, -into, c.c - nr * c.radius, c.a - nf * c.radius, halfL, halfW)
    }
  }

  // ---- 街灯・信号柱・街路樹の幹（車体の長方形で当てる。柱は動かないので、止められて跳ね返る） ----
  for (const pole of spec.armor ? [] : polesNear(world, x, z, halfL + 1)) {
    const hit = hitPole(x, z, f.x, f.z, halfL, halfW, pole)
    if (!hit) continue
    x += hit.nx * hit.push
    z += hit.nz * hit.push
    const into = rebound(hit.nx, hit.nz, tune.poleBounce, tune.poleFriction)
    if (into >= 0) continue
    // 当たった点を止められるので、そこを軸に向きを振られる
    const here = { ...v, x, z, heading }
    yawRate = clamp(yawRate + kick(here, pole.x, pole.z, hit.nx * -into, hit.nz * -into), -tune.maxKick, tune.maxKick)
    if (-into > tune.crashSpeed) {
      events.push({ type: 'crash', x: pole.x, z: pole.z, value: -into, ref: String(v.id) })
      hurt = applyImpact(hurt, -into, hit.lx, hit.lz, halfL, halfW, true)
    }
  }
  const turned = heading + clamp(twist, -0.2, 0.2)

  return {
    vehicle: {
      ...v,
      x,
      y: world.groundY(x, z),
      z,
      heading: turned,
      speed: forward,
      slip: lateral,
      steer,
      yawRate,
      accel: (forward - v.speed) / dt,
      ...(hurt === v ? {} : { damage: hurt.damage, dents: hurt.dents }),
    },
    events,
  }
}

interface Contact {
  /** a から b への向き */
  nx: number
  nz: number
  overlap: number
  /** 当たった点 */
  px: number
  pz: number
}

/** 2台の前後の円どうしで、いちばん深く重なっている組を探す */
function findContact(a: VehicleState, b: VehicleState): Contact | null {
  const ha = hull(VEHICLE_SPECS[a.kind])
  const hb = hull(VEHICLE_SPECS[b.kind])
  const fa = dirOf(a.heading)
  const fb = dirOf(b.heading)
  let best: Contact | null = null
  for (const sa of [1, -1]) {
    const ax = a.x + fa.x * ha.reach * sa
    const az = a.z + fa.z * ha.reach * sa
    for (const sb of [1, -1]) {
      const bx = b.x + fb.x * hb.reach * sb
      const bz = b.z + fb.z * hb.reach * sb
      let dx = bx - ax
      let dz = bz - az
      let d = Math.hypot(dx, dz)
      const overlap = ha.radius + hb.radius - d
      if (overlap <= 0 || (best && overlap <= best.overlap)) continue
      if (d < 1e-4) {
        // 円の中心が重なっていたら、車の中心どうしの向きで離す
        dx = b.x - a.x
        dz = b.z - a.z
        d = Math.hypot(dx, dz)
        if (d < 1e-4) {
          dx = fa.x
          dz = fa.z
          d = 1
        }
      }
      // 深くめり込んで円どうしの向きが逆を向いたら、車の中心どうしの向きで離す
      if (dx * (b.x - a.x) + dz * (b.z - a.z) < 0) {
        dx = b.x - a.x
        dz = b.z - a.z
        d = Math.hypot(dx, dz)
      }
      const nx = dx / d
      const nz = dz / d
      best = { nx, nz, overlap, px: ax + nx * (ha.radius - overlap / 2), pz: az + nz * (ha.radius - overlap / 2) }
    }
  }
  return best
}

/** 当たった点に力（fx, fz）を受けたときに付く回転（時計回りが＋） */
function kick(v: VehicleState, px: number, pz: number, fx: number, fz: number, gain = 1): number {
  const spec = VEHICLE_SPECS[v.kind]
  const f = dirOf(v.heading)
  const along = (px - v.x) * f.x + (pz - v.z) * f.z
  const across = -(px - v.x) * f.z + (pz - v.z) * f.x
  const torque = along * (-fx * f.z + fz * f.x) - across * (fx * f.x + fz * f.z)
  // 回りにくさは車体の長さと幅から（細長い板の回転半径の2乗）
  const k2 = (spec.length * spec.length + spec.width * spec.width) / 12
  return clamp((torque / k2) * VEHICLE_TUNING.carYaw * gain, -VEHICLE_TUNING.maxKick, VEHICLE_TUNING.maxKick)
}

/** 世界の速度（vx, vz）を、車の前後と横へ分けて持たせる */
function withVelocity(v: VehicleState, x: number, z: number, vx: number, vz: number, yawRate: number): VehicleState {
  const f = dirOf(v.heading)
  return { ...v, x, z, speed: vx * f.x + vz * f.z, slip: -vx * f.z + vz * f.x, yawRate }
}

/**
 * [cheats] 車を世界の向き（dvx, dvz）へ突き飛ばし、回転（spin rad/s）を足す。重い車ほど動かない（1400kg のセダンが基準）。
 * 戦車の砲の爆風（cannon.ts）が使う
 */
export function shoveVehicle(v: VehicleState, dvx: number, dvz: number, spin: number): VehicleState {
  const f = dirOf(v.heading)
  const light = Math.min(1, 1400 / VEHICLE_SPECS[v.kind].mass)
  const vx = f.x * v.speed - f.z * v.slip + dvx * light
  const vz = f.z * v.speed + f.x * v.slip + dvz * light
  return withVelocity(v, v.x, v.z, vx, vz, clamp(v.yawRate + spin * light, -VEHICLE_TUNING.maxKick, VEHICLE_TUNING.maxKick))
}

/** 当たった点（世界の座標）を、当たる前の車体の座標に直して損傷を積む */
function dentAt(next: VehicleState, before: VehicleState, hit: Contact, impact: number): VehicleState {
  const spec = VEHICLE_SPECS[before.kind]
  if (spec.armor) return next
  const f = dirOf(before.heading)
  const dx = hit.px - before.x
  const dz = hit.pz - before.z
  return applyImpact(next, impact, -dx * f.z + dz * f.x, dx * f.x + dz * f.z, spec.length / 2, spec.width / 2)
}

/** 2台の車が重なっていれば押し離す。a を主役として、押された b と当たりの強さ（近づく速さ m/s）を返す */
export function collideVehicles(
  a: VehicleState,
  b: VehicleState,
): { a: VehicleState; b: VehicleState; impact: number } | null {
  const hit = findContact(a, b)
  if (!hit) return null
  const tune = VEHICLE_TUNING
  const { nx, nz, overlap } = hit
  const fa = dirOf(a.heading)
  const fb = dirOf(b.heading)
  const avx = fa.x * a.speed - fa.z * a.slip
  const avz = fa.z * a.speed + fa.x * a.slip
  const bvx = fb.x * b.speed - fb.z * b.slip
  const bvz = fb.z * b.speed + fb.x * b.slip
  const impact = Math.max(0, (avx - bvx) * nx + (avz - bvz) * nz)

  const ma = VEHICLE_SPECS[a.kind].mass
  const mb = VEHICLE_SPECS[b.kind].mass
  // 道筋に沿って走る交通の車は、軽く触れただけでは動かない（sim は強く当たったときだけ道筋から外す）。
  // その場合は自分が重なりを全部引き受ける
  const fixed = b.driver === 'traffic' && impact <= 1.5
  const shareA = fixed ? 1 : mb / (ma + mb)
  const ax = a.x - nx * overlap * shareA
  const az = a.z - nz * overlap * shareA
  const bx = b.x + nx * overlap * (1 - shareA)
  const bz = b.z + nz * overlap * (1 - shareA)
  if (impact <= 0) {
    return { a: { ...a, x: ax, z: az }, b: { ...b, x: bx, z: bz }, impact: 0 }
  }

  // 運動量を受け渡す（重い車ほど動かされにくい）
  const hard = clamp((impact - tune.hardFrom) / (tune.hardFull - tune.hardFrom), 0, 1)
  const gain = lerp(1, tune.hardYaw, hard)
  const j = ((1 + lerp(tune.carBounce, tune.hardBounce, hard)) * impact) / (1 / ma + 1 / mb)
  const da = j / ma
  const db = j / mb
  return {
    a: dentAt(withVelocity(a, ax, az, avx - nx * da, avz - nz * da, clamp(a.yawRate + kick(a, hit.px, hit.pz, -nx * da, -nz * da, gain), -tune.maxKick, tune.maxKick)), a, hit, impact),
    b: dentAt(withVelocity(b, bx, bz, bvx + nx * db, bvz + nz * db, clamp(b.yawRate + kick(b, hit.px, hit.pz, nx * db, nz * db, gain), -tune.maxKick, tune.maxKick)), b, hit, impact),
    impact,
  }
}
