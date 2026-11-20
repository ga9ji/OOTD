// Grand Theft Outfit [部品: cheats の見た目] 裏コードで出す乗り物（戦車・飛行機）を描く。
// 入口: createSpecialsRenderer(ctx)
// 契約: state.vehicles のうち kind が tank / plane の物だけを描く（ふつうの車は renderVehicles.ts）。
//       形は箱と円柱を組んだ低ポリで、どれも架空の一般的な形（実在の機種は写していない）。寸法は VEHICLE_SPECS に合わせる。
//       前が −z、右が ＋x、地面が y=0。
//       戦車: 車体・履帯・砲塔・砲身。履帯の転輪は走った距離で回る。坂では前後の地面の高さに合わせて傾く。
//       飛行機: 胴体・主翼・尾翼・プロペラ・脚。上下の速さで機首を上げ下げし、旋回で翼を傾ける。プロペラは速さに合わせて回る。
//       影は真下の地面に落とす（飛行機は高く上がるほど大きく薄くなる）。
import * as THREE from 'three'
import { clamp, dirOf } from '../../lib/gto/math'
import type { SpecialKind, VehicleState } from '../../lib/gto/types'
import { isSpecial, VEHICLE_SPECS } from '../../lib/gto/vehicle'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'
import { contactShadowTexture } from './vehicleShadowTex'

/** 見た目を決める数字 */
export const SPECIAL_STYLE = {
  /** 色（塗装色に掛ける濃淡と、決まった色） */
  track: 0x23252a,
  wheel: 0x3a3d42,
  barrel: 0x3d4430,
  glass: 0x1c2748,
  stripe: 0xff6a2b,
  prop: 0x12172b,
  gear: 0x2a2c31,
  /** 飛行機の翼の端から端まで m、尾翼の幅 m */
  wingSpan: 9.4,
  tailSpan: 3.4,
  /** 機首の上げ下げ（上下の速さ m/s あたりのラジアン）と上限、旋回で傾く角度（旋回の速さ rad/s あたりのラジアン）と上限 */
  pitchPerClimb: 0.03,
  pitchMax: 0.32,
  bankPerYaw: 0.62,
  bankMax: 0.6,
  /** 姿勢の付いてくる速さ（1/s） */
  ease: 6,
  /** プロペラの回る速さ（止まっているとき rad/s と、速さ 1m/s あたりの足し前） */
  propIdle: 9,
  propPerSpeed: 1.6,
  /** 影の濃さと、飛行機の影が消えきる高さ m */
  shadowAlpha: 0.5,
  shadowFade: 90,
}

interface Special {
  kind: SpecialKind
  root: THREE.Group
  /** 傾ける胴体 */
  body: THREE.Group
  shadow: THREE.Mesh
  /** 回す部品（戦車の転輪・飛行機のプロペラ） */
  spinners: THREE.Object3D[]
  paint: THREE.MeshLambertMaterial
  /** いまの傾き */
  pitch: number
  roll: number
  spin: number
}

/** 色を少し暗く・明るくする */
const shade = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k)

export function createSpecialsRenderer(ctx: RenderCtx): RenderPart {
  const { scene, world, quality } = ctx
  const S = SPECIAL_STYLE
  const group = new THREE.Group()
  group.name = 'gto-specials'
  scene.add(group)

  // 形の元（全部の乗り物で使い回す）
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)
  const cone = new THREE.ConeGeometry(0.5, 1, 14)
  const shadowMap = contactShadowTexture()
  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const flat = (color: number | THREE.Color) => new THREE.MeshLambertMaterial({ color })
  const shared = {
    track: flat(S.track),
    wheel: flat(S.wheel),
    barrel: flat(S.barrel),
    glass: flat(S.glass),
    stripe: flat(S.stripe),
    prop: flat(S.prop),
    gear: flat(S.gear),
  }
  const owned: THREE.Material[] = []

  /** 部品を 1 つ足す（大きさ sx, sy, sz、中心 x, y, z） */
  const part = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, size: [number, number, number], at: [number, number, number], turn?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(...size)
    mesh.position.set(...at)
    if (turn) mesh.rotation.set(...turn)
    mesh.castShadow = quality.shadows
    mesh.receiveShadow = quality.shadows
    parent.add(mesh)
    return mesh
  }

  const buildTank = (body: THREE.Group, paint: THREE.MeshLambertMaterial, spinners: THREE.Object3D[]) => {
    const spec = VEHICLE_SPECS.tank
    const L = spec.length
    const W = spec.width
    const dark = flat(shade(paint.color.getHex(), 0.78))
    owned.push(dark)
    const trackW = 0.62
    const trackH = 0.92
    // 履帯（左右）と、前後の斜めの面、転輪
    for (const side of [-1, 1]) {
      const x = side * (W / 2 - trackW / 2)
      part(body, box, shared.track, [trackW, trackH * 0.62, L * 0.82], [x, trackH * 0.5, 0])
      part(body, cyl, shared.track, [trackH, trackW, trackH], [x, trackH * 0.5, -L * 0.41], [0, 0, Math.PI / 2])
      part(body, cyl, shared.track, [trackH, trackW, trackH], [x, trackH * 0.5, L * 0.41], [0, 0, Math.PI / 2])
      for (let i = 0; i < 5; i++) {
        const wheel = part(body, cyl, shared.wheel, [0.62, trackW + 0.06, 0.62], [x, 0.36, -L * 0.32 + (i * L * 0.64) / 4], [0, 0, Math.PI / 2])
        spinners.push(wheel)
      }
      // 履帯の上の泥よけ
      part(body, box, dark, [trackW + 0.1, 0.07, L * 0.94], [x, trackH + 0.02, 0])
    }
    // 車体: 低い箱と、前の斜めの板
    part(body, box, paint, [W - trackW * 2 + 0.1, 0.78, L * 0.9], [0, 0.86, 0])
    part(body, box, paint, [W - trackW * 2 + 0.1, 0.5, 1.2], [0, 0.98, -L * 0.45 + 0.25], [-0.5, 0, 0])
    part(body, box, dark, [W * 0.7, 0.16, L * 0.5], [0, 1.3, L * 0.12])
    // 砲塔と砲身、ハッチ
    const turret = new THREE.Group()
    turret.position.set(0, 1.36, -L * 0.04)
    body.add(turret)
    part(turret, cyl, paint, [2.1, 0.74, 2.3], [0, 0.37, 0])
    part(turret, box, paint, [1.5, 0.6, 1.1], [0, 0.36, 1.2])
    part(turret, box, dark, [1.0, 0.5, 0.5], [0, 0.4, -1.05])
    part(turret, cyl, shared.barrel, [0.22, 3.6, 0.22], [0, 0.42, -2.9], [Math.PI / 2, 0, 0])
    part(turret, cyl, shared.barrel, [0.32, 0.5, 0.32], [0, 0.42, -4.55], [Math.PI / 2, 0, 0])
    part(turret, cyl, dark, [0.7, 0.12, 0.7], [0.42, 0.8, 0.25])
    // 後ろの灯り
    part(body, box, shared.stripe, [0.3, 0.14, 0.06], [-W * 0.26, 1.0, L * 0.45 + 0.02])
    part(body, box, shared.stripe, [0.3, 0.14, 0.06], [W * 0.26, 1.0, L * 0.45 + 0.02])
  }

  const buildPlane = (body: THREE.Group, paint: THREE.MeshLambertMaterial, spinners: THREE.Object3D[]) => {
    const spec = VEHICLE_SPECS.plane
    const L = spec.length
    const axis = 1.25 // 胴体の中心の高さ（脚で立ったとき）
    const turnZ: [number, number, number] = [Math.PI / 2, 0, 0]
    // 胴体: 太い筒、前のカウル、後ろへ細る円すい
    part(body, cyl, paint, [1.25, L * 0.42, 1.3], [0, axis, -L * 0.1], turnZ)
    part(body, cyl, shared.stripe, [1.2, 0.5, 1.25], [0, axis, -L * 0.37], turnZ)
    part(body, cone, paint, [1.25, L * 0.46, 1.3], [0, axis, L * 0.34], turnZ)
    // 風防（操縦席）
    part(body, box, shared.glass, [0.8, 0.5, 1.4], [0, axis + 0.62, -L * 0.1])
    part(body, box, shared.glass, [0.72, 0.4, 0.5], [0, axis + 0.52, -L * 0.1 - 0.9], [0.5, 0, 0])
    // 主翼（上から見て一枚板。端に橙の帯）と支柱
    const wingY = axis + 0.74
    part(body, box, paint, [S.wingSpan, 0.14, 1.5], [0, wingY, -L * 0.1])
    for (const side of [-1, 1]) {
      part(body, box, shared.stripe, [0.7, 0.15, 1.52], [side * (S.wingSpan / 2 - 0.35), wingY, -L * 0.1])
      part(body, cyl, shared.gear, [0.07, 1.25, 0.07], [side * 1.25, axis + 0.2, -L * 0.1], [0, 0, side * 0.95])
    }
    // 尾翼（水平と垂直）
    part(body, box, paint, [S.tailSpan, 0.1, 0.8], [0, axis + 0.1, L * 0.47])
    part(body, box, paint, [0.1, 1.25, 0.95], [0, axis + 0.68, L * 0.46], [-0.22, 0, 0])
    part(body, box, shared.stripe, [0.11, 0.34, 0.6], [0, axis + 1.2, L * 0.49], [-0.22, 0, 0])
    // 脚: 主脚 2 本と尾輪
    for (const side of [-1, 1]) {
      part(body, cyl, shared.gear, [0.08, 0.95, 0.08], [side * 0.72, 0.68, -L * 0.16], [0, 0, side * -0.4])
      part(body, cyl, shared.track, [0.56, 0.2, 0.56], [side * 0.92, 0.28, -L * 0.16], [0, 0, Math.PI / 2])
    }
    part(body, cyl, shared.track, [0.26, 0.12, 0.26], [0, 0.13, L * 0.42], [0, 0, Math.PI / 2])
    part(body, cyl, shared.gear, [0.06, 0.7, 0.06], [0, 0.45, L * 0.4], [-0.5, 0, 0])
    // プロペラ: 機首の軸と 2 枚の羽根
    const prop = new THREE.Group()
    prop.position.set(0, axis, -L * 0.5 + 0.56)
    body.add(prop)
    part(prop, cone, shared.prop, [0.36, 0.5, 0.36], [0, 0, -0.1], [-Math.PI / 2, 0, 0])
    part(prop, box, shared.prop, [2.3, 0.2, 0.05], [0, 0, 0.1])
    spinners.push(prop)
  }

  const make = (v: VehicleState, kind: SpecialKind): Special => {
    const spec = VEHICLE_SPECS[kind]
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    const body = new THREE.Group()
    body.rotation.order = 'YXZ'
    root.add(body)
    const paint = flat(v.color)
    const spinners: THREE.Object3D[] = []
    if (kind === 'tank') buildTank(body, paint, spinners)
    else buildPlane(body, paint, spinners)
    // 影は乗り物の外に置く（傾きに付き合わせず、いつも真下の地面に落とす）
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowMap, color: 0x000000, transparent: true, opacity: S.shadowAlpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadow.renderOrder = 2
    const span = kind === 'plane' ? S.wingSpan : spec.width * 1.25
    shadow.scale.set(span, 1, spec.length * 1.2)
    group.add(shadow)
    group.add(root)
    return { kind, root, body, shadow, spinners, paint, pitch: 0, roll: 0, spin: 0 }
  }

  const remove = (s: Special) => {
    group.remove(s.root)
    group.remove(s.shadow)
    s.paint.dispose()
    ;(s.shadow.material as THREE.Material).dispose()
  }

  const place = (s: Special, v: VehicleState, dt: number) => {
    const spec = VEHICLE_SPECS[v.kind]
    const f = dirOf(v.heading)
    const ground = world.groundY(v.x, v.z)
    const alt = Math.max(0, v.alt ?? 0)
    const k = 1 - Math.exp(-S.ease * dt)
    // 地上では、前後の地面の高さに合わせて傾く（坂）
    const half = spec.length * 0.4
    const slope = Math.atan2(world.groundY(v.x + f.x * half, v.z + f.z * half) - world.groundY(v.x - f.x * half, v.z - f.z * half), half * 2)
    const grounded = clamp(1 - alt / 2, 0, 1)
    const wantPitch = slope * grounded + clamp((v.climb ?? 0) * S.pitchPerClimb, -S.pitchMax, S.pitchMax) * (1 - grounded)
    const wantRoll = s.kind === 'plane' ? clamp(-v.yawRate * S.bankPerYaw, -S.bankMax, S.bankMax) * (1 - grounded) : 0
    s.pitch += (wantPitch - s.pitch) * k
    s.roll += (wantRoll - s.roll) * k
    s.root.position.set(v.x, ground + alt, v.z)
    s.root.rotation.y = -v.heading
    s.body.rotation.x = s.pitch
    s.body.rotation.z = s.roll
    // 回る部品
    if (s.kind === 'tank') {
      s.spin += (v.speed / 0.31) * dt
      for (const w of s.spinners) w.rotation.x = -s.spin
    } else {
      s.spin += (v.driver === 'none' && alt <= 0 ? 0 : S.propIdle + Math.abs(v.speed) * S.propPerSpeed) * dt
      for (const p of s.spinners) p.rotation.z = s.spin
    }
    // 影: 真下の地面。高いほど大きく、薄く
    const high = clamp(alt / S.shadowFade, 0, 1)
    s.shadow.position.set(v.x, ground + 0.09, v.z)
    s.shadow.rotation.y = -v.heading
    const span = s.kind === 'plane' ? S.wingSpan : spec.width * 1.25
    s.shadow.scale.set(span * (1 + high * 0.8), 1, spec.length * 1.2 * (1 + high * 0.8))
    ;(s.shadow.material as THREE.MeshBasicMaterial).opacity = S.shadowAlpha * (1 - high * 0.85)
  }

  const specials = new Map<number, Special>()
  return {
    update: (frame: FrameInfo) => {
      const alive = new Set<number>()
      for (const v of frame.state.vehicles) {
        const kind = v.kind
        if (!isSpecial(kind)) continue
        alive.add(v.id)
        let s = specials.get(v.id)
        if (s && s.kind !== kind) {
          remove(s)
          s = undefined
        }
        if (!s) {
          s = make(v, kind)
          specials.set(v.id, s)
        }
        place(s, v, Math.min(0.05, frame.dt))
      }
      for (const [id, s] of specials) {
        if (alive.has(id)) continue
        remove(s)
        specials.delete(id)
      }
    },
    dispose: () => {
      for (const s of specials.values()) remove(s)
      specials.clear()
      scene.remove(group)
      box.dispose()
      cyl.dispose()
      cone.dispose()
      shadowGeometry.dispose()
      shadowMap.dispose()
      for (const m of [...Object.values(shared), ...owned]) m.dispose()
    },
  }
}
