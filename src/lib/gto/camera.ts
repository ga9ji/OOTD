// Grand Theft Outfit [部品: camera] 背後カメラ。
// 入口: createCamera(target) / stepCamera(cam, target, input, world, dt, crowd?) / viewFov(fov, aspect) / moveFrame(cam, input)
// 契約: 追う相手（CameraTarget）と入力だけを見て、次の CameraState を返す。
//       他の部品の状態は読まない。描画側は CameraState をそのまま three のカメラへ写す。
// 考え方: 位置は相手に固く付いていき、向きだけ遅れて追う（曲がると相手の側面が一瞬見える）。
//         画角は速度で変えない。距離は速さのぶんだけ少し遅れる（発進で相手が先へ出て、急停止・衝突でカメラが詰める）。
//         壁には一歩も入らず、カメラのすぐ前の通行人は手前へ寄ってよける。
//         徒歩のスティックは「押し始めたときの画面」を基準に読む（moveFrame）。押しっぱなしなら主人公は
//         世界の中をまっすぐ走り、カメラが背後へ回り込んで背中が映る（横向きのまま円を描き続けない）。
import { angleDiff, clamp, damp, DEG, dirOf } from './math'
import type { CameraState, GtoWorld, InputFrame, PlayMode } from './types'

export interface CameraTarget {
  x: number
  y: number
  z: number
  heading: number
  speed: number
  mode: PlayMode
  /** [onfoot] 乗り降りの段。あるあいだ、カメラは車の斜め後ろ外側に一定の距離で留まる（無ければふだんの背後カメラ） */
  stage?: CameraStage
}

/** [onfoot] 乗り降りの段: 相手の車と、使うドアの側 */
export interface CameraStage {
  /** 車の中心（足元）と向き */
  x: number
  y: number
  z: number
  heading: number
  /** 車幅 m */
  width: number
  /** 使うドアの側。1=右、−1=左、0=後ろ */
  side: 1 | -1 | 0
  /** 効き 0..1（0 はふだんの背後カメラ、1 は段の画） */
  k: number
}

/** カメラがよける相手。r が無ければ通行人（薄い板）、あれば車などの固い円 */
export interface CameraCrowd {
  x: number
  z: number
  r?: number
}

/** 車を、カメラがよける円の列（前・中・後ろ）にする。sim が自分の乗っていない車について呼ぶ */
export function vehicleCrowd(v: { x: number; z: number; heading: number }, length: number, width: number): CameraCrowd[] {
  const d = dirOf(v.heading)
  const r = width * 0.5
  const reach = Math.max(0, length * 0.5 - r)
  return [-1, 0, 1].map((k) => ({ x: v.x + d.x * reach * k, z: v.z + d.z * reach * k, r }))
}

interface ModeTuning {
  /** 軸（相手の足元から height 上の点）からカメラまでの距離 m */
  dist: number
  /** 軸からカメラを見上げる角（ラジアン）。カメラの高さ = height + dist·sin(pitch) */
  pitch: number
  /** 縦の画角（度、横長の画面のとき） */
  fov: number
  /** 向きを追う強さ（1/秒）。残りの角度 × これ が回る速さになる */
  follow: number
  /** 回る速さの上限（ラジアン/秒） */
  maxTurn: number
  /** この速さ（m/s）以上で、追う強さが満額になる */
  fullSpeed: number
  /** 相手がカメラへ向かってくるとき、真正面からこの角度（ラジアン）以内は回り込まない */
  deadBack: number
  /** 手で回したあと、自動で追い始めるまでの秒 */
  idleDelay: number
  /** 視線の先読み（ラジアン）。相手が真横を向いたとき、視線だけこの角度ぶん進む先へ振る。
   *  曲がっている最中に相手が画面の中央から外側へずれ、進む先が広く見える */
  lead: number
  /** 壁や車で詰まっても、軸からこの距離 m より近くへは寄らない。それ以上詰めるときは、同じ水平距離のまま
   *  上へ逃げて見下ろす（主人公に貼り付いたり、自分の車の中へ入ったりしない） */
  near: number
  /** 見ている向きを水平からどれだけ下げるか（ラジアン）。地平線の高さを決める */
  look: number
}

/**
 * 手触りを決める数字。ここを変えれば他の部品に触らず調整できる。
 * 16:9 の画面での狙い（実測の目標値）:
 *   バーは 4:3。横長の画面へ幅の割合のまま写すと自機が縦に大きくなりすぎ、足元と前方の路面が隠れる。
 *   そこで占有率は画面の「高さ」に対して合わせる（バーの車幅 25%（4:3）= 画面高の 33%）。
 *   徒歩 … くり抜きの絵（板の中の 0.14〜1.67m）が画面高の 36%、頭 45%・足 81%、地平線 41%。
 *          カメラは頭より上（1.85m、3.95m 後ろ）から少し見下ろす。足の下に路面が 2 割近く残り、
 *          主人公の頭の上と左右に進む先の路面が見える（走る姿勢や旋回でも足が下端で切れない）
 *   運転 … 見えている車体の幅が画面高の 33%（16:9 の幅の 18〜19%）、屋根 58%、後端の地面 85%、地平線 48%
 *          （高さ 2.0m、後端から 5.0m 後ろ）。車の全周と、その下・左右の路面が見える
 */
export const CAMERA_TUNING = {
  foot: { dist: 4.063, pitch: 0.236, fov: 55, follow: 3, maxTurn: 1.45, fullSpeed: 1.5, deadBack: 0.5, idleDelay: 2.4, lead: 0.19, near: 3.1, look: 0.096 } as ModeTuning,
  drive: { dist: 7.3, pitch: 0.14, fov: 53, follow: 2.3, maxTurn: 9, fullSpeed: 4, deadBack: 0.1, idleDelay: 0.9, lead: 0.14, near: 5.4, look: 0.02 } as ModeTuning,
  /** 軸の高さ m（相手の足元から） */
  height: 0.9,
  /** これより遅い相手の向きは追わない（m/s） */
  followFrom: 0.6,
  pitchMin: -0.35,
  pitchMax: 1.1,
  /** 上下の角度が既定へ戻る速さ（1/秒） */
  pitchRate: 4,
  /** 軸のずれ（乗り降りで相手が瞬間移動した分、段差）を詰める速さ（1/秒） */
  pivotRate: 6,
  /** これより離れたら、なめらかに追わずに飛ぶ（m） */
  snapDist: 14,
  /** 距離を伸ばす速さ（1/秒）。徒歩→運転の引きが 0.6〜0.8 秒になる */
  distOut: 3.3,
  /** 通行人をよけて寄る速さ（1/秒） */
  distIn: 16,
  /** 速さ 1m/s ごとに後ろへ遅れる距離 m（= 秒）。発進・加速で相手が先へ出る */
  trailTime: 0.045,
  /** 遅れの上限 m（全開でも車の大きさは 15% しか変わらない） */
  trailMax: 1.3,
  /** 遅れが伸びる速さ（1/秒）。加速に 1 秒ほど遅れて離れる */
  trailOut: 2.5,
  /** 遅れを詰める速さ（1/秒）。急ブレーキ・衝突で 0.3〜0.5 秒かけて寄る */
  trailIn: 5,
  /** 画角を切り替える速さ（1/秒） */
  fovRate: 4,
  /** 壁に当たったときに残す最短の距離 */
  minDist: 0.7,
  /** 詰まって上へ逃げるときの、見上げる角の上限（ラジアン） */
  squeezePitch: 1.3,
  /** 上へ逃げる・戻る速さ（1/秒） */
  riseRate: 12,
  /** 壁の手前に残す隙間 m */
  wallGap: 0.35,
  /** 左右の探り針の開き m（カメラの位置で）。レンズの手前の面（近接面）の半幅ぶん。ここに壁が掛かるなら一歩も譲らず寄る
   *  （壁の内側が透けて見えないように）。体の半径 0.35m より狭いので、壁に体を付けて歩いても掛からない */
  whisker: 0.3,
  /** 外側の探り針の開き m。ここに壁が掛かる所（狭い路地・壁沿い）では、なめらかに少しだけ寄る */
  alleyWhisker: 0.9,
  /** 外側の探り針で寄るのは、本来の距離のこの割合まで（バーの路地: 主人公の高さ 50% → 55〜60%） */
  alleyFloor: 0.86,
  /** 壁を探す刻み m */
  probeStep: 0.2,
  /** 視線の先読みを入れる・抜く速さ（1/秒） */
  leadRate: 7,
  /** 通行人: カメラの軸からこの横幅 m 以内にいたらよける */
  crowdSide: 0.55,
  /** 通行人: カメラの前 1m ごとに、よける横幅をこれだけ広げる（視野の端に大きく映る人もよける） */
  crowdSpread: 0.8,
  /** 通行人: カメラの前この距離 m までを「すぐ前」とみなす */
  crowdNear: 1.3,
  /** 通行人: その人の何 m 手前までカメラを出すか */
  crowdGap: 0.7,
  /** 通行人: 本来の距離のこの割合より近くへは寄らない。それより手前の人には、ここまで寄って上から見下ろす
   *  （主人公のほうから歩いてくる人を、レンズに届く前からよけ始める） */
  crowdFloor: 0.42,
  /** 通行人: 主人公からこの距離 m 以内の人はよけない（隣を歩く人。主人公と同じ大きさに映る） */
  crowdSkip: 0.9,
  /** 車: 車体の円からこれだけ手前で止める m。車は通行人と違い、どこまでも寄ってよける */
  solidGap: 0.3,
  /** 縦長の画面で確保する横の画角（度） */
  minHorizontalFov: 50,
  /** スティック: これより小さい倒し方は中立とみなす */
  stickDead: 0.05,
  /** スティック: 押している向きが、基準を決めたときからこの角度（ラジアン）以上変わったら、いまの画面を基準にやり直す。
   *  キーボードの 45° 刻みの持ち替えは必ずやり直し、アナログの小さな傾け直しはそのまま舵になる */
  stickRelatch: 0.7,
}

/**
 * [onfoot] 乗り降りの段の数字。ふだんの徒歩・運転の数字（CAMERA_TUNING）とは別に持つ。
 * 狙い: 車の斜め後ろ外側（ドアのある側）から、車体の全体・人物の全身・開いたドアが 1 画面に入る。
 *       軸は車の上（中心からドアの側へ少し寄せた点）で、距離は一定。車体の中へは入らない
 */
export const STAGE_TUNING = {
  /** 軸からカメラまでの距離 m（車体の対角の半分 2.4m より十分長い） */
  dist: 5.0,
  /** 軸からカメラを見上げる角（ラジアン）。カメラの高さ = height + dist·sin(pitch) */
  pitch: 0.15,
  /** 注視点の高さ m（車の足元から）。車体と人物の胴のあたり */
  lookY: 0.85,
  /** 軸を車の中心からドアの側へ寄せる量（車幅の半分に対する割合）と、後ろへ寄せる量 m。
   *  斜め後ろからは手前の後端が大きく写るので、後ろへ寄せておくと車体の全体が画面の中央に収まる */
  lean: 0.3,
  aft: 0.55,
  /** カメラの向き: 車の真後ろ向きから、ドアの外側へこの角度（ラジアン）だけ回り込んだ斜め後ろ */
  quarter: 0.62,
  /** 斜め後ろが壁で詰まるときに試す、ほかの回り込み角（先のものほど優先。負は反対の側） */
  fallback: [0.3, 0, -0.3, -0.62] as readonly number[],
  /** 候補の向きは、壁に入らずにこの割合まで下がれれば採る */
  roomy: 0.85,
  /** 段の向きへ回る速さ（1/秒）と、手で回したあとに自動で回り始めるまでの秒 */
  turnRate: 5,
  idleDelay: 0.8,
  /** 壁で詰まって寄る速さ・離れる速さ（1/秒） */
  flatIn: 14,
  flatOut: 3,
  /** 詰まっても、軸からこの水平距離 m より近くへは寄らない（そのぶん上へ逃げて見下ろす。車体には入らない） */
  minFlat: 1.2,
}

/** スティックの向き（前が 0・右が＋）。中立なら null */
const stickAngle = (input: InputFrame): number | null =>
  Math.hypot(input.moveX, input.moveY) > CAMERA_TUNING.stickDead ? Math.atan2(input.moveX, input.moveY) : null

/** 押しっぱなしが続いている（基準を持ち越す）か */
const held = (cam: CameraState, stick: number | null): boolean =>
  stick != null && cam.stick != null && cam.moveYaw != null && Math.abs(angleDiff(cam.stick, stick)) < CAMERA_TUNING.stickRelatch

/**
 * 徒歩のスティックを世界の向きへ直すときの基準の向き。sim が stepOnFoot へ渡す。
 * 押し始め・向きの持ち替え・中立ではカメラの向きそのもの。押しっぱなしのあいだは押し始めの基準のまま
 * （カメラが自動で背後へ回り込んでも、同じ入力は同じ世界の向きを指す）。
 */
export function moveFrame(cam: CameraState, input: InputFrame): number {
  return held(cam, stickAngle(input)) ? (cam.moveYaw as number) : cam.yaw
}

/** 縦長の画面では横の画角が狭くなりすぎるので、縦の画角を広げる。描画側がカメラへ写すときに通す */
export function viewFov(fov: number, aspect: number): number {
  if (!(aspect > 0)) return fov
  const need = (2 * Math.atan(Math.tan((CAMERA_TUNING.minHorizontalFov * DEG) / 2) / aspect)) / DEG
  return Math.max(fov, need)
}

interface Pivot {
  x: number
  y: number
  z: number
}

/** 軸・向き・角度・距離から、カメラの位置と注視点を決める */
const placed = (
  pivot: Pivot,
  yaw: number,
  pitch: number,
  dist: number,
  tune: ModeTuning,
  lead = 0,
): Pick<CameraState, 'x' | 'y' | 'z' | 'tx' | 'ty' | 'tz'> => {
  const d = dirOf(yaw)
  // 位置は yaw の真後ろ、視線だけ lead ぶん先（相手の進む側）へ振る
  const v = dirOf(yaw + lead)
  const flat = Math.cos(pitch) * dist
  const x = pivot.x - d.x * flat
  const y = pivot.y + CAMERA_TUNING.height + Math.sin(pitch) * dist
  const z = pivot.z - d.z * flat
  // 注視点は相手ではなく「カメラの前方」。相手の画面内の位置は、カメラの高さと距離で決まる
  const look = tune.look + (pitch - tune.pitch)
  const reach = Math.max(dist, 1)
  return {
    x,
    y,
    z,
    tx: x + v.x * Math.cos(look) * reach,
    ty: y - Math.sin(look) * reach,
    tz: z + v.z * Math.cos(look) * reach,
  }
}

export function createCamera(target: CameraTarget): CameraState {
  const tune = CAMERA_TUNING[target.mode]
  return {
    ...placed(target, target.heading, tune.pitch, tune.dist, tune),
    yaw: target.heading,
    pitch: tune.pitch,
    dist: tune.dist,
    fov: tune.fov,
    idle: 99,
    lead: 0,
    px: target.x,
    py: target.y,
    pz: target.z,
  }
}

/** 相手の向きへ、このコマで回す角度。徒歩は一定の速さで回り、最後だけゆっくり止まる */
function followStep(diff: number, tune: ModeTuning, speed: number, dt: number): number {
  const a = Math.abs(diff)
  const fade = clamp((Math.PI - a) / tune.deadBack, 0, 1)
  const gain = clamp(speed / tune.fullSpeed, 0.2, 1)
  const rate = Math.min(a * tune.follow, tune.maxTurn) * fade * gain
  return Math.sign(diff) * Math.min(a, rate * dt)
}

/** 相手が進んだ分は先に進め、残りのずれ（乗り降りの瞬間移動・段差）だけをなめらかに詰める */
function stepPivot(cam: CameraState, target: CameraTarget, dt: number): Pivot {
  const d = dirOf(target.heading)
  const ox = (cam.px ?? target.x) + d.x * target.speed * dt - target.x
  const oy = (cam.py ?? target.y) - target.y
  const oz = (cam.pz ?? target.z) + d.z * target.speed * dt - target.z
  if (Math.hypot(ox, oy, oz) > CAMERA_TUNING.snapDist) return { x: target.x, y: target.y, z: target.z }
  const keep = Math.exp(-CAMERA_TUNING.pivotRate * dt)
  return { x: target.x + ox * keep, y: target.y + oy * keep, z: target.z + oz * keep }
}

/** a から b へ進んで、建物に入らずに行ける長さ m */
function freeLength(world: GtoWorld, ax: number, az: number, bx: number, bz: number): number {
  const len = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(1, Math.ceil(len / CAMERA_TUNING.probeStep))
  for (let s = 1; s <= steps; s++) {
    const t = s / steps
    if (world.insideBuilding(ax + (bx - ax) * t, az + (bz - az) * t)) return (len * (s - 1)) / steps
  }
  return len
}

/**
 * 軸から後ろへ flat（水平距離）だけ下がるとき、壁に入らずに取れる水平距離。
 * hard は一歩も譲れない上限（真後ろの壁と、レンズの幅に掛かる壁）、soft は狭い所でなめらかに寄る目安。
 */
function wallLimit(world: GtoWorld, pivot: Pivot, viewYaw: number, flat: number): { hard: number; soft: number } {
  const d = dirOf(viewYaw)
  const bx = pivot.x - d.x * flat
  const bz = pivot.z - d.z * flat
  /** 軸から「カメラの横 side m の点」へ引いた線が、壁に入らずに届く割合（0..1） */
  const reach = (side: number): number => {
    const len = Math.hypot(flat, side)
    const free = freeLength(world, pivot.x, pivot.z, bx - d.z * side, bz + d.x * side)
    return free < len - 1e-6 ? free / len : 1
  }
  // 真後ろは隙間を残して止める
  const back = reach(0)
  let hard = back < 1 ? back * flat - CAMERA_TUNING.wallGap : flat
  let soft = flat
  for (const side of [-1, 1]) {
    hard = Math.min(hard, reach(side * CAMERA_TUNING.whisker) * flat)
    soft = Math.min(soft, Math.max(CAMERA_TUNING.alleyFloor, reach(side * CAMERA_TUNING.alleyWhisker)) * flat)
  }
  return { hard, soft: Math.min(hard, soft) }
}

/** カメラのすぐ前（軸とのあいだ）に通行人や車がいれば、その手前までの水平距離。いなければ flat */
function crowdLimit(crowd: readonly CameraCrowd[], pivot: Pivot, viewYaw: number, flat: number, wantFlat: number): number {
  const d = dirOf(viewYaw)
  const floor = wantFlat * CAMERA_TUNING.crowdFloor
  let limit = flat
  for (const p of crowd) {
    const rx = p.x - pivot.x
    const rz = p.z - pivot.z
    // 軸から後ろ向きの距離と、横へのずれ
    const along = -(rx * d.x + rz * d.z)
    const side = Math.abs(rx * -d.z + rz * d.x)
    if (p.r != null) {
      // 車: カメラの通り道に車体がかかっていれば、その手前まで寄る（車の中へは入らない）
      if (side > p.r + CAMERA_TUNING.solidGap || along < 0 || along - p.r > flat + CAMERA_TUNING.solidGap) continue
      limit = Math.min(limit, Math.max(CAMERA_TUNING.minDist, along - p.r - CAMERA_TUNING.solidGap))
      continue
    }
    // カメラの前 ahead m にいる人。真正面は遠くても、斜め横は「すぐ前」だけをよける
    const ahead = flat - along
    if (ahead < -0.2) continue
    const wide = ahead <= CAMERA_TUNING.crowdNear ? CAMERA_TUNING.crowdSide + Math.max(0, ahead) * CAMERA_TUNING.crowdSpread : CAMERA_TUNING.crowdSide
    if (side > wide) continue
    if (along < CAMERA_TUNING.crowdSkip) continue
    limit = Math.min(limit, Math.max(floor, along - CAMERA_TUNING.crowdGap))
  }
  return limit
}

/** [onfoot] 段の軸（車の中心からドアの側へ寄せた点） */
function stagePivot(stage: CameraStage): Pivot {
  const f = dirOf(stage.heading)
  const out = stage.width * 0.5 * STAGE_TUNING.lean * stage.side
  return { x: stage.x - f.z * out - f.x * STAGE_TUNING.aft, y: stage.y, z: stage.z + f.x * out - f.z * STAGE_TUNING.aft }
}

/** [onfoot] 段のカメラが落ち着く向き。斜め後ろ外側が壁で詰まるなら、空いている回り込み角を選ぶ */
export function stageYaw(stage: CameraStage, world: GtoWorld): number {
  const side = stage.side === 0 ? 1 : stage.side
  const pivot = stagePivot(stage)
  const want = STAGE_TUNING.dist * Math.cos(STAGE_TUNING.pitch)
  let best = stage.heading - side * STAGE_TUNING.quarter
  let bestRoom = -1
  for (const q of [STAGE_TUNING.quarter, ...STAGE_TUNING.fallback]) {
    const yaw = stage.heading - side * q
    const room = wallLimit(world, pivot, yaw, want).hard / want
    if (room >= STAGE_TUNING.roomy) return yaw
    if (room > bestRoom) {
      bestRoom = room
      best = yaw
    }
  }
  return best
}

type Pose = Pick<CameraState, 'x' | 'y' | 'z' | 'tx' | 'ty' | 'tz'>

/** [onfoot] 段の画: 軸から yaw の真後ろへ一定の距離。壁で詰まったら水平距離だけ縮め、同じ距離のまま上へ逃げる */
function stagePose(stage: CameraStage, yaw: number, flat: number): Pose {
  const pivot = stagePivot(stage)
  const d = dirOf(yaw)
  const full = STAGE_TUNING.dist * Math.cos(STAGE_TUNING.pitch)
  const base = CAMERA_TUNING.height + Math.sin(STAGE_TUNING.pitch) * STAGE_TUNING.dist
  // 縮めた分は高さへ回す（軸からの距離は変えない）
  const up = flat < full ? Math.sqrt(Math.max(0, STAGE_TUNING.dist * STAGE_TUNING.dist - flat * flat)) : 0
  return {
    x: pivot.x - d.x * flat,
    y: pivot.y + Math.max(base, CAMERA_TUNING.height + up),
    z: pivot.z - d.z * flat,
    tx: pivot.x,
    ty: pivot.y + STAGE_TUNING.lookY,
    tz: pivot.z,
  }
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k

export function stepCamera(
  cam: CameraState,
  target: CameraTarget,
  input: InputFrame,
  world: GtoWorld,
  dt: number,
  crowd: readonly CameraCrowd[] = [],
): CameraState {
  const tune = CAMERA_TUNING[target.mode]
  const touched = input.lookX !== 0 || input.lookY !== 0
  const idle = touched ? 0 : cam.idle + dt
  const speed = Math.abs(target.speed)

  // スティックの基準: 押しっぱなしなら持ち越し、押し始め・持ち替えはいまの画面。手で回した分は基準にも効く
  const stickNow = stickAngle(input)
  const keep = held(cam, stickNow)
  const moveYaw = moveFrame(cam, input) + input.lookX
  const stick = stickNow == null ? undefined : keep ? cam.stick : stickNow

  // 手で回した分はそのまま効かせる
  let yaw = cam.yaw + input.lookX
  let pitch = clamp(cam.pitch - input.lookY, CAMERA_TUNING.pitchMin, CAMERA_TUNING.pitchMax)

  // しばらく触っていなくて相手が動いていれば、相手の向きの後ろへ遅れて回り込む
  // （後退中も車の向きを追う。進んでいる向きへ回ると酔うので）
  // [onfoot] 乗り降りの段: 相手の向きではなく、車の斜め後ろ外側へ回り込む
  const stage = target.stage && target.stage.k > 0 ? target.stage : null
  if (stage) {
    if (idle > STAGE_TUNING.idleDelay) yaw += angleDiff(yaw, stageYaw(stage, world)) * (1 - Math.exp(-STAGE_TUNING.turnRate * dt))
  } else if (idle > tune.idleDelay && speed > CAMERA_TUNING.followFrom) {
    yaw += followStep(angleDiff(yaw, target.heading), tune, speed, dt)
    pitch = damp(pitch, tune.pitch, CAMERA_TUNING.pitchRate, dt)
  }

  // 視線の先読み: 相手が斜めを向いているあいだだけ、進む先へ少し振る（真後ろ・真正面では 0）
  const following = !input.lookBack && speed > CAMERA_TUNING.followFrom
  const wantLead = following ? Math.sin(angleDiff(yaw, target.heading)) * tune.lead * clamp(speed / tune.fullSpeed, 0, 1) : 0
  const lead = damp(cam.lead ?? 0, wantLead, CAMERA_TUNING.leadRate, dt)

  const fov = damp(cam.fov, tune.fov, CAMERA_TUNING.fovRate, dt)
  const pivot = stepPivot(cam, target, dt)

  // 振り返りは向きだけ一時的に反転する（yaw の記憶は変えない）
  const viewYaw = input.lookBack ? yaw + Math.PI : yaw
  const cos = Math.max(0.2, Math.cos(pitch))
  // 速さのぶんだけ後ろへ遅れる（前へ進んでいるときだけ。後退では引かない）
  const wantTrail = clamp(Math.max(0, target.speed) * CAMERA_TUNING.trailTime, 0, CAMERA_TUNING.trailMax)
  const trailNow = cam.trail ?? 0
  const trail = damp(trailNow, wantTrail, wantTrail < trailNow ? CAMERA_TUNING.trailIn : CAMERA_TUNING.trailOut, dt)
  const wantFlat = (tune.dist + trail) * cos

  // 壁: 一歩も入らない（寄るのは即座）。通行人: なめらかに寄る。離れるのはゆっくり
  const wall = wallLimit(world, pivot, viewYaw, wantFlat)
  const wallFlat = Math.max(CAMERA_TUNING.minDist * cos, wall.hard)
  const wallDist = wallFlat / cos
  const goal = crowdLimit(crowd, pivot, viewYaw, Math.max(CAMERA_TUNING.minDist * cos, wall.soft), wantFlat) / cos
  const eased = goal < cam.dist ? damp(cam.dist, goal, CAMERA_TUNING.distIn, dt) : damp(cam.dist, goal, CAMERA_TUNING.distOut, dt)
  const dist = Math.min(eased, wallDist)

  // 詰まって near より近づくなら、水平距離はそのまま、上へ逃げて見下ろす
  const flat = dist * cos
  const near = Math.min(tune.near, tune.dist)
  // （乗り降りで距離を伸ばしている途中は詰まっていないので、逃げない）
  const rise = damp(cam.rise ?? 0, Math.min(goal, wallDist) < near ? 1 : 0, CAMERA_TUNING.riseRate, dt)
  const over = dist < near ? Math.max(0, Math.min(CAMERA_TUNING.squeezePitch, Math.acos(clamp(flat / near, 0, 1))) - pitch) : 0
  const risen = pitch + over * rise
  const pos = placed(pivot, viewYaw, risen, flat / Math.cos(risen), tune, lead)
  // 坂でカメラが地面に潜らないようにする（注視点も同じだけ上げて、見ている向きを保つ）
  const lift = Math.max(0, world.groundY(pos.x, pos.z) + 0.5 - pos.y)
  const usual: Pose = { ...pos, y: pos.y + lift, ty: pos.ty + lift }
  // [onfoot] 乗り降りの段: 段の画を作り、効きのぶんだけふだんの画から寄せる
  let stageFlat: number | undefined
  let shown = usual
  if (stage) {
    const full = STAGE_TUNING.dist * Math.cos(STAGE_TUNING.pitch)
    const room = Math.max(Math.min(STAGE_TUNING.minFlat, full), wallLimit(world, stagePivot(stage), viewYaw, full).hard)
    const before = cam.stageFlat ?? room
    stageFlat = damp(before, room, room < before ? STAGE_TUNING.flatIn : STAGE_TUNING.flatOut, dt)
    const staged = stagePose(stage, viewYaw, Math.min(stageFlat, full))
    const up = Math.max(0, world.groundY(staged.x, staged.z) + 0.5 - staged.y)
    const k = clamp(stage.k, 0, 1)
    shown = {
      x: mix(usual.x, staged.x, k),
      y: mix(usual.y, staged.y + up, k),
      z: mix(usual.z, staged.z, k),
      tx: mix(usual.tx, staged.tx, k),
      ty: mix(usual.ty, staged.ty, k),
      tz: mix(usual.tz, staged.tz, k),
    }
  }
  return {
    ...shown,
    yaw,
    pitch,
    dist,
    fov,
    idle,
    lead,
    moveYaw: stick == null ? yaw : moveYaw,
    stick,
    rise,
    trail,
    px: pivot.x,
    py: pivot.y,
    pz: pivot.z,
    ...(stageFlat == null ? {} : { stageFlat }),
  }
}
