import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { hudModel } from '../hud'
import { NO_INPUT } from '../input'
import { minimapModel, minimapRoads } from '../minimap'
import { stepGto, viewOf } from '../sim'
import type { GtoState } from '../types'
import { allowLongSimulations, cfg, DT, run, start, world } from './helpers'

allowLongSimulations()

/** デモのシナリオを seconds 秒ぶん再生する */
function play(name: string, seconds: number): { state: GtoState; seen: Set<string> } {
  const demo = DEMOS[name]
  let s = start({ mode: demo.mode, stage: demo.stage, start: demo.spot ? spotStart(demo.spot) : null })
  const seen = new Set<string>()
  for (let i = 0; i < seconds / DT; i++) {
    const goal = viewOf(s).markers[0] ?? null
    // [missions] engine.ts と同じく、車道に沿って走るデモのために、いまいる道と向きも渡す
    const near = s.mode === 'drive' ? world.nearestRoad(s.player.x, s.player.z, true, 30) : null
    const road = near ? { x: near.x, z: near.z, heading: near.heading } : null
    const view = { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal, heading: s.player.heading, road, speed: s.player.speed }
    s = stepGto(s, demoInput(demo, s.t, DT, view), world, cfg, DT)
    for (const e of s.events) seen.add(e.type)
  }
  return { state: s, seen }
}
const spotStart = (key: string) => {
  const spot = world.spot(key)
  if (!spot) throw new Error(key)
  return { x: spot.x, z: spot.z, heading: ((spot.heading ?? 0) * Math.PI) / 180 }
}

describe('gto sim: 全部品の統合', () => {
  it('同じ種と入力なら、同じ結果になる', () => {
    const a = run(start({ seed: 5 }), 3, { moveY: 1 })
    const b = run(start({ seed: 5 }), 3, { moveY: 1 })
    expect(a).toEqual(b)
    expect(run(start({ seed: 6 }), 3, { moveY: 1 }).peds).not.toEqual(a.peds)
  })

  it('状態を書き換えずに、新しい状態を返す', () => {
    const s0 = start()
    const frozen = JSON.stringify(s0)
    const s1 = stepGto(s0, { ...NO_INPUT, moveY: 1 }, world, cfg, DT)
    expect(JSON.stringify(s0)).toBe(frozen)
    expect(s1).not.toBe(s0)
    expect(s1.frame).toBe(1)
  })

  it('歩きで始めると駅前の建物の外に立ち、交通と歩行者がいる', () => {
    const s = start()
    expect(s.mode).toBe('foot')
    expect(world.insideBuilding(s.player.x, s.player.z)).toBe(false)
    expect(s.vehicles.filter((v) => v.driver === 'traffic').length).toBeGreaterThan(4)
    expect(s.peds.length).toBeGreaterThan(6)
    expect(cfg.outfitKeys).toContain(s.outfit.wearing)
  })

  it('歩くと進み、背後カメラが付いてくる', () => {
    const s0 = start()
    const s1 = run(s0, 3, { moveY: 1 })
    const moved = Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z)
    expect(moved).toBeGreaterThan(3)
    const camDist = Math.hypot(s1.camera.x - s1.player.x, s1.camera.z - s1.player.z)
    expect(camDist).toBeGreaterThan(1)
    expect(camDist).toBeLessThan(7)
  })

  it('車で始めると車道の上にいて、アクセルで走る', () => {
    const s0 = start({ mode: 'drive', start: spotStart('miyamasuzaka-bottom') })
    expect(s0.player.vehicleId).not.toBeNull()
    expect(world.nearestRoad(s0.player.x, s0.player.z, true)?.dist).toBeLessThan(3)
    const s1 = run(s0, 4, { moveY: 1 })
    expect(s1.player.speed).toBeGreaterThan(8)
    expect(Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z)).toBeGreaterThan(20)
    expect(hudModel(s1, world, { ...viewOf(s1), clock: '' }).speedKmh).toBeGreaterThan(30)
  })

  it('交通の車は車道から外れずに走り続ける', () => {
    const s = run(start({ seed: 3 }), 20)
    const traffic = s.vehicles.filter((v) => v.driver === 'traffic')
    expect(traffic.length).toBeGreaterThan(4)
    for (const v of traffic) expect(world.nearestRoad(v.x, v.z, true, 40)?.dist ?? 99).toBeLessThan(9)
    expect(traffic.some((v) => v.speed > 2)).toBe(true)
  })

  it('デモ: 乗って走って降りる', () => {
    const { state, seen } = play('enter-exit', 11)
    expect(seen.has('enter')).toBe(true)
    expect(seen.has('exit')).toBe(true)
    expect(state.mode).toBe('foot')
  })

  it('デモ: 服を奪うと着替えて、手配される', () => {
    const before = start({ mode: 'foot', stage: DEMOS.steal.stage })
    const { state, seen } = play('steal', 4)
    expect(seen.has('steal')).toBe(true)
    expect(state.outfit.wearing).not.toBe(before.outfit.wearing)
    expect(state.outfit.wardrobe).toContain(before.outfit.wearing)
    expect(seen.has('wantedUp')).toBe(true)
  })

  it('デモ: 手配されると警察車両が出て追ってくる', () => {
    const { state } = play('chase', 12)
    const police = state.vehicles.filter((v) => v.driver === 'police')
    expect(police.length).toBeGreaterThan(0)
    expect(minimapModel(state, []).blips.some((b) => b.kind === 'police')).toBe(true)
  })

  it('デモ: ミッションを開始から達成まで通せる', () => {
    const { state, seen } = play('mission', 40)
    expect(seen.has('missionStep')).toBe(true)
    expect(seen.has('missionDone')).toBe(true)
    expect(state.mission.done).toContain('first-fit')
    expect(state.cash).toBeGreaterThan(1000)
  })

  it('すべてのデモが最後まで落ちずに回る', () => {
    for (const name of Object.keys(DEMOS)) {
      const { state } = play(name, 6)
      expect(Number.isFinite(state.player.x) && Number.isFinite(state.camera.y), name).toBe(true)
    }
  })

  it('HUD とミニマップは状態から導出できる', () => {
    const s = start()
    const hud = hudModel(s, world, { ...viewOf(s), clock: '13:20' })
    expect(hud.cash).toBe('¥1,000')
    expect(hud.speedKmh).toBeNull()
    expect(hud.wanted).toBe(0)
    const map = minimapModel(s, viewOf(s).markers)
    expect(map.blips.at(-1)?.kind).toBe('player')
    // ミニマップは値札の形（四角）なので、縦横それぞれが枠の内側にあること
    for (const b of map.blips) expect(Math.max(Math.abs(b.u), Math.abs(b.v))).toBeLessThanOrEqual(1)
    expect(minimapRoads(world).length).toBeGreaterThan(500)
  })
})
