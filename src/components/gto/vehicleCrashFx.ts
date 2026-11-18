// Grand Theft Outfit [部品: vehicle の見た目] 衝突の瞬間に飛ぶもの（火花・破片・落ちた部品）。
// 入口: createCrashFx(ctx, smoke, mobile)
// 契約: burst(当たった点, 弾かれる向き, 強さ, 塗装色) で、火花が放射状に散り、塗装の破片とガラスの粒が飛び、煙が立つ。
//       dropPart(...) で、バンパーやホイールキャップが車から外れて路面を転がり、しばらく残る。
//       火花は1枚の帯の集まり、破片と部品は1つのインスタンスで描く（数が増えても描画回数は 2 回）。状態には何も書き戻さない。
import * as THREE from 'three'
import type { CrashPart } from '../../lib/gto/vehicleCrash'
import type { RenderCtx } from './renderTypes'
import type { Smoke } from './vehicleFx'

export const CRASH_LOOK = {
  /** 火花: 当たりの強さ 1m/s あたりの本数と上限（PC・スマホ）、飛ぶ速さ m/s、寿命 秒、尾の長さ（秒ぶん）、太さ m */
  sparksPerSpeed: 3.2,
  sparksMax: 64,
  sparksMaxMobile: 20,
  sparkSpeed: [6, 17] as const,
  sparkLife: [0.2, 0.6] as const,
  sparkStreak: 0.035,
  sparkWidth: 0.02,
  /** 破片: 当たりの強さ 1m/s あたりの数と上限（PC・スマホ）、残る秒 */
  bitsPerSpeed: 0.7,
  bitsMax: 14,
  bitsMaxMobile: 5,
  bitLife: 9,
  /** 落ちた部品が残る秒 */
  partLife: 16,
  /** 路面での弾みと、滑るときの摩擦（1 秒あたりに残る速さの割合の指数） */
  bounce: 0.35,
  friction: 5,
}

export interface CrashFx {
  /** 当たった瞬間。(nx, nz) は当たった点から車が弾かれる向き、power は当たった強さ m/s、paint は車の塗装色 */
  burst: (x: number, y: number, z: number, nx: number, nz: number, power: number, paint: number) => void
  /** 部品が外れて落ちる。(x, y, z) は外れた場所、heading は車の向き、(vx, vz) は車の速度、width は車幅 m */
  dropPart: (part: CrashPart, x: number, y: number, z: number, heading: number, vx: number, vz: number, width: number) => void
  update: (dt: number) => void
  dispose: () => void
}

const GRAVITY = 9.8
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function createCrashFx(ctx: RenderCtx, smoke: Smoke, mobile: boolean): CrashFx {
  const look = CRASH_LOOK
  const ground = (x: number, z: number) => ctx.world.groundY(x, z)

  // ---- 火花: 速度の向きに伸びた細い帯（縦と横の 2 枚を十字に重ねる。どの向きから見ても線に見える） ----
  const sparkCap = mobile ? 40 : 160
  const sPos = new Float32Array(sparkCap * 3)
  const sVel = new Float32Array(sparkCap * 3)
  const sAge = new Float32Array(sparkCap)
  const sLife = new Float32Array(sparkCap)
  const sFloor = new Float32Array(sparkCap)
  let sCursor = 0
  let sLive = false
  const sparkPosition = new Float32Array(sparkCap * 8 * 3)
  const sparkColor = new Float32Array(sparkCap * 8 * 3)
  const sparkIndex: number[] = []
  for (let i = 0; i < sparkCap; i++) {
    for (const q of [0, 4]) sparkIndex.push(i * 8 + q, i * 8 + q + 1, i * 8 + q + 2, i * 8 + q, i * 8 + q + 2, i * 8 + q + 3)
  }
  const sparkGeometry = new THREE.BufferGeometry()
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPosition, 3).setUsage(THREE.DynamicDrawUsage))
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColor, 3).setUsage(THREE.DynamicDrawUsage))
  sparkGeometry.setIndex(sparkIndex)
  const sparkMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })
  const sparks = new THREE.Mesh(sparkGeometry, sparkMaterial)
  sparks.frustumCulled = false
  sparks.renderOrder = 7
  sparks.visible = false
  sparks.name = 'gto-vehicle-sparks'
  ctx.scene.add(sparks)
  // 昼は白に近い黄、夜は橙が残る（暗い画面で白く飛ばない）
  const hot = ctx.time === 'night' ? [1, 0.75, 0.32] : [1, 0.93, 0.62]

  // ---- 破片と落ちた部品: 箱1つを色と大きさを変えて使い回す ----
  const bitCap = mobile ? 16 : 56
  interface Bit {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    /** 向き（オイラー角）と回る速さ */
    rx: number
    ry: number
    rz: number
    wx: number
    wy: number
    wz: number
    sx: number
    sy: number
    sz: number
    age: number
    life: number
    floor: number
    resting: boolean
  }
  const bits: (Bit | null)[] = Array.from({ length: bitCap }, () => null)
  let bCursor = 0
  const bitGeometry = new THREE.BoxGeometry(1, 1, 1)
  const bitMaterial = new THREE.MeshLambertMaterial()
  const bitMesh = new THREE.InstancedMesh(bitGeometry, bitMaterial, bitCap)
  bitMesh.frustumCulled = false
  bitMesh.castShadow = ctx.quality.shadows
  bitMesh.count = bitCap
  bitMesh.name = 'gto-vehicle-debris'
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
  const tint = new THREE.Color()
  for (let i = 0; i < bitCap; i++) {
    bitMesh.setMatrixAt(i, HIDDEN)
    bitMesh.setColorAt(i, tint.set(0x808080))
  }
  ctx.scene.add(bitMesh)
  const m4 = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const pos3 = new THREE.Vector3()
  const scale3 = new THREE.Vector3()

  const addBit = (b: Omit<Bit, 'age' | 'floor' | 'resting'>, color: number) => {
    const i = bCursor
    bCursor = (bCursor + 1) % bitCap
    bits[i] = { ...b, age: 0, floor: ground(b.x, b.z), resting: false }
    bitMesh.setColorAt(i, tint.set(color))
    if (bitMesh.instanceColor) bitMesh.instanceColor.needsUpdate = true
  }

  const addSpark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, floor: number) => {
    const i = sCursor
    sCursor = (sCursor + 1) % sparkCap
    sPos.set([x, y, z], i * 3)
    sVel.set([vx, vy, vz], i * 3)
    sAge[i] = 0
    sLife[i] = life
    sFloor[i] = floor
    sLive = true
  }

  /** 火花1本ぶんの 8 頂点を書く（k は残りの明るさ 0..1） */
  const writeSpark = (i: number, k: number) => {
    const o = i * 24
    if (k <= 0) {
      sparkPosition.fill(0, o, o + 24)
      return
    }
    const px = sPos[i * 3]
    const py = sPos[i * 3 + 1]
    const pz = sPos[i * 3 + 2]
    const vx = sVel[i * 3]
    const vy = sVel[i * 3 + 1]
    const vz = sVel[i * 3 + 2]
    const tx = px - vx * look.sparkStreak
    const ty = py - vy * look.sparkStreak
    const tz = pz - vz * look.sparkStreak
    const w = look.sparkWidth * (0.35 + 0.65 * k)
    // 横向きの幅は、速度に直角な水平の向きへ
    const h = Math.hypot(vx, vz) || 1
    const ox = (-vz / h) * w
    const oz = (vx / h) * w
    // 1 枚目: 上下に幅を持つ帯、2 枚目: 水平に幅を持つ帯
    sparkPosition.set([px, py - w, pz, px, py + w, pz, tx, ty + w, tz, tx, ty - w, tz, px - ox, py, pz - oz, px + ox, py, pz + oz, tx + ox, ty, tz + oz, tx - ox, ty, tz - oz], o)
    for (let c = 0; c < 8; c++) {
      // 尾の側は暗い
      const end = c === 2 || c === 3 || c === 6 || c === 7 ? 0.25 : 1
      sparkColor.set([hot[0] * end, hot[1] * (0.45 + 0.55 * k) * end, hot[2] * k * end], o + c * 3)
    }
  }

  return {
    burst: (x, y, z, nx, nz, power, paint) => {
      const floor = ground(x, z)
      // 火花: 当たった点から放射状に。弾かれる向きと上へ少し寄る
      const n = Math.min(mobile ? look.sparksMaxMobile : look.sparksMax, Math.round(power * look.sparksPerSpeed))
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const up = rand(-0.15, 1)
        const flat = Math.sqrt(Math.max(0, 1 - up * up * 0.6))
        const s = rand(look.sparkSpeed[0], look.sparkSpeed[1]) * (0.6 + Math.min(1, power / 16) * 0.4)
        addSpark(x, y + rand(-0.15, 0.25), z, (Math.cos(a) * flat + nx * 0.5) * s, up * s * 0.7 + 1.5, (Math.sin(a) * flat + nz * 0.5) * s, rand(look.sparkLife[0], look.sparkLife[1]), floor)
      }
      // 煙: 当たった点にぱっと立つ
      const puffs = Math.min(mobile ? 6 : 18, Math.round(power))
      for (let i = 0; i < puffs; i++) {
        const a = Math.random() * Math.PI * 2
        const s = rand(1, 4)
        smoke.emit(x + Math.cos(a) * 0.4, y + rand(-0.1, 0.5), z + Math.sin(a) * 0.4, Math.cos(a) * s, rand(0.8, 2.2), Math.sin(a) * s, rand(0.5, 0.9), 1.5, rand(0.6, 1.1), 0.12)
      }
      // 破片: 塗装の板とガラスの粒が、弾かれる向きを中心に飛んで路面に残る
      const count = Math.min(mobile ? look.bitsMaxMobile : look.bitsMax, Math.round(power * look.bitsPerSpeed))
      for (let i = 0; i < count; i++) {
        const glass = i % 3 === 2
        const a = Math.atan2(nz, nx) + rand(-1.5, 1.5)
        const s = rand(2.5, 8) * (0.5 + Math.min(1, power / 16) * 0.5)
        const size = glass ? rand(0.04, 0.07) : rand(0.1, 0.22)
        addBit(
          {
            x: x + rand(-0.3, 0.3),
            y: y + rand(0, 0.35),
            z: z + rand(-0.3, 0.3),
            vx: Math.cos(a) * s,
            vy: rand(1.5, 4),
            vz: Math.sin(a) * s,
            rx: rand(0, 6),
            ry: rand(0, 6),
            rz: rand(0, 6),
            wx: rand(-14, 14),
            wy: rand(-8, 8),
            wz: rand(-14, 14),
            sx: size,
            sy: glass ? size : 0.03,
            sz: glass ? size : size * rand(0.4, 0.8),
            life: look.bitLife * rand(0.7, 1),
          },
          glass ? 0xb9d2d6 : i % 3 === 1 ? 0x2a2c2e : paint,
        )
      }
    },
    dropPart: (part, x, y, z, heading, vx, vz, width) => {
      const bumper = part === 'bumperFront' || part === 'bumperRear'
      // 車の動きを引きずりながら、少し横へ跳ねて転がる
      const side = part === 'hubcapLeft' ? -1 : part === 'hubcapRight' ? 1 : Math.random() < 0.5 ? -1 : 1
      const kx = Math.cos(heading) * side
      const kz = Math.sin(heading) * side
      addBit(
        {
          x,
          y,
          z,
          vx: vx * 0.5 + kx * rand(1.5, 3.5),
          vy: rand(2.2, 3.6),
          vz: vz * 0.5 + kz * rand(1.5, 3.5),
          rx: 0,
          ry: -heading,
          rz: bumper ? 0 : Math.PI / 2,
          wx: rand(-5, 5),
          wy: rand(-5, 5) + side * 3,
          wz: rand(-4, 4),
          sx: bumper ? width * 0.94 : 0.36,
          sy: bumper ? 0.15 : 0.04,
          sz: bumper ? 0.16 : 0.36,
          life: look.partLife,
        },
        bumper ? 0x9a9da0 : 0xc8ccd0,
      )
    },
    update: (dt) => {
      // ---- 火花 ----
      if (sLive) {
        let any = false
        for (let i = 0; i < sparkCap; i++) {
          if (sLife[i] <= 0) continue
          sAge[i] += dt
          if (sAge[i] >= sLife[i]) {
            sLife[i] = 0
            writeSpark(i, 0)
            continue
          }
          any = true
          sVel[i * 3 + 1] -= GRAVITY * dt
          sPos[i * 3] += sVel[i * 3] * dt
          sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt
          sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt
          if (sPos[i * 3 + 1] < sFloor[i] + 0.03 && sVel[i * 3 + 1] < 0) {
            // 路面で跳ねる
            sPos[i * 3 + 1] = sFloor[i] + 0.03
            sVel[i * 3 + 1] *= -0.45
            sVel[i * 3] *= 0.7
            sVel[i * 3 + 2] *= 0.7
          }
          writeSpark(i, 1 - sAge[i] / sLife[i])
        }
        sLive = any
        sparks.visible = any
        sparkGeometry.attributes.position.needsUpdate = true
        sparkGeometry.attributes.color.needsUpdate = true
      }
      // ---- 破片と部品 ----
      let moved = false
      for (let i = 0; i < bitCap; i++) {
        const b = bits[i]
        if (!b) continue
        moved = true
        const age = b.age + dt
        if (age >= b.life) {
          bits[i] = null
          bitMesh.setMatrixAt(i, HIDDEN)
          continue
        }
        let next: Bit = { ...b, age }
        if (!b.resting) {
          // いちばん薄い辺を下にして寝る高さ
          const rest = b.floor + Math.min(b.sx, b.sy, b.sz) / 2 + 0.02
          let { vx, vy, vz, wx, wy, wz } = b
          vy -= GRAVITY * dt
          let y = b.y + vy * dt
          let resting = false
          if (y <= rest && vy < 0) {
            y = rest
            const slow = Math.exp(-look.friction * 0.12)
            vx *= slow
            vz *= slow
            wx *= 0.5
            wy *= 0.6
            wz *= 0.5
            if (-vy * look.bounce < 0.9) {
              vy = 0
              resting = Math.hypot(vx, vz) < 0.4
            } else vy = -vy * look.bounce
          }
          if (y <= rest + 0.001) {
            // 路面を滑っているあいだは摩擦で止まる
            const slow = Math.exp(-look.friction * dt)
            vx *= slow
            vz *= slow
          }
          const x = b.x + vx * dt
          const z = b.z + vz * dt
          next = { ...next, x, y, z, vx, vy, vz, wx, wy, wz, rx: b.rx + wx * dt, ry: b.ry + wy * dt, rz: b.rz + wz * dt, resting, floor: resting ? b.floor : ground(x, z) }
        } else {
          // 止まったら、ぱたりと寝る（立ったまま路面に刺さって見えない）
          const flat = (r: number) => {
            const target = Math.round(r / Math.PI) * Math.PI
            return Math.abs(r - target) < 0.02 ? target : r + (target - r) * Math.min(1, dt * 12)
          }
          next = { ...next, rx: flat(b.rx), rz: flat(b.rz) }
        }
        bits[i] = next
        // 消える前の 1 秒で縮む
        const fade = Math.min(1, (next.life - next.age) / 1)
        euler.set(next.rx, next.ry, next.rz, 'YXZ')
        bitMesh.setMatrixAt(i, m4.compose(pos3.set(next.x, next.y, next.z), quat.setFromEuler(euler), scale3.set(next.sx * fade, next.sy * fade, next.sz * fade)))
      }
      if (moved) bitMesh.instanceMatrix.needsUpdate = true
    },
    dispose: () => {
      ctx.scene.remove(sparks)
      sparkGeometry.dispose()
      sparkMaterial.dispose()
      ctx.scene.remove(bitMesh)
      bitMesh.dispose()
      bitGeometry.dispose()
      bitMaterial.dispose()
    },
  }
}
