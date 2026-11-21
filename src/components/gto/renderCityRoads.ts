// Grand Theft Outfit [部品: city] 地面・道路・路面標示・横断歩道・線路と道路の高架。
// 入口: buildTerrain / buildRoads / buildRails
// 契約: world（地図）から動かない形を作るだけ。色は ROAD_STYLE。
import { areaDef } from '../../lib/gto/areas'
import { isGroundRoad, isScrambleCrossing, roadDeck } from '../../lib/gto/map'
import { FORK_RED_PATCHES, FORK_ZEBRA_WIDTH, forkCrossing } from '../../lib/gto/map109'
import { clipOutside, junctionClearings } from '../../lib/gto/mapJunction'
import { isStubCrossing } from '../../lib/gto/mapStreet'
import { BUS_APRON } from '../../lib/gto/mapEast'
import { EAST_CROSSWALKS } from '../../lib/gto/mapEastFront'
import { parkedTrain, TRAIN_CAR } from '../../lib/gto/mapTrain'
import { cumulative, pointAlong } from '../../lib/gto/math'
import type { GtoWorld, MapRoad } from '../../lib/gto/types'
import { box, Builder, densify, disc, offsetLine, ribbon, wall } from './renderCityGeom'
import { WALL_SPECS } from './renderCityTextures'

/** センター街のレンガ色の舗装が始まる所（交差点の中心からの距離 m。入口のゲートのすぐ手前） */
const CENTER_GAI_BRICK_FROM = 40

export const ROAD_STYLE = {
  // 昼の光と色調が暖色へ寄せるので、舗装は青みの灰色で持っておく（写真の歩道は灰色の平板）
  ground: 0x8f959c,
  asphalt: 0x44464b,
  /** スクランブル交差点の中央（標示のない濃いアスファルト） */
  asphaltDark: 0x3a3c41,
  paving: 0xa6adb6,
  /** センター街のレンガ色のブロック舗装 */
  brick: 0xa98572,
  crossBand: 0x9c4a3c,
  curb: 0xc2c8cf,
  line: 0xe9e6dc,
  lineOrange: 0xe0983a,
  rail: 0x4a4038,
  railSteel: 0xb8b4ac,
  deck: 0x8b8d8f,
  /** 歩行者デッキの黒い鉄骨 */
  deckSteel: 0x3a3e44,
  /** JR の鉄桁（茶灰色） */
  girder: 0x7d7268,
  /** 首都高の箱桁（白っぽい灰色） */
  expressway: 0xb9bbb9,
}

export function buildTerrain(world: GtoWorld, step: number) {
  const el = world.map.elevation
  const cols = Math.floor(((el.cols - 1) * el.step) / step) + 1
  const rows = Math.floor(((el.rows - 1) * el.step) / step) + 1
  const b = new Builder()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = el.x0 + c * step
      const z = el.z0 + r * step
      b.vert(x, world.groundY(x, z), z, 0, 1, 0, x / 4, z / 4, ROAD_STYLE.ground)
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c
      b.quad(i, i + cols, i + cols + 1, i + 1)
    }
  }
  const g = b.build()
  g.computeVertexNormals()
  return g
}

/** 浮いた床（高架の道路・線路・歩道橋）。上面・下面・両側の桁を作り、道の無い所に柱を立てる */
function viaduct(
  decks: Builder,
  sides: Builder,
  world: GtoWorld,
  line: [number, number][],
  width: number,
  topAt: (i: number) => number,
  o: { top: number; side: number; thickness: number; rail: number; pillarEvery: number; pillar: number; ribs?: boolean },
) {
  ribbon(decks, line, width, (_x, _z, i) => topAt(i), o.top, 1)
  // 下面（くぐるときに見える）
  const under = new Builder()
  ribbon(under, line, width, (_x, _z, i) => topAt(i) - o.thickness, o.side, 1)
  const base = decks.pos.length / 3
  for (let i = 0; i < under.pos.length / 3; i++) {
    decks.vert(under.pos[i * 3], under.pos[i * 3 + 1], under.pos[i * 3 + 2], 0, -1, 0, 0, 0, o.side, 0.55)
  }
  for (let i = 0; i < under.idx.length; i += 3) decks.idx.push(base + under.idx[i], base + under.idx[i + 2], base + under.idx[i + 1])

  const spec = WALL_SPECS.girder
  let sincePillar = o.pillarEvery
  let run = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const len = Math.hypot(bx - ax, bz - az) || 1
    const ux = -(bz - az) / len
    const uz = (bx - ax) / len
    const rx = ux * (width / 2)
    const rz = uz * (width / 2)
    const ya = topAt(i - 1)
    const yb = topAt(i)
    const u0 = run / spec.bay / 8
    const u1 = (run + len) / spec.bay / 8
    for (const s of [1, -1]) {
      // 桁の側面。高さが変わる区間は台形になる
      const nx = ux * s
      const nz = uz * s
      const p0 = sides.vert(ax + rx * s, ya - o.thickness, az + rz * s, nx, 0, nz, u0, 0, o.side, 0.9)
      const p1 = sides.vert(bx + rx * s, yb - o.thickness, bz + rz * s, nx, 0, nz, u1, 0, o.side, 0.9)
      const p2 = sides.vert(bx + rx * s, yb + o.rail, bz + rz * s, nx, 0, nz, u1, 1, o.side, 0.9)
      const p3 = sides.vert(ax + rx * s, ya + o.rail, az + rz * s, nx, 0, nz, u0, 1, o.side, 0.9)
      if (s > 0) sides.quad(p0, p1, p2, p3)
      else sides.quad(p1, p0, p3, p2)
      // 高欄の内側（床の上から見える）
      wall(decks, ax + rx * s * 0.97, az + rz * s * 0.97, bx + rx * s * 0.97, bz + rz * s * 0.97, Math.min(ya, yb), Math.max(ya, yb) + o.rail, -nx, -nz, o.side, 0.8)
    }
    run += len
    sincePillar += len
    const ground = world.groundY(bx, bz)
    const clearance = yb - o.thickness - ground
    if (clearance < 2.5) continue
    const overRoad = world.nearestRoad(bx, bz, false, 5.5) != null
    // 道をまたぐ所は、桁の下に横桁を渡す（ガード下から見上げたときの骨組み）
    if (o.ribs && overRoad) box(decks, bx, bz, yb - o.thickness - 0.45, yb - o.thickness, width / 2, 0.16, o.side, Math.atan2(uz, ux), 0.6)
    if (sincePillar >= o.pillarEvery && !overRoad && !world.insideBuilding(bx, bz)) {
      box(decks, bx, bz, ground - 0.5, yb - o.thickness, o.pillar, o.pillar, o.side, Math.atan2(uz, ux))
      sincePillar = 0
    }
  }
}

/** 車線の区切りの破線（道のりに沿って 5m 引いて 5m 空ける）。run は [x, z] の折れ線 */
function dashes(b: Builder, run: [number, number][], side: number, yAt: (x: number, z: number) => number) {
  const flat = run.flat()
  const cum = cumulative(flat)
  const total = cum[cum.length - 1]
  for (let s = 4; s + 5 < total - 3; s += 10) {
    const p0 = pointAlong(flat, cum, s)
    const p1 = pointAlong(flat, cum, s + 5)
    const line = offsetLine(
      [
        [p0.x, p0.z],
        [p1.x, p1.z],
      ],
      side,
    )
    ribbon(b, line, 0.15, yAt, ROAD_STYLE.line, 1)
  }
}

/** 停止線。run の端が元の線の端でない（＝交差点で切られた）とき、その端に、交差点へ向かう側の車線の幅で白い太線を引く */
function stopLines(b: Builder, run: [number, number][], full: [number, number][], r: MapRoad, yAt: (x: number, z: number) => number) {
  const ends: [[number, number], [number, number], boolean][] = [
    [run[0], run[1], true],
    [run[run.length - 1], run[run.length - 2], false],
  ]
  for (const [end, inner, atStart] of ends) {
    const fullEnd = atStart ? full[0] : full[full.length - 1]
    if (Math.hypot(end[0] - fullEnd[0], end[1] - fullEnd[1]) < 0.5) continue
    // 交差点へ向かう向き（inner → end）
    const dl = Math.hypot(end[0] - inner[0], end[1] - inner[1]) || 1
    const fx = (end[0] - inner[0]) / dl
    const fz = (end[1] - inner[1]) / dl
    // 一方通行で交差点から出ていく側には引かない
    const leaving = r.oneway != null && (r.oneway === 1) === atStart
    if (leaving) continue
    // 左側通行: 進む向きの左半分（一方通行は全幅）
    const half = r.width / 2 - 0.4
    const from = r.oneway ? -half : 0
    const lx = fz
    const lz = -fx
    ribbon(
      b,
      [
        [end[0] + lx * from, end[1] + lz * from],
        [end[0] + lx * half, end[1] + lz * half],
      ],
      0.45,
      yAt,
      ROAD_STYLE.line,
      1,
    )
  }
}

export function buildRoads(world: GtoWorld, detail: boolean) {
  const drive = new Builder()
  const walk = new Builder()
  const lines = new Builder()
  const zebra = new Builder()
  const decks = new Builder()
  const sides = new Builder()
  const lift = (dy: number) => (x: number, z: number) => world.groundY(x, z) + dy
  const S = ROAD_STYLE
  const clearings = junctionClearings(world.map.roads)
  // [areas] 原点の広場と、固定の座標に敷く渋谷だけの路面は、そのエリアでだけ描く
  const area = areaDef(world)

  // 109 前の分岐の横断歩道の付け根（赤茶の舗装）
  if (area.shibuyaSet) for (const [x, z, r] of FORK_RED_PATCHES) disc(walk, x, z, r, lift(0.16), S.crossBand, 14)

  // スクランブル交差点の中央。標示のない濃いアスファルトの広場
  if (area.scramble) disc(drive, 0, 0, 20, lift(0.13), S.asphaltDark, 24)

  world.map.roads.forEach((r: MapRoad) => {
    if (r.tunnel) return
    const line = densify(r.pts, 4)
    const deck = roadDeck(r)
    if (deck > 0) {
      // 高架の道路・歩道橋。床は地表から deck だけ浮く
      const base = line.map(([x, z]) => world.groundY(x, z) + deck)
      const motorway = r.kind === 'motorway' || r.kind === 'motorway_link'
      viaduct(decks, sides, world, line, r.width + (r.drive ? 1.2 : 0.6), (i) => base[i], {
        top: r.drive ? S.asphalt : S.paving,
        // 歩行者デッキは黒い鉄骨の桁（viaduct_03/04）
        side: motorway ? S.expressway : r.drive ? S.deck : S.deckSteel,
        thickness: motorway ? 2.4 : r.drive ? 1.6 : 0.9,
        rail: motorway ? 1.6 : 1.1,
        pillarEvery: r.drive ? 28 : 18,
        pillar: motorway ? 1.3 : r.drive ? 0.8 : 0.45,
      })
      return
    }
    if (!isGroundRoad(r)) return
    if (r.crossing) {
      // スクランブル交差点の横断歩道は幅が広い（辺 9m、対角 7m）
      const scramble = area.scramble && isScrambleCrossing(r)
      const diagonal = scramble && r.pts.some((v, i) => i % 2 === 0 && Math.hypot(v, r.pts[i + 1]) < 1)
      const width = scramble ? (diagonal ? 7 : 9) : Math.max(r.width, 4)
      // 109 前の分岐: 縞だけを描く（109_12、109_07）。先端から正面へ延びる線には縞を描かない。赤茶の舗装は付け根だけ（下の FORK_RED_PATCHES）
      if (area.scramble && isStubCrossing(r)) return
      const fork = area.shibuyaSet ? forkCrossing(r) : null
      if (fork === 'none') return
      ribbon(zebra, line, fork ? FORK_ZEBRA_WIDTH : width, lift(0.2), 0xffffff, 2)
      return
    }
    if (r.drive) {
      const across = r.width > 9 ? 4 : 2
      // 縁石（車道より一回り広い明るい帯を下に敷く）
      if (detail && r.width >= 5 && r.kind !== 'service') ribbon(walk, line, r.width + 0.5, lift(0.09), S.curb, across, true)
      ribbon(drive, line, r.width, lift(0.12), S.asphalt, across, true)
      for (let i = 0; i < r.pts.length; i += 2) disc(drive, r.pts[i], r.pts[i + 1], r.width / 2, lift(0.12), S.asphalt)
      // 交差点の中（横断歩道の外の端まで）には線を引かない（109_12、scramble_08）
      const marks = clipOutside(line, clearings)
      for (const run of marks) {
        if (!r.oneway && r.width >= 7.5) {
          // 対面通行の広い道の中央線。道玄坂は白の実線に橙の線が添う
          ribbon(lines, run, 0.18, lift(0.17), S.line, 1)
          if (detail && r.name === '道玄坂') ribbon(lines, offsetLine(run, 0.35), 0.14, lift(0.17), S.lineOrange, 1)
          if (detail && r.width >= 11) for (const side of [-r.width / 4, r.width / 4]) dashes(lines, run, side, lift(0.17))
        } else if (detail && r.oneway && r.width >= 8.5) {
          const lanes = Math.max(2, r.lanes ?? Math.round(r.width / 3.1))
          for (let k = 1; k < lanes; k++) dashes(lines, run, -r.width / 2 + (r.width * k) / lanes, lift(0.17))
        }
        // 路肩の白線
        if (detail && r.width >= 9) for (const side of [-1, 1]) ribbon(lines, offsetLine(run, side * (r.width / 2 - 0.35)), 0.12, lift(0.17), S.line, 1)
        // 停止線（交差点の手前で切れた端に、進む側の車線の幅で 1 本）
        if (detail && r.width >= 6) stopLines(lines, run, line, r, lift(0.17))
      }
    } else {
      const centerGai = r.name === '渋谷センター街'
      const width = centerGai ? r.width + 1.5 : r.width
      // レンガ色の舗装は入口のゲートから奥だけ。交差点の角の歩道（ゲートの手前）は灰色の平板のまま（scramble_08/14）
      const bricked = (x: number, z: number) => centerGai && Math.hypot(x, z) > CENTER_GAI_BRICK_FROM
      const inner = centerGai ? line.filter(([x, z]) => bricked(x, z)) : []
      const outer = centerGai ? line.filter(([x, z]) => !bricked(x, z)) : line
      if (outer.length >= 2) ribbon(walk, outer, width, lift(0.07), S.paving, 2, true)
      if (inner.length >= 2) ribbon(walk, inner, width, lift(0.07), S.brick, 2, true)
      for (let i = 0; i < r.pts.length; i += 2) disc(walk, r.pts[i], r.pts[i + 1], width / 2, lift(0.07), bricked(r.pts[i], r.pts[i + 1]) ? S.brick : S.paving)
    }
  })
  if (area.shibuyaSet) {
    // 東口のバス乗り場の路面（橋の手前から桁下まで一面のアスファルト）。地図の車道のすぐ下に敷く
    for (const { line, width } of BUS_APRON.lanes) {
      const fine = densify(line, 4)
      ribbon(drive, fine, width, lift(0.1), S.asphalt, 4, true)
      for (let i = 0; i < line.length; i += 2) disc(drive, line[i], line[i + 1], width / 2, lift(0.1), S.asphalt)
    }
    ribbon(zebra, densify(BUS_APRON.crosswalk.line, 4), BUS_APRON.crosswalk.width, lift(0.2), 0xffffff, 2)
    for (const c of EAST_CROSSWALKS) ribbon(zebra, densify(c.line, 4), c.width, lift(0.2), 0xffffff, 2)
  }
  return { drive, walk, lines, zebra, decks, sides }
}

/** 線路。高い所は桁に載せ（JR は茶灰色の鉄桁）、レール2本を敷く */
export function buildRails(world: GtoWorld, decks: Builder, sides: Builder, detail: boolean) {
  const tracks = new Builder()
  const S = ROAD_STYLE
  for (const rail of world.map.rails) {
    const n = rail.pts.length / 2
    const fine: [number, number][] = [[rail.pts[0], rail.pts[1]]]
    const fy: number[] = [rail.y[0]]
    // 長い区間は割って、高さを直線補間する
    for (let i = 1; i < n; i++) {
      const ax = rail.pts[(i - 1) * 2]
      const az = rail.pts[(i - 1) * 2 + 1]
      const bx = rail.pts[i * 2]
      const bz = rail.pts[i * 2 + 1]
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6))
      for (let s = 1; s <= k; s++) {
        fine.push([ax + ((bx - ax) * s) / k, az + ((bz - az) * s) / k])
        fy.push(rail.y[i - 1] + ((rail.y[i] - rail.y[i - 1]) * s) / k)
      }
    }
    const high = fy.some((y, i) => y - world.groundY(fine[i][0], fine[i][1]) > 2.5)
    const jr = rail.line === 'jr'
    if (high) {
      viaduct(decks, sides, world, fine, jr ? 5.2 : 4.6, (i) => fy[i], {
        top: S.rail,
        side: jr ? S.girder : S.deck,
        thickness: jr ? 1.9 : 1.4,
        rail: jr ? 0.5 : 0.3,
        pillarEvery: 16,
        pillar: 0.6,
        ribs: jr,
      })
      // 架線柱（JR の高架の上に並ぶ門形の柱の片側）
      if (jr && detail) {
        let since = 20
        for (let i = 1; i < fine.length; i++) {
          since += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1])
          if (since < 42) continue
          since = 0
          const [px, pz] = offsetLine(fine, 2.3)[i]
          const yaw = Math.atan2(fine[i][1] - fine[i - 1][1], fine[i][0] - fine[i - 1][0])
          box(decks, px, pz, fy[i], fy[i] + 6.4, 0.12, 0.12, 0x6f7376)
          box(decks, (px + fine[i][0]) / 2, (pz + fine[i][1]) / 2, fy[i] + 6.0, fy[i] + 6.2, 0.08, 1.3, 0x6f7376, yaw)
        }
      }
    } else ribbon(tracks, fine, 3.4, (x, z, i) => Math.max(fy[i], world.groundY(x, z)) + 0.15, S.rail, 1)
    for (const side of [-0.72, 0.72]) {
      ribbon(tracks, offsetLine(fine, side), 0.14, (x, z, i) => (high ? fy[i] : Math.max(fy[i], world.groundY(x, z)) + 0.15) + 0.08, S.railSteel, 1)
    }
  }
  // ガードの上に止まっている電車は、決まった場所の線路に置く渋谷だけの物
  if (areaDef(world).shibuyaSet) buildTrain(decks, world)
  return tracks
}

/** ガードの上に止まっている電車。銀色の車体に黄緑の帯、暗い窓の帯（viaduct_02） */
function buildTrain(b: Builder, world: GtoWorld) {
  const T = TRAIN_CAR
  for (const car of parkedTrain(world.map)) {
    const y = car.y + 0.45
    box(b, car.x, car.z, y, y + T.height, T.length / 2, T.width / 2, 0xc9cdd0, car.yaw)
    // 窓の帯と、その下の黄緑の帯（車体より少し外へ出す）
    box(b, car.x, car.z, y + 1.75, y + 2.75, T.length / 2 - 0.5, T.width / 2 + 0.03, 0x2a3138, car.yaw)
    box(b, car.x, car.z, y + 1.25, y + 1.65, T.length / 2 + 0.02, T.width / 2 + 0.04, 0x8fc93a, car.yaw)
    box(b, car.x, car.z, y + 3.0, y + 3.25, T.length / 2 + 0.02, T.width / 2 + 0.04, 0x8fc93a, car.yaw)
    // 床下の機器
    box(b, car.x, car.z, car.y + 0.1, y, T.length / 2 - 1.2, T.width / 2 - 0.25, 0x3c4046, car.yaw)
  }
}
