// ミニマップの導出（lib/gto/minimap.ts）のテスト。
import { describe, expect, it } from 'vitest'
import {
  MINIMAP_TUNING,
  clampToDial,
  thinBlips,
  minimapLayers,
  minimapModel,
  minimapRange,
  minimapRoute,
  minimapRouteFor,
  minimapSize,
  routeStale,
} from '../minimap'
import { dirOf } from '../math'
import type { Marker } from '../types'
import { start, world } from './helpers'

const goalAt = (x: number, z: number): Marker => ({ x, z, kind: 'goal', radius: 6, ref: 'm' })

describe('minimapLayers', () => {
  const layers = minimapLayers(world)

  it('トンネルと階段は描かず、道を太さの段に分ける', () => {
    expect(layers.roads.length).toBeGreaterThan(200)
    const tiers = new Set(layers.roads.map((r) => r.tier))
    expect(tiers).toEqual(new Set(['walk', 'minor', 'major', 'elevated']))
    const hidden = world.map.roads.filter((r) => r.tunnel || r.kind === 'steps').length
    expect(layers.roads.length).toBeLessThanOrEqual(world.map.roads.length - hidden)
  })

  it('建物は輪郭だけを持ち、実名を持ち出さない', () => {
    expect(layers.buildings.length).toBeGreaterThan(500)
    for (const b of layers.buildings.slice(0, 50)) {
      expect(Object.keys(b).sort()).toEqual(['pts', 'tall'])
      expect(b.pts.length).toBeGreaterThanOrEqual(6)
    }
  })

  it('線路と範囲を持つ', () => {
    expect(layers.rails.length).toBeGreaterThan(0)
    expect(layers.bounds).toEqual(world.bounds)
  })
})

describe('clampToDial', () => {
  it('内側の点はそのまま', () => {
    expect(clampToDial(0.2, -0.3)).toEqual({ u: 0.2, v: -0.3, edge: false })
  })
  it('外の点は向きを保ったまま円の縁へ寄せる', () => {
    const p = clampToDial(3, 1.5)
    expect(p.edge).toBe(true)
    expect(Math.hypot(p.u, p.v)).toBeCloseTo(MINIMAP_TUNING.rim)
    expect(p.v / p.u).toBeCloseTo(0.5)
  })
  it('半径を指定すれば、その円（縁取りの上）に置く', () => {
    const p = clampToDial(-5, 5, 0, 0, 1)
    expect(Math.hypot(p.u, p.v)).toBeCloseTo(1)
    expect(p.u).toBeCloseTo(-p.v)
  })
})

describe('clampToDial（主人公の位置から）', () => {
  it('主人公から見た向きを保ったまま縁へ寄せる', () => {
    const o = MINIMAP_TUNING.anchor
    const rim = MINIMAP_TUNING.rim
    // 真後ろ → 円のいちばん下、真右 → 主人公と同じ高さの円周
    const back = clampToDial(0, o - 5, 0, o)
    expect(back.u).toBeCloseTo(0)
    expect(back.v).toBeCloseTo(-rim)
    const right = clampToDial(7, o, 0, o)
    expect(right.u).toBeCloseTo(Math.sqrt(rim * rim - o * o))
    expect(right.v).toBeCloseTo(o)
    // 右後ろ 45° は、主人公から 45° の線の上で、円周に乗る
    const p = clampToDial(4, o - 4, 0, o)
    expect(p.u).toBeCloseTo(-(p.v - o))
    expect(Math.hypot(p.u, p.v)).toBeCloseTo(rim)
  })
})

describe('minimapRange', () => {
  it('徒歩より車が広く、速いほど広い（上限あり）', () => {
    const foot = minimapRange('foot', 0)
    const slow = minimapRange('drive', 0)
    const fast = minimapRange('drive', 20)
    expect(slow).toBeGreaterThan(foot)
    expect(fast).toBeGreaterThan(slow)
    expect(minimapRange('drive', 500)).toBe(minimapRange('drive', 60))
  })
})

describe('minimapModel', () => {
  const state = start()
  const f = dirOf(state.camera.yaw)
  const range = minimapRange(state.mode, state.player.speed)

  it('主人公は中心より少し下に置く（前を広く見せる）', () => {
    const m = minimapModel(state, [])
    const me = m.blips.find((b) => b.kind === 'player')
    expect(me).toMatchObject({ u: 0, v: MINIMAP_TUNING.anchor, edge: false })
    expect(m.range).toBe(range)
    expect(m.yaw).toBe(state.camera.yaw)
  })

  it('カメラの前にある目的地は上に出る', () => {
    const m = minimapModel(state, [goalAt(state.player.x + f.x * 30, state.player.z + f.z * 30)])
    const goal = m.blips.find((b) => b.kind === 'goal')
    expect(goal?.u).toBeCloseTo(0)
    expect(goal?.v).toBeCloseTo(MINIMAP_TUNING.anchor + 30 / range)
    expect(goal?.edge).toBe(false)
    expect(goal?.dist).toBeCloseTo(30)
  })

  it('右にある目的地は右に出る', () => {
    const m = minimapModel(state, [goalAt(state.player.x - f.z * 20, state.player.z + f.x * 20)])
    const goal = m.blips.find((b) => b.kind === 'goal')
    expect(goal?.u).toBeCloseTo(20 / range)
  })

  it('遠い目的地は縁に張り付き、向きが分かる', () => {
    const m = minimapModel(state, [goalAt(state.player.x + f.x * 900, state.player.z + f.z * 900)])
    const goal = m.blips.find((b) => b.kind === 'goal')
    expect(goal?.edge).toBe(true)
    expect(goal?.v).toBeCloseTo(MINIMAP_TUNING.rim)
    expect(goal?.rot).toBeCloseTo(0)
  })

  it('追っ手（警察の車）だけを赤い点にし、主人公を最後に描く', () => {
    const cop = { ...state.vehicles[0], id: 9001, driver: 'police' as const, x: state.player.x + 10, z: state.player.z }
    const m = minimapModel({ ...state, vehicles: [...state.vehicles, cop] }, [])
    expect(m.blips.filter((b) => b.kind === 'police')).toHaveLength(1)
    expect(m.blips[m.blips.length - 1].kind).toBe('player')
  })

  it('開始地点は、いちばん近い1つだけを出す（印を増やさない）', () => {
    const at = (d: number): Marker => ({ x: state.player.x + d, z: state.player.z, kind: 'start', radius: 6, ref: `s${d}` })
    const m = minimapModel(state, [at(900), at(400), at(20), at(700)])
    const starts = m.blips.filter((b) => b.kind === 'start')
    expect(starts.map((b) => Math.round(b.dist))).toEqual([20])
  })

  it('目的地があるあいだは、開始地点を出さない', () => {
    const begin: Marker = { x: state.player.x + 20, z: state.player.z, kind: 'start', radius: 6, ref: 's' }
    const m = minimapModel(state, [begin, goalAt(state.player.x + f.x * 30, state.player.z + f.z * 30)])
    expect(m.blips.map((b) => b.kind)).toEqual(['goal', 'player'])
  })

  it('向かう先は、枠の中にあっても縁の札（pin）で方角を示す', () => {
    // 右へ 20m（枠の中）
    const m = minimapModel(state, [goalAt(state.player.x - f.z * 20, state.player.z + f.x * 20)])
    const goal = m.blips.find((b) => b.kind === 'goal')
    expect(goal?.edge).toBe(false)
    // 札は縁取りの上（半径 1 の円周）に乗る
    expect(Math.hypot(goal?.pin?.u ?? 0, goal?.pin?.v ?? 0)).toBeCloseTo(1)
    expect(goal?.pin?.u).toBeGreaterThan(0.9)
    expect(goal?.pin?.v).toBeCloseTo(MINIMAP_TUNING.anchor)
    expect(goal?.pin?.rot).toBeCloseTo(Math.PI / 2)
    // 遠くても同じ縁の位置
    const far = minimapModel(state, [goalAt(state.player.x - f.z * 900, state.player.z + f.x * 900)])
    const farGoal = far.blips.find((b) => b.kind === 'goal')
    expect(farGoal?.pin?.u).toBeCloseTo(goal?.pin?.u ?? 0)
    expect(farGoal?.pin?.v).toBeCloseTo(goal?.pin?.v ?? 0)
  })

  it('真上に立ったら、札は上に置く（向きが決まらないので）', () => {
    const m = minimapModel(state, [goalAt(state.player.x, state.player.z)])
    const goal = m.blips.find((b) => b.kind === 'goal')
    expect(goal?.pin?.rot).toBeCloseTo(0)
    expect(goal?.pin?.v).toBeCloseTo(1)
  })

  it('見回り（threat）は向かう先にせず、枠の中にいるときだけ赤い点にする', () => {
    const guard = (d: number): Marker => ({ x: state.player.x + f.x * d, z: state.player.z + f.z * d, kind: 'start', radius: 8, ref: `g${d}`, threat: true })
    const m = minimapModel(state, [guard(25), guard(900)])
    expect(m.blips.some((b) => b.kind === 'start')).toBe(false)
    const red = m.blips.filter((b) => b.kind === 'police')
    expect(red).toHaveLength(1)
    expect(red[0].edge).toBe(false)
    expect(red[0].pin).toBeUndefined()
  })

  it('追っ手は近い順に数を絞り、重なる点は1つにまとめる', () => {
    const car = state.vehicles[0]
    const cop = (id: number, dx: number, dz: number) => ({ ...car, id, driver: 'police' as const, x: state.player.x + dx, z: state.player.z + dz })
    // 同じ交差点に固まった4台 → 1つ
    const bunch = [cop(1, 30, 0), cop(2, 32, 2), cop(3, 31, -2), cop(4, 29, 1)]
    const one = minimapModel({ ...state, vehicles: bunch }, [])
    expect(one.blips.filter((b) => b.kind === 'police')).toHaveLength(1)
    expect(one.blips.find((b) => b.kind === 'police')?.dist).toBeCloseTo(29.02, 1)
    // ばらけた8台 → 上限まで
    const spread = Array.from({ length: 8 }, (_, i) => cop(10 + i, Math.cos(i * 0.8) * (25 + i * 6), Math.sin(i * 0.8) * (25 + i * 6)))
    const many = minimapModel({ ...state, vehicles: spread }, [])
    const red = many.blips.filter((b) => b.kind === 'police')
    expect(red).toHaveLength(MINIMAP_TUNING.maxPolice)
    expect(Math.max(...red.map((b) => b.dist))).toBeLessThan(25 + 5 * 6)
  })

  it('徒歩の警官も追っ手として出す', () => {
    const cop = { ...state.peds[0], id: 9002, cop: true as const, x: state.player.x, z: state.player.z - 12 }
    const m = minimapModel({ ...state, peds: [...state.peds, cop] }, [])
    expect(m.blips.filter((b) => b.kind === 'police')).toHaveLength(1)
  })

  it('北の印は縁の上を回る', () => {
    const m = minimapModel({ ...state, camera: { ...state.camera, yaw: Math.PI / 2 } }, [])
    // 東を向いているとき、北は左
    // 縁取りの上（半径 1）に乗る
    expect(m.north.u).toBeCloseTo(-1)
    expect(Math.abs(m.north.v)).toBeLessThan(0.01)
  })
})

describe('thinBlips', () => {
  const dot = (u: number, v: number, dist: number) => ({ kind: 'police' as const, u, v, edge: false, rot: 0, dist })
  it('近い順に残し、すでに残した点のそばの点は捨てる', () => {
    const kept = thinBlips([dot(0.5, 0.5, 40), dot(0.52, 0.5, 30), dot(-0.5, 0, 50), dot(0, 0.9, 80)], 0.2, 2)
    expect(kept.map((b) => b.dist)).toEqual([30, 50])
  })
  it('元の配列は変えない', () => {
    const src = [dot(0, 0, 9), dot(0.5, 0, 3)]
    thinBlips(src, 0.2, 5)
    expect(src.map((b) => b.dist)).toEqual([9, 3])
  })
})

describe('minimapRoute', () => {
  const a = world.spot('scramble')!
  const b = world.spot('miyamasuzaka-top')!

  it('道に沿った折れ線を返す（始点と終点はそのまま）', () => {
    const route = minimapRoute(world.driveGraph, a.x, a.z, b.x, b.z)
    expect(route).not.toBeNull()
    const pts = route!.pts
    expect(pts.slice(0, 2)).toEqual([a.x, a.z])
    expect(pts.slice(-2)).toEqual([b.x, b.z])
    const straight = Math.hypot(b.x - a.x, b.z - a.z)
    expect(route!.length).toBeGreaterThanOrEqual(straight - 1e-6)
    expect(route!.length).toBeLessThan(straight * 2.5)
  })

  it('徒歩でも、目的地の近くまで届く道筋が引ける', () => {
    const route = minimapRouteFor(world, 'foot', a.x, a.z, b.x, b.z)
    expect(route).not.toBeNull()
    expect(route!.gap).toBeLessThan(60)
    expect(minimapRouteFor(world, 'drive', a.x, a.z, b.x, b.z)?.gap).toBeLessThan(60)
  })

  it('すぐ近くなら引かない', () => {
    expect(minimapRoute(world.driveGraph, a.x, a.z, a.x + 3, a.z + 3)).toBeNull()
  })

  it('道が無ければ null', () => {
    expect(minimapRoute({ nodes: [], edges: [] }, 0, 0, 100, 100)).toBeNull()
  })
})

describe('routeStale / minimapSize', () => {
  it('動いたか、目的地が変わったら引き直す', () => {
    const last = { ax: 0, az: 0, bx: 100, bz: 0 }
    expect(routeStale(null, 0, 0, 100, 0)).toBe(true)
    expect(routeStale(last, 3, 0, 100, 0)).toBe(false)
    expect(routeStale(last, 20, 0, 100, 0)).toBe(true)
    expect(routeStale(last, 0, 0, 120, 0)).toBe(true)
  })
  it('画面の短い辺に合わせ、スマホでは小さく止める', () => {
    expect(minimapSize(1280, 720, false)).toBe(194)
    expect(minimapSize(3840, 2160, false)).toBe(236)
    expect(minimapSize(390, 844, true)).toBe(117)
    expect(minimapSize(844, 390, true)).toBe(117)
  })
})
