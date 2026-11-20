// Grand Theft Outfit [部品: onfoot / outfit の見た目] 主人公と住人。出勤服のくり抜きスプライトのビルボード。
// 入口: createActorsRenderer(ctx)
// 契約: 状態の player / peds / outfit を読んで、カメラのほうを向く板を置く。
//       歩きの動きは stride（歩いた距離の位相）と速さから作る。関節の角度は lib/gto/onFootPose.ts が決め、
//       板を脚・腕・胴に分けて曲げるのは renderActorGait.ts。
//       乗り降りの途中は onFoot の boardingPose を読み、主人公をドアの外 → 開口の前 → 座席へ動かし、
//       車のドア（vehicleDoors.ts。車体の蝶番で開く）へ開き具合を頼む。
//       そのあいだの体の動き（手を伸ばす・脚を入れる・屈む・立ち上がる）も onFootPose の姿勢を重ねる。
//       服が変わったらテクスチャを差し替える。
//       背後カメラで見る主人公と、遠ざかっていく住人は「後ろ姿」（正面の写真から作った絵。renderActorArms.ts）で見せ、
//       こちらへ来る人は正面の写真のまま。後ろ姿のときは、体の板とは別の腕が歩き・走りに合わせて振れる。
//       主人公は「部位に切り分けた体」（renderActorPuppet.ts）で描く: 頭・胴・上腕/前腕・腿/すねを関節でつなぎ、
//       速さで前傾と腕振りが変わり、曲がる側へ体が倒れ、接地した足は地面に対して止まる（lib/gto/onFootRig.ts）。
//       部位の絵がまだ作れていないあいだと、倒れているときは板のまま。
//       [outfit] 服を奪う・着替える瞬間の演出と狙いの印は renderOutfitFx.ts。ここは「いま見せる服」と
//       姿勢の上書きを受け取って重ね、全員を置き終えたあとで演出を置かせるだけ。
import * as THREE from 'three'
import { angleDiff, clamp, damp, dirOf, hash, headingOf } from '../../lib/gto/math'
import { boardingPose, doorFrame, drivingSeat, FOOT_TUNING, gaitOf, SEAT_SEEN_DOOR } from '../../lib/gto/onFoot'
import { createFootGround } from '../../lib/gto/onFootGround'
import { easeGaitLevel } from '../../lib/gto/onFootRigView'
import { HEAD_ABOVE_HIP, mixRig, REST_RIG, rigBoarding, rigGait, type RigPose } from '../../lib/gto/onFootRig'
import { isCar, VEHICLE_SPECS } from '../../lib/gto/vehicle'
import { boardingAct, boardingBodyPose, gaitPose, mixPose, REST_POSE, type BodyPose } from '../../lib/gto/onFootPose'
import { armGait, mixLimb, pickView, planarArm, projectArm, type ActorView, type ArmLimb } from '../../lib/gto/onFootArms'
import { createArms, createBackSprites, placeArms, type Arms } from './renderActorArms'
import { applyGait, gaitUniform, makeBlobTexture, makeGaitGeometry, setRig, type GaitUniform } from './renderActorGait'
import { createPuppetKit, type Puppet, type PuppetLook } from './renderActorPuppet'
import { createFootShadows, FOOT_SHADOW_STYLE, makeDenseBlobTexture, type FootShadows } from './renderActorFootShadow'
import { chassisFrame, createDoorTrim } from './renderActorDoorTrim'
import { createSeatWindow, glassSeen, SEAT_WINDOW_ORDER } from './renderActorSeat'
import { createCabinSet } from './renderActorCabin'
import { applyTweak, createOutfitFx } from './renderOutfitFx'
import { requestVehicleDoor, vehicleCabin, vehicleSeatPoint } from './vehicleDoors'
import type { Boarding, BoardingPhase, VehicleState } from '../../lib/gto/types'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'

/** 見た目を決める数字 */
export const ACTOR_STYLE = {
  heroHeight: 1.74,
  pedMin: 1.56,
  pedMax: 1.78,
  /** 走るときの前傾（ラジアン）と、加減速で前後に揺れる量（ラジアン / (m/s²)） */
  leanRun: 0.17,
  leanAccel: 0.006,
  leanMax: 0.3,
  /** 横向きに動くとき、体をひねったように板の幅を詰める割合 */
  profileSquash: 0.24,
  /** 絵を切り替えた（正面⇔後ろ姿・左右の裏返し）瞬間に、幅を一度すぼめる割合と、戻る速さ（1/s） */
  swapPinch: 0.2,
  swapRate: 14,
  /** 腕を別に描く距離 m（住人。これより遠くは腕なしの後ろ姿だけ）。[PC, スマホ] */
  armsWithin: [45, 16],
  /** 腕の付け根を、肩の端から内へ寄せる割合（胴の板と重ねて、すきまを作らない） */
  armsInset: 0.88,
  /** 立ち止まっているときの呼吸（高さに対する割合） */
  breathe: 0.006,
  /**
   * 足元の影の濃さ（本物の影がある画質では薄く重ねるだけ）。
   * 色調を後段で掛ける画質（quality.post）は、明るい地面でも濃く出る絵（makeDenseBlobTexture）に替えて blobOpacityDense を使う
   */
  blobOpacity: 0.6,
  blobOpacityWithShadows: 0.5,
  blobOpacityDense: 0.82,
  /** 歩くたびに体ごと左右へ傾く量（ラジアン）。体重が左右の足へ移って見える */
  roll: 0.035,
  rollRun: 0.06,
  /** 座席へ沈む深さ m と、縮む割合 */
  sinkDepth: 0.12,
  sinkShrink: 0.2,
  /** 乗り降りの姿勢へ移る速さ（1/s）と、姿勢そのものをなめらかにする速さ */
  actRate: 12,
  actSmooth: 18,
  /** 走りで体が浮く高さ（身長に対する割合） */
  hop: 0.018,
  /** 足元の面（舗装・敷石・横断歩道の縞）の高さを調べ直す移動距離 m と、段を上り下りする速さ（1/s） */
  liftEvery: 0.6,
  liftRate: 14,
  /** 関節のある体（主人公）の体の下の影: 濃さ [色調を後段で掛ける画質, 掛けない画質] と、体の幅に対する大きさ（左右の足の真下の影は renderActorFootShadow.ts） */
  rigBlobOpacity: [0.96, 0.7],
  rigBlobWide: 1.5,
  /**
   * 関節のある体: 旋回の速さ（rad/s）と加減速（m/s²）を −1..1 へ直す基準と、なめらかにする速さ（1/s）。
   * 旋回の傾きは、切り返した瞬間に素早く倒れ（turnRise）、向きが変わりきったあともしばらく残る（turnRate）
   */
  turnFull: 3,
  turnRise: 16,
  turnRate: 3.2,
  accelFull: 26,
  /** 頭の切り抜きを正面の写真にする境目（進む向きとカメラの向きの cos。これより小さければ顔が見える） */
  headFrontBelow: 0.45,
  /** 体の向きが狙いの向きへ回る速さ（1/s） */
  yawRate: 16,
  accelRate: 6,
  /** 運転中、窓越しに座った上半身を見せる距離 m（カメラから。遠ければ描かない） */
  driverWithin: 16,
  /** 座ったままドアを開け閉めするあいだ、開口越しの車内を見せはじめるドアの開き具合 */
  seatedSeenDoor: 0.18,
  /** 時刻ごとの明るさ（スプライトは陰影を付けずに、この色を掛ける） */
  tint: { day: 0xffffff, dusk: 0xe6c9b4, night: 0x8f93b8 },
}

interface Actor {
  root: THREE.Group
  /** 進む向きへ前傾させるための入れ物 */
  tilt: THREE.Group
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  shadow: THREE.Mesh
  gait: GaitUniform
  key: string
  height: number
  width: number
  /** 板の左右（1 か −1 へ向かって動く） */
  flip: number
  /** いま見せている絵（正面か後ろ姿）と、切り替えた直後のすぼみ 0..1 */
  view: ActorView
  shown: ActorView
  pinch: number
  arms: Arms | null
  lean: number
  lastSpeed: number
  seed: number
  /** 乗り降りの姿勢（なめらかにしたもの）と、その効き 0..1 */
  act: BodyPose
  actWeight: number
  /** 関節のある体で描くか（主人公）。puppet は部位の絵ができてから作る */
  rigged: boolean
  puppet: Puppet | null
  /** 足の真下の影（関節のある体だけ） */
  feet: FootShadows | null
  puppetLook: PuppetLook | null
  rigAct: RigPose
  turn: number
  push: number
  /** 走りの度合い・動いている度合い（下がるほうだけゆっくり。止められても走りの姿勢がすぐ抜けない） */
  runShown: number
  moveShown: number
  lastHeading: number
  /** 体の向き（急な向き直りをなめらかにしたもの） */
  yaw: number
  /** 足元の面の厚み（地表から m。なめらかにしたもの）と、狙いの値・最後に調べた場所 */
  lift: number
  liftWant: number
  liftAt: { x: number; z: number } | null
}

/** 1人ぶんの姿勢の入力 */
interface PoseInput {
  x: number
  y: number
  z: number
  heading: number
  stride: number
  speed: number
  down: boolean
  /** 車へ沈んだ度合い 0..1 */
  sink: number
  /** 乗り降りの動作（主人公だけ）。toward は車のある向き（世界）、headY は座ったときの頭の高さ m（路面から） */
  act?: { phase: BoardingPhase; k: number; towardX: number; towardZ: number; weight: number; side: 1 | -1 | 0; headY: number } | null
  /** 描き始めの1コマ（車内から現れた瞬間）。姿勢をなめらかにせず、その段階の姿へ合わせる */
  snap?: boolean
}

export function createActorsRenderer(ctx: RenderCtx): RenderPart {
  const { scene, camera, quality, world } = ctx
  const group = new THREE.Group()
  group.name = 'gto-actors'
  scene.add(group)

  const planeGeometry = makeGaitGeometry(quality.id === 'mobile')
  const shadowGeometry = new THREE.PlaneGeometry(1, 1)
  shadowGeometry.rotateX(-Math.PI / 2)
  // 色調を後段で掛ける画質では地面の明るさが 1 を超えるので、明るい地面でも濃く出る絵にする
  const blob = quality.post ? makeDenseBlobTexture() : makeBlobTexture()
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: blob,
    color: 0x000000,
    transparent: true,
    opacity: quality.post ? ACTOR_STYLE.blobOpacityDense : quality.shadows ? ACTOR_STYLE.blobOpacityWithShadows : ACTOR_STYLE.blobOpacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  // 主人公の体の下の影は濃くする（足元が地面に貼り付いて見える）
  const heroShadowMaterial = shadowMaterial.clone()
  heroShadowMaterial.opacity = ACTOR_STYLE.rigBlobOpacity[quality.post ? 0 : 1]
  const tint = new THREE.Color(ACTOR_STYLE.tint[ctx.time])
  const armsWithin = ACTOR_STYLE.armsWithin[quality.id === 'mobile' ? 1 : 0]
  const puppets = createPuppetKit(quality.id === 'mobile')
  const footGround = createFootGround(world, quality.terrainStep)

  const loader = new THREE.TextureLoader()
  const textures = new Map<string, THREE.Texture>()
  const textureOf = (key: string) => {
    const cached = textures.get(key)
    if (cached) return cached
    ctx.loading.begin()
    const tex = loader.load(
      ctx.spriteUrl(key),
      () => ctx.loading.end(),
      undefined,
      () => ctx.loading.end(),
    )
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 2
    textures.set(key, tex)
    return tex
  }

  const makeActor = (key: string, height: number, seed: number, rigged = false): Actor => {
    const gait = gaitUniform()
    const material = new THREE.MeshBasicMaterial({ map: textureOf(key), color: tint, alphaTest: 0.5, side: THREE.DoubleSide })
    applyGait(material, gait)
    const plane = new THREE.Mesh(planeGeometry, material)
    plane.castShadow = quality.shadows
    // 影もスプライトの形に抜き、脚の動きも同じにする
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaTest: 0.5 })
    applyGait(depth, gait)
    plane.customDepthMaterial = depth
    const shadow = new THREE.Mesh(shadowGeometry, rigged ? heroShadowMaterial : shadowMaterial)
    shadow.renderOrder = 1
    const tilt = new THREE.Group()
    tilt.add(plane)
    const root = new THREE.Group()
    root.add(shadow, tilt)
    group.add(root)
    const actor: Actor = { root, tilt, plane, shadow, gait, key, height, width: height * 0.4, flip: 1, view: 'back', shown: 'front', pinch: 0, arms: null, lean: 0, lastSpeed: 0, seed, act: REST_POSE, actWeight: 0, rigged, puppet: null, feet: null, puppetLook: null, rigAct: REST_RIG, turn: 0, push: 0, runShown: 0, moveShown: 0, lastHeading: 0, yaw: 0, lift: 0, liftWant: 0, liftAt: null }
    fit(actor, key)
    return actor
  }

  const setMap = (a: Actor, map: THREE.Texture) => {
    if (a.plane.material.map === map) return
    a.plane.material.map = map
    a.plane.material.needsUpdate = true
    const depth = a.plane.customDepthMaterial as THREE.MeshDepthMaterial
    depth.map = map
    depth.needsUpdate = true
  }

  const fit = (a: Actor, key: string) => {
    if (a.key !== key) {
      a.key = key
      a.shown = 'front'
      setMap(a, textureOf(key))
    }
    a.width = a.height * ctx.spriteAspect(key)
  }

  /** 見せる絵（正面か後ろ姿）を合わせる。後ろ姿がまだ作れていなければ正面のまま。返り値は後ろ姿の絵 */
  const dress = (a: Actor, view: ActorView) => {
    const look = view === 'back' ? backs.get(a.key) : null
    const want: ActorView = look ? 'back' : 'front'
    if (a.shown !== want) {
      a.shown = want
      a.pinch = 1
    }
    setMap(a, look ? look.tex : textureOf(a.key))
    return look
  }

  const disposeActor = (a: Actor) => {
    group.remove(a.root)
    a.arms?.mesh.geometry.dispose()
    a.puppet?.dispose()
    a.feet?.dispose()
    a.plane.material.dispose()
    ;(a.plane.customDepthMaterial as THREE.Material).dispose()
  }

  const axis = new THREE.Vector3()
  const backs = createBackSprites(textureOf, tint)

  /** 板をカメラへ向け、歩きの動き・前傾・接地の影・倒れた姿勢を付ける */
  const pose = (a: Actor, at: PoseInput, dt: number, now: number) => {
    const { x, y, z, speed } = at
    // 足元の面: 地表の上に敷かれた舗装・敷石・横断歩道の縞の上に立つ（靴が沈まず、影が面の下へ隠れない）
    if (!a.liftAt || (x - a.liftAt.x) ** 2 + (z - a.liftAt.z) ** 2 > ACTOR_STYLE.liftEvery ** 2) {
      const first = a.liftAt == null
      a.liftAt = { x, z }
      a.liftWant = footGround.rise(x, z)
      if (first) a.lift = a.liftWant
    }
    a.lift = damp(a.lift, a.liftWant, ACTOR_STYLE.liftRate, dt)
    a.root.position.set(x, y + a.lift, z)
    const face = Math.atan2(camera.position.x - x, camera.position.z - z)
    // カメラから見て、進む向きがどれだけ横か（0=奥か手前、1=真横）と、左右どちらか
    const rel = angleDiff(headingOf(x - camera.position.x, z - camera.position.z), at.heading)
    const moving = clamp(speed / 1.2, 0, 1)
    const run = clamp((speed - FOOT_TUNING.walkSpeed * 0.8) / (FOOT_TUNING.runSpeed - FOOT_TUNING.walkSpeed * 0.8), 0, 1)
    const profile = Math.abs(Math.sin(rel)) * moving
    // 遠ざかる人は後ろ姿、こちらへ来る人は正面。倒れている人は正面の写真のまま
    a.view = pickView(a.view, Math.cos(rel), at.act != null && at.act.phase !== 'approach')
    const look = dress(a, at.down ? 'front' : a.view)
    // 正面の絵は、横へ動くとき進む側へ裏返す。後ろ姿は裏返さない（背中の絵がそのまま進む向きを表す）
    const flipTo = look ? 1 : moving > 0.3 && Math.abs(Math.sin(rel)) > 0.3 ? (Math.sin(rel) > 0 ? 1 : -1) : a.flip
    if (flipTo !== a.flip) {
      a.flip = flipTo
      a.pinch = 1
    }
    a.pinch = damp(a.pinch, 0, ACTOR_STYLE.swapRate, dt)

    // 体の動き（シェーダ）。位相は歩いた距離から来るので、足の運びと進みが合う。
    // 向きは板の中の左右で渡す: 板の右（+x）は世界では (cos face, −sin face)、裏返しているときは逆
    const flipSign = a.flip < 0 ? -1 : 1
    const rightX = Math.cos(face) * flipSign
    const rightZ = -Math.sin(face) * flipSign
    const fwd = dirOf(at.heading)
    const phase = at.stride * Math.PI * 2
    const walk = at.down ? REST_POSE : gaitPose({ phase, moving, run, side: fwd.x * rightX + fwd.z * rightZ })
    const act = at.act
    if (act) {
      const target = boardingBodyPose(act.phase, act.k, act.towardX * rightX + act.towardZ * rightZ)
      a.act = at.snap ? target : mixPose(a.act, target, 1 - Math.exp(-ACTOR_STYLE.actSmooth * dt))
    }
    a.actWeight = act && at.snap ? act.weight : damp(a.actWeight, act ? act.weight : 0, ACTOR_STYLE.actRate, dt)
    if (!act && a.actWeight < 0.01) a.act = REST_POSE
    const mixed = mixPose(walk, a.act, a.actWeight)
    // 後ろ姿では腕を別の板で振るので、体の板の腕は曲げない
    const body = look ? { ...mixed, armL: 0, armR: 0, foreL: 0, foreR: 0 } : mixed

    // 前傾: 走るほど前へ、加速で前へ・急停止で後ろへ
    const accel = dt > 0 ? (speed - a.lastSpeed) / dt : 0
    a.lastSpeed = speed
    const wantLean = clamp(run * ACTOR_STYLE.leanRun + moving * 0.03 + accel * ACTOR_STYLE.leanAccel, -ACTOR_STYLE.leanMax, ACTOR_STYLE.leanMax)
    a.lean = damp(a.lean, at.down ? 0 : wantLean, 9, dt)
    axis.set(-Math.cos(at.heading), 0, -Math.sin(at.heading))
    a.tilt.quaternion.setFromAxisAngle(axis, a.lean)

    // 幅: 横向きは体をひねったぶん細く、向きを変える瞬間は板が裏返る
    const breathe = 1 + Math.sin(now * 1.7 + a.seed * 6.3) * ACTOR_STYLE.breathe * (1 - moving)
    const h = a.height * breathe * (1 - at.sink * ACTOR_STYLE.sinkShrink)
    const w = a.width * (1 - profile * ACTOR_STYLE.profileSquash) * a.flip * (1 - a.pinch * ACTOR_STYLE.swapPinch)
    a.plane.scale.set(w, h, 1)
    // 写真の中の体の中心（正面の絵は、後ろ姿の絵と左右が逆）
    const rig = backs.get(a.key)?.rig
    const legX = rig ? (look ? rig.legX : -rig.legX) : 0
    setRig(a.gait, body, Math.abs(w) / h, 0.5 + legX, quality.id === 'mobile')
    const roll = Math.sin(at.stride * Math.PI * 2) * moving * (ACTOR_STYLE.roll + run * (ACTOR_STYLE.rollRun - ACTOR_STYLE.roll)) * (1 - profile * 0.7)
    a.plane.rotation.set(0, face, at.down ? Math.PI / 2 - 0.12 : roll)
    // 走りは両足が地面を離れる瞬間がある（脚が前後に開ききったところで体が浮く）
    const hop = run * moving * ACTOR_STYLE.hop * a.height * (0.5 - 0.5 * Math.cos(phase * 2))
    a.plane.position.y = at.down ? 0.25 : hop - at.sink * ACTOR_STYLE.sinkDepth

    // 腕（後ろ姿のときだけ）: 体の向きと見ている向きから、肩・肘・手首を板の上へ投影する
    const near = (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2 < armsWithin * armsWithin
    // 関節のある体（主人公）: 板と腕の板は隠し、部位を関節で動かす
    const parts = a.rigged && !at.down ? (backs.get(a.key)?.puppet ?? null) : null
    a.plane.visible = !parts
    if (a.puppet) a.puppet.root.visible = parts != null
    if (parts) {
      if (!a.puppet) {
        a.puppet = puppets.make(parts, quality.shadows)
        // 開口ののぞき窓（renderActorSeat）の、抜く面と戻す面のあいだに描く
        a.puppet.root.traverse((o) => {
          o.renderOrder = SEAT_WINDOW_ORDER.body
        })
        a.root.add(a.puppet.root)
        a.lastHeading = at.heading
        a.yaw = at.heading
      }
      if (a.puppetLook !== parts) {
        a.puppet.setLook(parts)
        a.puppetLook = parts
      }
      const tall = a.height * parts.dims.tall
      const spin = dt > 0 && !act ? angleDiff(a.lastHeading, at.heading) / dt : 0
      a.lastHeading = at.heading
      const turnWant = clamp(spin / ACTOR_STYLE.turnFull, -1, 1) * moving
      a.turn = damp(a.turn, turnWant, Math.abs(turnWant) > Math.abs(a.turn) ? ACTOR_STYLE.turnRise : ACTOR_STYLE.turnRate, dt)
      a.push = damp(a.push, clamp(accel / ACTOR_STYLE.accelFull, -1, 1), ACTOR_STYLE.accelRate, dt)
      a.runShown = easeGaitLevel(a.runShown, run, dt)
      a.moveShown = easeGaitLevel(a.moveShown, moving, dt)
      const gait = rigGait({ phase, moving: a.moveShown, run: a.runShown, turn: a.turn, accel: a.push, stride: gaitOf(speed).strideLength / tall })
      // 座りきったときの腰の高さ: 頭が車の窓の高さ（車種ごとの頭の位置）に来るように
      const seatHip = act ? clamp(act.headY / tall - HEAD_ABOVE_HIP, 0.2, 0.42) : 0
      if (act && at.snap) {
        // 車内から現れた瞬間は、立った姿からの移りを見せない（座った姿で現れる）
        a.rigAct = rigBoarding(act.phase, act.k, act.side, seatHip)
        a.yaw = at.heading
      } else if (act) a.rigAct = mixRig(a.rigAct, rigBoarding(act.phase, act.k, act.side, seatHip), 1 - Math.exp(-ACTOR_STYLE.actSmooth * dt))
      else if (a.actWeight < 0.01) a.rigAct = REST_RIG
      const rig = mixRig(gait, a.rigAct, a.actWeight)
      a.puppet.apply(rig)
      a.puppet.root.scale.setScalar(tall)
      a.yaw += angleDiff(a.yaw, at.heading) * (1 - Math.exp(-ACTOR_STYLE.yawRate * dt))
      a.puppet.root.rotation.set(0, Math.PI - a.yaw, 0)
      // 屈むのも、走りで浮くのも関節（腰の高さ）でやる。体ごと上下させない（接地した足は地面に着いたまま）
      a.puppet.root.position.y = 0
      // 足の真下の影: 踏んでいる足の下が濃くなり、足が体の前後へ出ても影が足から離れない
      if (!a.feet) {
        a.feet = createFootShadows(blob, FOOT_SHADOW_STYLE.opacity[quality.post ? 0 : 1])
        a.root.add(a.feet.root)
      }
      a.feet.root.visible = a.shadow.visible
      a.feet.update(rig, tall, a.yaw, parts.dims.legHalf)
      // 頭は、横顔が見える向きでも正面の写真（後ろ姿の絵は髪で塗りつぶしてある）
      // 乗り降りの動作中は後ろ頭のまま（立ち上がって体が外へ向く1コマだけ、正面の顔に替わらない）
      a.puppet.faceHead(face, !(at.act != null && at.act.phase !== 'approach') && Math.cos(rel) < ACTOR_STYLE.headFrontBelow)
    }
    if (!parts && a.feet) a.feet.root.visible = false
    if (look && near && !parts) {
      if (!a.arms) {
        a.arms = createArms(look.arm, quality.shadows)
        a.plane.add(a.arms.mesh)
      }
      a.arms.mesh.material = look.arm
      a.arms.mesh.visible = true
      const vl = Math.hypot(x - camera.position.x, z - camera.position.z) || 1
      const vx = (x - camera.position.x) / vl
      const vz = (z - camera.position.z) / vl
      const view = { rightX: -fwd.z * rightX + fwd.x * rightZ, rightDepth: -fwd.z * vx + fwd.x * vz, fwdX: fwd.x * rightX + fwd.z * rightZ, fwdDepth: fwd.x * vx + fwd.z * vz }
      const swing = armGait(phase, moving, run)
      const frame = { shoulderHalf: look.rig.shoulderHalf * ACTOR_STYLE.armsInset, armLen: look.rig.armLen }
      const limb = (sign: 1 | -1): ArmLimb => {
        const gaitLimb = projectArm(sign, sign < 0 ? swing.l : swing.r, frame, view)
        if (a.actWeight < 0.01) return gaitLimb
        return mixLimb(gaitLimb, planarArm(sign, sign < 0 ? a.act.armL : a.act.armR, sign < 0 ? a.act.foreL : a.act.foreR, frame, view), a.actWeight)
      }
      placeArms(a.arms, [limb(-1), limb(1)], look.rig, look.rig.centerX - look.rig.legX, body, Math.abs(w) / h, a.height)
    } else if (a.arms) {
      a.arms.mesh.visible = false
    }

    // 足元の影: 地面の傾きに沿わせ、足が上がる瞬間（体が浮く瞬間）に少し小さく薄くする
    const gx = (world.groundY(x + 0.4, z) - world.groundY(x - 0.4, z)) / 0.8
    const gz = (world.groundY(x, z + 0.4) - world.groundY(x, z - 0.4)) / 0.8
    a.shadow.rotation.set(-Math.atan(gz), 0, Math.atan(gx))
    a.shadow.position.y = 0.05
    const air = Math.abs(Math.sin(at.stride * Math.PI * 2)) * moving * (0.08 + run * 0.14)
    const sw = Math.max(0.7, a.width * (parts ? ACTOR_STYLE.rigBlobWide : 1.35)) * (1 - air) * (at.down ? 1.9 : 1) * (1 - at.sink * 0.6)
    a.shadow.scale.set(sw, 1, sw * (parts ? 0.8 : 0.62))
  }

  /** 乗り降りの動作。車のある向きと、段階の進み具合。降りたあと歩き出したら歩きへ譲る */
  const actOf = (board: Boarding, car: VehicleState, x: number, z: number, speed: number): PoseInput['act'] => {
    if (board.phase === 'approach') return null
    const dx = car.x - x
    const dz = car.z - z
    const d = Math.hypot(dx, dz)
    // 座席へ入りきる前後は車との向きが定まらないので、ドアの側（車の横）を向きとする
    const f = dirOf(car.heading)
    const side = board.side === 0 ? 1 : board.side
    const tx = d > 0.5 ? dx / d : f.z * side
    const tz = d > 0.5 ? dz / d : -f.x * side
    const weight = board.phase === 'leave' ? 1 - clamp(speed / 1.5, 0, 1) : 1
    return { ...boardingAct(board), towardX: tx, towardZ: tz, weight, side: board.side, headY: vehicleCabin(car.kind).head.y }
  }

  /** 運転中の姿: 座りきって両手はハンドル */
  const seatedAct = (car: VehicleState, side: 1 | -1): PoseInput['act'] => {
    const f = dirOf(car.heading)
    return { phase: 'sit', k: 1, towardX: f.z * side, towardZ: -f.x * side, weight: 1, side, headY: vehicleCabin(car.kind).head.y }
  }

  /** 運転席の窓を、カメラが近くから・浅すぎない角度で見ているか（見えないときは、車内の体を描かない） */
  const windowFaces = (car: VehicleState, side: 1 | -1): boolean => {
    const rx = camera.position.x - car.x
    const rz = camera.position.z - car.z
    if (rx * rx + rz * rz > ACTOR_STYLE.driverWithin ** 2) return false
    const f = dirOf(car.heading)
    const layout = vehicleCabin(car.kind)
    return glassSeen(-(rx * f.x + rz * f.z) - layout.head.z, (rx * -f.z + rz * f.x) * side - layout.door.halfBelt)
  }

  const hero = makeActor('', ACTOR_STYLE.heroHeight, 0.37, true)
  const peds = new Map<number, Actor>()
  const outfitFx = createOutfitFx(ctx, { group, planeGeometry, textureOf, tint })
  const seatWindow = createSeatWindow(scene)
  const doorTrim = createDoorTrim(scene, tint)
  const cabinSet = createCabinSet(scene, tint)
  const seatAt = new THREE.Vector3()
  const seatOther = new THREE.Vector3()
  const headAt = new THREE.Vector3()
  const carFrame = new THREE.Matrix4()
  /** 最後に使ったドアの側（運転中、どちらの席に座っているか） */
  let seatSide: 1 | -1 = 1
  /** 前のフレームに車へ頼んだドアの開き具合 */
  let lastAsked: { id: number; side: 1 | -1; door: number } | null = null

  return {
    update: (frame: FrameInfo) => {
      const { state, dt, now } = frame
      const p = state.player
      const board = p.boarding ?? null
      const car = board ? state.vehicles.find((v) => v.id === board.vehicleId) : undefined
      const riding = car ? boardingPose(p, car, VEHICLE_SPECS[car.kind]) : null
      // ドアは車の担当の部品（車体の蝶番で開き、開口の奥は暗い車内）。開けていたいフレームごとに頼む
      const asked = riding && car && riding.side !== 0 && riding.door > 0 && !frame.photo ? { id: car.id, side: riding.side, door: riding.door } : null
      if (asked) requestVehicleDoor(asked.id, asked.side, asked.door)
      // 車はこの部品より先に描かれるので、いま画面にあるドアの板は「前のフレームに頼んだ開き具合」。
      // 重ねる縁取り・開口ののぞき窓も同じ値で描く（フレームが粗いと、板と縁取りの角度がずれて黒い板がはみ出す）
      const drawnDoor = riding && car && lastAsked && lastAsked.id === car.id && lastAsked.side === riding.side ? lastAsked.door : 0
      lastAsked = asked

      if (board && board.side !== 0) seatSide = board.side
      // 運転中（ドアは閉まっている）: 座った上半身を、ドアの窓越しに見せる。スマホでは描かない
      // [cheats] 戦車と飛行機は窓が無い（体は描かない）
      const mine = state.mode === 'drive' && !frame.photo && quality.id !== 'mobile' ? state.vehicles.find((v) => v.id === p.vehicleId && isCar(v.kind)) : undefined
      const shutIn = riding != null && riding.inside >= 1 && riding.door <= SEAT_SEEN_DOOR && drawnDoor <= SEAT_SEEN_DOOR
      const behindGlass = mine && (riding == null || shutIn) && windowFaces(mine, seatSide) ? mine : null
      const driving = behindGlass ? drivingSeat(behindGlass, VEHICLE_SPECS[behindGlass.kind], seatSide) : null

      // 開いたドアの内側の縁取り（車体色）と、車内へ入った体を開口越しに見せるのぞき窓・開口の奥の車内
      const shownCar = behindGlass ?? (riding && car && riding.side !== 0 && (riding.door > 0 || drawnDoor > 0) && !frame.photo ? car : null)
      const shownSide = behindGlass ? seatSide : riding && riding.side !== 0 ? riding.side : seatSide
      if (shownCar) {
        const layout = vehicleCabin(shownCar.kind)
        const seat = vehicleSeatPoint(shownCar.id, shownSide, 'seat', seatAt)
        const baseY = seat ? seat.y - layout.seat.y : world.groundY(shownCar.x, shownCar.z)
        const at = { x: shownCar.x, z: shownCar.z, heading: shownCar.heading, baseY, layout, side: shownSide }
        // 車体の傾きに合わせて重ねる（車の担当の3点から車体の姿勢を起こす）
        const other = seat ? vehicleSeatPoint(shownCar.id, shownSide === 1 ? -1 : 1, 'seat', seatOther) : null
        const head = other ? vehicleSeatPoint(shownCar.id, 1, 'head', headAt) : null
        const frame = seat && other && head ? chassisFrame(layout, shownSide === 1 ? seat : other, shownSide === 1 ? other : seat, head, carFrame) : null
        if (behindGlass) {
          // 閉まりきる直前のドアの板がまだ描かれているあいだは、外板の色を重ねたままにする
          if (drawnDoor > 0) doorTrim.show({ ...at, door: drawnDoor, color: shownCar.color, frame })
          else doorTrim.hide()
          // 窓の奥にも車内（背もたれ・ハンドル・向こう側の明るい窓）を置く。暗い服でも、座った上半身が窓の中に抜けて見える
          cabinSet.show({ ...at, seenX: doorFrame(shownCar, VEHICLE_SPECS[shownCar.kind]).seatOut })
          seatWindow.show({ ...at, door: 0, camera: camera.position, glass: true })
        } else if (riding) {
          doorTrim.show({ ...at, door: drawnDoor, color: shownCar.color, frame })
          // ドアが開きはじめたら、開口の奥は車内（座席・ハンドル）。体が入る前から見えている
          // 座ったままドアが動くあいだ（閉めかけ・開けかけ）の浅い角度では、ドアの板がカメラから見て開口の手前に重なる。
          // そこで開口を抜くと、車内（暗いダッシュボード）がドアの板の上に描かれて黒い板に見えるので、半分以上開いてから抜く
          const seenFrom = riding.inside >= 1 && board && (board.phase === 'shut' || board.phase === 'unlatch') ? ACTOR_STYLE.seatedSeenDoor : SEAT_SEEN_DOOR
          if (drawnDoor > seenFrom) {
            seatWindow.show({ ...at, door: drawnDoor, camera: camera.position })
            cabinSet.show({ ...at, seenX: doorFrame(shownCar, VEHICLE_SPECS[shownCar.kind]).seenOut })
          } else {
            seatWindow.hide()
            cabinSet.hide()
          }
        }
      } else {
        doorTrim.hide()
        seatWindow.hide()
        cabinSet.hide()
      }

      // 乗り降りの途中は、運転の構えに入ってからも座りきるまで主人公を描く
      const showHero = !frame.photo && state.outfit.wearing !== '' && (driving != null || (riding ? riding.visible : state.mode === 'foot'))
      const appeared = showHero && !hero.root.visible
      hero.root.visible = showHero
      // [outfit] 奪った服が飛んで届くまでは、元の服を見せる
      const look = outfitFx.plan(frame, showHero)
      if (showHero) {
        fit(hero, look.heroKey)
        const fixed = riding != null && board != null && board.phase !== 'approach' && board.phase !== 'leave'
        const x = driving ? driving.x : fixed && riding ? riding.x : p.x
        const z = driving ? driving.z : fixed && riding ? riding.z : p.z
        // 車内に座りきっているあいだは、足元の丸い影を出さない（車の下に人の影が見えない）
        hero.shadow.visible = !(driving != null || (riding != null && riding.inside >= 1))
        pose(
          hero,
          {
            x,
            y: fixed || driving ? world.groundY(x, z) : p.y,
            z,
            heading: driving ? driving.heading : fixed && riding ? riding.heading : p.heading,
            stride: p.stride,
            speed: fixed || driving ? 0 : p.speed,
            down: false,
            sink: driving ? 1 : riding ? riding.sink : 0,
            act: driving && behindGlass ? seatedAct(behindGlass, seatSide) : riding && board && car ? actOf(board, car, x, z, p.speed) : null,
            snap: appeared,
          },
          dt,
          now,
        )
        // 運転手を引っぱり出すあいだは体を後ろへ引く
        hero.plane.rotation.z += riding ? -riding.pull * 0.2 * (riding.side || 1) : 0
        // [outfit] 服を奪う動作（踏み込む・決めの弾み）と、着替えの回転
        if (look.hero) applyTweak(hero, look.hero)
        if (look.hero && hero.puppet) {
          // 関節のある体にも同じ動きを写す（着替えの回転は、体ごと回る）
          const tw = look.hero
          hero.puppet.root.position.y += tw.lift
          hero.puppet.root.scale.y *= tw.sy
          hero.puppet.root.rotation.y += Math.acos(clamp(tw.sx, -1, 1))
        }
      }
      const alive = new Set<number>()
      for (const ped of state.peds) {
        alive.add(ped.id)
        let a = peds.get(ped.id)
        if (!a) {
          const h = ACTOR_STYLE.pedMin + hash(ped.id, 3) * (ACTOR_STYLE.pedMax - ACTOR_STYLE.pedMin)
          a = makeActor(ped.outfitKey, h, hash(ped.id, 7))
          peds.set(ped.id, a)
        }
        // [outfit] 服を奪われている最中の相手は、倒さずに立たせたまま回す
        const robbed = ped.id === look.victimId
        fit(a, robbed ? look.victimKey : ped.outfitKey)
        pose(
          a,
          { x: ped.x, y: ped.y, z: ped.z, heading: ped.heading, stride: ped.stride, speed: ped.speed, down: !robbed && ped.mood === 'stunned' && ped.timer > 1, sink: 0 },
          dt,
          now,
        )
        if (robbed && look.victim) applyTweak(a, look.victim)
      }
      for (const [id, a] of peds) {
        if (alive.has(id)) continue
        disposeActor(a)
        peds.delete(id)
      }
      outfitFx.place(frame, showHero ? hero : null, (id) => peds.get(id))
    },
    dispose: () => {
      disposeActor(hero)
      for (const a of peds.values()) disposeActor(a)
      for (const t of textures.values()) t.dispose()
      puppets.dispose()
      backs.dispose()
      outfitFx.dispose()
      seatWindow.dispose()
      cabinSet.dispose()
      doorTrim.dispose()
      planeGeometry.dispose()
      shadowGeometry.dispose()
      shadowMaterial.dispose()
      heroShadowMaterial.dispose()
      blob.dispose()
      scene.remove(group)
    },
  }
}
