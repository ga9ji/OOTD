// Grand Theft Outfit [部品: city] 東口の「線路が右にある」ことの決め手。乗り場に並ぶ路線バスと、工事中の JR の高架の東の面。
// 現地写真 miyamasuzaka_07/08、viaduct_01、towers_17: 橋の桁下の暗がりの前に白地に緑と橙の帯のバスが連なり、
// 右手には白い仮囲いの上に電車、その上を白い鉄骨の桁が覆う。
// 入口: buildEastSide(cb)
// 契約: 置き場所と寸法は lib/gto/mapEast.ts。どれも当たり判定を持たない飾り。会社名・行き先・ロゴは描かない。
import { JR_EAST, NORTH_PLAZA, jrEastEdges, jrUpperSpan, parkedBuses, type EastEdge } from '../../lib/gto/mapEast'
import { TRAIN_CAR } from '../../lib/gto/mapTrain'
import type { CityBuild } from './renderCityBuildings'
import { buildEastFront, bus, sideWindows } from './renderCityEastFront'
import { box, cylinder, wall } from './renderCityGeom'

const JR = { hoard: 0xf1f3f3, sheet: 0x8f979c, slab: 0xd9dcdc, steel: 0xf4f5f3, post: 0xe6e8e7, car: 0xe9edef, band: 0x8fc93a, glass: 0x2a3138, under: 0x3c4046, shadow: 0x2c3136, inner: 0x5a646b, lamp: 0xfff6e2 }

/** JR の駅舎（東の面を作り替える建物）の OSM id */
const JR_STATION_ID = 904652357

/**
 * 桁の上の、工事中の躯体 2 層ぶん。白い柱と梁の骨組みの奥に暗い内側、床の縁は白い板、頂部は細い足場の手すり。
 * 壁の線から内へ back m の奥行きで建てる（駅舎の屋根の上に載る）
 */
function upperFrames(cb: CityBuild, e: EastEdge, base: number, yaw: number) {
  const J = JR_EAST
  const span = jrUpperSpan(e)
  if (!span) return
  const full = Math.hypot(e.bx - e.ax, e.bz - e.az)
  const ux = (e.bx - e.ax) / full
  const uz = (e.bz - e.az) / full
  const len = span[1] - span[0]
  const at = (t: number, off: number): [number, number] => [e.ax + ux * (span[0] + t) + e.nx * off, e.az + uz * (span[0] + t) + e.nz * off]
  const [cx, cz] = at(len / 2, J.out - J.back / 2)
  const white = cb.walls.metal
  const levels = [
    [J.girder1 + 1.1, J.deck2],
    [J.deck2, J.top],
  ]
  for (const [y0, y1] of levels) {
    // 暗い内側（奥へ引っ込めた箱）と、上の床の縁の白い板
    box(cb.walls.blank, cx, cz, base + y0, base + y1 - 1.2, len / 2 - 0.3, J.back / 2 - 0.6, JR.inner, yaw, 1)
    // 床の縁の白い板は、夕方と夜に作業灯で白く浮く（miyamasuzaka_06/07 の右: 暗い空に白い骨組みの段）
    box(cb.walls.lit, cx, cz, base + y1 - 1.2, base + y1, len / 2 + 0.2, J.back / 2, JR.steel, yaw, 0.8)
    // 表の柱と、柱の間の中段の梁
    const bays = Math.max(1, Math.round(len / J.bay))
    for (let k = 0; k <= bays; k++) {
      const [px, pz] = at((len * k) / bays, J.out - 0.3)
      box(white, px, pz, base + y0, base + y1 - 1.2, 0.28, 0.28, JR.steel, yaw, 1.05)
    }
    if (cb.detail) {
      const [mx, mz] = at(len / 2, J.out - 0.3)
      box(white, mx, mz, base + (y0 + y1 - 1.2) / 2 - 0.18, base + (y0 + y1 - 1.2) / 2 + 0.18, len / 2, 0.14, JR.post, yaw, 1)
    }
  }
  // 頂部の足場の手すり（細い柱と横の 2 本）と、灰色の養生の幕
  const [rx, rz] = at(len / 2, J.out - 0.2)
  for (const h of [1.1, 2.1]) box(white, rx, rz, base + J.top + h - 0.06, base + J.top + h + 0.06, len / 2, 0.06, JR.post, yaw, 1)
  if (!cb.detail) return
  for (let t = 0; t <= len; t += 2.2) {
    const [px, pz] = at(t, J.out - 0.2)
    box(white, px, pz, base + J.top, base + J.top + 2.2, 0.05, 0.05, JR.post, yaw, 1)
  }
  for (let t = 5; t + 5 < len; t += 19) {
    const [sx, sz] = at(t + 2.5, J.out - 0.12)
    box(cb.walls.blank, sx, sz, base + J.deck2 + 0.3, base + J.top - 1.4, 2.5, 0.06, JR.sheet, yaw, 0.95)
  }
}

/** 東の面 1 区間。白い仮囲い → 張り出した床 → 電車 → 柱 → 白い鉄骨の桁 */
function eastEdge(cb: CityBuild, e: EastEdge, base: number, withTrain: boolean) {
  const J = JR_EAST
  const len = Math.hypot(e.bx - e.ax, e.bz - e.az)
  const ux = (e.bx - e.ax) / len
  const uz = (e.bz - e.az) / len
  const yaw = Math.atan2(uz, ux)
  const at = (t: number, off: number): [number, number] => [e.ax + ux * t + e.nx * off, e.az + uz * t + e.nz * off]
  // 仮囲い（壁のすぐ表）。白い鋼板に縦の目地、ところどころ灰色の養生の幕
  const [h0x, h0z] = at(0, 0.18)
  const [h1x, h1z] = at(len, 0.18)
  wall(cb.walls.metal, h0x, h0z, h1x, h1z, base - 0.5, base + J.hoard, e.nx, e.nz, JR.hoard, 1, 0, len / 1.5 / 8, 0, (J.hoard + 0.5) / 3 / 8)
  if (cb.detail) {
    for (let t = 7; t + 4 < len; t += 17) {
      const [s0x, s0z] = at(t, 0.3)
      const [s1x, s1z] = at(t + 4.2, 0.3)
      wall(cb.walls.blank, s0x, s0z, s1x, s1z, base + 0.4, base + J.hoard + 2.6, e.nx, e.nz, JR.sheet, 0.95)
    }
  }
  // 電車の載る床（壁から張り出す）と、その奥の影
  const [mx, mz] = at(len / 2, J.out / 2)
  box(cb.roofs, mx, mz, base + J.hoard, base + J.rail, len / 2, J.out / 2, JR.slab, yaw, 1)
  const [d0x, d0z] = at(0, 0.12)
  const [d1x, d1z] = at(len, 0.12)
  wall(cb.walls.blank, d0x, d0z, d1x, d1z, base + J.rail, base + J.girder0, e.nx, e.nz, JR.shadow, 0.9)
  // 上を覆う白い鉄骨の桁（縦の補剛材つき）と、桁の上の白い手すりの帯
  const [g0x, g0z] = at(0, J.out)
  const [g1x, g1z] = at(len, J.out)
  // 錆びた鉄桁の絵ではなく白い鋼板（新しい桁）。茶色く見えるとコンクリートの陸橋に読める
  wall(cb.walls.metal, g0x, g0z, g1x, g1z, base + J.girder0, base + J.girder1, e.nx, e.nz, JR.steel, 1.08, 0, len / 1.6 / 8, 0, (J.girder1 - J.girder0) / 3 / 8)
  // 桁の下のホームの明かり（夕方と夜、電車の上に白い光の線が奥へ伸びる）
  const [l0x, l0z] = at(0, J.out - 0.45)
  const [l1x, l1z] = at(len, J.out - 0.45)
  wall(cb.walls.lit, l0x, l0z, l1x, l1z, base + J.girder0 - 0.32, base + J.girder0, e.nx, e.nz, JR.lamp, 1)
  box(cb.roofs, mx, mz, base + J.girder0, base + J.girder1, len / 2, J.out / 2 - 0.02, JR.steel, yaw, 0.85)
  box(cb.walls.blank, mx, mz, base + J.girder1, base + J.girder1 + 1.1, len / 2, J.out / 2 - 0.4, JR.post, yaw, 0.95)
  // 桁を支える白い柱（床の縁に並ぶ）
  const posts = Math.max(1, Math.round(len / J.post))
  for (let k = 0; k <= posts; k++) {
    const [px, pz] = at((len * k) / posts, J.out - 0.3)
    box(cb.walls.blank, px, pz, base + J.rail, base + J.girder0, 0.22, 0.22, JR.post, yaw, 1)
  }
  upperFrames(cb, e, base, yaw)
  if (!withTrain) return
  // 電車（銀色の車体に黄緑の帯、暗い窓の帯）。床の上、桁の下に止まっている
  const T = TRAIN_CAR
  const count = Math.floor((len + T.gap) / (T.length + T.gap))
  const start = (len - (count * (T.length + T.gap) - T.gap)) / 2
  for (let k = 0; k < count; k++) {
    const [cx, cz] = at(start + k * (T.length + T.gap) + T.length / 2, 0.25 + T.width / 2)
    const y = base + J.rail + 0.45
    // 桁の影に入るので、車体は明るめに持ち上げる
    // 夕方と夜はホームの明かりを受けて車体が白く浮く（暗い箱に沈むと、高架の上の電車だと読めない）
    box(cb.walls.lit, cx, cz, y, y + T.height, T.length / 2, T.width / 2, JR.car, yaw, 1.0)
    box(cb.roofs, cx, cz, y + 1.75, y + 2.75, T.length / 2 - 0.5, T.width / 2 + 0.03, JR.glass, yaw, 1)
    sideWindows(cb, cx, cz, ux, uz, T.length / 2 - 0.6, T.width / 2 + 0.05, y + 1.6, y + 2.9, [-1])
    box(cb.walls.lit, cx, cz, y + 1.25, y + 1.65, T.length / 2 + 0.02, T.width / 2 + 0.04, JR.band, yaw, 1.1)
    box(cb.walls.lit, cx, cz, y + 3.0, y + 3.25, T.length / 2 + 0.02, T.width / 2 + 0.04, JR.band, yaw, 1.1)
    box(cb.roofs, cx, cz, base + J.rail, y, T.length / 2 - 1.2, T.width / 2 - 0.25, JR.under, yaw, 1)
  }
}

const PLAZA = { panel: 0xf4f6f8, glass: 0x2b3640, frame: 0xe4e8ea, kiosk: 0xd6ecf8, pylon: 0x2a2c2f, signRed: 0xd5281f, signYellow: 0xf7c61f, wood: 0x8a5a36 }

/**
 * 宮益坂下の北の歩道の手前の物（towers_16）: 映画館のビルの丸い角、縦長の案内塔、地下への出入口のガラスの囲い。
 * 寸法と置き場所は mapEast.ts の NORTH_PLAZA
 */
function buildNorthPlaza(cb: CityBuild) {
  const { round, pylon } = NORTH_PLAZA
  const bd = cb.world.map.buildings.find((b) => b.id === NORTH_PLAZA.building)
  if (!bd) return
  const blank = cb.walls.blank
  // 白いパネルは空の色を映す金属の壁で描く（日陰でも白く見える）
  const white = cb.walls.metal
  const seg = cb.detail ? 20 : 10
  // 丸い角。足元は奥へ引っ込んだ暗い店先（上の階が庇のように張り出す）、その上はガラスの帯と白いパネルの帯が交互。
  // 白いパネルは日陰でも白く見えるよう、少し自分で光る壁で描く（towers_15/16: 右手前の白い帯と白い円柱）
  const bright = cb.walls.lit
  cylinder(blank, round.x, round.z, round.r - 0.9, round.r - 0.9, bd.y - 0.5, bd.y + round.shop, PLAZA.glass, { seg })
  cylinder(bright, round.x, round.z, round.r + 0.12, round.r + 0.12, bd.y + round.shop - 0.5, bd.y + round.shop, PLAZA.panel, { seg })
  for (let y = round.shop; y < round.top; y += round.band + round.glass) {
    const g1 = Math.min(round.top, y + round.glass)
    cylinder(blank, round.x, round.z, round.r - 0.25, round.r - 0.25, bd.y + y, bd.y + g1, PLAZA.glass, { seg })
    if (g1 < round.top) cylinder(bright, round.x, round.z, round.r + 0.12, round.r + 0.12, bd.y + g1, bd.y + Math.min(round.top, g1 + round.band), PLAZA.panel, { seg, cap: PLAZA.panel })
  }
  cylinder(white, round.x, round.z, round.r, round.r, bd.y + round.top - 0.3, bd.y + round.top, PLAZA.panel, { seg, cap: PLAZA.panel })
  // 庇を支える白い円柱（歩道の縁）と、東の壁に沿った庇（白い鼻先、下は暗い軒裏）
  for (const [x, z, r] of NORTH_PLAZA.columns) cylinder(bright, x, z, r, r, cb.world.groundY(x, z) - 0.3, bd.y + round.shop - 0.4, PLAZA.panel, { seg: cb.detail ? 14 : 8 })
  const cn = NORTH_PLAZA.canopy
  const cyaw = Math.atan2(cn.bz - cn.az, cn.bx - cn.ax)
  const clen = Math.hypot(cn.bx - cn.ax, cn.bz - cn.az)
  const cmx = (cn.ax + cn.bx) / 2 + (Math.sin(cyaw) * cn.out) / 2
  const cmz = (cn.az + cn.bz) / 2 - (Math.cos(cyaw) * cn.out) / 2
  box(bright, cmx, cmz, bd.y + round.shop - 0.5, bd.y + round.shop + 0.25, clen / 2, cn.out / 2, PLAZA.panel, cyaw, 1.1)
  // 案内塔。黒い枠の中に色の札が縦に並ぶ（文字は描かない）
  const py = cb.world.groundY(pylon.x, pylon.z)
  box(blank, pylon.x, pylon.z, py, py + pylon.h, pylon.w / 2, pylon.d / 2, PLAZA.pylon, 0, 1)
  let top = py + pylon.h - 0.12
  for (const [color, h] of pylon.panels) {
    box(blank, pylon.x, pylon.z, top - h + 0.05, top - 0.05, pylon.w / 2 - 0.08, pylon.d / 2 + 0.03, color, 0, 1.15)
    top -= h
    if (top < py + pylon.foot) break
  }
  // 庇の下の壁の店の印（towers_15 の右上: 茶色い板壁に赤い箱の看板）。赤い箱に黄色い帯だけ（架空の店。字もロゴも描かない）
  const sg = NORTH_PLAZA.sign
  box(blank, sg.x, sg.z, bd.y + sg.y0 - 0.6, bd.y + sg.y1 + 0.6, 0.12, sg.half + 1.2, PLAZA.wood, 0, 1)
  box(blank, sg.x + 0.25, sg.z, bd.y + sg.y0, bd.y + sg.y1, 0.3, sg.half, PLAZA.signRed, 0, 1.15)
  box(blank, sg.x + 0.58, sg.z, bd.y + sg.y0 + 0.35, bd.y + sg.y0 + 0.7, 0.03, sg.half * 0.7, PLAZA.signYellow, 0, 1.2)
  // 壁から突き出す立体の印。赤い台の上に黄色い太鼓形の行灯、上下に白い縁（日陰でも色が出るよう、少し自分で光る壁で描く）
  const mk = NORTH_PLAZA.mark
  const mseg = cb.detail ? 14 : 8
  box(bright, mk.x, mk.z, bd.y + mk.y0, bd.y + mk.y0 + mk.base, mk.reach, mk.depth, PLAZA.signRed, 0, 1.1)
  cylinder(bright, mk.x, mk.z, mk.r + 0.04, mk.r + 0.04, bd.y + mk.y0 + mk.base, bd.y + mk.y0 + mk.base + 0.08, PLAZA.panel, { seg: mseg })
  cylinder(bright, mk.x, mk.z, mk.r, mk.r, bd.y + mk.y0 + mk.base + 0.08, bd.y + mk.y1 - 0.08, PLAZA.signYellow, { seg: mseg })
  cylinder(bright, mk.x, mk.z, mk.r + 0.04, mk.r + 0.04, bd.y + mk.y1 - 0.08, bd.y + mk.y1, PLAZA.panel, { seg: mseg, cap: PLAZA.panel })
  kioskGlass(cb)
}

/**
 * 地下への出入口のガラスの囲い（towers_15/16 の左手前）。白いタイルの腰壁の上に、細い枠の透明なガラス。
 * 向こうの橋と塔の裾が透けて見える。北の端が高く、南へ向かって低くなる片流れ。
 */
function kioskGlass(cb: CityBuild) {
  const k = NORTH_PLAZA.kiosk
  const blank = cb.walls.metal
  const cx = (k.x0 + k.x1) / 2
  const cz = (k.z0 + k.z1) / 2
  const hx = (k.x1 - k.x0) / 2
  const hz = (k.z1 - k.z0) / 2
  const y = cb.world.groundY(cx, cz)
  const topAt = (z: number) => y + k.hNorth + ((k.hSouth - k.hNorth) * (z - k.z0)) / (k.z1 - k.z0)
  // 腰壁（四周）。中は階段なので上は塞がない
  for (const sx of [-1, 1]) box(blank, cx + sx * hx, cz, y - 0.3, y + k.base, 0.09, hz, PLAZA.panel, 0, 1.05)
  for (const sz of [-1, 1]) box(blank, cx, cz + sz * hz, y - 0.3, y + k.base, hx, 0.09, PLAZA.panel, 0, 1.05)
  // ガラス 1 枚（表と裏）。上の辺は片流れに沿って傾く
  const pane = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const g = cb.glass
    const q = [g.vert(ax, y + k.base, az, nx, 0, nz, 0, 0, PLAZA.kiosk), g.vert(bx, y + k.base, bz, nx, 0, nz, 1, 0, PLAZA.kiosk), g.vert(bx, topAt(bz), bz, nx, 0, nz, 1, 1, PLAZA.kiosk), g.vert(ax, topAt(az), az, nx, 0, nz, 0, 1, PLAZA.kiosk)]
    g.quad(q[0], q[1], q[2], q[3])
    g.quad(q[0], q[3], q[2], q[1])
  }
  const bays = Math.max(1, Math.round((k.z1 - k.z0) / k.bay))
  for (let i = 0; i < bays; i++) {
    const z0 = k.z0 + ((k.z1 - k.z0) * i) / bays
    const z1 = k.z0 + ((k.z1 - k.z0) * (i + 1)) / bays
    for (const sx of [-1, 1]) pane(cx + sx * hx, z0, cx + sx * hx, z1, sx, 0)
  }
  pane(k.x0, k.z0, k.x1, k.z0, 0, -1)
  pane(k.x0, k.z1, k.x1, k.z1, 0, 1)
  // 細い枠（方立て）と、上の縁の白い枠
  for (let i = 0; i <= bays; i++) {
    const z = k.z0 + ((k.z1 - k.z0) * i) / bays
    for (const sx of [-1, 1]) box(blank, cx + sx * hx, z, y + k.base, topAt(z), 0.05, 0.05, PLAZA.frame, 0, 1)
    if (i === bays) break
    const z1 = k.z0 + ((k.z1 - k.z0) * (i + 1)) / bays
    // 上の縁の細い枠。短い箱を細かい段にして傾きを作る
    const cuts = 8
    for (let c = 0; c < cuts; c++) {
      const a = z + ((z1 - z) * c) / cuts
      const b = z + ((z1 - z) * (c + 1)) / cuts
      for (const sx of [-1, 1]) box(blank, cx + sx * hx, (a + b) / 2, topAt(b), topAt(a) + 0.05, 0.04, (b - a) / 2, PLAZA.frame, 0, 1)
    }
  }
}

/** 東口の決め手。バスは細部（軽量設定では台数を半分）、高架の東の面は遠くからも見えるのでいつも作る */
export function buildEastSide(cb: CityBuild) {
  const station = cb.world.map.buildings.find((b) => b.id === JR_STATION_ID)
  if (station) {
    for (const e of jrEastEdges(station.pts)) eastEdge(cb, e, station.y, Math.hypot(e.bx - e.ax, e.bz - e.az) > TRAIN_CAR.length + 2)
  }
  buildNorthPlaza(cb)
  parkedBuses(cb.world).forEach((p, i) => {
    if (cb.detail || i % 2 === 0) bus(cb, p)
  })
  // 宮益坂下の横断歩道の先（入口の車路の両脇のバス、上屋、白い仮囲い、歩道の柵）
  buildEastFront(cb)
}
