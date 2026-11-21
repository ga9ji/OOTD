import { describe, expect, it } from 'vitest'
import { AREAS, hubDistance, neonBoost } from '../areas'
import shinjukuJson from '../data/shinjukuMap.json'
import { blockStyleOf, createWorld, landmarkOf, LANDMARK_IDS, roofBoards, streetProps } from '../map'
import { KABUKICHO_ARCH, kabukichoArch, SHINJUKU_BLOCK_STYLES, SHINJUKU_MAIN_STREETS, SHINJUKU_STREET_FURNITURE } from '../mapShinjuku'
import { cumulative, dist2, pointAlong, pointInPolygon } from '../math'
import { ALL_MISSIONS, MISSIONS, missionsOf, SHINJUKU_MISSIONS, type MissionStep } from '../missionData'
import { createMissions, missionMarkers, startMission, stepMissions } from '../missions'
import { applySave, saveSummary } from '../save'
import { parseLaunch } from '../shot'
import { buildSignage } from '../signage'
import { titleCamera } from '../titleCamera'
import type { ShibuyaMap } from '../types'
import { cfg, DT, start, world as shibuya } from './helpers'

// 新宿（東口・歌舞伎町・新宿三丁目）の作り込み: 出発地点・外装・街具・門・看板・題名の画面のカメラ・依頼。
// 渋谷の cityMap.test / missions.test / titleCamera.test と同じ形で確かめる（地図そのものは areaShinjukuMap.test.ts）。

const map = shinjukuJson as unknown as ShibuyaMap
const world = createWorld(map, 'shinjuku')
const buildings = map.buildings

describe('新宿の作り込み', () => {
  it('出発地点は建物の外の広場で、壁ぎわでもない', () => {
    const { x, z } = AREAS.shinjuku.spawn
    expect(world.insideBuilding(x, z)).toBe(false)
    expect(world.resolveCircle(x, z, 0.6).hit).toBe(false)
    // 車道の上でもない（始めた途端にはねられない）
    const road = world.nearestRoad(x, z, true, 40)!
    expect(road.dist).toBeGreaterThan(map.roads[road.road].width / 2 + 1)
    expect(road.dist).toBeLessThan(40)
  })

  it('外装を決めた建物は、どれも新宿の地図にあり、渋谷の地図には無い', () => {
    const ids = Object.keys(SHINJUKU_BLOCK_STYLES).map(Number)
    expect(ids.length).toBeGreaterThanOrEqual(10)
    for (const id of ids) {
      const b = buildings.find((o) => o.id === id)
      expect(b, String(id)).toBeDefined()
      expect(landmarkOf(b!)).toBe('styled')
      expect(blockStyleOf(b!)).toBe(SHINJUKU_BLOCK_STYLES[id])
      expect(shibuya.map.buildings.some((o) => o.id === id), String(id)).toBe(false)
      expect(LANDMARK_IDS[id]).toBeUndefined()
      // 部品に分かれた建物・浮いた建物には決めない（外装を建て直すので、形が合わなくなる）
      expect(b!.part ?? b!.hasParts ?? b!.roof ?? 0, String(id)).toBe(0)
    }
  })

  it('屋上の広告塔は屋上の中に立ち、相手（広場や交差点）のほうを向く', () => {
    let boards = 0
    for (const b of buildings) {
      const style = SHINJUKU_BLOCK_STYLES[b.id]
      if (!style?.boards) continue
      const placed = roofBoards(b)
      expect(placed).toHaveLength(style.boards.length)
      placed.forEach((p, i) => {
        boards++
        expect(pointInPolygon(b.pts, p.x, p.z), `${b.id}`).toBe(true)
        const to = style.boards![i].toward
        const want = Math.atan2(to[0] - p.x, -(to[1] - p.z))
        // 板の表は、相手の方角からそう外れない（横へずらした分だけ振れる）
        expect(Math.abs(Math.atan2(Math.sin(p.heading - want), Math.cos(p.heading - want)))).toBeLessThan(0.7)
      })
    }
    expect(boards).toBeGreaterThanOrEqual(5)
  })

  it('歌舞伎町には、夜に外装ごと光る棟が 4 棟以上ある', () => {
    const lit = buildings.filter((b) => SHINJUKU_BLOCK_STYLES[b.id]?.lit)
    expect(lit.length).toBeGreaterThanOrEqual(4)
    for (const b of lit) expect(b.pts[1], String(b.id)).toBeLessThan(-150)
  })

  it('街灯と並木の決まり・広告面を付ける通りは、新宿の地図にある通り', () => {
    const names = new Set(map.roads.map((r) => r.name))
    for (const n of [...Object.keys(SHINJUKU_STREET_FURNITURE), ...SHINJUKU_MAIN_STREETS]) expect(names.has(n), n).toBe(true)
    const props = streetProps(world)
    // 歌舞伎町の通りにも街灯が並ぶ
    expect(props.filter((p) => p.kind === 'lamp-dogenzaka').length).toBeGreaterThan(10)
    expect(props.filter((p) => p.kind === 'lamp-koen').length).toBeGreaterThan(8)
    // 同じ地図なら同じ並び
    expect(streetProps(world)).toEqual(props)
  })

  it('歌舞伎町の入口の門: 靖国通りのすぐ北で、通りの奥（北）を向き、柱は壁にめり込まない。渋谷には立たない', () => {
    const gate = kabukichoArch(world)!
    expect(gate).not.toBeNull()
    expect(gate.z).toBeLessThan(-160)
    expect(gate.z).toBeGreaterThan(-185)
    // 北向き（heading 0）から 40° 以内
    expect(Math.abs(Math.atan2(Math.sin(gate.heading), Math.cos(gate.heading)))).toBeLessThan((40 * Math.PI) / 180)
    expect(gate.half).toBeGreaterThanOrEqual(KABUKICHO_ARCH.halfMin)
    expect(gate.half).toBeLessThanOrEqual(KABUKICHO_ARCH.halfMax)
    for (const side of [-1, 1]) {
      const x = gate.x + Math.cos(gate.heading) * gate.half * side
      const z = gate.z + Math.sin(gate.heading) * gate.half * side
      expect(world.insideBuilding(x, z)).toBe(false)
    }
    // 門の真ん中は通りの上（車がくぐれる）
    expect(world.nearestRoad(gate.x, gate.z, true, 5)?.dist).toBeLessThan(0.5)
    expect(kabukichoArch(shibuya)).toBeNull()
  })

  it('看板は歌舞伎町にも駅前と同じ密度で付き、ネオン文字は歌舞伎町のほうが多い', () => {
    const signs = buildSignage(world)
    expect(signs.length).toBeGreaterThan(400)
    const near = (cx: number, cz: number, r: number) => signs.filter((s) => Math.hypot(s.x - cx, s.z - cz) < r)
    const kabuki = near(20, -290, 150)
    const sanchome = near(350, 150, 150)
    expect(kabuki.length).toBeGreaterThan(80)
    const neonShare = (list: typeof signs) => list.filter((s) => s.kind === 'neon').length / Math.max(1, list.length)
    expect(neonShare(kabuki)).toBeGreaterThan(neonShare(sanchome))
    // 軽量の配置（スマホ）でも、歌舞伎町に看板が残る
    const lite = buildSignage(world, 'lite')
    expect(lite.filter((s) => Math.hypot(s.x - 20, s.z + 290) < 150).length).toBeGreaterThan(20)
  })
})

describe('新宿の題名の画面のカメラ', () => {
  const spec = AREAS.shinjuku.title
  const period = (Math.PI * 2) / spec.rate
  const samples = Array.from({ length: 41 }, (_, i) => titleCamera((i / 40) * period, spec))
  /** (x, z) から pad m 以内にある屋根のうち、いちばん高いもの（無ければ -Infinity） */
  function roofNear(x: number, z: number, pad: number): number {
    let top = -Infinity
    for (let dx = -pad; dx <= pad; dx += 4) {
      for (let dz = -pad; dz <= pad; dz += 4) {
        for (const b of buildings) if (pointInPolygon(b.pts, x + dx, z + dz)) top = Math.max(top, b.y + b.h)
      }
    }
    return top
  }

  it('決めた弧の上を往復して、もとの位置へ戻る。街の範囲の中を飛ぶ', () => {
    const start = titleCamera(0, spec)
    const back = titleCamera(period, spec)
    expect(Math.hypot(back.x - start.x, back.z - start.z)).toBeLessThan(0.01)
    for (const c of samples) {
      expect(Math.hypot(c.x - spec.cx!, c.z - spec.cz!)).toBeCloseTo(spec.radius, 6)
      expect(c.y).toBe(spec.height)
      expect([c.tx, c.tz]).toEqual([spec.cx, spec.cz])
      expect(c.x).toBeGreaterThan(world.bounds.minX)
      expect(c.x).toBeLessThan(world.bounds.maxX)
      expect(c.z).toBeGreaterThan(world.bounds.minZ)
      expect(c.z).toBeLessThan(world.bounds.maxZ)
    }
  })

  it('カメラのまわり 12m に、カメラの高さへ届く建物が無い', () => {
    for (const c of samples) expect(roofNear(c.x, c.z, 12), `(${c.x.toFixed(0)}, ${c.z.toFixed(0)})`).toBeLessThan(c.y - 6)
  })

  it('見る先（歌舞伎町の真ん中）までの見通しを、手前の建物が塞がない', () => {
    for (const c of samples) {
      for (let s = 0.05; s < 0.9; s += 0.03) {
        const x = c.x + (c.tx - c.x) * s
        const z = c.z + (c.tz - c.z) * s
        const y = c.y + (c.ty - c.y) * s
        expect(roofNear(x, z, 0), `(${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(y - 3)
      }
    }
  })
})

describe('新宿の依頼', () => {
  it('数本あり、どれにも失うものがある手順が 1 つはあり、途中でやることの種類が 2 回以上変わる', () => {
    expect(SHINJUKU_MISSIONS.length).toBeGreaterThanOrEqual(3)
    expect(SHINJUKU_MISSIONS.filter((d) => !d.after)).toHaveLength(1)
    const act = (s: MissionStep) => (s.kind === 'goto' ? (s.vehicle ? 'drive' : 'walk') : s.kind)
    for (const d of SHINJUKU_MISSIONS) {
      expect(d.reward, d.id).toBeGreaterThan(0)
      expect(d.brief.length, d.id).toBeGreaterThan(10)
      expect(d.giver.length, d.id).toBeGreaterThan(2)
      const pressured = d.steps.some((s) => s.timeLimit != null || s.kind === 'tail' || (s.kind === 'goto' && (s.guards != null || s.fragile != null || s.noHeat === true)))
      expect(pressured, d.id).toBe(true)
      const acts = d.steps.map(act)
      expect(acts.filter((a, i) => i > 0 && a !== acts[i - 1]).length, d.id).toBeGreaterThanOrEqual(2)
      expect(new Set(d.steps.map((s) => s.text)).size, d.id).toBe(d.steps.length)
    }
  })

  it('開始地点・目的地・尾行の道筋は、新宿の歩ける場所にある', () => {
    for (const d of SHINJUKU_MISSIONS) {
      expect(world.insideBuilding(d.start.x, d.start.z), `${d.id} start`).toBe(false)
      expect(world.nearestRoad(d.start.x, d.start.z, false, 30), `${d.id} start`).not.toBeNull()
      // 依頼人は車道の上に立たない
      const drive = world.nearestRoad(d.start.x, d.start.z, true, 30)
      if (drive) expect(drive.dist, `${d.id} start`).toBeGreaterThan(map.roads[drive.road].width / 2)
      for (const s of d.steps) {
        if (s.kind === 'goto') {
          expect(world.insideBuilding(s.x, s.z), `${d.id} ${s.text}`).toBe(false)
          const near = world.nearestRoad(s.x, s.z, s.vehicle === true, 30)
          expect(near, `${d.id} ${s.text}`).not.toBeNull()
          expect(near!.dist, `${d.id} ${s.text}`).toBeLessThan(s.radius)
        }
        if (s.kind === 'tail') {
          const cum = cumulative(s.path)
          const total = cum[cum.length - 1]
          expect(total).toBeGreaterThan(80)
          for (let at = 0; at <= total; at += 2) {
            const p = pointAlong(s.path, cum, at)
            expect(world.insideBuilding(p.x, p.z), `${d.id} tail ${at}`).toBe(false)
          }
          expect(Math.sqrt(dist2(d.start.x, d.start.z, s.path[0], s.path[1]))).toBeLessThan(s.far - 10)
        }
      }
    }
  })

  it('見回りの立つ場所は歩ける所で、目的地の輪とは重ならない。目的の文に条件が書いてある', () => {
    let guards = 0
    for (const d of SHINJUKU_MISSIONS) {
      for (const s of d.steps) {
        if (s.kind !== 'goto' || !s.guards) continue
        expect(s.fragile).toBeUndefined()
        expect(s.text).toContain('赤い輪')
        for (const g of s.guards) {
          guards++
          for (let i = 0; i < g.path.length; i += 2) {
            const fixed = world.resolveCircle(g.path[i], g.path[i + 1], 0.4)
            expect(Math.hypot(fixed.x - g.path[i], fixed.z - g.path[i + 1]), `${d.id} guard`).toBeLessThan(0.5)
            expect(Math.sqrt(dist2(g.path[i], g.path[i + 1], s.x, s.z))).toBeGreaterThan(g.radius + 1)
          }
        }
      }
    }
    expect(guards).toBeGreaterThan(0)
  })

  it('依頼の場所は街の範囲の中にある（範囲の端の行き止まりの外へは置かない）', () => {
    const b = world.bounds
    const inside = (x: number, z: number) => x > b.minX + 10 && x < b.maxX - 10 && z > b.minZ + 10 && z < b.maxZ - 10
    for (const d of SHINJUKU_MISSIONS) {
      expect(inside(d.start.x, d.start.z), d.id).toBe(true)
      for (const s of d.steps) if (s.kind === 'goto') expect(inside(s.x, s.z), `${d.id} ${s.text}`).toBe(true)
    }
  })
})

describe('新宿の依頼と、渋谷の依頼の住み分け', () => {
  it('新宿で立つのは新宿の依頼人だけ。新宿の依頼人の場所を踏むと始まり、渋谷では始まらない', () => {
    expect(missionsOf('shinjuku')).toBe(SHINJUKU_MISSIONS)
    const open = missionMarkers(createMissions('shinjuku')).map((m) => m.ref)
    expect(open).toEqual(SHINJUKU_MISSIONS.filter((d) => !d.after).map((d) => d.id))
    const first = SHINJUKU_MISSIONS[0]
    const view = { x: first.start.x, z: first.start.z, inVehicle: false, wantedLevel: 0, t: 1 }
    expect(stepMissions(createMissions('shinjuku'), view, [], DT).mission.active?.id).toBe(first.id)
    expect(stepMissions(createMissions(), view, [], DT).mission.active).toBeNull()
  })

  it('依頼の id は全エリアを通して重ならず、前提の依頼は同じエリアの中にある', () => {
    expect(ALL_MISSIONS).toHaveLength(MISSIONS.length + SHINJUKU_MISSIONS.length)
    expect(new Set(ALL_MISSIONS.map((d) => d.id)).size).toBe(ALL_MISSIONS.length)
    for (const list of [MISSIONS, SHINJUKU_MISSIONS]) for (const d of list) if (d.after) expect(list.some((o) => o.id === d.after), d.id).toBe(true)
    // 進行中の依頼は、どのエリアの物でも id から中身を引ける
    expect(startMission(createMissions('shinjuku'), SHINJUKU_MISSIONS[0].id, 0).active?.id).toBe(SHINJUKU_MISSIONS[0].id)
  })

  it('新宿で達成した依頼も、渋谷へ戻って読み直して残る（達成の記録は全エリアで 1 本）', () => {
    const done = [MISSIONS[0].id, SHINJUKU_MISSIONS[0].id]
    const save = { v: 1, cash: 4200, wearing: 'c', wardrobe: ['c', 'a', 'b'], done }
    expect(applySave(start(), save, cfg.outfitKeys).mission.done).toEqual(done)
    expect(saveSummary(save)).toMatchObject({ missions: 2, missionTotal: ALL_MISSIONS.length })
  })
})

describe('新宿の看板の中心と、撮影用の立ち位置', () => {
  it('看板の密な中心: 渋谷は原点だけ、新宿は東口と歌舞伎町。ネオンの多い一帯は歌舞伎町だけ', () => {
    expect(hubDistance(shibuya, 30, 40)).toBeCloseTo(50, 6)
    expect(hubDistance(world, 20, -290)).toBe(0)
    expect(hubDistance(world, 0, 0)).toBe(0)
    expect(neonBoost(world, 0, -300)).toBe(1)
    expect(neonBoost(world, 0, 0)).toBe(0)
    expect(neonBoost(shibuya, 0, -300)).toBe(0)
  })

  it('新宿のスポットへ立てる（?gtoShot=<キー>&area=shinjuku。建物の外に立つ）', () => {
    for (const spot of map.spots) {
      const l = parseLaunch(new URLSearchParams(`gtoShot=${spot.key}`), world)
      expect(l.photo, spot.key).not.toBeNull()
      expect(world.insideBuilding(l.photo!.x, l.photo!.z), spot.key).toBe(false)
    }
  })
})
