import { describe, expect, it } from 'vitest'
import { createCamera, stepCamera } from '../camera'
import { angleDiff, dirOf } from '../math'
import { createPlayer, exitPoint, findEnterable, FOOT_TUNING, stepOnFoot } from '../onFoot'
import { collideVehicles, createVehicle, stepVehicle, VEHICLE_SPECS } from '../vehicle'
import type { VehicleControl, VehicleState } from '../types'
import { DT, input, world } from './helpers'

const drive = (v: VehicleState, control: Partial<VehicleControl>, seconds: number) => {
  let cur = v
  let crashes = 0
  for (let i = 0; i < seconds / DT; i++) {
    const r = stepVehicle(cur, { throttle: 0, brake: 0, steer: 0, handbrake: false, ...control }, world, DT)
    cur = r.vehicle
    crashes += r.events.length
  }
  return { v: cur, crashes }
}

// 明治通り（南北にまっすぐな広い道）の上、北向き
const onMeiji = () => {
  const road = world.nearestRoad(200, 150, true, 80)
  if (!road) throw new Error('road')
  return createVehicle(1, 'sedan', road.x, road.z, road.heading, world)
}

describe('gto vehicle: 車の挙動', () => {
  it('アクセルで加速し、最高速を超えない', () => {
    const a = drive(onMeiji(), { throttle: 1 }, 2).v
    expect(a.speed).toBeGreaterThan(8)
    expect(a.speed).toBeLessThan(VEHICLE_SPECS.sedan.maxSpeed)
  })

  it('ブレーキで止まり、踏み続けると後退する', () => {
    const moving = { ...onMeiji(), speed: 12 }
    const stopped = drive(moving, { brake: 1 }, 1.2).v
    expect(stopped.speed).toBeLessThan(2)
    expect(drive(stopped, { brake: 1 }, 2).v.speed).toBeLessThan(-1)
  })

  it('ハンドルを右に切ると右へ曲がる', () => {
    const v0 = { ...onMeiji(), speed: 8 }
    const v1 = drive(v0, { throttle: 0.5, steer: 1 }, 1).v
    expect(angleDiff(v0.heading, v1.heading)).toBeGreaterThan(0.3)
  })

  it('サイドブレーキで曲がると横に滑る', () => {
    const v0 = { ...onMeiji(), speed: 16 }
    const grip = drive(v0, { steer: 1 }, 0.6).v
    const slide = drive(v0, { steer: 1, handbrake: true }, 0.6).v
    expect(Math.abs(slide.slip)).toBeGreaterThan(Math.abs(grip.slip) + 0.5)
  })

  it('建物にぶつかると衝突が起きて、中にはめり込まない', () => {
    const tower = world.spot('tower-scramble-square')
    if (!tower) throw new Error('spot')
    const from = world.resolveCircle(tower.x - 60, tower.z, 1)
    const v0 = { ...createVehicle(1, 'sedan', from.x, from.z, Math.PI / 2, world), speed: 20 }
    const r = drive(v0, { throttle: 1 }, 5)
    expect(r.crashes).toBeGreaterThan(0)
    expect(world.insideBuilding(r.v.x, r.v.z)).toBe(false)
  })

  it('重なった2台は押し離される', () => {
    const a = { ...createVehicle(1, 'sedan', 0, 0, 0, world), speed: 10 }
    const b = createVehicle(2, 'kei', 0, -2, 0, world)
    const hit = collideVehicles(a, b)
    expect(hit?.impact).toBeGreaterThan(5)
    expect(hit && Math.hypot(hit.a.x - hit.b.x, hit.a.z - hit.b.z)).toBeGreaterThan(2)
    expect(collideVehicles(a, { ...b, z: -30 })).toBeNull()
  })
})

describe('gto onFoot: 徒歩', () => {
  it('前へ倒すとカメラの向きへ歩き、走ると速い', () => {
    const p0 = createPlayer(0, 0, 0, world)
    let walk = p0
    let sprint = p0
    for (let i = 0; i < 60; i++) {
      walk = stepOnFoot(walk, input({ moveY: 1 }), Math.PI / 2, world, [], DT)
      sprint = stepOnFoot(sprint, input({ moveY: 1, run: true }), Math.PI / 2, world, [], DT)
    }
    expect(walk.x).toBeGreaterThan(1.2)
    expect(Math.abs(walk.z)).toBeLessThan(0.2)
    expect(sprint.x).toBeGreaterThan(walk.x * 2)
    expect(Math.abs(angleDiff(walk.heading, Math.PI / 2))).toBeLessThan(0.05)
    expect(walk.stride).toBeGreaterThan(0.5)
  })

  it('停まっている車は通り抜けられない', () => {
    let p = createPlayer(0, 3, 0, world)
    for (let i = 0; i < 120; i++) p = stepOnFoot(p, input({ moveY: 1 }), 0, world, [{ x: 0, z: 0, r: 1.1 }], DT)
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(1.1 + FOOT_TUNING.radius - 0.01)
  })

  it('近くの車に乗れて、降りる場所は建物の外', () => {
    const p = createPlayer(0, 0, 0, world)
    const near = createVehicle(1, 'sedan', 2, 0, 0, world)
    const far = createVehicle(2, 'sedan', 30, 0, 0, world)
    expect(findEnterable(p, [far, near])?.id).toBe(1)
    expect(findEnterable(p, [far])).toBeNull()
    const out = exitPoint(near, 0.9, world)
    expect(world.insideBuilding(out.x, out.z)).toBe(false)
    // 運転席（右側）へ降りる
    const r = { x: -dirOf(near.heading).z, z: dirOf(near.heading).x }
    expect((out.x - near.x) * r.x + (out.z - near.z) * r.z).toBeGreaterThan(1)
  })
})

describe('gto camera: 背後カメラ', () => {
  const target = { x: 0, y: 0, z: 0, heading: 0, speed: 0, mode: 'foot' as const }

  it('最初は相手の真後ろ、少し上にいる', () => {
    const cam = createCamera(target)
    expect(cam.z).toBeGreaterThan(2.8)
    expect(cam.y).toBeGreaterThan(1.4)
    expect(Math.abs(cam.x)).toBeLessThan(0.01)
  })

  it('手で回すと向きが変わり、上下は限界で止まる', () => {
    let cam = createCamera(target)
    for (let i = 0; i < 200; i++) cam = stepCamera(cam, target, input({ lookX: 0.01, lookY: 0.05 }), world, DT)
    expect(cam.yaw).toBeCloseTo(2, 1)
    expect(cam.pitch).toBeCloseTo(-0.35, 2)
  })

  it('走っている車の後ろへ自然に回り込む', () => {
    const car = { ...target, mode: 'drive' as const, heading: Math.PI / 2, speed: 15 }
    let cam = createCamera(target)
    for (let i = 0; i < 240; i++) cam = stepCamera(cam, car, input(), world, DT)
    expect(Math.abs(angleDiff(cam.yaw, car.heading))).toBeLessThan(0.1)
    // 画角は速度で変えない（バーの実測）
    expect(cam.fov).toBeLessThan(60)
  })

  it('後ろが建物なら、カメラは建物の手前まで寄る', () => {
    const tower = world.spot('tower-scramble-square')
    if (!tower) throw new Error('spot')
    const edge = world.resolveCircle(tower.x, tower.z, 2.5)
    // 建物を背にして立つ
    const back = Math.atan2(edge.x - tower.x, -(edge.z - tower.z))
    const t = { ...target, x: edge.x, z: edge.z, y: world.groundY(edge.x, edge.z), heading: back }
    let cam = createCamera(t)
    for (let i = 0; i < 120; i++) cam = stepCamera(cam, t, input(), world, DT)
    expect(cam.dist).toBeLessThan(3.2)
    expect(world.insideBuilding(cam.x, cam.z)).toBe(false)
  })
})
