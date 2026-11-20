// Grand Theft Outfit [部品: onfoot] 徒歩の操作と、車の乗り降り。
// 入口: createPlayer / stepOnFoot / stepBoarding / boardingPose / findEnterable / exitPoint / cameraSubject / crowdExempt
// 契約: 主人公と入力とカメラの向きを受け取り、次の主人公を返す。車の中身（挙動）には触れず、
//       乗る相手を選ぶ・ドアへ歩く・開ける・座る・降りる、までを担当する。
//       乗り降りは一瞬では終わらない。段階（Boarding）を1歩ずつ進め、描画は boardingPose を読んで
//       ドアの開き具合と主人公の位置を決める。sim.ts は stepBoarding の結果を状態へ写すだけ。
import { angleDiff, approach, clamp, dirOf, dist2, headingOf, lerp } from './math'
import { isSpecial, VEHICLE_SPECS } from './vehicle'
import type { Boarding, GtoEvent, GtoWorld, InputFrame, PlayMode, PlayerState, VehicleKind, VehicleState } from './types'

/** 手触りを決める数字 */
export const FOOT_TUNING = {
  /** スティックを倒しきったときの速さ（小走り）。浅く倒せばゆっくり歩く */
  walkSpeed: 3.0,
  runSpeed: 6.6,
  /** 加速・減速 m/s² */
  accel: 22,
  decel: 30,
  /** 体の向きを変える速さ rad/s */
  turnRate: 11,
  radius: 0.35,
  /** 乗り込める距離（車の中心から） */
  enterRange: 3.6,
  /** 歩幅（左右1組ぶんの長さ m）= strideBase + strideGain × 速さ。速いほど大股になる */
  strideBase: 0.9,
  strideGain: 0.45,
  strideMin: 1.2,
  /** 坂の効き。上りは勾配×この値だけ遅く、下りは少し速い */
  uphill: 1.3,
  downhill: 0.3,
}

/** 乗り降りの間（秒）と立ち位置 */
export const BOARD_TUNING = {
  /** ドアを開ける（取っ手へ手を伸ばす → 手が届いてから、引くのと同じ速さでドアが開く）。
   *  0.5 秒刻みのコマにも「手を掛けて半分開いたドア」が残る長さ（DOOR_BEATS.openFrom から先が開く区間） */
  open: 0.7,
  /** 運転手を降ろす（奪うときだけ） */
  pull: 1.1,
  /** 座る（開いたドアの内側へ踏み込む → 腰を落としながら片脚から車内へ入る → 外の脚を引き込んで座る） */
  sit: 1.25,
  /** ドアを閉める（座ったまま外の手を開いたドアへ伸ばす → 引くのと同じ速さで閉まる）。座りきっていれば、閉まりきる前でも発進できる
   *  （操作は待たせないので長く取れる）。ドアが動く区間は 1 秒: 0.5 秒刻みのコマのどれかに、必ず半開きのドアと引く手が残る */
  shut: 1.25,
  /** ドアが閉まったあと、同じ斜め後ろの画のまま座った姿を窓越しに見せる秒（ハンドルへ手を置く間）。
   *  操作は止めない: 走り出して shutHoldSpeed を超えたら、間を早送りして運転の画へ移る（shutHoldRush） */
  shutHold: 0.6,
  shutHoldSpeed: 1.5,
  /** 座る動きのうち、ここ（進み具合 0..1）から先はもう発進できる（体は座席に入り、外の脚を引き込んでいるところ） */
  driveFrom: 0.82,
  /** 降りる: 停めて、座ったまま手で押してドアを開ける → 外へ出る → ドアの横に立って手で押して閉める → もう歩ける */
  unlatch: 0.45,
  out: 1.75,
  /** 外へ出きってから、ドアを手で押して閉める秒（out の段階の続き。スティックを倒せば切り上げて歩き出せる）。
   *  ドアが動く区間は 0.6 秒: 0.5 秒刻みのコマのどれかに、押す手と動いているドアが残る。長いと、降りた体が腕を出したまま固まって見える。
   *  残りの 0.26 秒（DOOR_BEATS.pushTo から先）は、押しきった腕を下ろす間。ここが短いと、前へ伸ばした腕が 1〜2 コマで
   *  体の横へ飛んで、硬直した姿のまま切り替わって見える */
  push: 1.0,
  /** 外へ出る段階の最初、座ったまま動かない秒（カメラがドアの側へ回り込み、開口越しに座った上半身が見える間） */
  outHold: 0.2,
  /** 歩けるようになってから、押しかけのドアが閉まりきるまでの秒（押しきっていれば、もう閉まっている） */
  leave: 0.3,
  /** 降りて歩けるようになってから、カメラが段の画（車の斜め後ろ外側）からふだんの背後の画へ戻りきるまでの秒。
   *  同じ秒だけ、降りた車はカメラがよける相手から外す */
  settle: 0.7,
  /** 段の画へ移りきるまでの秒（ドアへ走り出してから・降りるボタンを押してから） */
  stageIn: 0.35,
  /** 乗るとき: ドアまでの距離がこの m 以内なら段の画、そこから stageFar m 離れるまでに背後カメラへ戻る */
  stageNear: 1.5,
  stageFar: 3,
  /** ドアが閉まったあとの間（shutHold）のうち、段の画のまま保つ割合。残りで運転の画へ移る */
  stageKeep: 0.4,
  /** 閉まったあとの間に走り出したら、間をこの倍の速さで進める（段の画から運転の画へ、飛ばずに早く移る） */
  shutHoldRush: 3,
  /** 座りかけ・閉めている最中に走り出したとき、shutHoldSpeed からこの m/s だけ速くなるあいだに段を抜く */
  stageRollOff: 3,
  /** 降りられる速さの上限 m/s */
  exitSpeed: 9,
  /** ドアへ走る速さ m/s と、あきらめるまでの秒 */
  approachSpeed: 5.2,
  approachTimeout: 4.5,
  /** ドアの外に立つ位置。車の側面からの距離 m と、ドアの後ろの端（取っ手）からさらに後ろへ m。
   *  開くドアの弧の外なので、ドアが体を通り抜けない */
  doorGap: 0.5,
  doorBackPad: 0.24,
  /** 屈む位置: ドアの開口の前（車の側面からの距離 m）と、座席の真横からさらに後ろへ m（開いたドアの先端をよける） */
  sillGap: 0.36,
  sillBack: 0.12,
  /** 座席: 左右の位置（車幅の半分に対する割合）と、ドアの枠の前端から後端への割合（vehicleCabin と同じ） */
  seatSide: 0.44,
  seatBack: 0.62,
  /** 座った体を描く位置: 車体の側面から内へ m。本当の座席（seatSide）より開口寄り。
   *  斜め後ろのカメラから、開いたドアの開口越しに座った上半身が見える深さ */
  seatInset: 0.24,
  /** ドアの外に立つときの体の向き: 車の前向きから、車体のほうへ回す割合（0=車の前、1=車体へまっすぐ）。
   *  斜めに立てば、取っ手へ手を伸ばす → 開口へ踏み込む → 座る、のあいだ体の向きがほとんど変わらない */
  doorTurn: 0.45,
  /** 降りて立ち上がったとき、体が車の外へ向く割合（1 で真横） */
  outTurn: 0.5,
}

/**
 * 前のドアの枠（車の全長に対する割合。前が負・後ろが正）。hinge=蝶番（前の端）、rear=取っ手のある後ろの端。
 * 車の担当の lib/gto/vehicleCabin.ts（cabinLayout）が車体の断面から出す値と同じ（テストで照合している）。
 * 断面は描画側にあって lib からは読めないので、表で持つ。
 */
export const DOOR_FRAME: Record<VehicleKind, { hinge: number; rear: number }> = {
  sedan: { hinge: -0.17, rear: 0.08 },
  kei: { hinge: -0.3, rear: 0.07 },
  taxi: { hinge: -0.25, rear: 0.06 },
  van: { hinge: -0.4, rear: -0.1 },
  police: { hinge: -0.18, rear: 0.07 },
  // [cheats] 戦車と飛行機にドアは無い。降りて立つ場所（車体の横）を決めるためだけに置く
  tank: { hinge: -0.1, rear: 0.05 },
  plane: { hinge: -0.12, rear: 0.03 },
}

/**
 * 座る動きの拍（sit の進み具合 0..1 の中の区間）。降りるとき（out）は同じ拍を逆に辿る。
 *   step  … ドアの外から、開いたドアの内側（座席の真横・車体の外）へ踏み込む
 *   duck  … 腰を座面の高さへ落としていく（頭は窓の高さのまま。地面へはしゃがまない）
 *   slide … 腰を落としながら、車の側の脚から座席へ横に入る（体は開口を通って車体の輪郭の内側へ）
 *   tuck  … 外の脚を引き込んで座りきる
 * 姿勢（onFootPose / onFootRig）も同じ拍を読む。
 */
export const SEAT_BEATS = {
  step: [0, 0.2],
  /** 踏み込みとほぼ同時に屈みきる。降りるときは、開口の前では屈んだままで、ドアの横へ踏み出しながら体を起こす */
  duck: [0, 0.2],
  slide: [0.22, 0.66],
  /** 外に残した脚を引き込み、上体を起こして座りきる（開口越しに座った上半身が見えている） */
  tuck: [0.58, 0.95],
  /** 倒した上体を起こす区間（腰が座席へ入るころから。頭が屋根の縁をくぐったあと） */
  rise: [0.4, 0.88],
  /** 体を車の前へ向ける区間（踏み込みながら回り、腰を落とす前に前を向く） */
  turn: [0, 0.24],
} as const

/**
 * 手とドアが一緒に動く区間（各段階の進み具合 0..1 の中）。姿勢（onFootRig）も同じ値を読むので、
 * 手が届く前にドアが動いたり、手を離したあとにドアだけが動いたりしない。
 *   openFrom    … 開ける: ここまでは手を伸ばすだけ。ここから先、引く手と一緒に開く
 *   shutFrom    … 座って閉める: ここまでは外の手を開いたドアへ伸ばすだけ。ここから先、引く手と一緒に閉まる
 *   unlatchFrom … 降りる: 手をドアへ当てるまで。ここから先、押す手と一緒に unlatchOpen まで開く（残りは体が出ながら開く）
 *   pushFrom〜pushTo … 降りて閉める: 手を掛けてから押しきるまで。pushTo から先は、伸ばした腕を体の横へ下ろす間
 *                       （進み具合の 1/4 以上を残す。腕の振りが 1 ラジアン近く戻るので、短いと関節の角度が飛ぶ）
 */
export const DOOR_BEATS = { openFrom: 0.35, shutFrom: 0.2, unlatchFrom: 0.15, unlatchOpen: 0.6, pushFrom: 0.13, pushTo: 0.74 } as const

/** 降りて押して閉めるあいだの進み具合 0..1（out の段階に入ってからの秒 → 0 は体が出きった瞬間） */
export const pushProgress = (t: number): number => clamp((t - BOARD_TUNING.out) / BOARD_TUNING.push, 0, 1)

/** 押して閉めるドアの閉まり具合 0..1（k は押す間の進み具合）。歩ける段階（leave）も同じ曲線の続きを辿る */
const pushShut = (k: number): number => clamp((k - DOOR_BEATS.pushFrom) / (DOOR_BEATS.pushTo - DOOR_BEATS.pushFrom), 0, 1)

/** ドアがこれより開いているあいだは、座った体を描く（開口越しに見える） */
export const SEAT_SEEN_DOOR = 0.06

/** 車体の外（開口の前）で落とす腰の割合。残りは座席へ入りながら落とす */
export const SEAT_OUTSIDE_DROP = 0.35

/** 座る動きの進み具合 u から、腰を座面の高さへ落とした度合い 0..1。
 *  車体の外（duck）では SEAT_OUTSIDE_DROP まで。残りは座席へ入りながら（slide）落とす。地面へしゃがむ姿にしない */
export const seatSink = (u: number): number => SEAT_OUTSIDE_DROP * beat(u, SEAT_BEATS.duck) + (1 - SEAT_OUTSIDE_DROP) * beat(u, SEAT_BEATS.slide)

/** 外へ出る段階（out）に入ってからの秒 → 体の動きの進み具合 0..1（最初の outHold 秒は座ったまま） */
export const outProgress = (t: number): number => clamp((t - BOARD_TUNING.outHold) / (BOARD_TUNING.out - BOARD_TUNING.outHold), 0, 1)

/** 拍の中の進み具合 0..1（なめらか） */
export const beat = (u: number, span: readonly [number, number]): number => {
  const k = clamp((u - span[0]) / (span[1] - span[0]), 0, 1)
  return k * k * (3 - 2 * k)
}

/** 円で近似した障害物（停まっている車など）。box があれば向きのある箱として当てる */
export interface Blocker {
  x: number
  z: number
  r: number
  box?: { heading: number; halfLength: number; halfWidth: number }
}

/** 乗り降りに要る車の大きさ（vehicle.ts の諸元から sim.ts が渡す） */
export interface CarSize {
  length: number
  width: number
}

export function createPlayer(x: number, z: number, heading: number, world: GtoWorld): PlayerState {
  return { x, y: world.groundY(x, z), z, heading, speed: 0, running: false, stride: 0, vehicleId: null, busy: 0, boarding: null }
}

/** その速さのときの歩幅（左右1組ぶん）。足踏みの速さが人らしい範囲に収まるようにする */
export function gaitOf(speed: number): { strideLength: number } {
  return { strideLength: Math.max(FOOT_TUNING.strideMin, FOOT_TUNING.strideBase + FOOT_TUNING.strideGain * Math.abs(speed)) }
}

const smooth = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

/** 障害物から押し出す */
function pushOut(x: number, z: number, b: Blocker): { x: number; z: number } {
  if (!b.box) {
    const dx = x - b.x
    const dz = z - b.z
    const dd = Math.hypot(dx, dz)
    const min = b.r + FOOT_TUNING.radius
    return dd < min && dd > 1e-4 ? { x: b.x + (dx / dd) * min, z: b.z + (dz / dd) * min } : { x, z }
  }
  // 箱: 車の向きに合わせた座標（前 lf・右 lr）で、めり込みの浅い軸へ押す
  const f = dirOf(b.box.heading)
  const dx = x - b.x
  const dz = z - b.z
  const lf = dx * f.x + dz * f.z
  const lr = dx * -f.z + dz * f.x
  const overF = b.box.halfLength + FOOT_TUNING.radius - Math.abs(lf)
  const overR = b.box.halfWidth + FOOT_TUNING.radius - Math.abs(lr)
  if (overF <= 0 || overR <= 0) return { x, z }
  const nf = overF < overR ? lf + Math.sign(lf || 1) * overF : lf
  const nr = overF < overR ? lr : lr + Math.sign(lr || 1) * overR
  return { x: b.x + f.x * nf - f.z * nr, z: b.z + f.z * nf + f.x * nr }
}

/** 乗り降りで体が固定されている段階か（leave は歩ける） */
const locked = (b: Boarding | null | undefined): b is Boarding => b != null && b.phase !== 'leave'

/** 車を運転してよいか（乗り降りの途中は不可。ただし体が座席に入って脚を引き込むころからは、もう走り出せる。
 *  ドアは走り出しながら閉まる） */
export const canDrive = (p: PlayerState): boolean => {
  const b = p.boarding
  if (b == null || b.phase === 'shut') return true
  return b.phase === 'sit' && b.t >= BOARD_TUNING.sit * BOARD_TUNING.driveFrom
}

export function stepOnFoot(
  p: PlayerState,
  input: InputFrame,
  camYaw: number,
  world: GtoWorld,
  blockers: Blocker[],
  dt: number,
): PlayerState {
  const busy = Math.max(0, p.busy - dt)
  // 乗り降りの最中は stepBoarding が体を動かす
  if (locked(p.boarding)) return { ...p, busy }
  const mag = busy > 0 ? 0 : clamp(Math.hypot(input.moveX, input.moveY), 0, 1)
  // スティックの向きを、カメラが見ている向きを基準に世界の向きへ直す
  const wish = camYaw + Math.atan2(input.moveX, input.moveY)
  const running = input.run && mag > 0.2
  const d = dirOf(mag > 0.05 ? wish : p.heading)
  // 半歩先の高さから勾配を見て、上りは遅く・下りは少し速くする
  const grade = (world.groundY(p.x + d.x * 0.5, p.z + d.z * 0.5) - world.groundY(p.x, p.z)) / 0.5
  const slope = grade > 0 ? 1 - clamp(grade, 0, 0.35) * FOOT_TUNING.uphill : 1 + clamp(-grade, 0, 0.35) * FOOT_TUNING.downhill
  const target = mag * (running ? FOOT_TUNING.runSpeed : FOOT_TUNING.walkSpeed) * slope
  const speed = approach(p.speed, target, (target > p.speed ? FOOT_TUNING.accel : FOOT_TUNING.decel) * dt)
  const heading =
    mag > 0.05 ? p.heading + clamp(angleDiff(p.heading, wish), -FOOT_TUNING.turnRate * dt, FOOT_TUNING.turnRate * dt) : p.heading

  // 進むのは入力の向き（体の向きは少し遅れて付いてくる）
  let at = { x: p.x + d.x * speed * dt, z: p.z + d.z * speed * dt }
  for (const b of blockers) at = pushOut(at.x, at.z, b)
  const res = world.resolveCircle(at.x, at.z, FOOT_TUNING.radius)
  const moved = Math.hypot(res.x - p.x, res.z - p.z)
  const actual = dt > 0 ? Math.min(speed, moved / dt + 0.5) : speed
  return {
    ...p,
    x: res.x,
    y: world.groundY(res.x, res.z),
    z: res.z,
    heading,
    speed: actual,
    running,
    stride: p.stride + moved / gaitOf(actual).strideLength,
    busy,
  }
}

/** いちばん近い、乗り込める車（乗り降りの途中は無し） */
export function findEnterable(p: PlayerState, vehicles: VehicleState[]): VehicleState | null {
  if (p.boarding != null) return null
  let best: VehicleState | null = null
  let bestGap = FOOT_TUNING.enterRange
  for (const v of vehicles) {
    if (v.driver === 'player') continue
    // [cheats] 戦車と飛行機は大きいので、中心ではなく車体の縁からの距離で見る。飛んでいる飛行機には乗れない
    if ((v.alt ?? 0) > 0) continue
    const gap = isSpecial(v.kind) ? hullGap(p, v) : Math.sqrt(dist2(p.x, p.z, v.x, v.z))
    if (gap < bestGap) {
      bestGap = gap
      best = v
    }
  }
  return best
}

/** 車から降りて立つ場所。運転席は右側なので、まず右。塞がっていれば左、それも駄目なら後ろ */
export function exitPoint(v: VehicleState, halfWidth: number, world: GtoWorld): { x: number; z: number; heading: number } {
  const f = dirOf(v.heading)
  const r = { x: -f.z, z: f.x }
  const side = halfWidth + 0.75
  const options = [
    { x: v.x + r.x * side, z: v.z + r.z * side },
    { x: v.x - r.x * side, z: v.z - r.z * side },
    { x: v.x - f.x * (side + 2), z: v.z - f.z * (side + 2) },
  ]
  const spot = options.find((o) => !world.resolveCircle(o.x, o.z, FOOT_TUNING.radius).hit) ?? options[0]
  const res = world.resolveCircle(spot.x, spot.z, FOOT_TUNING.radius)
  return { x: res.x, z: res.z, heading: headingOf(res.x - v.x, res.z - v.z) }
}

// ----------------------------------------------------------------------------
// 乗り降り
// ----------------------------------------------------------------------------

/** 車の前のドアまわりの位置。fw は車の中心から前へ m、out は中心から横へ m（使う側の符号を掛ける前） */
export interface DoorFrame {
  /** 蝶番・ドアの後ろの端・座席の前後の位置 */
  hingeFw: number
  rearFw: number
  seatFw: number
  /** 車体の側面と座席の横の位置 */
  sideOut: number
  seatOut: number
  /** 座った体を描く横の位置（座席より開口寄り。BOARD_TUNING.seatInset） */
  seenOut: number
}

export function doorFrame(v: VehicleState, size: CarSize): DoorFrame {
  const frame = DOOR_FRAME[v.kind]
  const hingeFw = -frame.hinge * size.length
  // ドアは少なくとも 0.6m（vehicleCabin と同じ下限）
  const rearFw = Math.min(hingeFw - 0.6, -frame.rear * size.length)
  return {
    hingeFw,
    rearFw,
    seatFw: lerp(hingeFw, rearFw, BOARD_TUNING.seatBack),
    sideOut: size.width / 2,
    seatOut: (size.width / 2) * BOARD_TUNING.seatSide,
    seenOut: Math.max((size.width / 2) * BOARD_TUNING.seatSide, size.width / 2 - BOARD_TUNING.seatInset),
  }
}

/** 車体の座標（前へ fw・右へ out）を世界の座標へ */
const carPoint = (v: VehicleState, fw: number, out: number): { x: number; z: number } => {
  const f = dirOf(v.heading)
  return { x: v.x - f.z * out + f.x * fw, z: v.z + f.x * out + f.z * fw }
}

/** ドアの外に立つ位置（ドアの後ろの端＝取っ手の外）。side=0 は車の後ろ */
export function doorPoint(v: VehicleState, size: CarSize, side: Boarding['side']): { x: number; z: number } {
  if (side === 0) return carPoint(v, -(size.length / 2 + 0.9), 0)
  const frame = doorFrame(v, size)
  return carPoint(v, frame.rearFw - BOARD_TUNING.doorBackPad, (frame.sideOut + BOARD_TUNING.doorGap) * side)
}

/** 車体へまっすぐ向く向き（side=0 は車の前） */
export function doorAcross(v: VehicleState, side: Boarding['side']): number {
  if (side === 0) return v.heading
  const f = dirOf(v.heading)
  return headingOf(f.z * side, -f.x * side)
}

/** ドアの外に立ったときの体の向き（車の前と車体のあいだの斜め。取っ手は斜め前にある。side=0 は車の前を向く） */
export function doorFacing(v: VehicleState, side: Boarding['side']): number {
  return v.heading + angleDiff(v.heading, doorAcross(v, side)) * BOARD_TUNING.doorTurn
}

/**
 * 運転しているあいだ、窓越しに見せる体の位置と向き（本当の座席。肘や肩がドアの外板から出ない深さ）。
 * ドアが開いているあいだの「開口寄り」の位置とは、ドアが閉まる・開くあいだに行き来する（boardingPose の shut / unlatch）。
 * 描画はここに座った姿の上半身を置き、ドアの窓の形にだけ見せる（ドアが閉まった瞬間に人が消えない）
 */
export function drivingSeat(v: VehicleState, size: CarSize, side: 1 | -1): { x: number; z: number; heading: number } {
  const frame = doorFrame(v, size)
  return { ...carPoint(v, frame.seatFw, frame.seatOut * side), heading: v.heading }
}

/** 座った体を描く位置（座席の、開口寄り） */
function seatPoint(v: VehicleState, size: CarSize, side: Boarding['side']): { x: number; z: number } {
  const frame = doorFrame(v, size)
  return carPoint(v, frame.seatFw, frame.seenOut * (side === 0 ? 1 : side))
}

/** 使うドアの側。prefer の側が建物で塞がっていれば反対、両方駄目なら後ろ */
function pickSide(
  v: VehicleState,
  size: CarSize,
  prefer: 1 | -1,
  world: GtoWorld,
  vehicles: VehicleState[],
  sizeOf: (v: VehicleState) => CarSize,
): Boarding['side'] {
  // 並んで停まっている別の車の中へは出ない
  const others: Blocker[] = vehicles
    .filter((o) => o.id !== v.id)
    .map((o) => ({ x: o.x, z: o.z, r: 0, box: { heading: o.heading, halfLength: sizeOf(o).length / 2, halfWidth: sizeOf(o).width / 2 } }))
  const free = (side: 1 | -1) => {
    const d = doorPoint(v, size, side)
    if (world.resolveCircle(d.x, d.z, FOOT_TUNING.radius).hit) return false
    return others.every((o) => {
      const q = pushOut(d.x, d.z, o)
      return q.x === d.x && q.z === d.z
    })
  }
  if (free(prefer)) return prefer
  const other = prefer === 1 ? -1 : 1
  return free(other) ? other : 0
}

/** 主人公が車のどちら側にいるか */
const sideOf = (p: PlayerState, v: VehicleState): 1 | -1 => {
  const f = dirOf(v.heading)
  return (p.x - v.x) * -f.z + (p.z - v.z) * f.x >= 0 ? 1 : -1
}

const pinned = (v: VehicleState): VehicleState => ({ ...v, speed: 0, slip: 0, yawRate: 0, accel: 0 })
const swap = (list: VehicleState[], item: VehicleState) => list.map((o) => (o.id === item.id ? item : o))

export interface BoardingStep {
  player: PlayerState
  mode: PlayMode
  vehicles: VehicleState[]
  events: GtoEvent[]
  /** 車から降ろされた運転手が立つ場所（その1歩だけ。sim.ts が逃げる住人を置く） */
  ejected: { x: number; z: number; heading: number } | null
}

/** 乗り降りを1歩進める。ボタンが押されたら始め、段階ごとの間を数えて次へ移る */
export function stepBoarding(
  p: PlayerState,
  mode: PlayMode,
  vehicles: VehicleState[],
  sizeOf: (v: VehicleState) => CarSize,
  input: InputFrame,
  world: GtoWorld,
  dt: number,
): BoardingStep {
  const same: BoardingStep = { player: p, mode, vehicles, events: [], ejected: null }
  const b = p.boarding
  if (b == null) {
    if (input.enter && p.busy <= 0) return begin(p, mode, vehicles, sizeOf, world)
    // 降りたばかりの車の覚えを減らす
    const left = p.leftCar
    if (left == null) return same
    return { ...same, player: { ...p, leftCar: left.t > dt ? { ...left, t: left.t - dt } : null } }
  }

  const v = vehicles.find((o) => o.id === b.vehicleId)
  // 車が消えた（遠くで片付けられた等）ら取りやめる
  if (!v) return { ...same, player: { ...p, boarding: null, vehicleId: null, busy: 0 }, mode: 'foot' }
  const size = sizeOf(v)
  // 閉まったあとの間に走り出したら、間を早送りする（カメラは飛ばずに、早く運転の画へ移る）
  const rush = b.phase === 'shut' && b.t >= BOARD_TUNING.shut && Math.abs(v.speed) > BOARD_TUNING.shutHoldSpeed
  const t = b.t + dt * (rush ? BOARD_TUNING.shutHoldRush : 1)
  const hold = Math.max(p.busy, dt * 2)
  const next = (phase: Boarding['phase']): Boarding => ({ ...b, phase, t: 0, dt })
  const tick: Boarding = { ...b, t, dt }

  switch (b.phase) {
    case 'approach':
      return approachDoor(p, tick, v, size, vehicles, input, world, dt)
    case 'open': {
      const stay = { ...same, vehicles: swap(vehicles, pinned(v)) }
      if (t < BOARD_TUNING.open) return { ...stay, player: { ...p, speed: 0, busy: hold, boarding: tick } }
      if (!b.jack) return takeSeat(p, next('sit'), v, vehicles)
      // 運転手は、主人公のすぐ外隣（車と反対の側・少し後ろ）へ降ろされる。主人公の真後ろには置かない
      // （斜め後ろから見ているカメラと主人公のあいだに立つと、カメラがよけて真上からの画へ跳ぶ）
      const f = dirOf(v.heading)
      const d = doorPoint(v, size, b.side)
      const out = world.resolveCircle(d.x - f.x * 0.25 - f.z * 0.8 * b.side, d.z - f.z * 0.25 + f.x * 0.8 * b.side, FOOT_TUNING.radius)
      return {
        ...stay,
        player: { ...p, speed: 0, busy: hold, boarding: next('pull') },
        events: [{ type: 'carjack', x: v.x, z: v.z, ref: String(v.id) }],
        ejected: { x: out.x, z: out.z, heading: headingOf(out.x - v.x, out.z - v.z) },
      }
    }
    case 'pull': {
      if (t >= BOARD_TUNING.pull) return takeSeat(p, next('sit'), v, vehicles)
      return { ...same, vehicles: swap(vehicles, pinned(v)), player: { ...p, speed: 0, busy: hold, boarding: tick } }
    }
    case 'sit':
    case 'shut': {
      const done = b.phase === 'sit' ? t >= BOARD_TUNING.sit : t >= BOARD_TUNING.shut + BOARD_TUNING.shutHold
      const boarding = !done ? tick : b.phase === 'sit' ? next('shut') : null
      // 走り出せるようになったら車を止めておかない（ドアを閉めながら発進できる）
      const cars = canDrive({ ...p, boarding: tick }) ? vehicles : swap(vehicles, pinned(v))
      return { ...same, vehicles: cars, player: { ...p, speed: 0, busy: boarding ? hold : 0, boarding } }
    }
    case 'unlatch': {
      // まず停める。停まってドアが開いたら外へ
      const slowed = { ...v, speed: approach(v.speed, 0, 22 * dt), slip: approach(v.slip, 0, 22 * dt) }
      if (t < BOARD_TUNING.unlatch || Math.abs(slowed.speed) > 0.6) {
        return { ...same, vehicles: swap(vehicles, slowed), player: { ...p, busy: hold, boarding: tick } }
      }
      // 外へ出るあいだも運転の構えのまま（カメラは車の後ろに留まる）。歩きへ切り替えるのは出きってから
      const d = doorPoint(v, size, b.side)
      return {
        ...same,
        vehicles: swap(vehicles, pinned(v)),
        player: { ...p, speed: 0, busy: hold, boarding: next('out') },
        events: [{ type: 'exit', x: d.x, z: d.z }],
      }
    }
    case 'out': {
      // 体が出きったら、ドアの横に立って手で押して閉める。スティックを倒せば切り上げて歩き出す（ドアは続きを自分で閉まる）
      const walkOff = t >= BOARD_TUNING.out && Math.hypot(input.moveX, input.moveY) > 0.5
      if (t < BOARD_TUNING.out + BOARD_TUNING.push && !walkOff) {
        return { ...same, vehicles: swap(vehicles, pinned(v)), player: { ...p, speed: 0, busy: hold, boarding: tick } }
      }
      // 歩ける段階は、押しかけのドアの閉まり具合の続きから始める（ドアが跳ばない）
      const left: Boarding = { ...b, phase: 'leave', t: pushShut(pushProgress(t)) * BOARD_TUNING.leave, dt }
      const d = doorPoint(v, size, b.side)
      const at = world.resolveCircle(d.x, d.z, FOOT_TUNING.radius)
      return {
        ...same,
        mode: 'foot',
        vehicles: swap(vehicles, { ...pinned(v), driver: 'none' }),
        player: {
          ...p,
          x: at.x,
          y: world.groundY(at.x, at.z),
          z: at.z,
          // 向きは車と同じまま（カメラが車の向こう側へ回り込まないように）。外へ向く姿は boardingPose が決める
          heading: v.heading,
          speed: 0,
          running: false,
          vehicleId: null,
          busy: 0,
          boarding: left,
        },
      }
    }
    case 'leave':
      if (t < BOARD_TUNING.leave) return { ...same, player: { ...p, boarding: tick } }
      return { ...same, player: { ...p, boarding: null, leftCar: { vehicleId: b.vehicleId, t: BOARD_TUNING.settle, side: b.side } } }
  }
}

/** [cheats] 主人公から、車体の長方形の縁までの距離 m（中にいれば 0） */
function hullGap(p: { x: number; z: number }, v: VehicleState): number {
  const spec = VEHICLE_SPECS[v.kind]
  const f = dirOf(v.heading)
  const fw = (p.x - v.x) * f.x + (p.z - v.z) * f.z
  const out = (p.x - v.x) * -f.z + (p.z - v.z) * f.x
  return Math.hypot(Math.max(0, Math.abs(fw) - spec.length / 2), Math.max(0, Math.abs(out) - spec.width / 2))
}
/** [cheats] 戦車と飛行機から降りられる速さの上限 m/s（ドアの演技が無く、その場で降りるので、ほぼ止まっているときだけ） */
const SPECIAL_EXIT_SPEED = 2

/**
 * [cheats] 戦車と飛行機の乗り降り。ドアの演技は省いて、その 1 歩で入れ替わる。
 * 降りる: ほぼ止まっていて、飛行機なら接地しているときだけ。車体の横（塞がっていれば反対側・後ろ）に立つ
 * 乗る: そのまま運転席へ
 */
function beginSpecial(p: PlayerState, mode: PlayMode, vehicles: VehicleState[], sizeOf: (v: VehicleState) => CarSize, world: GtoWorld, mine: VehicleState | undefined, target: VehicleState | null): BoardingStep {
  const same: BoardingStep = { player: p, mode, vehicles, events: [], ejected: null }
  if (mine) {
    if (Math.abs(mine.speed) >= SPECIAL_EXIT_SPEED || (mine.alt ?? 0) > 0) return same
    const side = pickSide(mine, sizeOf(mine), 1, world, vehicles, sizeOf)
    const d = doorPoint(mine, sizeOf(mine), side)
    const at = world.resolveCircle(d.x, d.z, FOOT_TUNING.radius)
    return {
      ...same,
      mode: 'foot',
      vehicles: swap(vehicles, { ...pinned(mine), driver: 'none' }),
      player: { ...p, x: at.x, y: world.groundY(at.x, at.z), z: at.z, heading: mine.heading, speed: 0, running: false, vehicleId: null, busy: 0, boarding: null, leftCar: null },
      events: [{ type: 'exit', x: at.x, z: at.z }],
    }
  }
  if (!target) return same
  return takeSeat(p, null, target, vehicles)
}

/** ボタンが押された1歩: 降り始めるか、乗る相手を決めてドアへ向かう */
function begin(p: PlayerState, mode: PlayMode, vehicles: VehicleState[], sizeOf: (v: VehicleState) => CarSize, world: GtoWorld): BoardingStep {
  const same: BoardingStep = { player: p, mode, vehicles, events: [], ejected: null }
  const mine = vehicles.find((v) => v.id === p.vehicleId)
  if (mine && isSpecial(mine.kind)) return beginSpecial(p, mode, vehicles, sizeOf, world, mine, null)
  if (mine) {
    if (Math.abs(mine.speed) >= BOARD_TUNING.exitSpeed) return same
    const side = pickSide(mine, sizeOf(mine), 1, world, vehicles, sizeOf)
    return { ...same, player: { ...p, boarding: { phase: 'unlatch', vehicleId: mine.id, side, t: 0, jack: false } } }
  }
  const target = findEnterable(p, vehicles)
  if (!target) return same
  if (isSpecial(target.kind)) return beginSpecial(p, mode, vehicles, sizeOf, world, undefined, target)
  const jack = target.driver === 'traffic' || target.driver === 'police'
  const side = pickSide(target, sizeOf(target), sideOf(p, target), world, vehicles, sizeOf)
  return {
    ...same,
    // 運転手はその場で車を停める（道筋から外す）
    vehicles: jack ? swap(vehicles, { ...target, driver: 'none', route: null }) : vehicles,
    player: { ...p, boarding: { phase: 'approach', vehicleId: target.id, side, t: 0, jack } },
  }
}

/** ドアの外まで走る。スティックを倒すか、時間が掛かりすぎたら取りやめる */
function approachDoor(
  p: PlayerState,
  b: Boarding,
  v: VehicleState,
  size: CarSize,
  vehicles: VehicleState[],
  input: InputFrame,
  world: GtoWorld,
  dt: number,
): BoardingStep {
  const car = b.jack ? { ...v, speed: approach(v.speed, 0, 16 * dt) } : v
  const cars = b.jack ? swap(vehicles, car) : vehicles
  const base: BoardingStep = { player: p, mode: 'foot', vehicles: cars, events: [], ejected: null }
  const d = doorPoint(car, size, b.side)
  const gap = Math.hypot(d.x - p.x, d.z - p.z)
  const cancel =
    (b.t > 0.2 && Math.hypot(input.moveX, input.moveY) > 0.5) ||
    b.t > BOARD_TUNING.approachTimeout ||
    gap > FOOT_TUNING.enterRange * 3
  if (cancel) return { ...base, player: { ...p, boarding: null } }

  const hold = Math.max(p.busy, dt * 2)
  if (gap < 0.12 && Math.abs(car.speed) < 1.5) {
    return {
      ...base,
      vehicles: swap(cars, pinned(car)),
      player: { ...p, x: d.x, y: world.groundY(d.x, d.z), z: d.z, heading: doorFacing(car, b.side), speed: 0, running: false, busy: hold, boarding: { ...b, phase: 'open', t: 0 } },
    }
  }
  const speed = Math.min(approach(p.speed, BOARD_TUNING.approachSpeed, FOOT_TUNING.accel * dt), gap / dt)
  const want = headingOf(d.x - p.x, d.z - p.z)
  const step = dirOf(want)
  const res = world.resolveCircle(p.x + step.x * speed * dt, p.z + step.z * speed * dt, FOOT_TUNING.radius)
  const moved = Math.hypot(res.x - p.x, res.z - p.z)
  return {
    ...base,
    player: {
      ...p,
      x: res.x,
      y: world.groundY(res.x, res.z),
      z: res.z,
      heading: p.heading + clamp(angleDiff(p.heading, want), -FOOT_TUNING.turnRate * dt, FOOT_TUNING.turnRate * dt),
      speed,
      running: speed > FOOT_TUNING.walkSpeed,
      stride: p.stride + moved / gaitOf(speed).strideLength,
      busy: hold,
      boarding: b,
    },
  }
}

/** 座り始める: ここで運転手になり、カメラは運転の構えへ移り始める（発進はドアが閉まってから） */
function takeSeat(p: PlayerState, boarding: Boarding | null, v: VehicleState, vehicles: VehicleState[]): BoardingStep {
  const car: VehicleState = { ...pinned(v), driver: 'player', route: null }
  return {
    player: { ...p, x: car.x, y: car.y, z: car.z, heading: car.heading, speed: 0, running: false, vehicleId: car.id, busy: 0, boarding },
    mode: 'drive',
    vehicles: swap(vehicles, car),
    events: [{ type: 'enter', x: car.x, z: car.z }],
    ejected: null,
  }
}

/** カメラが追う相手（camera.ts の CameraTarget と同じ形） */
export interface CameraSubject {
  x: number
  y: number
  z: number
  heading: number
  speed: number
  mode: PlayMode
  /** 乗り降りの段（camera.ts の CameraStage と同じ形）。あるあいだ、カメラは車の斜め後ろ外側に留まる */
  stage?: { x: number; y: number; z: number; heading: number; width: number; side: Boarding['side']; k: number }
  /** [cheats] camera.ts の CameraTarget と同じ: 大きな乗り物の引きの倍率と、空を飛んでいるか */
  reach?: number
  air?: boolean
}

/** [cheats] 戦車と飛行機を撮るときの、引きの倍率（ふだんの車の距離に対して） */
const SPECIAL_CAMERA: Partial<Record<VehicleKind, number>> = { tank: 1.55, plane: 1.8 }

/** 乗り込みの途中で走り出した車は、速さに沿って段を抜く（1 = 停まっている、0 = もう走っている） */
const rolling = (v: VehicleState): number => 1 - smooth((Math.abs(v.speed) - BOARD_TUNING.shutHoldSpeed) / BOARD_TUNING.stageRollOff)

/**
 * 乗り降りの段の効き 0..1（camera.ts がふだんの背後カメラと段の画を混ぜる割合）。
 *   乗る … ドアへ近づくにつれて入れ、ドアを開ける・座る・閉めるあいだは 1。閉まったあとの間（shutHold）の後半で抜く。
 *          途中で走り出したら、速さに沿って抜く（rolling）
 *   降りる … ドアが開き始めたら入れ、体が出る・ドアを閉めるあいだは 1。歩けるようになってから settle 秒で抜く
 */
export function stageAmount(p: PlayerState, v: VehicleState, size: CarSize): number {
  const B = BOARD_TUNING
  const b = p.boarding
  if (b == null) return p.leftCar != null && p.leftCar.vehicleId === v.id ? smooth(p.leftCar.t / B.settle) : 0
  switch (b.phase) {
    case 'approach': {
      // 遠くから走ってくるあいだは背後カメラのまま（主人公が画面から外れない）。ドアの近くで段の画へ移る
      const d = doorPoint(v, size, b.side)
      const gap = Math.hypot(d.x - p.x, d.z - p.z)
      return smooth(b.t / B.stageIn) * (1 - clamp((gap - B.stageNear) / B.stageFar, 0, 1))
    }
    case 'sit':
      return rolling(v)
    case 'shut':
      return (1 - smooth((b.t - B.shut - B.shutHold * B.stageKeep) / (B.shutHold * (1 - B.stageKeep)))) * rolling(v)
    case 'unlatch':
      return smooth(b.t / B.stageIn)
    case 'out':
      return smooth((B.unlatch + b.t) / B.stageIn)
    default:
      return 1
  }
}

/**
 * カメラが追う相手。主人公（運転中は車）そのものに、乗り降りのあいだだけ「段」を添える。
 * 段があるあいだ、カメラは車の斜め後ろ外側（ドアの見える側）に一定の距離で留まり、車体の全体・人物の全身・ドアが
 * 1 画面に入る（camera.ts の STAGE_TUNING）。相手の点そのものは動かさないので、段が抜ければふだんの背後カメラへ戻る
 */
export function cameraSubject(p: PlayerState, mode: PlayMode, vehicles: VehicleState[]): CameraSubject {
  const riding = mode === 'drive' ? vehicles.find((o) => o.id === p.vehicleId) : undefined
  const reach = riding ? SPECIAL_CAMERA[riding.kind] : undefined
  // 飛んでいるあいだは、乗り物の高さを追う（地上では主人公の y のまま）
  const air = riding != null && (riding.alt ?? 0) > 0
  const own: CameraSubject = { x: p.x, y: air && riding ? riding.y : p.y, z: p.z, heading: p.heading, speed: p.speed, mode, ...(reach ? { reach } : {}), ...(air ? { air } : {}) }
  const id = p.boarding?.vehicleId ?? p.leftCar?.vehicleId
  const v = id == null ? undefined : vehicles.find((o) => o.id === id)
  if (!v) return own
  const size = VEHICLE_SPECS[v.kind]
  const k = stageAmount(p, v, size)
  if (k <= 0) return own
  const side = p.boarding?.side ?? p.leftCar?.side ?? 1
  return { ...own, stage: { x: v.x, y: v.y, z: v.z, heading: v.heading, width: size.width, side, k } }
}

/** カメラがよける相手から外す車（乗り降りの相手と、降りたばかりの車）。無ければ null */
export function crowdExempt(p: PlayerState): number | null {
  return p.boarding?.vehicleId ?? p.leftCar?.vehicleId ?? null
}

/** 描画が読む、乗り降りの途中の姿 */
export interface BoardingPose {
  /** 主人公を描く位置と向き */
  x: number
  z: number
  heading: number
  /** 主人公を描くか（ドアが閉まったあとは車内なので描かない） */
  visible: boolean
  /** 腰を座面の高さへ落とした度合い 0..1（1 で座りきった） */
  sink: number
  /** 車体の輪郭の内側へ入った度合い 0..1（0 は開口の前＝車体の外、1 は座席） */
  inside: number
  /** ドアの開き具合 0..1 */
  door: number
  /** 運転手を引っぱり出している度合い 0..1 */
  pull: number
  side: Boarding['side']
  vehicleId: number
}

export function boardingPose(p: PlayerState, v: VehicleState, size: CarSize): BoardingPose | null {
  const b = p.boarding
  if (b == null || b.vehicleId !== v.id) return null
  const d = doorPoint(v, size, b.side)
  const seat = seatPoint(v, size, b.side)
  const facing = doorFacing(v, b.side)
  const base = { side: b.side, vehicleId: v.id, pull: 0 }
  // ドアの外 → 開口の前（開いたドアと車体のあいだ。座席の真横の少し後ろ）→ 座席、と回り込む
  const frame = doorFrame(v, size)
  const sill =
    b.side === 0
      ? { x: lerp(d.x, seat.x, 0.5), z: lerp(d.z, seat.z, 0.5) }
      : carPoint(v, frame.seatFw - BOARD_TUNING.sillBack, (frame.sideOut + BOARD_TUNING.sillGap) * b.side)
  // u は座る動きの進み具合（降りるときは逆に辿る）: 踏み込む → 車体の外で屈む → 滑り込む
  const seated = (u: number) => {
    const step = beat(u, SEAT_BEATS.step)
    const slide = beat(u, SEAT_BEATS.slide)
    const ax = lerp(d.x, sill.x, step)
    const az = lerp(d.z, sill.z, step)
    return { x: lerp(ax, seat.x, slide), z: lerp(az, seat.z, slide), sink: seatSink(u), inside: slide }
  }
  // 踏み込みながら、立っていたときの向き（from）から車の前へ体を回す。屈むころには前を向いている
  const turned = (from: number, u: number) => from + angleDiff(from, v.heading) * beat(u, SEAT_BEATS.turn)
  switch (b.phase) {
    case 'approach':
      return { ...base, x: p.x, z: p.z, heading: p.heading, visible: true, sink: 0, inside: 0, door: 0 }
    case 'open':
      return { ...base, x: d.x, z: d.z, heading: facing, visible: true, sink: 0, inside: 0, door: smooth((b.t / BOARD_TUNING.open - DOOR_BEATS.openFrom) / (1 - DOOR_BEATS.openFrom)) }
    case 'pull':
      return { ...base, x: d.x, z: d.z, heading: facing, visible: true, sink: 0, inside: 0, door: 1, pull: Math.sin(clamp(b.t / BOARD_TUNING.pull, 0, 1) * Math.PI) }
    case 'sit': {
      const u = clamp(b.t / BOARD_TUNING.sit, 0, 1)
      // 座りきるまで描く（車内へ入った体は、開いたドアの開口越しに見える。renderActorSeat）
      return { ...base, ...seated(u), heading: turned(facing, u), visible: true, door: 1 }
    }
    case 'shut': {
      // 座った体は、ドアが閉まりきる直前まで開口越しに見えている
      const door = 1 - smooth((b.t / BOARD_TUNING.shut - DOOR_BEATS.shutFrom) / (1 - DOOR_BEATS.shutFrom))
      // ドアが閉まるにつれて、開口寄りの位置から本当の座席へ寄る（閉まったドアの外板から肘が出ない）
      const deep = b.side === 0 ? seat : drivingSeat(v, size, b.side)
      return { ...base, x: lerp(deep.x, seat.x, door), z: lerp(deep.z, seat.z, door), heading: v.heading, visible: door > SEAT_SEEN_DOOR, sink: 1, inside: 1, door }
    }
    case 'unlatch': {
      // 手を当ててから、押す手と一緒に半分過ぎまで開く。残りは体が出はじめるのと一緒に開ききる（開いたのに誰もいない間を作らない）
      const door = DOOR_BEATS.unlatchOpen * smooth((b.t / BOARD_TUNING.unlatch - DOOR_BEATS.unlatchFrom) / (1 - DOOR_BEATS.unlatchFrom))
      // 本当の座席から、開口寄りの位置へ出てくる
      const deep = b.side === 0 ? seat : drivingSeat(v, size, b.side)
      const k = door / DOOR_BEATS.unlatchOpen
      return { ...base, x: lerp(deep.x, seat.x, k), z: lerp(deep.z, seat.z, k), heading: v.heading, visible: door > SEAT_SEEN_DOOR, sink: 1, inside: 1, door }
    }
    case 'out': {
      const u = 1 - outProgress(b.t)
      // 立ち上がったら体は少し外へ向く（車に背を向けきらない。閉めるドアは斜め前にある）
      const stand = v.heading + angleDiff(v.heading, doorAcross(v, b.side) + Math.PI) * BOARD_TUNING.outTurn
      const opened = DOOR_BEATS.unlatchOpen + (1 - DOOR_BEATS.unlatchOpen) * smooth(b.t / (BOARD_TUNING.out * 0.25))
      // 出きったら、ドアの横に立ったまま手で押して閉める（押す手と同じ速さで閉まる）
      const door = b.t > BOARD_TUNING.out ? 1 - smooth(pushShut(pushProgress(b.t))) : opened
      return { ...base, ...seated(u), heading: turned(stand, u), visible: true, door }
    }
    case 'leave':
      return { ...base, x: p.x, z: p.z, heading: p.heading, visible: true, sink: 0, inside: 0, door: 1 - smooth(b.t / BOARD_TUNING.leave) }
  }
}
