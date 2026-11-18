// [onfoot] 乗り降りの段のカメラ（車の斜め後ろ外側に一定の距離で留まる）。ふだんの背後カメラを変えないことも守る。
import { describe, expect, it } from 'vitest'
import { CAMERA_TUNING, createCamera, STAGE_TUNING, stageYaw, stepCamera, type CameraStage, type CameraTarget } from '../camera'
import { angleDiff, DEG, dirOf } from '../math'
import type { CameraState, GtoWorld } from '../types'
import { DT, input, world } from './helpers'

const flat: GtoWorld = {
  ...world,
  groundY: () => 0,
  insideBuilding: () => false,
  segmentClear: () => 1,
  resolveCircle: (x, z) => ({ x, z, hit: false, nx: 0, nz: 0 }),
}

/** x > wallX が全部建物（北向きの車の右＝運転席の側が壁） */
const walledRight = (wallX: number): GtoWorld => {
  const inside = (x: number) => x > wallX
  return {
    ...flat,
    insideBuilding: (x) => inside(x),
    segmentClear: (ax, az, bx, bz) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25))
      for (let s = 1; s <= steps; s++) if (inside(ax + ((bx - ax) * s) / steps)) return (s - 1) / steps
      return 1
    },
  }
}

// 車は原点に北向き（heading 0）。全長 4.4m・幅 1.8m
const LEN = 4.4
const WIDTH = 1.8
const stageOf = (k: number, side: CameraStage['side'] = 1): CameraStage => ({ x: 0, y: 0, z: 0, heading: 0, width: WIDTH, side, k })
const f = dirOf(0)
const right = { x: -f.z, z: f.x }
/** 車の座標（前 fw m・右 rt m）を世界へ */
const at = (fw: number, rt: number) => ({ x: f.x * fw + right.x * rt, z: f.z * fw + right.z * rt })
/** ドアの外に立つ人（右のドアの後ろの端の外） */
const standing = (side: number) => at(-0.3, (WIDTH / 2 + 0.5) * side)
const footAt = (side: number, stage?: CameraStage): CameraTarget => ({ ...standing(side), y: 0, heading: 0, speed: 0, mode: 'foot', stage })
const driveAt = (stage?: CameraStage): CameraTarget => ({ x: 0, y: 0, z: 0, heading: 0, speed: 0, mode: 'drive', stage })

function project(cam: CameraState, px: number, py: number, pz: number, aspect = 16 / 9) {
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2])
    return v.map((c) => c / l)
  }
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const fw = norm([cam.tx - cam.x, cam.ty - cam.y, cam.tz - cam.z])
  const r = norm(cross(fw, [0, 1, 0]))
  const u = cross(r, fw)
  const d = [px - cam.x, py - cam.y, pz - cam.z]
  const depth = dot(d, fw)
  const t = Math.tan((cam.fov * DEG) / 2)
  return { x: 0.5 + dot(d, r) / depth / (2 * t * aspect), y: 0.5 - dot(d, u) / depth / (2 * t), depth }
}

const settle = (t: CameraTarget, w: GtoWorld, seconds = 3, from = createCamera({ ...t, stage: undefined })) => {
  let cam = from
  for (let i = 0; i < seconds / DT; i++) cam = stepCamera(cam, t, input(), w, DT)
  return cam
}

/** カメラから車体の箱（水平面）までの距離。中なら 0 */
const bodyGap = (cam: CameraState) => {
  const fw = cam.x * f.x + cam.z * f.z
  const rt = cam.x * right.x + cam.z * right.z
  return Math.hypot(Math.max(0, Math.abs(fw) - LEN / 2), Math.max(0, Math.abs(rt) - WIDTH / 2))
}

/** 車体の 8 つの角・開いたドアの先端・人物の頭と足が画面の中（余白 margin）に入っているか */
function framed(cam: CameraState, side: number, margin = 0.03) {
  const pts: [number, number, number][] = []
  for (const fw of [-LEN / 2, LEN / 2]) for (const rt of [-WIDTH / 2, WIDTH / 2]) for (const y of [0, 1.45]) pts.push([at(fw, rt).x, y, at(fw, rt).z])
  // 開いたドアの先端（蝶番は前寄り、ドアの長さ 1.1m が真横へ開ききった位置）
  const tip = at(0.75, (WIDTH / 2 + 1.1) * side)
  pts.push([tip.x, 0.4, tip.z], [tip.x, 1.2, tip.z])
  const body = standing(side)
  pts.push([body.x, 0, body.z], [body.x, 1.72, body.z])
  return pts.every(([x, y, z]) => {
    const s = project(cam, x, y, z)
    return s.depth > 0.5 && s.x > margin && s.x < 1 - margin && s.y > margin && s.y < 1 - margin
  })
}

describe('gto camera [onfoot]: 乗り降りの段', () => {
  it('段が無い・効きが 0 のときは、ふだんの背後カメラと 1 コマも違わない（徒歩・運転とも）', () => {
    for (const base of [footAt(1), driveAt()]) {
      let a = createCamera(base)
      let b = createCamera(base)
      for (let i = 0; i < 180; i++) {
        const moving = { ...base, x: base.x + i * 0.05, heading: i * 0.01, speed: 3 }
        a = stepCamera(a, moving, input(), world, DT)
        b = stepCamera(b, { ...moving, stage: stageOf(0) }, input(), world, DT)
        expect(b).toEqual(a)
      }
    }
  })

  it('ふだんの数字（徒歩・運転の距離・角度・画角・追う強さ）は変えていない', () => {
    expect(CAMERA_TUNING.foot).toEqual({ dist: 4.063, pitch: 0.236, fov: 55, follow: 3, maxTurn: 1.45, fullSpeed: 1.5, deadBack: 0.5, idleDelay: 2.4, lead: 0.19, near: 3.1, look: 0.096 })
    expect(CAMERA_TUNING.drive).toEqual({ dist: 7.3, pitch: 0.14, fov: 53, follow: 2.3, maxTurn: 9, fullSpeed: 4, deadBack: 0.1, idleDelay: 0.9, lead: 0.14, near: 5.4, look: 0.02 })
  })

  it('開けた場所: 車の斜め後ろ外側（ドアの側）に一定の距離で留まり、車体の全体・人物の全身・開いたドアが画面に入る', () => {
    for (const side of [1, -1] as const) {
      const cam = settle(footAt(side, stageOf(1, side)), flat)
      // 車の後ろ・ドアの側
      expect(cam.x * f.x + cam.z * f.z).toBeLessThan(-LEN / 2)
      expect((cam.x * right.x + cam.z * right.z) * side).toBeGreaterThan(WIDTH / 2 + 0.5)
      // 車体から 2m 以上離れている（めり込まない）
      expect(bodyGap(cam)).toBeGreaterThan(2)
      expect(Math.hypot(cam.x - cam.tx, cam.y - cam.ty, cam.z - cam.tz)).toBeCloseTo(STAGE_TUNING.dist, 0)
      expect(framed(cam, side)).toBe(true)
      // 車体は画面の幅の 3 割以上に写る（遠すぎない）
      const xs = [at(-LEN / 2, -WIDTH / 2), at(-LEN / 2, WIDTH / 2), at(LEN / 2, -WIDTH / 2), at(LEN / 2, WIDTH / 2)].map((p) => project(cam, p.x, 0.5, p.z).x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.3)
    }
  })

  it('乗る人が徒歩の構えでも、座って運転の構えになっても、段の画は同じ場所（構えの切り替えでカメラが動かない）', () => {
    const a = settle(footAt(1, stageOf(1)), flat)
    const b = settle(driveAt(stageOf(1)), flat, 3, a)
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.02)
    // 切り替えたコマでも飛ばない
    const next = stepCamera(a, driveAt(stageOf(1)), input(), flat, DT)
    expect(Math.hypot(a.x - next.x, a.y - next.y, a.z - next.z)).toBeLessThan(0.02)
  })

  it('段へ入るとき・抜けるとき、効きに沿ってなめらかに移る（1コマで 0.4m より大きく飛ばない）', () => {
    let cam = settle(footAt(1), flat)
    let prev = cam
    const step = (t: CameraTarget) => {
      cam = stepCamera(cam, t, input(), flat, DT)
      expect(Math.hypot(cam.x - prev.x, cam.y - prev.y, cam.z - prev.z)).toBeLessThan(0.4)
      prev = cam
    }
    for (let i = 1; i <= 21; i++) step(footAt(1, stageOf(i / 21)))
    for (let i = 0; i < 120; i++) step(footAt(1, stageOf(1)))
    for (let i = 20; i >= 0; i--) step(driveAt(stageOf(i / 21)))
    for (let i = 0; i < 120; i++) step(driveAt())
    // 抜けきれば運転の背後カメラ
    expect(cam.dist).toBeCloseTo(CAMERA_TUNING.drive.dist, 0)
  })

  it('ドアの側のすぐ横が壁でも、建物の中へも車体の中へも入らない。車体の全体はまだ画面に入る', () => {
    // 車の右 1.6m（ドアが開くぎりぎり）から先が壁
    const w = walledRight(WIDTH / 2 + 1.6)
    let cam = settle(footAt(1), w, 1)
    for (let i = 0; i < 240; i++) {
      cam = stepCamera(cam, footAt(1, stageOf(Math.min(1, i / 20))), input(), w, DT)
      expect(w.insideBuilding(cam.x, cam.z)).toBe(false)
      expect(bodyGap(cam)).toBeGreaterThan(0.8)
    }
    expect(bodyGap(cam)).toBeGreaterThan(1.5)
    const corners = [at(-LEN / 2, -WIDTH / 2), at(-LEN / 2, WIDTH / 2), at(LEN / 2, -WIDTH / 2), at(LEN / 2, WIDTH / 2)]
    for (const p of corners) {
      const s = project(cam, p.x, 0.7, p.z)
      expect(s.depth).toBeGreaterThan(0.5)
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(1)
    }
  })

  it('斜め後ろ外側が空いていればそこを選び、壁で詰まるなら空いている回り込み角を選ぶ', () => {
    expect(angleDiff(0, stageYaw(stageOf(1, 1), flat))).toBeCloseTo(-STAGE_TUNING.quarter, 5)
    expect(angleDiff(0, stageYaw(stageOf(1, -1), flat))).toBeCloseTo(STAGE_TUNING.quarter, 5)
    const tight = stageYaw(stageOf(1, 1), walledRight(WIDTH / 2 + 1.0))
    expect(Math.abs(angleDiff(0, tight))).toBeLessThan(STAGE_TUNING.quarter)
  })

  it('真後ろも横も壁（袋小路）なら、車体へ寄らずに上へ逃げて見下ろす', () => {
    const boxed: GtoWorld = {
      ...flat,
      insideBuilding: (x, z) => Math.abs(x) > 2.2 || z > 3.2,
      segmentClear: (ax, az, bx, bz) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25))
        for (let s = 1; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps
          const z = az + ((bz - az) * s) / steps
          if (Math.abs(x) > 2.2 || z > 3.2) return (s - 1) / steps
        }
        return 1
      },
    }
    const cam = settle(driveAt(stageOf(1)), boxed, 3)
    expect(boxed.insideBuilding(cam.x, cam.z)).toBe(false)
    // 屋根（1.45m）より 1m 以上高い
    expect(cam.y).toBeGreaterThan(2.45)
  })
})
