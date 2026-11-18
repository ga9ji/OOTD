// Grand Theft Outfit [部品: vehicle の見た目] 車。
// 入口: createVehiclesRenderer(ctx)
// 契約: 状態の vehicles を読んで、車種ごとの形（vehicleShape.ts）を置く。
//       四輪は1つずつ自分の接地点の面（車道の舗装・縁石の帯・歩道・地面。lib/gto/vehicleGround.ts）に付き、
//       車体はその上にばねで乗る（lib/gto/vehicleSuspension.ts）。車道の縁を片輪が越えればその輪だけが段を降り、
//       旋回では四輪が路面に付いたまま外側のばねだけが縮み（外側の裾が 6〜10cm 沈む。内側はほぼ元の高さ）、外側のタイヤハウスが詰まる。
//       車の下には接地の影を敷き、タイヤ1本ずつの真下にも濃い影を置く（どの輪も路面に付いているのが読める）。
//       車輪の回転と舵、加減速の沈み込み、旋回のロール（lib/gto/vehicleAttitude.ts のばね）、ブレーキ灯、
//       ヘッドライトの光だまり、タイヤの土煙とタイヤ痕、衝突の煙（vehicleFx.ts）は、ここで車の速度・加速度・横滑りから作る。
//       当たった結果は車体に残す: 凹み（dents）で形を潰し（vehicleDamageFx.ts）、壊れ具合（damage）で
//       ボンネットから白煙 → 黒煙 → 炎を出し続ける。当たった瞬間（速度の急な変化で見分ける。壁・柱・車のどれでも、
//       当てた側も当てられた側も）は、火花が放射状に散り、破片が飛び、車が輪ごと跳ねて当たった反対側の輪が浮き
//       （lib/gto/vehicleCrash.ts）、深く潰れた端からはバンパーが外れて路面に転がる（vehicleCrashFx.ts）。
//       前のドアは車体のヒンジを軸に開閉する（vehicleDoors.ts）。乗り降りの担当は requestVehicleDoor(車の id, 側, 0〜1) を
//       毎フレーム呼ぶだけでよく、座った人物を置く位置は vehicleSeatPoint(車の id, 側, 'seat' | 'head', out) で取れる。
//       URL に &doors=0.7 を付けると、全車の両方のドアをその開き具合で開けたままにする（見た目の確認用）。
//       状態には何も書き戻さない。
import * as THREE from 'three'
import { clamp, dirOf } from '../../lib/gto/math'
import { VEHICLE_SPECS } from '../../lib/gto/vehicle'
import { attitudeTarget, bodyPose, restAttitude, restWheelLook, slideShake, stepAttitude, stepWheelLook, wheelTrails, type Attitude, type WheelLook } from '../../lib/gto/vehicleAttitude'
import { crashKick, droppedParts, hopPose, impactFromVelocity, restCrashBody, stepCrashBody, wreckSag, type CrashBody } from '../../lib/gto/vehicleCrash'
import { damageStage } from '../../lib/gto/vehicleDamage'
import { wheelSurface } from '../../lib/gto/vehicleGround'
import { limitPoleKinds } from '../../lib/gto/vehiclePoles'
import { groundFit, restSuspension, stepSuspension, wheelOffsets, type Suspension, type WheelHeights } from '../../lib/gto/vehicleSuspension'
import type { VehicleKind, VehicleState } from '../../lib/gto/types'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'
import { createCrashFx } from './vehicleCrashFx'
import { crushOf, DAMAGE_LOOK, deformGeometry, dentKey } from './vehicleDamageFx'
import { createDoorKit, doorRequest, endDoorFrame, registerCarDoors, type CarDoors } from './vehicleDoors'
import { createCarLights, createSkidMarks, createSmoke } from './vehicleFx'
import { createPaintKit } from './vehiclePaint'
import { contactShadowTexture, tireBlobTexture } from './vehicleShadowTex'
import { buildVehicleShape, disposeVehicleShape, type VehicleShape } from './vehicleShape'
import { CREASE } from './vehicleShapeParts'

/** 見た目を決める数字 */
export const VEHICLE_STYLE = {
  /** ブレーキ灯が点く減速 m/s²（惰性の減速では点かない）と、点いたあと残る秒 */
  brakeDecel: 3.6,
  brakeHold: 0.18,
  /** 灯火の明るさ: 尾灯（消灯・夜の常灯・ブレーキ）、前照灯（昼・夜） */
  tailOff: 0.3,
  tailOn: 1.1,
  tailBrake: 3.4,
  headOff: 0.85,
  headOn: 2.6,
  /** タイヤ痕の濃さ（いちばん濃いとき）と、前輪の痕の濃さ（後輪に対する割合） */
  skidAlpha: 0.72,
  /** [onfoot] 痕が満額の濃さになるまでの秒 */
  skidRamp: 0.45,
  skidFront: 0.85,
  /** タイヤ痕の幅（タイヤの幅に対する倍率）。背後のカメラから 1 本ずつ黒い帯として読める太さ */
  skidWidth: 1.0,
  /** タイヤの煙の粒の数（lib の 1 秒あたりの粒に掛ける。PC）。小さく濃い粒を詰めて 1 本の帯にする */
  smokeDensity: 3.2,
  /** これより遠い車は効果（煙・痕）を出さない m */
  fxRange: 130,
  /** 壊れたエンジンの煙（1秒あたりの粒）: 白煙・黒煙・炎 */
  engineSmoke: 12,
  engineBlack: 22,
  engineFire: 44,
  /** ボンネットが跳ね上がり始める鼻の凹みと、いちばん開いた角度 rad、走行中のばたつき rad */
  hoodOpenAt: 0.45,
  hoodAngle: 0.95,
  hoodFlutter: 0.07,
  /** 当たった瞬間に車体を揺さぶる強さ（rad/s ÷ m/s）と上限 */
  jolt: 0.09,
  joltMax: 1.3,
  /** 1コマでこれより動いた車は置き直されたとみなし、当たりを見ない m */
  warp: 3,
  /** 車体のロールのうち、車輪も一緒に倒れる割合（荷重の掛かったタイヤが寝て見える） */
  camber: 0.5,
  /** 車の下の接地の影: 濃さ（PC・スマホ）と、車体に対する大きさ（幅・長さ）、面からの高さ m */
  shadowAlpha: 0.95,
  shadowAlphaMobile: 0.8,
  shadowSize: [1.3, 1.16] as const,
  // 白線と横断歩道の塗装（車道の面 +0.05〜0.08）より上に置く
  shadowLift: 0.09,
  /** タイヤの真下の影: 濃さと、タイヤに対する大きさ（幅・前後） */
  tireShadowAlpha: 0.85,
  tireShadowSize: [2.3, 2.5] as const,
  /** 車体の隅がこれより沈んだら、車体より上に出るタイヤを切り取り始める m（タイヤハウスの隙間より少し手前）と、肩の線から下げる切り口 m */
  /** 艶の帯の明るさ（昼）。夜は空の暗さに合わせて弱まる */
  glossAlpha: 0.42,
  wheelClipFrom: 0.06,
  wheelClipDrop: 0.03,
}

interface Car {
  root: THREE.Group
  chassis: THREE.Group
  body: THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  head: THREE.Mesh
  trim: THREE.Mesh
  tailMesh: THREE.Mesh
  tail: THREE.MeshBasicMaterial
  /** 艶の帯（無傷のあいだだけ見せる。潰れた車体には追従しない）。スマホの形には無い */
  gloss: THREE.Mesh | null
  /** いまの形を作った凹みの札と、この車だけの潰れた形（無傷なら空。車種の形を共用している） */
  dentKey: string
  dented: THREE.BufferGeometry[]
  /** 四輪と車体のばね。まだ置いていなければ null */
  susp: Suspension | null
  /** 路面に沿う板（接地の影と、前照灯の光だまりの土台） */
  ground: THREE.Group
  /** エンジンの煙の出し残し */
  engineDebt: number
  /** 跳ね上がるボンネット（鼻が潰れるまでは隠してある）。鼻の短い車種は null */
  hood: THREE.Group | null
  hoodLength: number
  roof: THREE.MeshBasicMaterial | null
  /** 車輪の支点（前左・前右・後左・後右。前の2つは舵で向きが変わる）と、回る車輪 */
  pivots: THREE.Group[]
  wheels: THREE.Mesh[]
  kind: VehicleKind
  shape: VehicleShape
  /** 車輪の回った角度 */
  spin: number
  /** 車体のばねの状態（ピッチ・ロールと、その速さ） */
  att: Attitude
  /** 前輪の見た目の切れ角（立て直しのあいだ逆に切れたまま残る） */
  look: WheelLook
  /** ブレーキ灯の残り秒 */
  brake: number
  /** 直前のフレームの車輪の接地点（タイヤ痕を繋ぐ。後ろ左・後ろ右・前左・前右の x, y, z）。滑っていなければ null */
  skid: number[] | null
  /** [onfoot] いまの痕を引き始めてからの秒（引き始めは薄く、続くほど濃くする） */
  skidAge: number
  /** 煙の出し残し（1未満の端数） */
  smokeDebt: number
  /** 前のドア（開けるまでは何も作らない） */
  doors: CarDoors
  /** 衝突で輪ごと跳ねている量 */
  hop: CrashBody
  /** 車体が沈み込んだとき、車体より上に出るタイヤを切り取る面（前輪・後輪）と、その面を持つ車輪の材質。沈むまでは null */
  clip: { planes: [THREE.Plane, THREE.Plane]; materials: [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial] } | null
  /** 直前のコマの位置と速度（世界の x, z）と凹み。当たりを見分ける。まだ無ければ null */
  last: { x: number; z: number; vx: number; vz: number; dents: readonly number[] | undefined } | null
}

export function createVehiclesRenderer(ctx: RenderCtx): RenderPart {
  const { scene, world, quality } = ctx
  const style = VEHICLE_STYLE
  // 沈み込んだ車体より上に出るタイヤを、車ごとの面で切り取る（材質ごとの切り取りを使う。面を持たない材質には何も起きない）
  ctx.renderer.localClippingEnabled = true
  const clipLocal = new THREE.Plane()
  const mobile = quality.id === 'mobile'
  const group = new THREE.Group()
  group.name = 'gto-vehicles'
  scene.add(group)

  const shapes = new Map<VehicleKind, VehicleShape>()
  const shapeOf = (kind: VehicleKind) => {
    const found = shapes.get(kind)
    if (found) return found
    const made = buildVehicleShape(kind, mobile ? 'lite' : 'high')
    shapes.set(kind, made)
    return made
  }
  // 前照灯は点灯・消灯の2つの材質を全車で使い回す
  const headOn = new THREE.MeshBasicMaterial({ vertexColors: true })
  headOn.color.setScalar(style.headOn)
  const headOff = new THREE.MeshBasicMaterial({ vertexColors: true })
  headOff.color.setScalar(style.headOff)
  const wheelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
  // 塗装と、窓・黒い部品。PC は空と地面が映り込む（曲面に沿って地平線の帯が流れる）。スマホは軽い材質
  const paintKit = createPaintKit(mobile)
  const trimMaterial = paintKit.trim
  // 艶の帯（肩の線と屋根の縁に沿う細い白いハイライト）。白を足して描く。明るさは時刻に合わせる
  const glossMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: style.glossAlpha, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const luma = new THREE.Color()
  // ボンネットの板（蝶番が原点で、前（−z）へ 1m 伸びる。車ごとに幅と長さを掛ける）。裏は煤けた色
  const hoodPanel = new THREE.BoxGeometry(1, 0.035, 1).translate(0, 0, -0.5)
  hoodPanel.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      Array.from({ length: hoodPanel.attributes.position.count }, (_, i) => (hoodPanel.attributes.normal.getY(i) < -0.5 ? [0.12, 0.12, 0.12] : [0.62, 0.62, 0.62])).flat(),
      3,
    ),
  )
  // 接地の影: 車体の真下が濃く、縁へ向けて消える板（全車で使い回す）
  const shadowMap = contactShadowTexture()
  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowMap,
    color: 0x000000,
    transparent: true,
    opacity: mobile ? style.shadowAlphaMobile : style.shadowAlpha,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  })
  // タイヤ1本ずつの真下の影（全車ぶんを1回で描く）
  const tireShadowMap = tireBlobTexture()
  const tireShadowMaterial = new THREE.MeshBasicMaterial({
    map: tireShadowMap,
    color: 0x000000,
    transparent: true,
    opacity: style.tireShadowAlpha,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -7,
    polygonOffsetUnits: -7,
  })
  const tireShadowCapacity = (quality.maxVehicles + 10) * 4
  const tireShadows = new THREE.InstancedMesh(shadowGeometry, tireShadowMaterial, tireShadowCapacity)
  tireShadows.frustumCulled = false
  tireShadows.renderOrder = 3
  tireShadows.count = 0
  tireShadows.name = 'gto-vehicle-tire-shadows'
  scene.add(tireShadows)
  let tireShadowCount = 0
  const blobMatrix = new THREE.Matrix4()
  const blobPosition = new THREE.Vector3()
  const blobTurn = new THREE.Quaternion()
  const blobScale = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const cars = new Map<number, Car>()
  // 軽量設定は街路樹とふつうの道路照明を描かない（renderCityProps.ts）。見えない柱には当たらないようにする
  limitPoleKinds(world, quality.props ? undefined : (kind) => kind !== 'tree' && kind !== 'lamp-plain')
  const smoke = createSmoke(ctx, mobile ? 170 : 900)
  const skids = createSkidMarks(ctx, mobile ? 160 : 900)
  const lights = createCarLights(ctx, quality.maxVehicles + 10)
  const crash = createCrashFx(ctx, smoke, mobile)
  const doorKit = createDoorKit(quality.shadows)
  // 見た目の確認用: &doors=0.7 で全車の両方のドアを開けたままにする
  const doorsAjar = typeof location === 'undefined' ? 0 : clamp(Number(new URLSearchParams(location.search).get('doors') ?? 0) || 0, 0, 1)
  let lastSimFrame = -1
  const bodyPaints = function* () {
    for (const car of cars.values()) yield car.body.material as THREE.MeshLambertMaterial | THREE.MeshPhongMaterial
  }

  const makeCar = (v: VehicleState): Car => {
    const shape = shapeOf(v.kind)
    const spec = VEHICLE_SPECS[v.kind]
    const paint = paintKit.paint(v.color)
    const body = new THREE.Mesh(shape.body, paint)
    body.castShadow = quality.shadows
    body.receiveShadow = quality.shadows
    const tail = new THREE.MeshBasicMaterial({ vertexColors: true })
    const roof = shape.roofLamp ? new THREE.MeshBasicMaterial({ vertexColors: true }) : null
    const chassis = new THREE.Group()
    chassis.rotation.order = 'YXZ'
    // 車体は車輪の高さを軸に揺れる
    chassis.position.y = shape.look.wheel
    const trim = new THREE.Mesh(shape.trim, trimMaterial)
    trim.castShadow = quality.shadows
    const head = new THREE.Mesh(shape.head, headOff)
    const tailMesh = new THREE.Mesh(shape.tail, tail)
    for (const mesh of [body, trim, head, tailMesh]) {
      mesh.position.y = -shape.look.wheel
      chassis.add(mesh)
    }
    let gloss: THREE.Mesh | null = null
    if (shape.gloss) {
      gloss = new THREE.Mesh(shape.gloss, glossMaterial)
      gloss.position.y = -shape.look.wheel
      chassis.add(gloss)
    }
    if (shape.roofLamp && roof) {
      const lamp = new THREE.Mesh(shape.roofLamp, roof)
      lamp.position.y = -shape.look.wheel
      chassis.add(lamp)
    }
    // 跳ね上がるボンネット: フロントガラスの付け根を蝶番にした板。鼻が潰れたら開く
    const cowlIndex = shape.look.stations.findIndex((st) => st.roof != null)
    const cowl = shape.look.stations[Math.max(0, cowlIndex - 1)]
    const hoodLength = (cowl.z + 0.47) * spec.length
    let hood: THREE.Group | null = null
    if (cowlIndex > 0 && hoodLength > 0.6) {
      hood = new THREE.Group()
      hood.position.set(0, cowl.belt * spec.height - shape.look.wheel + 0.05, cowl.z * spec.length)
      const panel = new THREE.Mesh(hoodPanel, paint)
      panel.scale.set(spec.width * 0.86, 1, hoodLength)
      panel.castShadow = quality.shadows
      hood.add(panel)
      hood.visible = false
      chassis.add(hood)
    }
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    root.add(chassis)
    // 車輪は車体（chassis）の外に置く。車体が傾いても沈んでも、車輪は自分の接地点に残る
    const pivots: THREE.Group[] = []
    const wheels: THREE.Mesh[] = []
    for (const [x, z] of wheelOffsets(spec.wheelbase, shape.track * 2)) {
      const pivot = new THREE.Group()
      pivot.position.set(x, shape.look.wheel, z)
      const wheel = new THREE.Mesh(shape.wheel, wheelMaterial)
      wheel.castShadow = quality.shadows
      pivot.add(wheel)
      root.add(pivot)
      pivots.push(pivot)
      wheels.push(wheel)
    }
    const ground = new THREE.Group()
    ground.rotation.order = 'YXZ'
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadow.scale.set(spec.width * style.shadowSize[0], 1, spec.length * style.shadowSize[1])
    shadow.position.y = style.shadowLift
    shadow.renderOrder = 2
    ground.add(shadow)
    root.add(ground)
    group.add(root)
    const doors = doorKit.attach(chassis, v.kind, paint)
    registerCarDoors(v.id, doors)
    return {
      doors,
      root,
      chassis,
      body,
      head,
      trim,
      tailMesh,
      tail,
      gloss,
      dentKey: '',
      dented: [],
      susp: null,
      ground,
      engineDebt: 0,
      hood,
      hoodLength,
      roof,
      pivots,
      wheels,
      kind: v.kind,
      shape,
      spin: 0,
      att: restAttitude(),
      look: restWheelLook(),
      brake: 0,
      skid: null,
      skidAge: 0,
      smokeDebt: 0,
      hop: restCrashBody(),
      clip: null,
      last: null,
    }
  }

  /** 凹みが変わったら、この車だけの潰れた形に作り直す */
  const reshape = (car: Car, v: VehicleState) => {
    const key = dentKey(v.dents)
    if (key === car.dentKey) return
    car.dentKey = key
    for (const g of car.dented) g.dispose()
    car.dented = []
    const spec = VEHICLE_SPECS[v.kind]
    const dents = v.dents
    if (car.gloss) car.gloss.visible = !dents || dents.every((d) => d <= 0)
    if (!dents || dents.every((d) => d <= 0)) {
      car.body.geometry = car.shape.body
      car.trim.geometry = car.shape.trim
      car.head.geometry = car.shape.head
      car.tailMesh.geometry = car.shape.tail
      return
    }
    // 塗装の面は細かく割って折れ目を出す。窓と黒い部品は1回、灯火は割らずに動かして、潰れた側を消す
    car.body.geometry = deformGeometry(car.shape.body, spec, dents, { levels: mobile ? 1 : 2, darken: DAMAGE_LOOK.scuff, crease: mobile ? undefined : CREASE })
    car.trim.geometry = deformGeometry(car.shape.trim, spec, dents, { levels: mobile ? 0 : 1, darken: 0.3, crease: mobile ? undefined : CREASE })
    car.head.geometry = deformGeometry(car.shape.head, spec, dents, { levels: 0, darken: 1 })
    car.tailMesh.geometry = deformGeometry(car.shape.tail, spec, dents, { levels: 0, darken: 1 })
    car.dented = [car.body.geometry, car.trim.geometry, car.head.geometry, car.tailMesh.geometry]
  }

  const removeCar = (car: Car, id: number) => {
    registerCarDoors(id, null)
    for (const m of car.clip?.materials ?? []) m.dispose()
    car.doors.dispose()
    group.remove(car.root)
    for (const g of car.dented) g.dispose()
    car.dented = []
    car.body.material.dispose()
    car.tail.dispose()
    car.roof?.dispose()
  }

  /** 車体の座標（右 lx・前後 lz、前が −z）を世界の x, z に直す */
  const toWorld = (v: VehicleState, lx: number, lz: number) => {
    const f = dirOf(v.heading)
    return { x: v.x - f.z * lx - f.x * lz, z: v.z + f.x * lx - f.z * lz }
  }

  /** タイヤの土煙とタイヤ痕。滑り・空転・急ブレーキのときだけ、鳴いている車輪の接地点から出す */
  const wheelFx = (car: Car, v: VehicleState, dt: number, smokeDt: number) => {
    const spec = VEHICLE_SPECS[v.kind]
    const trails = wheelTrails(v, spec)
    if (!trails.rear && !trails.front) {
      car.skid = null
      car.skidAge = 0
      car.smokeDebt = 0
      return
    }
    const half = spec.wheelbase / 2
    // 後ろ左・後ろ右・前左・前右
    const wheels = [toWorld(v, -car.shape.track, half), toWorld(v, car.shape.track, half), toWorld(v, -car.shape.track, -half), toWorld(v, car.shape.track, -half)]
    // 痕は車輪が実際に乗っている面に残す
    const contact = car.susp ? [car.susp.wheelY[2], car.susp.wheelY[3], car.susp.wheelY[0], car.susp.wheelY[1]] : wheels.map((w) => world.groundY(w.x, w.z))
    const now = wheels.flatMap((w, i) => [w.x, contact[i], w.z])
    // 空転（発進）と旋回の鳴きは薄い痕、横滑りと急ブレーキは濃い痕
    // [onfoot] 引き始めは薄く入れる。一瞬だけ鳴いた車輪が、真っ黒で四角い短い痕（路面の穴に見える）を残さない
    car.skidAge += dt
    const ramp = Math.min(1, car.skidAge / style.skidRamp)
    const alpha = (trails.cause === 'spin' || trails.cause === 'corner' ? style.skidAlpha * trails.strength : style.skidAlpha) * ramp * ramp
    const prev = car.skid
    if (prev) {
      wheels.forEach((_, i) => {
        const rear = i < 2
        if (rear ? !trails.rear : !trails.front) return
        skids.add(prev[i * 3], prev[i * 3 + 1], prev[i * 3 + 2], now[i * 3], now[i * 3 + 1], now[i * 3 + 2], car.shape.look.tire * style.skidWidth, rear ? alpha : alpha * style.skidFront)
      })
    }
    car.skid = now

    // 煙は後輪 2 本それぞれの接地点から細く濃く出て、進んできた側へ帯になって残る（車体の後ろ一面の靄にしない）。
    // R17 の実測（status/vehicle-measure.md）: バーの煙はバンパーの下端より低く、タイヤの幅の 2〜3 倍の太さで路面を這う
    // 粒の数は実際に経った時間で決める（コマ落ちしても、進んだ道のりあたりの粒が減って数珠にならない）
    car.smokeDebt = Math.min(40, car.smokeDebt + trails.smoke * smokeDt * (mobile ? 0.5 : style.smokeDensity))
    const f = dirOf(v.heading)
    // 車が路面の上を動いている速度（煙はほとんど置いていかれる）
    const wx = f.x * v.speed - f.z * v.slip
    const wz = f.z * v.speed + f.x * v.slip
    const sliding = trails.cause === 'slide'
    // 流れていく側（荷重の掛かった外側）の後輪が 5 粒に 3 粒を出す
    const outerRear = v.slip < 0 ? 0 : 1
    // 車の状態が進まなかったコマ（描画のほうが細かい）では出さずに持ち越す。次に進んだ区間へまとめて撒く（1 点に固まった玉にしない）
    const moved = prev ? Math.hypot(now[0] - prev[0], now[2] - prev[2]) : 1
    while (car.smokeDebt >= 1 && moved > 0.02) {
      car.smokeDebt -= 1
      // 前輪が煙を出すのは四輪が鳴く急ブレーキだけ。横滑りは後輪 2 本の接地点だけから出す（前輪の後ろや車体の手前に塊を残さない）
      const pick = trails.cause === 'lock' && Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 2) : sliding ? (Math.random() < 0.6 ? outerRear : 1 - outerRear) : Math.floor(Math.random() * 2)
      // このコマで輪が動いた区間のどこかから出す（速く動いても粒が数珠にならず、1 本の帯に繋がる）
      const along = prev ? Math.random() : 1
      const at = (axis: number) => (prev ? prev[pick * 3 + axis] + (now[pick * 3 + axis] - prev[pick * 3 + axis]) * along : now[pick * 3 + axis])
      const jitter = () => (Math.random() - 0.5) * 0.08
      const drag = 0.03 + Math.random() * 0.07
      smoke.emit(
        at(0) + jitter(),
        at(1) + 0.08 + Math.random() * 0.08,
        at(2) + jitter(),
        wx * drag + jitter() * 4,
        0.15 + Math.random() * 0.3,
        wz * drag + jitter() * 4,
        // 粒の直径 m。タイヤの幅の 2〜3 倍。隣の粒と重なって 1 本の帯になる
        sliding ? 0.55 + Math.random() * 0.2 : 0.45 + Math.random() * 0.15,
        sliding ? 0.9 : 0.7,
        // 帯の長さは車 1 台ぶんほど（バーの煙は後輪のすぐ後ろで消える）
        sliding ? 0.38 + Math.random() * 0.22 : 0.32 + Math.random() * 0.18,
        (sliding ? 0.27 : 0.13) * (0.6 + 0.4 * trails.strength),
        // バーの実測: 滑りの煙は白ではなく路面の色に近い灰褐色
        'dust',
      )
    }
  }

  /** 壊れたエンジンの煙。ボンネットの上から、白煙 → 黒煙 → 炎と黒煙 */
  const engineFx = (car: Car, v: VehicleState, dt: number) => {
    const stage = damageStage(v.damage)
    if (stage === 'ok') {
      car.engineDebt = 0
      return
    }
    const spec = VEHICLE_SPECS[v.kind]
    const rate = stage === 'fire' ? style.engineFire : stage === 'black' ? style.engineBlack : style.engineSmoke
    car.engineDebt += rate * dt * (mobile ? 0.5 : 1)
    if (car.engineDebt < 1) return
    const crush = crushOf(spec, v.dents).front
    const f = dirOf(v.heading)
    // 煙は車の動きを少し引きずる
    const vx = f.x * v.speed * 0.3
    const vz = f.z * v.speed * 0.3
    while (car.engineDebt >= 1) {
      car.engineDebt -= 1
      const at = toWorld(v, (Math.random() - 0.5) * spec.width * 0.6, -(spec.length / 2 - crush - 0.2 - Math.random() * 0.7))
      const y = car.root.position.y + car.shape.headY + 0.25
      const drift = () => (Math.random() - 0.5) * 0.8
      if (stage === 'fire' && Math.random() < 0.6) {
        // 炎: 車幅ほどの明るい塊が、屋根の上まで立ちのぼる
        smoke.emit(at.x, y + Math.random() * 0.2, at.z, vx + drift(), 2 + Math.random() * 1.6, vz + drift(), 0.9 + Math.random() * 0.6, 0.7, 0.5 + Math.random() * 0.35, 0.92, 'fire')
      } else if (stage === 'smoke') {
        smoke.emit(at.x, y, at.z, vx + drift(), 1.5 + Math.random() * 0.9, vz + drift(), 0.6 + Math.random() * 0.3, 1.2, 1.4 + Math.random() * 0.6, 0.34, 'white')
      } else {
        // 黒煙: 濃く、広がりながら高く昇る
        smoke.emit(at.x, y + 0.15, at.z, vx + drift(), 2.2 + Math.random() * 1.3, vz + drift(), 0.9 + Math.random() * 0.5, 1.6, 2 + Math.random() * 1, stage === 'fire' ? 0.8 : 0.66, 'black')
      }
    }
  }

  /** 衝突の瞬間を速度の急な変化から見分けて、火花・破片・煙を出し、車を輪ごと跳ねさせ、外れた部品を落とす */
  const crashFx = (car: Car, v: VehicleState) => {
    const spec = VEHICLE_SPECS[v.kind]
    const f = dirOf(v.heading)
    const vx = f.x * v.speed - f.z * v.slip
    const vz = f.z * v.speed + f.x * v.slip
    const last = car.last
    car.last = { x: v.x, z: v.z, vx, vz, dents: v.dents }
    if (!last || Math.hypot(v.x - last.x, v.z - last.z) > style.warp) return
    const halfL = spec.length / 2
    const hit = impactFromVelocity(last.vx, last.vz, vx, vz, v.heading, halfL, spec.width / 2)
    if (hit) {
      // 車ごと跳ねる（当たった反対側の輪が浮く）。車体のばねも、当たった端が沈む向きへ揺さぶる
      const bias = Math.random() < 0.5 ? -1 : 1
      car.hop = crashKick(car.hop, hit.impact, hit.lx, hit.lz, halfL, spec.width / 2, bias)
      const jolt = Math.min(style.joltMax, hit.impact * style.jolt)
      car.att = { ...car.att, pitchVel: car.att.pitchVel - jolt * Math.sign(hit.lz || 1), rollVel: car.att.rollVel + jolt * 0.8 * (hit.lx ? Math.sign(hit.lx) : bias) }
      const at = toWorld(v, hit.lx, -hit.lz)
      const n = Math.hypot(v.x - at.x, v.z - at.z) || 1
      crash.burst(at.x, car.root.position.y + car.shape.look.wheel + 0.15, at.z, (v.x - at.x) / n, (v.z - at.z) / n, hit.impact, v.color)
    }
    // 深く潰れた端からバンパーが、凹んだ側面からホイールキャップが外れて落ちる
    for (const part of droppedParts(last.dents, v.dents)) {
      const end = part === 'bumperFront' ? -halfL : part === 'bumperRear' ? halfL : 0
      const at = toWorld(v, part === 'hubcapLeft' ? -spec.width / 2 - 0.1 : part === 'hubcapRight' ? spec.width / 2 + 0.1 : 0, end)
      crash.dropPart(part, at.x, car.root.position.y + car.shape.look.wheel, at.z, v.heading, vx, vz, spec.width)
    }
  }

  const placeCar = (car: Car, v: VehicleState, frame: FrameInfo) => {
    const spec = VEHICLE_SPECS[v.kind]
    const dt = Math.min(0.05, frame.dt)
    const radius = car.shape.look.wheel
    const trackWidth = car.shape.track * 2
    // ---- 四輪: それぞれ自分の接地点の路面に付く。車体はその上にばねで乗り、遅れて付いてくる ----
    const offsets = wheelOffsets(spec.wheelbase, trackWidth)
    const heights: WheelHeights = wheelSurface(world, v.x, v.z, v.heading, offsets)
    const susp = car.susp ? stepSuspension(car.susp, heights, spec.wheelbase, trackWidth, dt) : restSuspension(heights, spec.wheelbase, trackWidth)
    car.susp = susp
    // 衝突で跳ねているあいだは、路面に残る側の輪を軸に車ごと（輪も一緒に）傾いて浮く
    car.hop = stepCrashBody(car.hop, dt)
    const hop = hopPose(car.hop, spec.wheelbase / 2, trackWidth / 2)
    car.root.position.set(v.x, susp.y + hop.rise, v.z)
    car.root.rotation.set(hop.pitch, -v.heading, hop.roll)
    car.pivots.forEach((pivot, i) => {
      pivot.position.y = susp.wheelY[i] - susp.y + radius
    })
    // タイヤの真下の影（車輪ごとに、その輪が乗っている面へ置く）
    blobTurn.setFromAxisAngle(UP, -v.heading)
    blobScale.set(car.shape.look.tire * style.tireShadowSize[0], 1, radius * style.tireShadowSize[1])
    offsets.forEach(([lx, lz], i) => {
      if (tireShadowCount >= tireShadowCapacity) return
      const at = toWorld(v, lx, lz)
      tireShadows.setMatrixAt(tireShadowCount++, blobMatrix.compose(blobPosition.set(at.x, susp.wheelY[i] + style.shadowLift + 0.005, at.z), blobTurn, blobScale))
    })
    // 影と光だまりは路面の面に貼る
    const fit = groundFit(heights, spec.wheelbase, trackWidth)
    car.ground.position.y = fit.y - susp.y - hop.rise
    car.ground.rotation.set(fit.pitch - hop.pitch, 0, fit.roll - hop.roll)

    // ---- 車体のばね: 加速で尻が沈み、ブレーキと横滑りで鼻が沈み、旋回と横滑りで外へ傾く ----
    car.att = stepAttitude(car.att, attitudeTarget(v), dt)
    // 車体は荷重の掛かった側の輪へ乗り掛かる（反対側はほとんど浮かない）。四隅の沈みはタイヤハウスの隙間まで
    const pose = bodyPose(car.att, trackWidth / 2, spec.wheelbase / 2)
    // 滑っているあいだは、引っかかっては逃げるタイヤに揺さぶられて小刻みに揺れる（一定の角度で固まらない）
    const shake = slideShake(v, frame.now)
    // 壊れた車は、潰れた鼻が下がり、潰れた角の側へ傾いたまま据わる
    const sag = wreckSag(v.dents)
    car.chassis.rotation.set(susp.pitch + pose.pitch + shake.pitch + sag.pitch, 0, susp.roll + pose.roll + shake.roll + sag.roll)
    car.chassis.position.y = radius + pose.heave + shake.heave
    // ロールの軸は内側の輪の上（車軸の高さ）: 内側の裾は輪の上に留まり、外側だけが輪へ沈む。横へはずらさない（輪が車体の外に立って見えない）
    car.chassis.position.x = 0
    // 四輪は路面に付いたまま動かない（浮かせない）。車体につられてほんの少しだけ寝る
    for (const pivot of car.pivots) pivot.rotation.z = pose.roll * style.camber
    // ---- 前のドア: 頼まれた分だけヒンジを軸に開く（頼まれなければ閉じて消える） ----
    car.doors.set(1, Math.max(doorsAjar, doorRequest(v.id, 1)))
    car.doors.set(-1, Math.max(doorsAjar, doorRequest(v.id, -1)))

    // ---- ボンネット: 鼻が潰れると跳ね上がり、走るとばたつく ----
    if (car.hood) {
      const d = v.dents
      const nose = d ? Math.max(d[0], d[1], d[2]) : 0
      const open = clamp((nose - style.hoodOpenAt) / (1 - style.hoodOpenAt), 0, 1)
      car.hood.visible = open > 0
      if (open > 0) {
        const flutter = Math.sin(frame.now * 11 + v.id) * style.hoodFlutter * Math.min(1, Math.abs(v.speed) / 6)
        car.hood.rotation.x = 0.3 + open * (style.hoodAngle - 0.3) + flutter
        // 潰れた分だけ板も短くなる
        car.hood.scale.z = Math.max(0.5, 1 - crushOf(spec, d).front / Math.max(0.1, car.hoodLength))
      }
    }

    // ---- 車輪: 進んだ分だけ回り、前輪は舵の向きへ切れる ----
    car.spin -= (v.speed * dt) / car.shape.look.wheel
    // 前輪は舵のとおりに切れ、ドリフト中は進んでいく向きへ逆に切れる（lib/gto/vehicleAttitude.ts の stepWheelLook）
    car.look = stepWheelLook(car.look, v, dt)
    const steer = -car.look.angle
    car.pivots[0].rotation.y = steer
    car.pivots[1].rotation.y = steer
    for (const wheel of car.wheels) wheel.rotation.x = car.spin

    // ---- 灯火 ----
    // 乗り捨てられた車・停めてある車は灯りを消す
    const lampsOn = ctx.lighting.lampsOn && v.driver !== 'none'
    if (v.speed > 0.5 && v.accel < -style.brakeDecel) car.brake = style.brakeHold
    else car.brake = Math.max(0, car.brake - dt)
    const braking = car.brake > 0
    car.head.material = lampsOn ? headOn : headOff
    car.tail.color.setScalar(braking ? style.tailBrake : lampsOn ? style.tailOn : style.tailOff)
    if (car.roof) {
      // パトカーの赤色灯は追跡中に点滅する。タクシーの行灯は夜に灯る
      const flash = v.kind === 'police' ? (v.driver === 'police' ? (Math.sin(frame.now * 14) > 0 ? 3.2 : 0.5) : 0.7) : lampsOn ? 2.2 : 0.9
      car.roof.color.setScalar(flash)
    }
    car.root.updateMatrixWorld(true)
    // 車体が沈み込んだ輪は、フェンダーの肩より上に出る分を切り取る（外側のタイヤの上半分が車体に隠れ、ボンネットや荷室を突き抜けない）
    const sunk = Math.tan(Math.abs(pose.roll)) * (trackWidth / 2) + Math.tan(Math.abs(pose.pitch)) * (spec.wheelbase / 2) - pose.heave - shake.heave
    if (!car.clip && sunk > style.wheelClipFrom) {
      const planes: [THREE.Plane, THREE.Plane] = [new THREE.Plane(), new THREE.Plane()]
      const materials = planes.map((plane) => {
        const m = wheelMaterial.clone()
        m.clippingPlanes = [plane]
        return m
      }) as [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial]
      car.clip = { planes, materials }
      car.wheels.forEach((wheel, i) => {
        wheel.material = materials[i < 2 ? 0 : 1]
      })
    }
    if (car.clip) {
      car.clip.planes.forEach((plane, i) => {
        // 車体の座標で「肩の線より下だけ残す」面を、いまの車体の姿勢で世界へ移す
        clipLocal.normal.set(0, -1, 0)
        clipLocal.constant = car.shape.fenderY[i] - style.wheelClipDrop - radius
        plane.copy(clipLocal).applyMatrix4(car.chassis.matrixWorld)
      })
    }
    const halfL = spec.length / 2
    // 潰れた端では、灯りのにじみも奥へ下がり、潰れた分だけ弱まる
    const crush = crushOf(spec, v.dents)
    const frontLit = 1 - Math.min(1, ((v.dents?.[0] ?? 0) + (v.dents?.[2] ?? 0)) / 2)
    const rearLit = 1 - Math.min(1, ((v.dents?.[3] ?? 0) + (v.dents?.[5] ?? 0)) / 2)
    if (lampsOn && frontLit > 0.05) {
      lights.pool(car.ground.matrixWorld, -halfL + crush.front, spec.width, ctx.lighting.headlightPool * 4 * frontLit)
      lights.glow(car.chassis.matrixWorld, car.shape.headY - car.shape.look.wheel, -halfL + crush.front - 0.06, spec.width * 1.5, 0.5, 0.55 * frontLit, 0.5 * frontLit, 0.4 * frontLit)
    }
    if (braking || lampsOn) {
      // ブレーキで赤い筋が車幅の 2 倍以上へ伸びる
      const k = (braking ? (lampsOn ? 1.15 : 0.9) : 0.34) * rearLit
      lights.glow(car.chassis.matrixWorld, car.shape.tailY - car.shape.look.wheel, halfL - crush.rear + 0.06, spec.width * (braking ? 2.7 : 1.6), braking ? 0.8 : 0.42, k, k * 0.06, k * 0.04)
    }

    const dx = v.x - ctx.camera.position.x
    const dz = v.z - ctx.camera.position.z
    if (dx * dx + dz * dz < style.fxRange * style.fxRange) {
      wheelFx(car, v, dt, Math.min(0.2, frame.dt))
      engineFx(car, v, dt)
    } else car.skid = null
  }

  return {
    update: (frame: FrameInfo) => {
      // 映り込みは空の明るさに合わせる（夜は弱い）
      luma.setHex(ctx.lighting.skyHorizon)
      const skyLevel = clamp(0.25 + (luma.r * 0.3 + luma.g * 0.5 + luma.b * 0.2) * 1.1, 0.25, 1)
      paintKit.level(skyLevel, bodyPaints())
      glossMaterial.opacity = style.glossAlpha * skyLevel
      lights.begin()
      tireShadowCount = 0
      const alive = new Set<number>()
      for (const v of frame.state.vehicles) {
        alive.add(v.id)
        let car = cars.get(v.id)
        if (car && car.kind !== v.kind) {
          removeCar(car, v.id)
          car = undefined
        }
        if (!car) {
          car = makeCar(v)
          cars.set(v.id, car)
        }
        const paint = car.body.material as THREE.MeshLambertMaterial | THREE.MeshPhongMaterial
        paint.color.setHex(v.color)
        reshape(car, v)
        placeCar(car, v, frame)
        if (frame.state.frame !== lastSimFrame) crashFx(car, v)
      }
      for (const [id, car] of cars) {
        if (alive.has(id)) continue
        removeCar(car, id)
        cars.delete(id)
      }
      lights.end()
      endDoorFrame()
      tireShadows.count = tireShadowCount
      tireShadows.instanceMatrix.needsUpdate = true
      lastSimFrame = frame.state.frame
      crash.update(Math.min(0.05, frame.dt))
      smoke.update(Math.min(0.05, frame.dt))
    },
    dispose: () => {
      for (const [id, car] of cars) removeCar(car, id)
      cars.clear()
      doorKit.dispose()
      for (const s of shapes.values()) disposeVehicleShape(s)
      hoodPanel.dispose()
      shadowGeometry.dispose()
      shadowMaterial.dispose()
      shadowMap.dispose()
      scene.remove(tireShadows)
      tireShadows.dispose()
      tireShadowMaterial.dispose()
      tireShadowMap.dispose()
      headOn.dispose()
      headOff.dispose()
      wheelMaterial.dispose()
      glossMaterial.dispose()
      paintKit.dispose()
      crash.dispose()
      smoke.dispose()
      skids.dispose()
      lights.dispose()
      scene.remove(group)
    },
  }
}
