// Grand Theft Outfit [部品: signs] 看板の光を、路面と、そこに立つ人・車に落とす。
// 入口: buildGroundGlow(world, field, gain) / createBodyGlow(ctx, field, gain)
// 契約: 光の場（signageGlow.ts の GlowField）を絵にするだけ。
//       路面: 場の升目をそのまま頂点色の網にして加算で重ねる（壁際が明るく、距離で落ち、色どうしが混ざる）。
//       人と車: その場所の場の色を、体を包む形（人は卵形、車は箱）の「奥の面より手前にある画素」にだけ掛ける。
//               掛け方は 下の色 ×（光の色相 × boost × s ＋（1 − cut × s））（signageGlow.ts の tintFactor と同じ式）。
//               黒い服は黒いまま、白い服と明るい車体は補色が落ちて看板の色そのものに染まる。
//               ほかの部品の材質には触らない（深度だけを見る）。
import * as THREE from 'three'
import { VEHICLE_SPECS } from '../../lib/gto/vehicle'
import { dirOf } from '../../lib/gto/math'
import { sampleGlow, TINT_TUNING, type GlowField } from '../../lib/gto/signageGlow'
import type { GtoWorld } from '../../lib/gto/types'
import type { FrameInfo, RenderCtx } from './renderTypes'

/** 路面の光の網の浮き（路面の線 0.17 より上。高くすると人の足先と車輪が光の下に沈む） */
const GROUND_LIFT = 0.21
/** これより暗い升目は網にしない */
const GROUND_MIN = 0.012

/**
 * 光の場を路面の網にする。頂点は升目の角、色は場の値 × gain。4隅とも建物の中の升目は作らない。
 * 属性は renderSigns.ts の光の板と同じ（position / uv / color / shape）で、同じ材質で描ける。
 */
export function buildGroundGlow(world: GtoWorld, field: GlowField, gain: number, shape: number): THREE.BufferGeometry | null {
  const { cols, rows, cell, data, x0, z0 } = field
  const levelAt = (c: number, r: number) => Math.max(data[(r * cols + c) * 3], data[(r * cols + c) * 3 + 1], data[(r * cols + c) * 3 + 2])
  // 0: まだ調べていない / 1: 外 / 2: 建物の中
  const inside = new Uint8Array(cols * rows)
  const isInside = (c: number, r: number) => {
    const i = r * cols + c
    if (inside[i] === 0) inside[i] = world.insideBuilding(x0 + c * cell, z0 + r * cell) ? 2 : 1
    return inside[i] === 2
  }
  const vertexOf = new Int32Array(cols * rows).fill(-1)
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const vertex = (c: number, r: number) => {
    const i = r * cols + c
    if (vertexOf[i] >= 0) return vertexOf[i]
    const x = x0 + c * cell
    const z = z0 + r * cell
    vertexOf[i] = pos.length / 3
    pos.push(x, world.groundY(x, z) + GROUND_LIFT, z)
    col.push(data[i * 3] * gain, data[i * 3 + 1] * gain, data[i * 3 + 2] * gain)
    return vertexOf[i]
  }
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      if (Math.max(levelAt(c, r), levelAt(c + 1, r), levelAt(c, r + 1), levelAt(c + 1, r + 1)) < GROUND_MIN) continue
      if (isInside(c, r) && isInside(c + 1, r) && isInside(c, r + 1) && isInside(c + 1, r + 1)) continue
      const a = vertex(c, r)
      const b = vertex(c + 1, r)
      const d = vertex(c + 1, r + 1)
      const e = vertex(c, r + 1)
      idx.push(a, e, d, a, d, b)
    }
  }
  if (idx.length === 0) return null
  const count = pos.length / 3
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('shape', new THREE.Float32BufferAttribute(new Float32Array(count).fill(shape), 1))
  g.setIndex(idx)
  return g
}

// ----------------------------------------------------------------------------
// 人と車に被せる色
// ----------------------------------------------------------------------------

const BODY_VERTEX = `
uniform float soft;
varying float vEdge;
varying vec3 vTint;
void main() {
  vTint = vec3(0.0);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #endif
  mat4 toWorld = modelMatrix * instanceMatrix;
  // 人を包む卵形は、輪郭へ向かって薄くする（すぐ後ろの壁や手前の物に、形の跡を残さない）
  vEdge = 1.0;
  if (soft > 0.5) {
    vec3 eye = (inverse(toWorld) * vec4(cameraPosition, 1.0)).xyz;
    vEdge = abs(dot(normalize(position), normalize(eye - position)));
  }
  gl_Position = projectionMatrix * viewMatrix * toWorld * vec4(position, 1.0);
}`

const BODY_FRAGMENT = `
varying float vEdge;
varying vec3 vTint;
void main() {
  vec3 light = max(vTint, vec3(0.0));
  float hi = max(light.r, max(light.g, light.b));
  float s = clamp(hi * smoothstep(0.0, 0.6, vEdge) * float(BODY_GAIN), 0.0, float(TINT_MAX));
  gl_FragColor = vec4(light / max(hi, 1e-4) * (float(TINT_BOOST) * s), 1.0 - float(TINT_CUT) * s);
}`

/**
 * 体を染める強さ（場の色 × gain に掛けて s にする）・補色を落とす割合・光の色の成分を持ち上げる割合。
 * 持ち上げは控えめにする（いちばん明るい成分で 1.16 倍まで）。車の前照灯のように元から明るい物まで
 * 何倍にもすると、ブルームで白い玉になる。
 */
const BODY = { gain: 1.25, cut: 0.6, boost: 0.78 }
/** 人は前照灯を持たないので、光の色の成分をもっと持ち上げる（暗い服にも看板の色が乗って見える。いちばん明るい成分で 1.9 倍まで） */
const PERSON_BOOST = 1.6

/** 人を包む卵形の半径 m（横・縦）と、中心の高さ m。走って前へ傾いた体も中に収まる大きさで、底は路面より上（路面を染めない） */
const PERSON = { r: 0.8, ry: 1.0, y: 1.07 }
/** 車を包む箱の余白 m と、箱の底を路面から浮かす高さ m（歩道の段を染めない） */
const CAR = { pad: 0.18, lift: 0.36, top: 0.25 }
/** これより弱い光は被せない */
const BODY_MIN = 0.03

export interface BodyGlow {
  update: (frame: FrameInfo) => void
  dispose: () => void
}

/** その場所の看板の光を、人と車の体に被せる。range はカメラからの距離の上限 m */
export function createBodyGlow(ctx: RenderCtx, field: GlowField, gain: number, limits: { people: number; cars: number; range: number }): BodyGlow {
  const { scene, camera, world } = ctx
  const material = (soft: number, side: THREE.Side, boost: number) =>
    new THREE.ShaderMaterial({
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      defines: { BODY_GAIN: BODY.gain, TINT_MAX: TINT_TUNING.max, TINT_BOOST: boost, TINT_CUT: BODY.cut },
      uniforms: { soft: { value: soft } },
      // 色 = 下の色 × 光の色 ＋ 下の色 × 残す割合（アルファ）
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
      // 包む形の奥の面より「手前」にある画素（＝中にいる人や車体）だけを染める
      depthFunc: THREE.GreaterDepth,
      side,
    })
  const make = (geometry: THREE.BufferGeometry, mat: THREE.ShaderMaterial, max: number, name: string) => {
    const mesh = new THREE.InstancedMesh(geometry, mat, max)
    mesh.name = name
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.setColorAt(0, new THREE.Color(0, 0, 0))
    scene.add(mesh)
    return mesh
  }
  const people = make(new THREE.SphereGeometry(1, 14, 10), material(1, THREE.BackSide, PERSON_BOOST), limits.people, 'gto-sign-glow-people')
  const cars = make(new THREE.BoxGeometry(1, 1, 1), material(0, THREE.BackSide, BODY.boost), limits.cars, 'gto-sign-glow-cars')
  const m = new THREE.Matrix4()
  const color = new THREE.Color()
  const range2 = limits.range * limits.range

  /** (x, z) の光の色を color に入れる。弱ければ false */
  const tintAt = (x: number, z: number) => {
    const dx = x - camera.position.x
    const dz = z - camera.position.z
    const d2 = dx * dx + dz * dz
    if (d2 > range2) return false
    const c = sampleGlow(field, x, z)
    // 遠くはなだらかに消す
    const k = gain * Math.min(1, (1 - d2 / range2) * 3)
    color.setRGB(c[0] * k, c[1] * k, c[2] * k)
    return Math.max(c[0], c[1], c[2]) * k >= BODY_MIN
  }

  const addPerson = (x: number, y: number, z: number) => {
    if (people.count >= limits.people || !tintAt(x, z)) return
    m.set(PERSON.r, 0, 0, x, 0, PERSON.ry, 0, y + PERSON.y, 0, 0, PERSON.r, z, 0, 0, 0, 1)
    people.setMatrixAt(people.count, m)
    people.setColorAt(people.count, color)
    people.count++
  }

  return {
    update: (frame) => {
      const { state } = frame
      people.count = 0
      cars.count = 0
      if (state.player.vehicleId == null && !frame.photo) addPerson(state.player.x, state.player.y, state.player.z)
      for (const p of state.peds) addPerson(p.x, p.y, p.z)
      for (const v of state.vehicles) {
        // [cheats] 飛んでいる飛行機には、路面の看板の光を当てない
        if ((v.alt ?? 0) > 1) continue
        if (cars.count >= limits.cars || !tintAt(v.x, v.z)) continue
        const spec = VEHICLE_SPECS[v.kind]
        const d = dirOf(v.heading)
        const w = spec.width + CAR.pad * 2
        const h = spec.height + CAR.top - CAR.lift + 0.3
        const l = spec.length + CAR.pad * 2
        const base = world.groundY(v.x, v.z) + CAR.lift
        // 列は 右・上・前（右手系にする。裏返すと箱の表と裏が入れ替わる）
        m.set(d.z * w, 0, d.x * l, v.x, 0, h, 0, base + h / 2, -d.x * w, 0, d.z * l, v.z, 0, 0, 0, 1)
        cars.setMatrixAt(cars.count, m)
        cars.setColorAt(cars.count, color)
        cars.count++
      }
      for (const mesh of [people, cars]) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },
    dispose: () => {
      for (const mesh of [people, cars]) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.dispose()
      }
    },
  }
}
