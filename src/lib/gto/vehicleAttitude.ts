// Grand Theft Outfit [部品: vehicle] 車体の姿勢と、タイヤが路面に残すもの。
// 入口: VEHICLE_ATTITUDE / restAttitude / attitudeTarget / stepAttitude / bodyPose / wheelTrails
// 契約: 車の状態（速さ・横滑り・回る速さ・前後の加速度）だけから、車体が傾きたがる角度と、
//       どの車輪が痕と煙を出すかを決める。描画（renderVehicles.ts）はこれをばねで追って形にする。
// 入口（追加）: frontWheelAngle（前輪の見た目の切れ角。ドリフト中は進む向きへ逆に切れる）
//       向きの約束: roll は＋で左へ傾く（右旋回の外側）。pitch は＋で鼻が上がる（加速の沈み込み）。
import { clamp } from './math'
import type { VehicleState } from './types'
import type { VehicleSpec } from './vehicle'

/** 姿勢と痕を決める数字 */
export const VEHICLE_ATTITUDE = {
  /** 旋回の横向きの加速度（回る速さ × 速さ、m/s²）あたりのロール rad。上限へは滑らかに寄る（頭打ちで固まらない）:
   *  街なかの切り返し（5.4m/s²）で 3.8°、きつい旋回（16m/s²）で 7.7°、ドリフト（旋回＋横滑り 8m/s）で 8.7° */
  lean: 0.014,
  /** 横滑り 1m/s あたりのロール rad（流れていく側へ傾く。向きが回り終わっても流れているあいだ残る） */
  slipLean: 0.02,
  /** ロールが寄っていく上限 rad（約 8.9°）。車輪は路面に残り、車体だけが傾く。
   *  R16: 背後のカメラは向きが遅れて付くので、旋回中に写るのは車の内側の側面。R15 は内側の裾を動かさなかった（rollLift 0）ので、
   *  写っている側は何も変わらず、板のまま向きだけ変わって見えた。バーの実物も、写っている内側の裾が持ち上がってタイヤハウスが開く。
   *  内側を 9cm 上げ、外側を 15cm 沈める（輪は動かさない）。以下は前のラウンドまでの経緯:
   *  R15 の 12.6° は、背後カメラから見える側（旋回の内側）の裾が輪から離れ、輪が車体の外に立って竹馬に見えた。
   *  内側の裾は元の高さから上げない（rollLift 0）。傾きは外側が沈む分だけで作るので、角度はここまで。
   *  R14 の 14° は車輪ごと箱のように倒れ、内側の前後輪が浮いて車体下に隙間が見えた。車輪を路面に残した R15 の 4°・8° は、
   *  背後カメラの小さなコマ（640x480）で腰の線がほぼ水平に見えた。
   *  バーの実物は外側の後輪がフェンダーに半分潜り、リアバンパーの線が路面に対してはっきり斜めになる */
  /* R17 確認 1 回目: 上の 8.9° は 640x480 のコマで屋根とバンパーの線がほぼ水平に見え、「タイヤが下がった」ようにしか読めなかった。
   *  車体の側を倒す: 上限 13.5°、外側 14cm 沈み・内側 20cm 浮き（内側のサイドシルの下に車体の底が帯で見える）。輪は路面のまま */
  rollMax: 0.235,
  /** ロールのばね（強さと減衰）。ピッチより遅く、0.6 秒かけて目標に届いて 2 割行き過ぎる。
   *  切り始め（0.25 秒）はまだ半分、最大は 0.6 秒後、戻りも同じだけ遅れるので、8fps・3 コマおきのコマで 進入 → 最大 → 戻り が別の角度に写る */
  rollSpring: 30,
  rollDamping: 5,
  /** 前後の加速度 1m/s² あたりのピッチ rad */
  squat: 0.006,
  /** 横滑り 1m/s あたりの鼻の沈み rad（滑り始めを超えた分だけ。7m/s の滑りで 1.6°）。
   *  R17 の実測（status/vehicle-measure.md）: バーの真横のコマ 2 枚で、裾の線は路面に対して前下がり 1.3〜2.6°、
   *  タイヤハウスの隙間は後ろがタイヤの直径の 36〜37%、前が 14〜19%。R16 までは逆（尻が沈む）だった */
  slipDive: 0.01,
  slipSquatFrom: 2.4,
  /** 前輪の見た目の切れ角 rad（舵いっぱい）と、ドリフト中に進む向きへ向くときの上限 rad。
   *  バーの実測: 流れているコマの前輪は車体に対して 35〜40° 切れ、踏面がこちらを向く */
  steerLook: 0.6,
  steerLookMax: 0.7,
  /** 前輪が進んでいく向き（カウンター）へ向き切る横滑り m/s（slideStart から連続して移る） */
  counterFull: 6,
  /** 逆に切る量は、進む向きと車体の向きのずれの何割か。10 割にすると、背後のカメラ（進む向きの後ろ）からは前輪が真後ろから見えて
   *  暗い踏面の楕円にしかならない（R17 確認 1 回目）。6 割なら、見えている側のホイールの面が残り、後ろの縁がフェンダーの外へ出る */
  counterShare: 0.6,
  /** 前輪の見た目が切れ角へ付く速さ 1/s と、ドリフトの後で戻るときの速さ 1/s、戻りを遅らせる時間 s。
   *  バーの立て直しのコマは、車体がほぼ真っ直ぐに戻っても前輪が逆に切れて車体の外へ出ている */
  lookFollow: 16,
  lookRelease: 1.7,
  lookHold: 0.7,
  /** ピッチの上限 rad（約 5.4°。急ブレーキで鼻が 18cm 沈み、尻は 5cm だけ浮く） */
  pitchMax: 0.095,
  /** ばねの行き過ぎをここまで許す（上限に対する倍率。ロールは 13.5° を超えない） */
  overshoot: 1.055,
  /** 車体の前後のばね（ピッチ。強さと減衰）。0.4 秒で目標に届き、2〜3 割行き過ぎてから揺れ戻る */
  spring: 64,
  damping: 6.4,
  /** 前後の傾き（ピッチ）で、車体の端が車輪へ沈み込める量 m と、車輪から浮ける量 m。
   *  荷重の掛かった輪のばねは縮み、抜けた輪のばねはほとんど伸びないので、車体は傾きながら腰を落とす
   *  （急ブレーキで鼻が 18cm 沈み、尻は 5cm だけ浮く） */
  cornerSink: 0.18,
  cornerLift: 0.05,
  /** 左右の傾き（ロール）で、外側の裾が車輪へ沈み込める量 m と、内側の裾が車輪から浮ける量 m。
   *  外側のばねが縮み、内側のばねが伸びる（伸びは縮みより小さい）。輪は路面から動かないので、内側はタイヤハウスの隙間が開いて見える。
   *  車体を剛体として回すと内側が同じだけ持ち上がるので、回した分だけ車体の真ん中を下げて（bodyPose の heave）内側を路面の近くに留める。
   *  外側はタイヤの上半分がフェンダーに隠れるまで沈む（車体より上に出るタイヤは描画が切り取る） */
  rollSink: 0.14,
  rollLift: 0.18,
  /** 横向きの荷重がいっぱいに掛かったとき、車体ぜんたいが腰を落とす量 m（内側の裾もタイヤへ少し被さる。開かない） */
  loadDrop: 0.01,
  /** ロールとピッチが重なったときの、四隅の沈みと浮きの上限 m（超えそうなら全部まとめて弱める） */
  sinkMax: 0.3,
  liftMax: 0.24,
  /** 滑っているあいだの揺れ（タイヤが引っかかっては逃げる）: 揺れが出切る横滑り m/s、ロール・ピッチ rad、上下 m、拍 rad/s */
  shakeFull: 7,
  shakeRoll: 0.0075,
  shakePitch: 0.006,
  shakeHeave: 0.008,
  shakeRate: 17,
  /** 後輪が痕と煙を出し始める横滑り m/s、前輪も痕を残す横滑り m/s */
  slideStart: 2.4,
  slideFront: 5.5,
  /** 滑っているとみなす最低の速さ m/s（止まりかけでは出さない） */
  slideMoving: 4,
  /** 発進の空転とみなす加速 m/s²、タイヤが鳴く減速 m/s² */
  spinAccel: 8.5,
  lockDecel: 12.5,
  /** 滑っていなくても後輪が鳴き始める旋回の横向きの加速度 m/s²（回る速さ × 速さ）と、そのときの煙の粒（1秒あたり）・痕の濃さ */
  squealFrom: 10,
  smokeSqueal: 9,
  squealStrength: 0.45,
  /** 煙の粒（1秒あたり）: 滑り始め、横滑り 1m/s ごとの増し、上限、空転、急ブレーキ */
  smokeBase: 14,
  smokePerSlip: 6,
  smokeMax: 46,
  smokeSpin: 30,
  smokeLock: 36,
}

/** 車体の姿勢（ばねの状態） */
export interface Attitude {
  pitch: number
  pitchVel: number
  roll: number
  rollVel: number
}

export const restAttitude = (): Attitude => ({ pitch: 0, pitchVel: 0, roll: 0, rollVel: 0 })

/** いまの走り方で、車体が落ち着こうとする傾き */
export function attitudeTarget(v: VehicleState): { pitch: number; roll: number } {
  const tune = VEHICLE_ATTITUDE
  const slide = Math.abs(v.slip)
  return {
    // 遠心力で外へ。横へ流れているあいだは、流れていく側（タイヤが引っかかる側）へさらに沈む
    // 上限では切らず、滑らかに寄せる: 旋回のきつさや滑りの大きさが変われば、深い傾きの中でも角度が変わり続ける
    roll: tune.rollMax * Math.tanh((v.yawRate * v.speed * tune.lean - v.slip * tune.slipLean) / tune.rollMax),
    // 加速で尻、減速で鼻が沈む。横滑りは前の外側の輪へ乗り掛かって鼻が少し沈み、後ろのタイヤハウスが開く
    pitch: clamp(v.accel * tune.squat - Math.max(0, slide - tune.slipSquatFrom) * tune.slipDive, -tune.pitchMax, tune.pitchMax),
  }
}

/** ばねを dt 秒進める（目標へ遅れて付き、少し行き過ぎて戻る）。外から揺さぶるときは pitchVel / rollVel に足す */
export function stepAttitude(a: Attitude, target: { pitch: number; roll: number }, dt: number): Attitude {
  const tune = VEHICLE_ATTITUDE
  const pitchVel = a.pitchVel + ((target.pitch - a.pitch) * tune.spring - a.pitchVel * tune.damping) * dt
  const rollVel = a.rollVel + ((target.roll - a.roll) * tune.rollSpring - a.rollVel * tune.rollDamping) * dt
  const pitchLimit = tune.pitchMax * tune.overshoot
  const rollLimit = tune.rollMax * tune.overshoot
  const pitch = clamp(a.pitch + pitchVel * dt, -pitchLimit, pitchLimit)
  const roll = clamp(a.roll + rollVel * dt, -rollLimit, rollLimit)
  return { pitch, pitchVel, roll, rollVel }
}

/**
 * 車輪の上に載せる車体の傾きと沈み。ばねの状態から、四隅の沈み込みと浮きが上限に収まるように弱めて返す。
 * ロールは外側が rollSink まで沈み、内側が rollLift まで浮く。ピッチは沈む端が cornerSink、浮く端が cornerLift まで。
 * 重なったときは四隅のどこも sinkMax より沈まず、liftMax より浮かない。
 * halfTrack・halfBase は車輪の左右・前後の間隔の半分 m。heave は車体の真ん中の上下 m（沈みが負）。
 */
export function bodyPose(a: Attitude, halfTrack: number, halfBase: number): { pitch: number; roll: number; heave: number } {
  const { cornerSink, cornerLift, rollSink, rollLift, sinkMax, liftMax } = VEHICLE_ATTITUDE
  const side = Math.tan(Math.abs(a.roll)) * halfTrack
  const end = Math.tan(Math.abs(a.pitch)) * halfBase
  // それぞれの軸で、沈みと浮きの幅に収める
  const kRoll = Math.min(1, (rollSink + rollLift) / 2 / Math.max(side, 1e-6))
  const kPitch = Math.min(1, (cornerSink + cornerLift) / 2 / Math.max(end, 1e-6))
  const heldSide = side * kRoll
  const heldEnd = end * kPitch
  // 沈む側が深く、浮く側が浅くなるだけ、真ん中を下げる
  const drop = VEHICLE_ATTITUDE.loadDrop * Math.min(1, Math.abs(a.roll) / VEHICLE_ATTITUDE.rollMax)
  const heave = (heldSide * (rollLift - rollSink)) / (rollSink + rollLift) + (heldEnd * (cornerLift - cornerSink)) / (cornerSink + cornerLift) - drop
  // 重なった隅が上限を超えるなら、傾きと沈みをまとめて弱める
  const k = Math.min(1, sinkMax / Math.max(heldSide + heldEnd - heave, 1e-6), liftMax / Math.max(heldSide + heldEnd + heave, 1e-6))
  return { pitch: a.pitch * kPitch * k, roll: a.roll * kRoll * k, heave: heave * k }
}

/** ロールの軸を接地面の高さに置くための、車体の横ずれ m（＋が右）。axle は車体を回している高さ（車軸）m */
export function rollShift(roll: number, axle: number): number {
  return -Math.sin(roll) * axle
}

const NO_SHAKE = { pitch: 0, roll: 0, heave: 0 }

/**
 * 滑っているあいだ、車体が小刻みに揺れる量（ばねの姿勢に足す）。t は秒。
 * 滑るタイヤは引っかかっては逃げるので、車体は一定の角度で止まらない。拍の合わない波を重ねて、同じ形を繰り返さない。
 */
export function slideShake(v: VehicleState, t: number): { pitch: number; roll: number; heave: number } {
  const tune = VEHICLE_ATTITUDE
  const slide = Math.abs(v.slip)
  if (slide <= tune.slideStart || Math.hypot(v.speed, v.slip) <= tune.slideMoving) return NO_SHAKE
  const k = clamp((slide - tune.slideStart) / (tune.shakeFull - tune.slideStart), 0, 1)
  const w = tune.shakeRate
  const p = v.id * 2.4
  return {
    roll: k * tune.shakeRoll * (0.62 * Math.sin(t * w + p) + 0.38 * Math.sin(t * w * 1.73 + p * 1.3)),
    pitch: k * tune.shakePitch * (0.6 * Math.sin(t * w * 1.31 + p + 1) + 0.4 * Math.sin(t * w * 2.2 + p)),
    heave: k * tune.shakeHeave * Math.sin(t * w * 1.52 + p + 2),
  }
}

/**
 * 前輪の見た目の切れ角 rad（＋が右）。ふだんは舵のとおり。横滑りが深まると、前輪は車が進んでいく向きへ向く
 * （車体は旋回の内へ向いたまま、前輪だけが外＝逆へ切れて見える。カウンターステア）。
 */
export function frontWheelAngle(v: VehicleState): number {
  const tune = VEHICLE_ATTITUDE
  const plain = v.steer * tune.steerLook
  const slide = Math.abs(v.slip)
  if (slide <= tune.slideStart || v.speed <= 0 || Math.hypot(v.speed, v.slip) <= tune.slideMoving) return plain
  const k = clamp((slide - tune.slideStart) / (tune.counterFull - tune.slideStart), 0, 1)
  const travel = clamp(Math.atan2(v.slip, v.speed) * tune.counterShare, -tune.steerLookMax, tune.steerLookMax)
  return plain + (travel - plain) * k
}

/** 前輪の見た目の切れ角の状態（angle は rad、hold は戻りを遅らせる残り時間 s） */
export interface WheelLook {
  angle: number
  hold: number
}

export const restWheelLook = (): WheelLook => ({ angle: 0, hold: 0 })

/**
 * 前輪の見た目を dt 秒進める。切り込みと振り返しにはすぐ付き、ドリフトの後で真っ直ぐへ戻るときだけ遅れる
 * （車体が立ち直っても、前輪はしばらく逆に切れたまま車体の外へ出て見える）。
 */
export function stepWheelLook(look: WheelLook, v: VehicleState, dt: number): WheelLook {
  const tune = VEHICLE_ATTITUDE
  const target = frontWheelAngle(v)
  const sliding = Math.abs(v.slip) > tune.slideStart && Math.hypot(v.speed, v.slip) > tune.slideMoving
  const hold = sliding ? tune.lookHold : Math.max(0, look.hold - dt)
  // 戻り: 同じ側で浅くなる動き
  const easing = look.angle * target >= 0 && Math.abs(target) < Math.abs(look.angle)
  const rate = easing && hold > 0 && !sliding ? tune.lookRelease : tune.lookFollow
  return { angle: look.angle + (target - look.angle) * (1 - Math.exp(-rate * dt)), hold }
}

/** タイヤが路面に残すもの */
export interface WheelTrails {
  /** 後輪・前輪が痕を残すか */
  rear: boolean
  front: boolean
  /** 煙の粒（1秒あたり） */
  smoke: number
  /** 痕と煙の濃さ 0..1 */
  strength: number
  /** 何が起きているか（煙の出方を変える） */
  cause: 'none' | 'slide' | 'spin' | 'lock' | 'corner'
}

const NO_TRAILS: WheelTrails = { rear: false, front: false, smoke: 0, strength: 0, cause: 'none' }

/** 横滑り・空転・急ブレーキのときに、どの車輪が痕と煙を出すか */
export function wheelTrails(v: VehicleState, _spec: VehicleSpec): WheelTrails {
  const tune = VEHICLE_ATTITUDE
  const slide = Math.abs(v.slip)
  const moving = Math.hypot(v.speed, v.slip)
  if (slide > tune.slideStart && moving > tune.slideMoving) {
    return {
      rear: true,
      front: slide > tune.slideFront,
      smoke: Math.min(tune.smokeMax, tune.smokeBase + (slide - tune.slideStart) * tune.smokePerSlip),
      strength: clamp(0.7 + (slide - tune.slideStart) / 8, 0, 1),
      cause: 'slide',
    }
  }
  if (v.accel < -tune.lockDecel && v.speed > 6) return { rear: true, front: true, smoke: tune.smokeLock, strength: 0.9, cause: 'lock' }
  if (v.driver !== 'traffic' && v.accel > tune.spinAccel && v.speed > 0.3 && v.speed < 8) {
    return { rear: true, front: false, smoke: tune.smokeSpin, strength: 0.5, cause: 'spin' }
  }
  // きつい旋回: 外へ踏ん張る後輪が鳴いて、薄い痕と薄い煙を引く（交通の車は街なかの速さで曲がるので出さない）
  if (v.driver !== 'traffic' && Math.abs(v.yawRate * v.speed) > tune.squealFrom && v.speed > 5) {
    return { rear: true, front: false, smoke: tune.smokeSqueal, strength: tune.squealStrength, cause: 'corner' }
  }
  return NO_TRAILS
}
