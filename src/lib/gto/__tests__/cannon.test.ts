// [部品: cheats] 戦車の砲（cannon.ts）。弾の着く場所、爆風で車が突き飛ばされて壊れること、街の中での撃ち方を確かめる。
import { describe, expect, it } from 'vitest'
import { aimShot, blastVehicle, canFire, CANNON_TUNING, muzzleOf } from '../cannon'
import { hudModel } from '../hud'
import { TANK_CAPTION, touchCaption, touchHint, visibleTouchButtons } from '../input'
import { stepGto, viewOf } from '../sim'
import { createVehicle, isSpecial, VEHICLE_SPECS } from '../vehicle'
import { damageStage } from '../vehicleDamage'
import type { GtoState, GtoWorld, InputFrame, VehicleState } from '../types'
import { allowLongSimulations, cfg, DT, input, run, start, world } from './helpers'

allowLongSimulations()

const T = CANNON_TUNING
/** 平らな世界。wallZ があれば、z がそれより北（小さい）側は建物 */
const flatWorld = (wallZ = -Infinity): GtoWorld =>
  ({
    groundY: () => 0,
    resolveCircle: (x: number, z: number) => ({ x, z, hit: false, nx: 0, nz: 0 }),
    segmentClear: (_ax: number, az: number, _bx: number, bz: number) => (bz >= wallZ ? 1 : Math.max(0, Math.min(1, (az - wallZ) / (az - bz)))),
  }) as unknown as GtoWorld
const open = flatWorld()
/** 原点で北（−z）を向いた戦車 */
const tank = (over: Partial<VehicleState> = {}): VehicleState => ({ ...createVehicle(1, 'tank', 0, 0, 0, open), ...over })
const car = (id: number, x: number, z: number, over: Partial<VehicleState> = {}): VehicleState => ({ ...createVehicle(id, 'sedan', x, z, 0, open), ...over })

describe('gto cannon: 弾の着く場所', () => {
  it('砲口は車体の前。何にも当たらなければ、射程の先で弾ける', () => {
    expect(muzzleOf(tank())).toEqual({ x: 0, z: -T.muzzleAhead })
    const shot = aimShot(open, tank(), [])
    expect(shot.hitId).toBeNull()
    expect(shot.dist).toBeCloseTo(T.range, 6)
    expect(shot.to.z).toBeCloseTo(-(T.muzzleAhead + T.range), 6)
    expect(shot.to.x).toBeCloseTo(0, 6)
  })

  it('まっすぐ先の壁で弾ける', () => {
    const shot = aimShot(flatWorld(-40), tank(), [])
    expect(shot.hitId).toBeNull()
    expect(shot.to.z).toBeCloseTo(-40, 1)
  })

  it('壁より手前に車がいれば、その車に当たる（射線から外れた車・後ろの車には当たらない）', () => {
    const ahead = car(2, 0.5, -25)
    const beside = car(3, 9, -15)
    const behind = car(4, 0, 20)
    const shot = aimShot(flatWorld(-40), tank(), [ahead, beside, behind])
    expect(shot.hitId).toBe(2)
    expect(shot.to.z).toBeGreaterThan(-25)
    expect(shot.to.z).toBeLessThan(-20)
  })

  it('車が 2 台並んでいれば、手前の車に当たる', () => {
    expect(aimShot(open, tank(), [car(2, 0, -60), car(3, 0, -30)]).hitId).toBe(3)
  })

  it('頭の上を飛んでいる飛行機には当たらない', () => {
    const plane: VehicleState = { ...createVehicle(5, 'plane', 0, -30, 0, open), alt: 40, y: 40 }
    expect(aimShot(open, tank(), [plane]).hitId).toBeNull()
  })

  it('撃てるのは戦車だけで、弾込めが済んでいるとき', () => {
    expect(canFire(tank())).toBe(true)
    expect(canFire(tank({ reload: 0.4 }))).toBe(false)
    expect(canFire(car(2, 0, 0))).toBe(false)
  })
})

describe('gto cannon: 爆風', () => {
  const at = { x: 0, z: -30 }
  const away = { x: 0, z: -1 }

  it('直に当たった車は、弾の飛んできた向きへ突き飛ばされ、黒煙を吐く。2 発で炎', () => {
    const hit = blastVehicle(car(2, 0, -30.2), at, true, away)!
    expect(hit.speed).toBeGreaterThan(T.shove * 0.8)
    expect(damageStage(hit.damage)).toBe('black')
    expect((hit.dents ?? []).some((d) => d > 0)).toBe(true)
    expect(damageStage(blastVehicle(hit, at, true, away)!.damage)).toBe('fire')
  })

  it('近いほど強く、外へ向かって飛ばされる。半径の外には届かない', () => {
    const near = blastVehicle(car(2, 3, -30), at, false, away)!
    const far = blastVehicle(car(3, 7, -30), at, false, away)!
    // 東にいる車は東へ（北向きの車なので、右への横滑り）
    expect(near.slip).toBeGreaterThan(far.slip)
    expect(far.slip).toBeGreaterThan(0)
    expect(near.damage ?? 0).toBeGreaterThan(far.damage ?? 0)
    expect(blastVehicle(car(4, T.blast + 6, -30), at, false, away)).toBeNull()
  })

  it('重い車は動きにくく、戦車は凹まない', () => {
    const sedan = blastVehicle(car(2, 3, -30), at, false, away)!
    const van = blastVehicle({ ...car(3, 3, -30), kind: 'van' }, at, false, away)!
    expect(Math.abs(van.slip)).toBeLessThan(Math.abs(sedan.slip))
    const other = blastVehicle({ ...createVehicle(6, 'tank', 3, -30, 0, open) }, at, false, away)!
    expect(other.damage ?? 0).toBe(0)
    expect(other.dents).toBeUndefined()
    expect(Math.hypot(other.speed, other.slip)).toBeLessThan(1.5)
  })

  it('頭の上を飛んでいる飛行機には届かない', () => {
    expect(blastVehicle({ ...createVehicle(5, 'plane', 1, -30, 0, open), alt: 40, y: 40 }, at, false, away)).toBeNull()
  })
})

describe('gto cannon: 街の中で撃つ', () => {
  const step = (s: GtoState, over: Partial<InputFrame> = {}) => stepGto(s, input(over), world, cfg, DT)
  const inTank = () => step(step(start(), { cheat: 'tank' }), { enter: true })
  const mine = (s: GtoState) => s.vehicles.find((v) => v.id === s.player.vehicleId)!

  it('E（服をいただくボタン）でも警笛のボタンでも撃てる。警笛は鳴らない', () => {
    for (const press of [{ steal: true }, { horn: true }]) {
      const s = step(inTank(), press)
      expect(s.events.map((e) => e.type)).toEqual(expect.arrayContaining(['shot', 'blast']))
      expect(s.events.some((e) => e.type === 'horn')).toBe(false)
      expect(mine(s).reload).toBeCloseTo(T.reload, 6)
      expect(mine(s).shotAt?.t).toBeCloseTo(s.t, 6)
    }
  })

  it('弾は建物の中まで行かず、手前で弾ける', () => {
    const s = step(inTank(), { steal: true })
    const blast = s.events.find((e) => e.type === 'blast')!
    const shot = s.events.find((e) => e.type === 'shot')!
    const tank = mine(s)
    // 着いた場所の半歩手前は建物の外
    const back = 0.6
    expect(world.insideBuilding(blast.x - Math.sin(tank.heading) * back, blast.z + Math.cos(tank.heading) * back)).toBe(false)
    expect(Math.hypot(blast.x - shot.x, blast.z - shot.z)).toBeLessThanOrEqual(T.range + 1e-6)
  })

  it('弾込めのあいだは撃てず、押しっぱなしなら間を置いて続けて撃つ', () => {
    let s = step(inTank(), { horn: true })
    let shots = 1
    const first = mine(s).shotAt?.t
    s = step(s, { horn: true })
    expect(mine(s).shotAt?.t).toBe(first)
    for (let i = 0; i < Math.round((T.reload * 2.5) / DT); i++) {
      s = step(s, { horn: true })
      if (s.events.some((e) => e.type === 'shot')) shots++
    }
    expect(shots).toBe(3)
  })

  it('撃つと手配が付き、反動で下がる', () => {
    const before = inTank()
    const s = step(before, { steal: true })
    expect(s.wanted.level).toBeGreaterThanOrEqual(2)
    expect(mine(s).speed).toBeLessThan(0)
  })

  it('前にいる車に当たると、その車は突き飛ばされて壊れ、運転手は降りて逃げる', () => {
    const base = inTank()
    const t = mine(base)
    const f = { x: Math.sin(t.heading), z: -Math.cos(t.heading) }
    const target: VehicleState = { ...createVehicle(9001, 'sedan', t.x + f.x * 14, t.z + f.z * 14, t.heading + Math.PI / 2, world), driver: 'traffic', route: { edge: 0, s: 0, cruise: 8 } }
    const pedsBefore = base.peds.length
    const s = step({ ...base, vehicles: [...base.vehicles.filter((v) => v.id === t.id), target] }, { steal: true })
    expect(s.events.find((e) => e.type === 'blast')?.ref).toBe('9001')
    const hit = s.vehicles.find((v) => v.id === 9001)!
    expect(hit.driver).toBe('none')
    expect(hit.route).toBeNull()
    expect(hit.damage ?? 0).toBeGreaterThan(0.5)
    expect(Math.hypot(hit.x - target.x, hit.z - target.z) + Math.hypot(hit.speed, hit.slip)).toBeGreaterThan(5)
    expect(s.peds.length).toBe(pedsBefore + 1)
    expect(s.peds[s.peds.length - 1].mood).toBe('flee')
    // 戦車は無傷
    expect(mine(s).damage ?? 0).toBe(0)
  })

  it('ふつうの車と飛行機は撃てない', () => {
    const drive = run(start({ mode: 'drive' }), 0.2)
    expect(step(drive, { steal: true }).events.some((e) => e.type === 'shot')).toBe(false)
    const plane = step(step(start(), { cheat: 'plane' }), { enter: true })
    expect(isSpecial(mine(plane).kind)).toBe(true)
    expect(step(plane, { steal: true, horn: true }).events.some((e) => e.type === 'shot')).toBe(false)
  })
})

describe('gto cannon: 操作の案内', () => {
  it('HUD: 戦車は「撃つ」のキーを出す', () => {
    const s = stepGto(stepGto(start(), input({ cheat: 'tank' }), world, cfg, DT), input({ enter: true }), world, cfg, DT)
    expect(hudModel(s, world, { ...viewOf(s), clock: '13:20' }).prompts).toEqual([
      { key: 'E', label: '撃つ' },
      { key: 'F', label: '降りる' },
    ])
  })

  it('タッチ: 戦車は警笛のボタンが「撃つ」になり、案内も戦車のものになる', () => {
    expect(touchCaption('horn', 'tank')).toBe('撃つ')
    expect(touchCaption('handbrake', 'tank')).toBe('サイドブレーキ')
    expect(touchCaption('horn')).toBe('警笛')
    expect(Object.keys(TANK_CAPTION)).toEqual(['horn'])
    const base = { canEnter: false, canSteal: false }
    expect(visibleTouchButtons('drive', { ...base, speed: 0, tank: true }).map((b) => b.id)).toEqual(['gas', 'brake', 'horn', 'exit'])
    const ids = new Set(Array.from({ length: 6 }, (_, beat) => touchHint('drive', { ...base, outfits: 0, speed: 0, tank: true }, beat).id))
    expect([...ids].sort()).toEqual(['drive-stopped', 'tank-fire', 'tank-turn'])
    expect(VEHICLE_SPECS.tank.armor).toBe(true)
  })
})
