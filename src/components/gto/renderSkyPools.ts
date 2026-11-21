// Grand Theft Outfit [部品: light] 路面に落ちる光（街灯・ネオン・店先・尾灯の光だまり）と、近くの街灯の光源。
// 入口: createLightPools(ctx, fogNear, fogFar) / createLocalLights(ctx)
// 契約: renderSky.ts から呼ばれる。光だまりは加算で重ねる板（光源は増やさない）で、遠くまで全部置く。
//       本物の光源は「見ている場所に近い街灯」数個と自分の車の灯りだけで、数は最初に決めて増減させない
//       （光源の数が変わるとシェーダーを作り直すことになる）。置き場所と強さは lightingLocal.ts が決める。
import * as THREE from 'three'
import { areaDef } from '../../lib/gto/areas'
import { hexToLinear, lampPools, spillColor, type Rgb } from '../../lib/gto/lighting'
import { boardLights, lampLights, pickLamps, plazaLights, shopStrips, tailPoolOf } from '../../lib/gto/lightingLocal'
import { streetProps } from '../../lib/gto/map'
import { dirOf } from '../../lib/gto/math'
import { buildSignage } from '../../lib/gto/signage'
import type { GtoWorld } from '../../lib/gto/types'
import { VEHICLE_SPECS } from '../../lib/gto/vehicle'
import type { FrameInfo, RenderCtx } from './renderTypes'

/** 光だまりを路面から浮かせる高さ m（横断歩道の縞より上） */
const POOL_LIFT = 0.27
/**
 * ポストプロセスの無い画質では、光だまりは色調を掛けたあとの色で足される（画面の色どうしの足し算になる）ので、
 * リニアで足すときより明るく出る。そのぶん弱める
 */
const POOL_GAIN_NO_POST = 0.2
/** 店先の明かりが歩道へ届く距離 m と、辺を割る長さ m */
const SHOP_REACH = 5.5
const SHOP_SEGMENT = 7
/** 尾灯の光だまりを描く車の上限 */
const TAIL_CAPACITY = 32
/** 本物の光源にする街灯の数と、選ぶ範囲 m。見ている場所の少し先を中心に選ぶ */
const LAMP_SLOTS = { high: 10, mobile: 3 } as const
/** 街灯の光の傘の半角（rad）。真下から 68°まで */
const LAMP_CONE = 1.19
const LAMP_PICK_RANGE = 110
const LAMP_PICK_AHEAD = 16

const POOL_VERTEX = `
attribute vec3 tint;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 加算で重ねるので、霧は「色を混ぜる」のではなく「薄くする」
  vTint = tint * (1.0 - smoothstep(fogNear, fogFar, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

// uv が (0.5, 0.5) の頂点だけでできた板は、頂点の色をそのまま塗る（店先の帯）。それ以外は丸い光だまり
const POOL_FRAGMENT = `
varying vec2 vUv;
varying vec3 vTint;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = pow(max(1.0 - d, 0.0), 1.6);
  gl_FragColor = vec4(vTint * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** 地面に沿わせた板の頂点を並べる入れ物 */
interface PatchBuffers {
  pos: number[]
  uv: number[]
  tint: number[]
  idx: number[]
}

const emptyPatches = (): PatchBuffers => ({ pos: [], uv: [], tint: [], idx: [] })
const scaled = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]

/**
 * 中心 (cx, cz) から、a 方向へ ±1・b 方向へ ±1 に広がる板を n×n に割って足す。
 * 各頂点は地表の高さに乗せるので、坂でも路面に沿う。
 */
function pushPatch(out: PatchBuffers, world: GtoWorld, cx: number, cz: number, ax: number, az: number, bx: number, bz: number, n: number, color: Rgb) {
  const base = out.pos.length / 3
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const v = j / n
      const x = cx + ax * (u * 2 - 1) + bx * (v * 2 - 1)
      const z = cz + az * (u * 2 - 1) + bz * (v * 2 - 1)
      out.pos.push(x, world.groundY(x, z) + POOL_LIFT, z)
      out.uv.push(u, v)
      out.tint.push(color[0], color[1], color[2])
    }
  }
  const row = n + 1
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = base + j * row + i
      out.idx.push(p, p + row, p + 1, p + 1, p + row, p + row + 1)
    }
  }
}

/** 壁ぎわで明るく、歩道の外へ向かって消える帯の、壁からの距離（0..1）と明るさ */
const SHOP_FALLOFF: [at: number, level: number][] = [
  [0.03, 1],
  [0.3, 0.42],
  [1, 0],
]

/** 店先の辺に沿って、歩道へこぼれる明かりの帯を足す。両端は消して、角で途切れて見えないようにする */
function pushShopStrip(out: PatchBuffers, world: GtoWorld, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, color: Rgb) {
  const len = Math.hypot(bx - ax, bz - az)
  const cols = Math.max(2, Math.ceil(len / SHOP_SEGMENT))
  const base = out.pos.length / 3
  const rows = SHOP_FALLOFF.length
  for (let i = 0; i <= cols; i++) {
    const u = i / cols
    const end = i === 0 || i === cols ? 0 : 1
    for (const [at, level] of SHOP_FALLOFF) {
      const x = ax + (bx - ax) * u + nx * at * SHOP_REACH
      const z = az + (bz - az) * u + nz * at * SHOP_REACH
      out.pos.push(x, world.groundY(x, z) + POOL_LIFT, z)
      // 中心の uv を入れると、頂点の色がそのまま出る
      out.uv.push(0.5, 0.5)
      const k = level * end
      out.tint.push(color[0] * k, color[1] * k, color[2] * k)
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const p = base + i * rows + j
      out.idx.push(p, p + rows, p + 1, p + 1, p + rows, p + rows + 1)
    }
  }
}

function patchGeometry(b: PatchBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
  g.setAttribute('tint', new THREE.Float32BufferAttribute(b.tint, 3))
  g.setIndex(b.idx)
  return g
}

export interface LightPools {
  update: (frame: FrameInfo) => void
  dispose: () => void
}

/** 街灯・ネオン・店先が路面に作る光だまり（動かないので1枚にまとめる）と、車の尾灯の光だまり（毎フレーム置き直す） */
export function createLightPools(ctx: RenderCtx, fogNear: number, fogFar: number): LightPools | null {
  const { scene, world, quality } = ctx
  const L = ctx.lighting
  const mobile = quality.id === 'mobile'
  const gain = quality.post ? 1 : POOL_GAIN_NO_POST
  const still = emptyPatches()
  const lampColor = scaled(hexToLinear(L.lampColor), L.lampPool * gain)
  if (L.lampPool > 0) {
    // 軽量設定では街の部品がふつうの道路照明を描かないので、光だまりも置かない（quality.props と同じ条件）
    for (const p of lampPools(streetProps(world), quality.props)) pushPatch(still, world, p.x, p.z, p.radius, 0, 0, p.radius, mobile ? 2 : 4, lampColor)
  }
  if (L.neonSpill > 0) {
    for (const s of buildSignage(world).slice(0, quality.maxSigns)) {
      if (!s.lit) continue
      const n = dirOf(s.heading)
      // 看板の前の路面を、壁に沿って横長に染める
      const along = s.kind === 'blade' ? 4.5 : Math.min(11, Math.max(5, s.w * 0.9))
      const out = s.kind === 'billboard' ? 9 : 6.5
      const cx = s.x + n.x * out * 0.75
      const cz = s.z + n.z * out * 0.75
      if (world.insideBuilding(cx, cz)) continue
      pushPatch(still, world, cx, cz, -n.z * along, n.x * along, n.x * out, n.z * out, mobile ? 2 : 3, scaled(spillColor(s.bg, s.fg), L.neonSpill * gain))
    }
  }
  if (L.shopSpill > 0) {
    const color = scaled(hexToLinear(L.shopSpillColor), L.shopSpill * gain)
    for (const s of shopStrips(world)) pushShopStrip(still, world, s.ax, s.az, s.bx, s.bz, s.nx, s.nz, color)
  }
  if (still.idx.length === 0 && L.tailPool <= 0) return null

  const material = new THREE.ShaderMaterial({
    vertexShader: POOL_VERTEX,
    fragmentShader: POOL_FRAGMENT,
    uniforms: { fogNear: { value: fogNear }, fogFar: { value: fogFar } },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    // 板の表裏は向きによって入れ替わるので、両面を描く
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  })
  const geometry = patchGeometry(still)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'gto-light-pools'
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = 2
  scene.add(mesh)

  // ---- 尾灯: 車ごとに板1枚。4隅を地表に乗せ直す ----
  const tailOn = L.tailPool > 0
  const tailPos = new Float32Array(TAIL_CAPACITY * 4 * 3)
  const tailTint = new Float32Array(TAIL_CAPACITY * 4 * 3)
  const tailGeometry = new THREE.BufferGeometry()
  const tailPosAttr = new THREE.BufferAttribute(tailPos, 3).setUsage(THREE.DynamicDrawUsage)
  const tailTintAttr = new THREE.BufferAttribute(tailTint, 3).setUsage(THREE.DynamicDrawUsage)
  tailGeometry.setAttribute('position', tailPosAttr)
  tailGeometry.setAttribute('tint', tailTintAttr)
  tailGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: TAIL_CAPACITY }, () => [0, 0, 1, 0, 0, 1, 1, 1]).flat(), 2))
  tailGeometry.setIndex(Array.from({ length: TAIL_CAPACITY }, (_, i) => [i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3]).flat())
  tailGeometry.setDrawRange(0, 0)
  const tailMesh = new THREE.Mesh(tailGeometry, material)
  tailMesh.name = 'gto-tail-pools'
  tailMesh.matrixAutoUpdate = false
  tailMesh.frustumCulled = false
  tailMesh.renderOrder = 3
  if (tailOn) scene.add(tailMesh)
  const red = scaled([1, 0.07, 0.04], L.tailPool * gain)
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]

  return {
    update: (frame) => {
      if (!tailOn) return
      let count = 0
      for (const v of frame.state.vehicles) {
        // [cheats] 飛んでいる飛行機は、路面に灯りを落とさない
        if ((v.alt ?? 0) > 1) continue
        if (count >= TAIL_CAPACITY) break
        const pool = tailPoolOf(v)
        if (!pool) continue
        const d = dirOf(pool.heading)
        CORNERS.forEach(([su, sv], k) => {
          const x = pool.x + -d.z * su * pool.across + d.x * sv * pool.along
          const z = pool.z + d.x * su * pool.across + d.z * sv * pool.along
          const o = (count * 4 + k) * 3
          tailPos[o] = x
          tailPos[o + 1] = world.groundY(x, z) + POOL_LIFT
          tailPos[o + 2] = z
          tailTint[o] = red[0] * pool.strength
          tailTint[o + 1] = red[1] * pool.strength
          tailTint[o + 2] = red[2] * pool.strength
        })
        count++
      }
      tailGeometry.setDrawRange(0, count * 6)
      tailPosAttr.needsUpdate = true
      tailTintAttr.needsUpdate = true
    },
    dispose: () => {
      scene.remove(mesh, tailMesh)
      geometry.dispose()
      tailGeometry.dispose()
      material.dispose()
    },
  }
}

export interface LocalLights {
  update: (frame: FrameInfo) => void
  dispose: () => void
}

/**
 * 近くの街灯と自分の車の灯りを、本物の光源として置く。路面だけでなく壁・車体・柱にも明暗の勾配が出る。
 * 影は落とさない（影を持つのは太陽だけ）。
 */
export function createLocalLights(ctx: RenderCtx): LocalLights | null {
  const { scene, camera, world, quality } = ctx
  const L = ctx.lighting
  if (!L.lampsOn || L.lampLight <= 0) return null
  const mobile = quality.id === 'mobile'
  const lampColor = new THREE.Color(L.lampColor)
  // 街灯と大型看板を同じ枠で取り合う（どちらも「近い順に数個」だけ本物の光源になる）
  const lamps = [
    ...lampLights(streetProps(world), quality.props).map((l) => ({ x: l.x, z: l.z, y: world.groundY(l.x, l.z) + l.height, range: l.range, color: lampColor, power: 1 })),
    ...[...boardLights(buildSignage(world).slice(0, quality.maxSigns)), ...(areaDef(world).scramble ? plazaLights(world) : [])].map((b) => ({ x: b.x, z: b.z, y: b.y, range: b.range, color: new THREE.Color().setRGB(b.color[0], b.color[1], b.color[2]), power: b.power * L.boardLight })),
  ]
  const slots = Array.from({ length: LAMP_SLOTS[quality.id] }, () => {
    // 灯具は下向きの傘。灯具より上の壁は照らさない（壁の下のほうだけが光だまりになり、上の階は夜の色のまま残る）
    const light = new THREE.SpotLight(L.lampColor, 0, 24, LAMP_CONE, 0.85, 2)
    light.castShadow = false
    scene.add(light, light.target)
    return light
  })
  // 自分の車: 前を照らすヘッドライトと、後ろを赤く染める尾灯（スマホでは置かない）
  const beam = mobile || L.headBeam <= 0 ? null : new THREE.SpotLight(0xfff0d0, 0, 46, 0.5, 0.7, 1.4)
  const tail = mobile || L.headBeam <= 0 ? null : new THREE.PointLight(0xff2a14, 0, 9, 2)
  if (beam) scene.add(beam, beam.target)
  if (tail) scene.add(tail)
  const forward = new THREE.Vector3()

  return {
    update: (frame) => {
      camera.getWorldDirection(forward)
      const fx = camera.position.x + forward.x * LAMP_PICK_AHEAD
      const fz = camera.position.z + forward.z * LAMP_PICK_AHEAD
      pickLamps(lamps, fx, fz, slots.length, LAMP_PICK_RANGE).forEach((slot, i) => {
        const light = slots[i]
        const lamp = slot.index >= 0 ? lamps[slot.index] : null
        light.intensity = lamp ? L.lampLight * lamp.power * slot.weight : 0
        if (!lamp) return
        light.position.set(lamp.x, lamp.y, lamp.z)
        light.target.position.set(lamp.x, lamp.y - 10, lamp.z)
        light.distance = lamp.range
        light.color.copy(lamp.color)
      })
      if (!beam || !tail) return
      const id = frame.state.player.vehicleId
      const car = id == null || frame.photo ? null : frame.state.vehicles.find((v) => v.id === id)
      if (!car) {
        beam.intensity = 0
        tail.intensity = 0
        return
      }
      const d = dirOf(car.heading)
      const half = VEHICLE_SPECS[car.kind].length / 2
      beam.position.set(car.x + d.x * half, car.y + 0.75, car.z + d.z * half)
      beam.target.position.set(car.x + d.x * (half + 24), car.y + 0.3, car.z + d.z * (half + 24))
      beam.intensity = L.headBeam
      const braking = car.speed > 0.5 && car.accel < -3
      tail.position.set(car.x - d.x * (half + 0.5), car.y + 0.7, car.z - d.z * (half + 0.5))
      tail.intensity = L.headBeam * (braking ? 0.22 : 0.07)
    },
    dispose: () => {
      for (const light of slots) {
        scene.remove(light, light.target)
        light.dispose()
      }
      if (beam) {
        scene.remove(beam, beam.target)
        beam.dispose()
      }
      if (tail) {
        scene.remove(tail)
        tail.dispose()
      }
    },
  }
}
