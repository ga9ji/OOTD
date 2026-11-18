// Grand Theft Outfit [部品: vehicle の見た目] 車のまわりの効果。
// 入口: createSmoke(ctx, capacity) / createSkidMarks(ctx, capacity) / createCarLights(ctx, capacity)
// 契約: 煙（タイヤの白煙・衝突の煙）、路面のタイヤ痕、ヘッドライトの光だまりと灯火のにじみを、
//       それぞれ1回の描画（点の集まり／1枚の帯／インスタンス）で出す。車の数が増えても描画回数は増えない。
import * as THREE from 'three'
import type { RenderCtx } from './renderTypes'

// ----------------------------------------------------------------------------
// 煙
// ----------------------------------------------------------------------------

/** 粒の種類: 白煙（軽い衝突・エンジン）、土煙（タイヤが巻き上げる、路面の色が混ざった煙）、黒煙（壊れたエンジン）、炎（時間帯に依らず明るい） */
export type SmokeTone = 'white' | 'dust' | 'black' | 'fire'

export interface Smoke {
  /** 1粒出す。grow は1秒あたりに広がる大きさ m。tone は粒の種類（省くと白煙） */
  emit: (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, alpha: number, tone?: SmokeTone) => void
  update: (dt: number) => void
  dispose: () => void
}

const SMOKE_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(512.0, aSize * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

const SMOKE_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function createSmoke(ctx: RenderCtx, capacity: number): Smoke {
  // 粒の状態（描画用のバッファ。毎フレーム書き換える）
  const pos = new Float32Array(capacity * 3)
  const vel = new Float32Array(capacity * 3)
  const size = new Float32Array(capacity)
  const grow = new Float32Array(capacity)
  const alpha = new Float32Array(capacity)
  const alpha0 = new Float32Array(capacity)
  const color = new Float32Array(capacity * 3)
  /** 炎の粒か（上へ昇りながら赤く暗くなる） */
  const flame = new Uint8Array(capacity)
  /** 濃いまま残る粒か（黒煙と炎） */
  const dense = new Uint8Array(capacity)
  const age = new Float32Array(capacity)
  const life = new Float32Array(capacity)
  let cursor = 0

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage))
  // 夜は煙も暗い（街灯の色を少し拾う）
  const tint = ctx.time === 'night' ? 0.3 : ctx.time === 'dusk' ? 0.6 : 0.92
  const fireGain = ctx.time === 'night' ? 2.4 : ctx.time === 'dusk' ? 1.5 : 1
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: SMOKE_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 6
  points.name = 'gto-vehicle-smoke'
  ctx.scene.add(points)
  const buffer = new THREE.Vector2()

  return {
    emit: (x, y, z, vx, vy, vz, s, g, l, a, tone = 'white') => {
      const i = cursor
      cursor = (cursor + 1) % capacity
      pos.set([x, y, z], i * 3)
      vel.set([vx, vy, vz], i * 3)
      size[i] = s
      grow[i] = g
      alpha0[i] = a
      alpha[i] = a
      flame[i] = tone === 'fire' ? 1 : 0
      dense[i] = tone === 'white' || tone === 'dust' ? 0 : 1
      if (tone === 'fire') {
        // 黄〜橙。粒ごとに少しずつ違う
        const hot = Math.random()
        // 夜は画面全体が暗く写るので、そのぶん炎を明るく出す
        color.set([2.4 * fireGain, (0.75 + hot * 0.9) * fireGain, (0.12 + hot * 0.25) * fireGain], i * 3)
      } else {
        // 黒煙は時間帯の明るさの 1 割ほど（夜でも真っ黒に潰れないよう下限を置く）
        const k = tone === 'black' ? Math.max(0.03, tint * 0.07) : tone === 'dust' ? tint * 0.86 : tint
        // 土煙は路面の埃のぶん少し茶色い
        color.set(tone === 'dust' ? [k, k * 0.94, k * 0.84] : [k, k * 0.98, k * 0.95], i * 3)
      }
      age[i] = 0
      life[i] = l
    },
    update: (dt) => {
      let live = false
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue
        age[i] += dt
        const k = age[i] / life[i]
        if (k >= 1) {
          life[i] = 0
          alpha[i] = 0
          continue
        }
        live = true
        const slow = Math.exp(-2.2 * dt)
        vel[i * 3] *= slow
        vel[i * 3 + 2] *= slow
        pos[i * 3] += vel[i * 3] * dt
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt
        size[i] += grow[i] * dt
        if (flame[i]) {
          // 炎は昇るにつれて赤く暗くなる
          const cool = Math.exp(-3.2 * dt)
          color[i * 3 + 1] *= cool
          color[i * 3 + 2] *= cool
          color[i * 3] *= Math.exp(-1.2 * dt)
        }
        // すぐ濃くなって、ゆっくり消える
        // 白煙は早く薄れ、黒煙と炎は濃いまま昇って最後に消える
        alpha[i] = alpha0[i] * Math.min(1, k * 8) * (dense[i] ? 1 - k * k : (1 - k) * (1 - k))
      }
      points.visible = live
      if (!live) return
      ctx.renderer.getDrawingBufferSize(buffer)
      material.uniforms.uScale.value = buffer.y / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360))
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.aSize.needsUpdate = true
      geometry.attributes.aAlpha.needsUpdate = true
      geometry.attributes.aColor.needsUpdate = true
    },
    dispose: () => {
      ctx.scene.remove(points)
      geometry.dispose()
      material.dispose()
    },
  }
}

// ----------------------------------------------------------------------------
// タイヤ痕
// ----------------------------------------------------------------------------

export interface SkidMarks {
  /** a から b へ、幅 width の黒い帯を1枚足す（古いものから上書きする）。alpha は濃さ 0..1 */
  add: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, alpha?: number) => void
  dispose: () => void
}

/** 痕を置く高さ m。車輪が乗っている面（車道なら地面 +0.12）から、白線と横断歩道の塗装（+0.17〜0.2）のすぐ上まで上げる。
 *  塗装の上を滑っても黒い痕が切れずに残る */
const SKID_LIFT = 0.095
/** 痕を描くときにカメラの側へ引き寄せる奥行き m（遠くの浅い角度でも塗装とちらつかない） */
const SKID_PULL = 0.2

export function createSkidMarks(ctx: RenderCtx, capacity: number): SkidMarks {
  const pos = new Float32Array(capacity * 18)
  const tone = new Float32Array(capacity * 24)
  const attribute = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)
  const toneAttribute = new THREE.BufferAttribute(tone, 4).setUsage(THREE.DynamicDrawUsage)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', attribute)
  // 頂点色の4つ目が濃さ（帯ごとに違う）
  geometry.setAttribute('color', toneAttribute)
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    // 帯の向きで表裏が変わるので両面を描く
    side: THREE.DoubleSide,
  })
  // 画面上の位置は変えずに、奥行きだけカメラの側へ SKID_PULL m 引き寄せて描く（塗装の板と重なってちらつかない）
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position = projectionMatrix * vec4(mvPosition.xyz * (1.0 - ${SKID_PULL.toFixed(2)} / max(${(SKID_PULL * 3).toFixed(2)}, length(mvPosition.xyz))), 1.0);`,
    )
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  mesh.name = 'gto-vehicle-skids'
  ctx.scene.add(mesh)
  let cursor = 0

  return {
    add: (ax, ay, az, bx, by, bz, width, alpha = 1) => {
      const dx = bx - ax
      const dz = bz - az
      const d = Math.hypot(dx, dz)
      if (d < 0.02 || d > 4) return
      const px = (-dz / d) * width * 0.5
      const pz = (dx / d) * width * 0.5
      pos.set(
        [
          ax - px, ay + SKID_LIFT, az - pz, bx + px, by + SKID_LIFT, bz + pz, bx - px, by + SKID_LIFT, bz - pz,
          ax - px, ay + SKID_LIFT, az - pz, ax + px, ay + SKID_LIFT, az + pz, bx + px, by + SKID_LIFT, bz + pz,
        ],
        cursor * 18,
      )
      for (let i = 0; i < 6; i++) tone.set([1, 1, 1, alpha], cursor * 24 + i * 4)
      cursor = (cursor + 1) % capacity
      attribute.needsUpdate = true
      toneAttribute.needsUpdate = true
    },
    dispose: () => {
      ctx.scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }
}

// ----------------------------------------------------------------------------
// 灯火（路面の光だまりと、灯りのにじみ）
// ----------------------------------------------------------------------------

export interface CarLights {
  /** フレームの最初に呼ぶ */
  begin: () => void
  /** 車の前の路面に光だまりを置く。root は車の土台（地面の傾きに沿う）の行列 */
  pool: (root: THREE.Matrix4, frontZ: number, width: number, strength: number) => void
  /** 灯りのにじみ（車体に対して立った板）。z は車体の前後位置、color は明るさを掛けた色 */
  glow: (body: THREE.Matrix4, y: number, z: number, width: number, height: number, r: number, g: number, b: number) => void
  /** フレームの最後に呼ぶ */
  end: () => void
  dispose: () => void
}

/** 中心が明るく外へ消える、楕円のぼかし */
function blobTexture(make: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) make(g, w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createCarLights(ctx: RenderCtx, capacity: number): CarLights {
  // 光だまり: 車のすぐ前がいちばん明るく、前方へ伸びて消える（左右2灯ぶんの重なり）
  const poolMap = blobTexture(
    (g, w, h) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = 'lighter'
      for (const cx of [0.4, 0.6]) {
        // 縦に長い楕円（半径は横 0.36w・縦 0.7h）。板の縁では必ず 0 になるようにする
        const cy = h * 0.72
        const ry = h * 0.7
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1)
        grad.addColorStop(0, 'rgba(255,240,205,0.9)')
        grad.addColorStop(0.2, 'rgba(255,235,195,0.5)')
        grad.addColorStop(0.55, 'rgba(255,230,190,0.14)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.save()
        g.translate(w * cx, cy)
        g.scale(w * 0.36, ry)
        g.fillStyle = grad
        g.fillRect(-1, -1, 2, 2)
        g.restore()
      }
      // 車に近い側の縁は、手前へ向けて消す（板の端が見えない）
      g.globalCompositeOperation = 'source-over'
      const fade = g.createLinearGradient(0, h * 0.8, 0, h)
      fade.addColorStop(0, 'rgba(0,0,0,0)')
      fade.addColorStop(1, 'rgba(0,0,0,1)')
      g.fillStyle = fade
      g.fillRect(0, h * 0.8, w, h * 0.2)
    },
    64,
    128,
  )
  const glowMap = blobTexture(
    (g, w, h) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = 'lighter'
      // 左右の灯りを芯にして、横へ長く伸びる筋
      for (const cx of [0.3, 0.7]) {
        const grad = g.createRadialGradient(w * cx, h / 2, 0, w * cx, h / 2, w * 0.3)
        grad.addColorStop(0, 'rgba(255,255,255,0.95)')
        grad.addColorStop(0.18, 'rgba(255,255,255,0.4)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.1)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.save()
        g.translate(0, h / 2)
        g.scale(1, (h / w) * 1.5)
        g.translate(0, -h / 2)
        g.fillStyle = grad
        g.fillRect(0, -h * 4, w, h * 9)
        g.restore()
      }
    },
    128,
    32,
  )
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: true } as const
  const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const poolMaterial = new THREE.MeshBasicMaterial({ map: poolMap, ...additive, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })
  const pools = new THREE.InstancedMesh(poolGeometry, poolMaterial, capacity)
  const glowGeometry = new THREE.PlaneGeometry(1, 1)
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowMap, ...additive, side: THREE.DoubleSide })
  const glows = new THREE.InstancedMesh(glowGeometry, glowMaterial, capacity * 2)
  for (const mesh of [pools, glows]) {
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    ctx.scene.add(mesh)
  }
  pools.renderOrder = 3
  pools.name = 'gto-vehicle-light-pools'
  glows.renderOrder = 7
  glows.name = 'gto-vehicle-glows'
  const color = new THREE.Color()
  // 最初に色のバッファを作っておく（後から足すとシェーダーを作り直すことになる）
  for (let i = 0; i < capacity; i++) pools.setColorAt(i, color.setScalar(0))
  for (let i = 0; i < capacity * 2; i++) glows.setColorAt(i, color.setScalar(0))

  const local = new THREE.Matrix4()
  const world = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const noTurn = new THREE.Quaternion()
  const POOL_LENGTH = 16
  let poolCount = 0
  let glowCount = 0

  return {
    begin: () => {
      poolCount = 0
      glowCount = 0
    },
    pool: (root, frontZ, width, strength) => {
      if (poolCount >= capacity) return
      local.compose(position.set(0, 0.06, frontZ - POOL_LENGTH / 2 + 2.6), noTurn, scale.set(width * 4.2, 1, POOL_LENGTH))
      pools.setMatrixAt(poolCount, world.multiplyMatrices(root, local))
      pools.setColorAt(poolCount, color.setRGB(strength, strength * 0.93, strength * 0.78))
      poolCount++
    },
    glow: (body, y, z, width, height, r, g, b) => {
      if (glowCount >= capacity * 2) return
      local.compose(position.set(0, y, z), noTurn, scale.set(width, height, 1))
      glows.setMatrixAt(glowCount, world.multiplyMatrices(body, local))
      glows.setColorAt(glowCount, color.setRGB(r, g, b))
      glowCount++
    },
    end: () => {
      pools.count = poolCount
      glows.count = glowCount
      pools.instanceMatrix.needsUpdate = true
      glows.instanceMatrix.needsUpdate = true
      if (pools.instanceColor) pools.instanceColor.needsUpdate = true
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true
    },
    dispose: () => {
      ctx.scene.remove(pools, glows)
      poolGeometry.dispose()
      glowGeometry.dispose()
      poolMaterial.dispose()
      glowMaterial.dispose()
      poolMap.dispose()
      glowMap.dispose()
    },
  }
}
