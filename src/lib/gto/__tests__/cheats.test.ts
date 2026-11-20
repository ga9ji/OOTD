// [部品: cheats] スマホの裏コード（cheats.ts）と、出てくる乗り物（戦車・飛行機）の乗り降り・走り。
import { describe, expect, it } from 'vitest'
import { flying } from '../aircraft'
import { stepCamera, createCamera } from '../camera'
import { CHEATS, dialPush, DIAL_MAX, findCheat, lowerWanted, specialSpot } from '../cheats'
import { hudModel } from '../hud'
import { FLIGHT_CAPTION, touchCaption, touchHint, visibleTouchButtons } from '../input'
import { cameraSubject, findEnterable } from '../onFoot'
import { saveOf } from '../save'
import { stepGto, viewOf } from '../sim'
import { collideVehicles, createVehicle, isCar, isSpecial, stepVehicle, VEHICLE_SPECS } from '../vehicle'
import { createWanted, WANTED_TUNING } from '../wanted'
import type { GtoState, GtoWorld, InputFrame, VehicleState } from '../types'
import { allowLongSimulations, cfg, DT, input, run, start, world } from './helpers'

allowLongSimulations()

const step = (s: GtoState, over: Partial<InputFrame> = {}) => stepGto(s, input(over), world, cfg, DT)
const specials = (s: GtoState) => s.vehicles.filter((v) => isSpecial(v.kind))
const mine = (s: GtoState) => s.vehicles.find((v) => v.id === s.player.vehicleId)

describe('gto cheats: 番号の表', () => {
  it('番号は数字だけで、どれも違い、打てる桁数に収まる', () => {
    const codes = CHEATS.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) {
      expect(code).toMatch(/^[0-9]+$/)
      expect(code.length).toBeLessThanOrEqual(DIAL_MAX)
    }
    expect(CHEATS.map((c) => c.id).sort()).toEqual(['calm', 'plane', 'tank'])
  })

  it('合う番号だけが通じる', () => {
    for (const c of CHEATS) expect(findCheat(c.code)?.id).toBe(c.id)
    expect(findCheat('')).toBeNull()
    expect(findCheat('0000')).toBeNull()
    expect(findCheat(CHEATS[0].code + '1')).toBeNull()
  })

  it('打てるのは数字だけ、上限の桁まで', () => {
    expect(dialPush('12', '3')).toBe('123')
    expect(dialPush('12', 'a')).toBe('12')
    expect(dialPush('12', '34')).toBe('12')
    const full = '9'.repeat(DIAL_MAX)
    expect(dialPush(full, '1')).toBe(full)
  })
})

describe('gto cheats: 手配度を下げる', () => {
  const at = (level: number) => ({ ...createWanted(), level, heat: WANTED_TUNING.levels[level - 1] + 20, unseen: 0 })

  it('1 つ下がり、熱さも下げた段に収まる（次の 1 歩で元の段へ戻らない）', () => {
    const lowered = lowerWanted(at(3))
    expect(lowered.level).toBe(2)
    expect(lowered.heat).toBeLessThan(WANTED_TUNING.levels[2])
    expect(lowered.heat).toBeGreaterThanOrEqual(WANTED_TUNING.levels[1])
  })

  it('1 から下げると手配が消える。手配が無ければ何も起きない', () => {
    expect(lowerWanted(at(1))).toEqual(createWanted())
    expect(lowerWanted(createWanted())).toEqual(createWanted())
  })

  it('街の中で打つと、その 1 歩で印が 1 つ減り、一言が出る。3 回で消える', () => {
    let s = run(start({ stage: { wanted: 3 } }), 0.5)
    expect(s.wanted.level).toBe(3)
    s = step(s, { cheat: 'calm' })
    expect(s.wanted.level).toBe(2)
    expect(s.events.some((e) => e.type === 'cheat' && e.ref === 'calm')).toBe(true)
    expect(viewOf(s).banner).toBe('裏コード: 手配度を下げた')
    s = run(s, 0.5)
    expect(s.wanted.level).toBe(2)
    s = step(step(s, { cheat: 'calm' }), { cheat: 'calm' })
    expect(s.wanted.level).toBe(0)
  })

  it('裏コードは進行の保存に何も足さない', () => {
    const before = start()
    const after = step(step(before, { cheat: 'tank' }), { cheat: 'calm' })
    expect(saveOf(after)).toEqual(saveOf(before))
  })
})

describe('gto cheats: 乗り物を出す', () => {
  it.each(['tank', 'plane'] as const)('%s が主人公の目の前に出て、建物にかからず、すぐ乗れる', (kind) => {
    const before = start()
    const s = step(before, { cheat: kind })
    const made = specials(s)
    expect(made).toHaveLength(1)
    expect(made[0].kind).toBe(kind)
    expect(made[0].driver).toBe('none')
    const spec = VEHICLE_SPECS[kind]
    // 車体の中心と前後の端が建物の外
    for (const fw of [-spec.length / 2, 0, spec.length / 2]) {
      expect(world.insideBuilding(made[0].x + Math.sin(made[0].heading) * fw, made[0].z - Math.cos(made[0].heading) * fw)).toBe(false)
    }
    expect(Math.hypot(made[0].x - s.player.x, made[0].z - s.player.z)).toBeLessThan(spec.length / 2 + 4)
    expect(findEnterable(s.player, s.vehicles)?.id).toBe(made[0].id)
    expect(viewOf(s).canEnter).toBe(true)
    expect(viewOf(s).banner).toContain('裏コード')
  })

  it('同じ乗り物を出し直すと、乗っていない古いほうは消える', () => {
    let s = step(start(), { cheat: 'tank' })
    const first = specials(s)[0].id
    s = step(run(s, 0.3), { cheat: 'tank' })
    expect(specials(s)).toHaveLength(1)
    expect(specials(s)[0].id).not.toBe(first)
    // 別の種類は、重ならない場所（少し先）に出て、両方残る
    s = step(s, { cheat: 'plane' })
    expect(specials(s).map((v) => v.kind).sort()).toEqual(['plane', 'tank'])
    const [a, b] = specials(s)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan((VEHICLE_SPECS.tank.length + VEHICLE_SPECS.plane.length) / 2)
  })

  it('乗っている乗り物は、出し直しても消えない', () => {
    let s = step(step(start(), { cheat: 'tank' }), { enter: true })
    const riding = s.player.vehicleId
    s = step(s, { cheat: 'tank' })
    expect(s.vehicles.some((v) => v.id === riding)).toBe(true)
    expect(specials(s)).toHaveLength(2)
  })

  it('目の前が建物なら、建物にかからない場所（近くの車道）に出す', () => {
    // 建物のすぐ手前で、壁を向いて立つ
    let found: { x: number; z: number; heading: number } | null = null
    for (let x = -200; x <= 200 && !found; x += 7) {
      for (let z = -200; z <= 200 && !found; z += 7) {
        if (world.insideBuilding(x, z)) continue
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          if (world.insideBuilding(x + Math.sin(heading) * 6, z - Math.cos(heading) * 6)) found = { x, z, heading }
        }
      }
    }
    expect(found).not.toBeNull()
    const spot = specialSpot(world, 'tank', found!)
    const half = VEHICLE_SPECS.tank.length / 2
    for (const fw of [-half, 0, half]) expect(world.insideBuilding(spot.x + Math.sin(spot.heading) * fw, spot.z - Math.cos(spot.heading) * fw)).toBe(false)
  })
})

describe('gto cheats: 乗り降り（ドアの演技なし）', () => {
  const inTank = () => step(step(start(), { cheat: 'tank' }), { enter: true })

  it('乗るボタンの 1 歩で運転席に入り、すぐ動かせる', () => {
    const s = inTank()
    expect(s.mode).toBe('drive')
    expect(s.player.boarding ?? null).toBeNull()
    expect(mine(s)?.kind).toBe('tank')
    expect(mine(s)?.driver).toBe('player')
    expect(viewOf(s).ride).toBe('tank')
    const moved = run(s, 1.5, { moveY: 1 })
    expect(moved.player.speed).toBeGreaterThan(3)
  })

  it('ほぼ止まっていれば、その 1 歩で車体の横に降りる', () => {
    const s = step(run(inTank(), 0.3), { enter: true })
    expect(s.mode).toBe('foot')
    expect(s.player.vehicleId).toBeNull()
    const tank = specials(s)[0]
    expect(tank.driver).toBe('none')
    expect(world.insideBuilding(s.player.x, s.player.z)).toBe(false)
    expect(Math.hypot(s.player.x - tank.x, s.player.z - tank.z)).toBeGreaterThan(VEHICLE_SPECS.tank.width / 2)
  })

  it('走っているあいだは降りられない', () => {
    const moving = run(inTank(), 2, { moveY: 1 })
    expect(Math.abs(moving.player.speed)).toBeGreaterThan(2)
    expect(step(moving, { enter: true, moveY: 1 }).mode).toBe('drive')
  })

  it('飛んでいる飛行機からは降りられず、飛んでいる飛行機には乗れない', () => {
    let s = step(step(start(), { cheat: 'plane' }), { enter: true })
    const id = s.player.vehicleId
    // 空へ上げる（地図の建物に関係なく確かめるため、状態を直接置く）
    const lift = (v: VehicleState): VehicleState => (v.id === id ? { ...v, alt: 200, y: v.y + 200, speed: 0.5, climb: 0 } : v)
    s = { ...s, vehicles: s.vehicles.map(lift) }
    const still = step(s, { enter: true })
    expect(still.mode).toBe('drive')
    expect(viewOf(still).altitude).toBeGreaterThan(150)
    const loose = { ...s, mode: 'foot' as const, player: { ...s.player, vehicleId: null }, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, driver: 'none' as const } : v)) }
    expect(findEnterable(loose.player, loose.vehicles)?.id).not.toBe(id)
  })
})

describe('gto cheats: 戦車の走り', () => {
  const flat = { groundY: () => 0, resolveCircle: (x: number, z: number) => ({ x, z, hit: false, nx: 0, nz: 0 }) } as unknown as GtoWorld
  const tank = (over: Partial<VehicleState> = {}): VehicleState => ({ ...createVehicle(1, 'tank', 0, 0, 0, flat), ...over })
  const drive = (v0: VehicleState, control: Partial<{ throttle: number; brake: number; steer: number }>, seconds: number) => {
    let v = v0
    for (let i = 0; i < Math.round(seconds / DT); i++) v = stepVehicle(v, { throttle: 0, brake: 0, steer: 0, handbrake: false, ...control }, flat, DT).vehicle
    return v
  }

  it('止まったまま、その場で向きを変えられる', () => {
    const v = drive(tank(), { steer: 1 }, 2)
    expect(v.heading).toBeGreaterThan(1.5)
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.5)
  })

  it('遅くて、横へは滑らない', () => {
    const v = drive(tank(), { throttle: 1 }, 10)
    expect(v.speed).toBeLessThanOrEqual(VEHICLE_SPECS.tank.maxSpeed)
    expect(v.speed).toBeGreaterThan(VEHICLE_SPECS.tank.maxSpeed * 0.8)
    expect(VEHICLE_SPECS.tank.maxSpeed).toBeLessThan(VEHICLE_SPECS.kei.maxSpeed)
    const turned = drive(v, { throttle: 1, steer: 1 }, 1.5)
    expect(Math.abs(turned.slip)).toBeLessThan(1)
  })

  it('ぶつけた車を押しのけ、自分はほとんど減速せず、凹まない', () => {
    const me = tank({ speed: 10 })
    const other: VehicleState = { ...createVehicle(2, 'sedan', 0, -(VEHICLE_SPECS.tank.length / 2 + VEHICLE_SPECS.sedan.length / 2 - 0.4), 0, flat) }
    const hit = collideVehicles(me, other)
    expect(hit).not.toBeNull()
    expect(hit!.a.speed).toBeGreaterThan(9)
    expect(hit!.b.speed).toBeGreaterThan(8)
    expect(hit!.a.dents).toBeUndefined()
    expect(hit!.a.damage ?? 0).toBe(0)
    expect((hit!.b.damage ?? 0) > 0).toBe(true)
  })

  it('戦車と飛行機は「ふつうの車」ではない（専用の形で描く）', () => {
    expect(isSpecial('tank') && isSpecial('plane')).toBe(true)
    expect(isCar('tank') || isCar('plane')).toBe(false)
    expect(isCar('sedan') && !isSpecial('sedan')).toBe(true)
  })
})

describe('gto cheats: 飛行機で街を飛ぶ', () => {
  it('出して乗り、空へ上げると、主人公とカメラが高さに付いてくる。地上の車には当たらない', () => {
    let s = step(step(start(), { cheat: 'plane' }), { enter: true })
    const id = s.player.vehicleId
    s = { ...s, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, alt: 240, y: v.y + 240, speed: 30, climb: 0 } : v)) }
    const ground = world.groundY(s.player.x, s.player.z)
    s = run(s, 3, { moveY: 1 })
    const plane = mine(s)!
    expect(flying(plane)).toBe(true)
    expect(plane.alt).toBeGreaterThan(200)
    expect(s.player.y).toBeCloseTo(plane.y, 6)
    expect(s.camera.y).toBeGreaterThan(ground + 200)
    expect(s.events.filter((e) => e.type === 'crash')).toEqual([])
  })

  it('サイドブレーキのボタンで上昇、走る・警笛のボタンで下降。警笛は鳴らない', () => {
    let s = step(step(start(), { cheat: 'plane' }), { enter: true })
    const id = s.player.vehicleId
    s = { ...s, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, alt: 240, y: v.y + 240, speed: 35, climb: 0 } : v)) }
    const up = run(s, 1.5, { moveY: 1, handbrake: true })
    const down = run(s, 1.5, { moveY: 1, horn: true })
    const down2 = run(s, 1.5, { moveY: 1, run: true })
    expect(mine(up)!.alt!).toBeGreaterThan(245)
    expect(mine(down)!.alt!).toBeLessThan(235)
    expect(mine(down2)!.alt!).toBeLessThan(235)
    let honked = false
    let t = s
    for (let i = 0; i < 60; i++) {
      t = step(t, { moveY: 1, horn: true })
      if (t.events.some((e) => e.type === 'horn')) honked = true
    }
    expect(honked).toBe(false)
  })

  it('カメラ: 飛んでいるあいだは足元の建物に寄せられず、大きな乗り物は引いて撮る', () => {
    const base = { x: 0, y: 100, z: 0, heading: 0, speed: 30, mode: 'drive' as const }
    const walled = { ...world, segmentClear: () => 0, insideBuilding: () => true } as GtoWorld
    const settle = (target: Parameters<typeof stepCamera>[1]) => {
      let cam = createCamera(target)
      for (let i = 0; i < 240; i++) cam = stepCamera(cam, target, input(), walled, DT)
      return cam.dist
    }
    const squeezed = settle(base)
    const free = settle({ ...base, air: true, reach: 1.8 })
    expect(free).toBeGreaterThan(squeezed * 2)
    expect(free).toBeGreaterThan(settle({ ...base, air: true }) * 1.5)
    // 乗っている乗り物から、引きと「空」を決める
    let s = step(step(start(), { cheat: 'plane' }), { enter: true })
    expect(cameraSubject(s.player, s.mode, s.vehicles).reach).toBeGreaterThan(1)
    expect(cameraSubject(s.player, s.mode, s.vehicles).air).toBeUndefined()
    const id = s.player.vehicleId
    s = { ...s, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, alt: 50, y: v.y + 50 } : v)) }
    expect(cameraSubject(s.player, s.mode, s.vehicles).air).toBe(true)
    expect(cameraSubject(s.player, s.mode, s.vehicles).y).toBeCloseTo(mine(s)!.y, 6)
  })
})

describe('gto cheats: 操作の案内', () => {
  const hud = (s: GtoState) => hudModel(s, world, { ...viewOf(s), clock: '13:20' })

  it('HUD: 飛行機は上昇・下降のキーを出し、飛んでいるあいだは高さを出して「降りる」を出さない', () => {
    let s = step(step(start(), { cheat: 'plane' }), { enter: true })
    expect(hud(s).prompts.map((p) => p.label)).toEqual(['上昇', '下降', '降りる'])
    expect(hud(s).altitude).toBeNull()
    const id = s.player.vehicleId
    s = { ...s, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, alt: 120.4, y: v.y + 120.4 } : v)) }
    expect(hud(s).prompts.map((p) => p.label)).toEqual(['上昇', '下降'])
    expect(hud(s).altitude).toBe(120)
  })

  it('HUD: 戦車は、ほぼ止まっているときだけ「降りる」を出す', () => {
    const s = step(step(start(), { cheat: 'tank' }), { enter: true })
    expect(hud(s).prompts.map((p) => p.label)).toEqual(['降りる'])
    const moving = run(s, 2, { moveY: 1 })
    expect(hud(moving).prompts).toEqual([])
  })

  it('タッチ: 飛行機は、サイドブレーキと警笛のボタンが「上昇」「下降」になり、止まっていても出る', () => {
    expect(touchCaption('handbrake', true)).toBe('上昇')
    expect(touchCaption('horn', true)).toBe('下降')
    expect(touchCaption('gas', true)).toBe('アクセル')
    expect(touchCaption('handbrake')).toBe('サイドブレーキ')
    expect(Object.keys(FLIGHT_CAPTION).sort()).toEqual(['handbrake', 'horn'])
    const base = { canEnter: false, canSteal: false }
    const ids = (ctx: Parameters<typeof visibleTouchButtons>[1]) => visibleTouchButtons('drive', ctx).map((b) => b.id)
    expect(ids({ ...base, speed: 0, plane: true })).toEqual(['gas', 'brake', 'handbrake', 'horn', 'exit'])
    expect(ids({ ...base, speed: 30, plane: true, airborne: true })).toEqual(['gas', 'brake', 'handbrake', 'horn'])
    // 飛んでいるあいだは、遅くても「降りる」を出さない
    expect(ids({ ...base, speed: 1, plane: true, airborne: true })).not.toContain('exit')
    // ふつうの車は変わらない
    expect(ids({ ...base, speed: 0 })).toEqual(['gas', 'brake', 'horn', 'exit'])
  })

  it('タッチ: 飛行機の案内は、地上と空で替わる', () => {
    const base = { canEnter: false, canSteal: false, outfits: 0 }
    const ground = touchHint('drive', { ...base, speed: 0, plane: true }, 0)
    const air = touchHint('drive', { ...base, speed: 30, plane: true, airborne: true }, 0)
    expect(ground.id).toMatch(/^plane-/)
    expect(air.id).toMatch(/^plane-/)
    expect(air.id).not.toBe(ground.id)
    expect(touchHint('drive', { ...base, speed: 0 }, 0).id).toBe('drive-stopped')
  })
})
