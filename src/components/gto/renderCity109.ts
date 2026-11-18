// Grand Theft Outfit [部品: city] 道の分岐の先端に立つ円筒の建物（109_02/03/14、dogenzaka_05/07）。
// 入口: buildForkTower(cb, bd, ext)
// 契約: 割り付けは map109.ts の forkTower。名前・ロゴ・広告は描かず、形と外装（銀色のパネルの円筒、
//       ガラスの吹き抜け、その前の鉄骨の格子に吊った縦長の大型広告、横長の細い窓の棟）だけを起こす。
import { CANOPY_MEMBER, forkCanopy, forkTower, type ForkTower } from '../../lib/gto/map109'
import { hash } from '../../lib/gto/math'
import type { MapBuilding } from '../../lib/gto/types'
import { BUILDING_STYLE, extrude, screen, shopFront, type CityBuild, type Extent } from './renderCityBuildings'
import { beam } from './renderCityExtras'
import { box, cap, cylinder, wall } from './renderCityGeom'

const C = { panel: 0xe4e5e4, cylinder: 0xe9ebed, cap: 0x9a9da2, glass: 0x34424f, steel: 0x8d949b, crown: 0xf3f3f0, accent: 0xd8366f, canopy: 0xf1f0ec, roof: 0x8a8c8e, truss: 0x8c7040, awning: 0x2c2d30 }

/**
 * 足元の鉄骨トラスの庇の高さ m（地面から）: 暗い庇の板、格子の下弦と上弦、柱の頭。
 * 109_13（20m 離れた向かいの歩道から）では格子は 2 階の高さの薄い帯（せい 1.5m ほど）で、柱の頭がその少し上へ出る。
 * せいを 4m にすると、近くから見上げたとき画面の高さいっぱいの鉄塔に見える
 */
const TRUSS = { awning: 4.2, low: 4.9, high: 6.5, post: 7.3 }

/**
 * 円筒の足元を巻く鉄骨トラスの庇（dogenzaka_07）。金茶色の柱の輪と、柱の間に渡した立体の格子、その下の暗い庇の板。
 * 109 の真横の歩道から坂下を見ると、これが画面の左手前を埋める
 */
function buildFootTruss(cb: CityBuild, f: ForkTower, ground: number) {
  const c = forkCanopy(f)
  const metal = cb.walls.metal
  // 細い鋼管（スマホは本数を減らすぶん少し太く）
  const half = cb.detail ? CANOPY_MEMBER.chord : CANOPY_MEMBER.chord * 1.5
  const thin = cb.detail ? CANOPY_MEMBER.brace : CANOPY_MEMBER.brace * 1.5
  const low = ground + TRUSS.low
  const high = ground + TRUSS.high
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  c.posts.forEach(([x, z], k) => {
    const [ix, iz] = c.inner[k]
    // 柱（太い丸柱の代わりに角柱）と、円筒の壁ぎわへのつなぎ梁（上下）
    beam(metal, [x, ground - 0.5, z], [x, ground + TRUSS.post, z], CANOPY_MEMBER.post, C.truss)
    beam(metal, [x, low, z], [ix, low, iz], half, C.truss)
    beam(metal, [x, high, z], [ix, high, iz], half, C.truss)
    if (cb.detail) beam(metal, [x, low, z], [ix, high, iz], thin, C.truss)
    if (k === 0) return
    const [px, pz] = c.posts[k - 1]
    const [qx, qz] = c.inner[k - 1]
    // 外と内の上下の弦
    for (const y of [low, high]) {
      beam(metal, [px, y, pz], [x, y, z], half, C.truss)
      beam(metal, [qx, y, qz], [ix, y, iz], half, C.truss)
    }
    // 外の面の斜材（山形）と中央の束
    const [mx, mz] = mid([px, pz], [x, z])
    beam(metal, [px, low, pz], [mx, high, mz], thin, C.truss)
    beam(metal, [mx, high, mz], [x, low, z], thin, C.truss)
    if (cb.detail) {
      beam(metal, [mx, low, mz], [mx, high, mz], thin, C.truss)
      // 上の面と下の面の筋交い、内の面の斜材
      beam(metal, [px, high, pz], [ix, high, iz], thin, C.truss)
      beam(metal, [qx, low, qz], [x, low, z], thin, C.truss)
      beam(metal, [qx, low, qz], [ix, high, iz], thin, C.truss)
    }
    // 暗い庇の板（円筒の壁ぎわから、柱までの半分だけ。外側は格子が空に抜ける）
    const [hx, hz] = mid(mid([qx, qz], [ix, iz]), mid(mid([px, pz], [x, z]), mid([qx, qz], [ix, iz])))
    const span = (Math.hypot(x - px, z - pz) + Math.hypot(ix - qx, iz - qz)) / 2
    const depth = Math.hypot((px + x) / 2 - (qx + ix) / 2, (pz + z) / 2 - (qz + iz) / 2) / 2
    box(cb.walls.blank, hx, hz, ground + TRUSS.awning, ground + TRUSS.awning + 0.28, span / 2, depth / 2 + 0.4, C.awning, Math.atan2(z - pz, x - px))
  })
}

/** 吹き抜けの寸法 m（円筒の脇から坂に沿って） */
const ATRIUM = { from: 1.5, len: 20, out: 2.6, bay: 4.25, tier: 3.6 }

export function buildForkTower(cb: CityBuild, bd: MapBuilding, ext: Extent) {
  const f = forkTower(bd.pts)
  const shop = BUILDING_STYLE.shop
  const base = bd.y + shop
  // ---- 円筒の後ろの棟。銀色のパネルに横長の細い窓 ----
  if (ext.bottom < bd.y) extrude(cb, 'blank', f.body, ext.bottom, bd.y, 0x6a6660, ext.bottom)
  // 1 階は元の輪郭いっぱいに張り出した銀色のパネルの壁（坂沿いの店の看板帯がこの壁に載る）。上は白い帯と平らな屋根
  extrude(cb, 'panel', bd.pts, bd.y, base - 0.9, C.panel, bd.y, 0.3)
  extrude(cb, 'blank', bd.pts, base - 0.9, base, C.canopy, base)
  // 後ろの棟の 1 階（張り出しの無い側）は店先
  shopFront(cb, f.body, bd.y, base, C.canopy, hash(bd.id, 3))
  cap(cb.roofs, bd.pts, base, C.roof, true)
  extrude(cb, 'panel', f.body, base, ext.top, C.panel, base, 0.3)
  cap(cb.roofs, f.body, ext.top, C.roof, true)
  // 屋上の縁の立ち上がり（白い帯）
  extrude(cb, 'blank', f.body, ext.top, ext.top + 1.1, C.crown, ext.top)

  // ---- 円筒。地面から棟の上へ頭ひとつ抜ける ----
  const top = ext.top + 11
  const u = 1 / (1.5 * 8)
  cylinder(cb.walls.lit, f.cx, f.cz, f.r, f.r, ext.minGround - 1, top, C.cylinder, { seg: 32, uPerMeter: u, v0: 0, v1: (top - ext.minGround + 1) / 3 / 8, cap: C.cap })
  // 頂部の帯（ロゴの位置。色の帯だけ）と、その下の細い色の輪
  cylinder(cb.walls.blank, f.cx, f.cz, f.r + 0.25, f.r + 0.25, top - 6.5, top - 1.4, C.crown, { seg: 32 })
  cylinder(cb.walls.blank, f.cx, f.cz, f.r + 0.3, f.r + 0.3, top - 7.4, top - 6.8, C.accent, { seg: 32 })
  // 足元の入口の庇（円筒を巻く白い輪と、その上の色の帯）
  cylinder(cb.walls.blank, f.cx, f.cz, f.r + 1.3, f.r + 1.3, bd.y + 4.0, bd.y + 4.9, C.canopy, { seg: 32, cap: C.canopy })
  cylinder(cb.walls.blank, f.cx, f.cz, f.r + 1.35, f.r + 1.35, bd.y + 4.25, bd.y + 4.65, C.accent, { seg: 32 })
  cylinder(cb.walls.shop, f.cx, f.cz, f.r + 0.15, f.r + 0.15, bd.y, bd.y + 4.0, 0xe8e6e0, { seg: 32, uPerMeter: 1 / (4.2 * 8), v0: 0, v1: 1 })
  // 交差点を向いた縦長の大型広告（円筒の面に沿わせて、上下に枠）
  const px = f.cx + f.fx * (f.r + 0.15)
  const pz = f.cz + f.fz * (f.r + 0.15)
  const hw = 2.9
  screen(cb, px + f.fz * hw, pz - f.fx * hw, px - f.fz * hw, pz + f.fx * hw, bd.y + 9.5, bd.y + 25.5, f.fx, f.fz, 1)

  buildFootTruss(cb, f, bd.y)

  // ---- 円筒の脇の吹き抜け。暗いガラスの面、その前に鉄骨の格子、格子に吊った縦長の大型広告 ----
  const a = f.atrium
  const el = Math.hypot(a.bx - a.ax, a.bz - a.az) || 1
  const dx = (a.bx - a.ax) / el
  const dz = (a.bz - a.az) / el
  const len = Math.min(ATRIUM.len, el - ATRIUM.from - 2)
  if (len < 6) return
  const at = (s: number, out: number): [number, number] => [a.ax + dx * (ATRIUM.from + s) + a.nx * out, a.az + dz * (ATRIUM.from + s) + a.nz * out]
  const y0 = bd.y + 5.2
  const y1 = ext.top - 2.2
  // ガラスの面（方立ての細かいカーテンウォール）。棟の壁より少し前に出す
  const [gx0, gz0] = at(0, 0.3)
  const [gx1, gz1] = at(len, 0.3)
  const bays = Math.max(1, Math.round(len / 1.8))
  wall(cb.walls.curtain, gx0, gz0, gx1, gz1, y0, y1, a.nx, a.nz, C.glass, 1, 0, bays / 8, 0, (y1 - y0) / 4 / 8)
  // 吹き抜けの上の庇（棟の屋上から前へ張り出す白い板）
  const [mx, mz] = at(len / 2, ATRIUM.out / 2)
  const yaw = Math.atan2(dz, dx)
  box(cb.walls.blank, mx, mz, y1, y1 + 1.2, len / 2 + 0.6, ATRIUM.out / 2 + 0.5, C.crown, yaw)
  // 鉄骨の格子（柱と梁。斜材で三角に組む）
  const cols = Math.max(2, Math.round(len / ATRIUM.bay))
  const step = len / cols
  const tiers = Math.max(2, Math.floor((y1 - bd.y - 4.6) / ATRIUM.tier))
  const tierH = (y1 - bd.y - 4.6) / tiers
  const half = cb.detail ? 0.11 : 0.16
  for (let k = 0; k <= cols; k++) {
    const [x, z] = at(k * step, ATRIUM.out)
    beam(cb.walls.metal, [x, bd.y, z], [x, y1, z], half * 1.3, C.steel)
    // 棟へのつなぎ梁
    const [wx, wz] = at(k * step, 0.3)
    for (let t = 1; t <= tiers; t += cb.detail ? 1 : 2) beam(cb.walls.metal, [x, bd.y + 4.6 + t * tierH, z], [wx, bd.y + 4.6 + t * tierH, wz], half * 0.8, C.steel)
  }
  for (let t = 0; t <= tiers; t++) {
    const y = bd.y + 4.6 + t * tierH
    const [x0, z0] = at(0, ATRIUM.out)
    const [x1, z1] = at(len, ATRIUM.out)
    beam(cb.walls.metal, [x0, y, z0], [x1, y, z1], half, C.steel)
    if (!cb.detail || t === tiers) continue
    // 斜材（1 段おきに向きを変える）
    for (let k = 0; k < cols; k++) {
      const up = (k + t) % 2 === 0
      const [bx0, bz0] = at(k * step, ATRIUM.out)
      const [bx1, bz1] = at((k + 1) * step, ATRIUM.out)
      beam(cb.walls.metal, [bx0, up ? y : y + tierH, bz0], [bx1, up ? y + tierH : y, bz1], half * 0.6, C.steel)
    }
  }
  // 格子の中央に吊った縦長の大型広告（上下は吊り材ぶん空ける）
  const adW = Math.min(6.4, len * 0.36)
  const [sx0, sz0] = at(len / 2 - adW / 2, ATRIUM.out + 0.25)
  const [sx1, sz1] = at(len / 2 + adW / 2, ATRIUM.out + 0.25)
  const adTop = y1 - 3.2
  const adBottom = Math.max(bd.y + 7.5, adTop - 15)
  screen(cb, sx0, sz0, sx1, sz1, adBottom, adTop, a.nx, a.nz, 3)
  for (const s of [len / 2 - adW / 2 + 0.4, len / 2 + adW / 2 - 0.4]) {
    const [hx, hz] = at(s, ATRIUM.out + 0.2)
    beam(cb.walls.metal, [hx, adTop, hz], [hx, y1, hz], 0.05, C.steel)
  }
}
