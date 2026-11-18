// Grand Theft Outfit [部品: city] 明治通りをまたぐ駅の橋。道路の上に浮いた、丸いルーバー屋根のガラスの筒。
// 現地写真 miyamasuzaka_06/08、viaduct_01、towers_17: 下から 暗い桁下（車とバスが抜ける）→ 白いパネルの腰 →
// ガラスの帯（奥に黄色い電車）→ 奥へ丸く倒れていく灰色のルーバー屋根。両端は丸く閉じる。
// 入口: ginzaStation(cb, bd, ext)
// 契約: 寸法は lib/gto/mapBridge.ts。壁を地面まで下ろさない（足元は丸柱だけ）。名前・ロゴ・広告は描かない。
import { EAST_BRIDGE, reachWest, tubeAxis, tubeColumns, tubeSection, type SectionPoint, type TubeAxis } from '../../lib/gto/mapBridge'
import type { MapBuilding } from '../../lib/gto/types'
import type { CityBuild, Extent } from './renderCityBuildings'
import { face } from './renderCityExtras'
import { box, cylinder, type Builder } from './renderCityGeom'

const TUBE = { fascia: 0xeef2f4, trim: 0x59616a, glass: 0xe4edf2, roof: 0xc3c9cd, soffit: 0x4d555b, beam: 0x3a4046, column: 0x9a9f9f }

type V3 = [number, number, number]

/** 断面の点 p を、中心 (cx, cz) から水平の向き (dx, dz) へ置いた位置 */
const place = (cx: number, cz: number, dx: number, dz: number, p: SectionPoint, base: number, grow = 0): V3 => [cx + dx * (p.s + grow), base + p.y, cz + dz * (p.s + grow)]

/** 断面の 1 区間（p→q）の面の法線。屋根は弧に沿って上を向く */
function sectionNormal(p: SectionPoint, q: SectionPoint, dx: number, dz: number): V3 {
  const run = p.s - q.s
  const rise = q.y - p.y
  const l = Math.hypot(run, rise) || 1
  return [(dx * rise) / l, run / l, (dz * rise) / l]
}

/** 断面の 1 区間を、水平の向きが d0 → d1 に変わる間に張る（まっすぐな側面では d0 = d1、中心だけが動く） */
function strip(cb: CityBuild, p: SectionPoint, q: SectionPoint, c0: [number, number], d0: [number, number], c1: [number, number], d1: [number, number], base: number, u0: number, u1: number, v: number, band = 0) {
  const mx = d0[0] + d1[0]
  const mz = d0[1] + d1[1]
  const ml = Math.hypot(mx, mz) || 1
  const n = sectionNormal(p, q, mx / ml, mz / ml)
  const quad: [V3, V3, V3, V3] = [place(c0[0], c0[1], d0[0], d0[1], p, base), place(c1[0], c1[1], d1[0], d1[1], p, base), place(c1[0], c1[1], d1[0], d1[1], q, base), place(c0[0], c0[1], d0[0], d0[1], q, base)]
  const shade = 0.84 + 0.16 * Math.max(0, n[0] * 0.5 - n[2] * 0.6 + 0.4)
  if (p.part === 'glass') {
    // 縦はガラスの帯 1 枚ぶん（奥の電車まで含めた絵）
    face(cb.walls.tube, quad, n, TUBE.glass, shade, [u0 / 2.4 / 8, 0, u1 / 2.4 / 8, 1])
    return
  }
  const len = Math.hypot(p.s - q.s, q.y - p.y)
  if (p.part === 'fascia') {
    face(cb.walls.metal, quad, n, TUBE.fascia, shade, [u0 / 1.5 / 8, 0, u1 / 1.5 / 8, len / 3 / 8])
    return
  }
  // 屋根: 横の細い目地（ルーバー）が 0.5m ごとに入るよう v を進める。上を向くほど空を映して明るい
  // 段ごとに明暗を交互に付けて、遠目にも段々のルーバーが読めるようにする
  face(cb.walls.metal, quad, n, TUBE.roof, (0.8 + 0.28 * n[1]) * (band % 2 ? 0.86 : 1), [u0 / 1.5 / 8, v / 0.5 / 8, u1 / 1.5 / 8, (v + len) / 0.5 / 8])
}

/** 下向きの面（桁下の天井） */
function soffit(b: Builder, pts: V3[]) {
  const i = pts.map((p) => b.vert(p[0], p[1], p[2], 0, -1, 0, 0, 0, TUBE.soffit, 1))
  for (let k = 1; k + 1 < i.length; k++) {
    b.idx.push(i[0], i[k], i[k + 1])
    b.idx.push(i[0], i[k + 1], i[k])
  }
}

function tube(cb: CityBuild, axis: TubeAxis, base: number, squash: number) {
  const B = EAST_BRIDGE
  const sec = tubeSection(axis.half, squash)
  const a: [number, number] = [axis.ax, axis.az]
  const b: [number, number] = [axis.bx, axis.bz]
  // 屋根の弧に沿った道のり（ルーバーの目地を端から端まで連ねる）
  const runs: number[] = [0]
  for (let i = 1; i < sec.length; i++) runs.push(runs[i - 1] + Math.hypot(sec[i].s - sec[i - 1].s, sec[i].y - sec[i - 1].y))
  const capSteps = cb.detail ? 10 : 6
  const capArc = (Math.PI * axis.half) / capSteps
  for (const side of [1, -1]) {
    const lat: [number, number] = [-axis.uz * side, axis.ux * side]
    for (let i = 0; i + 1 < sec.length; i++) strip(cb, sec[i], sec[i + 1], a, lat, b, lat, base, 0, axis.len, runs[i], i)
  }
  // 両端は丸く閉じる（断面を半周まわす。奥行きは capDepth ぶんだけ）
  for (const [c, out] of [
    [a, -1],
    [b, 1],
  ] as const) {
    const dir = (k: number): [number, number] => {
      const phi = (k / capSteps) * Math.PI
      const cos = Math.cos(phi)
      const sin = Math.sin(phi) * B.capDepth * out
      return [-axis.uz * cos + axis.ux * sin, axis.ux * cos + axis.uz * sin]
    }
    for (let k = 0; k < capSteps; k++) {
      for (let i = 0; i + 1 < sec.length; i++) strip(cb, sec[i], sec[i + 1], c, dir(k), c, dir(k + 1), base, axis.len + k * capArc, axis.len + (k + 1) * capArc, runs[i], i)
    }
    const fan: V3[] = []
    for (let k = 0; k <= capSteps; k++) fan.push(place(c[0], c[1], dir(k)[0], dir(k)[1], sec[0], base))
    soffit(cb.roofs, fan)
  }
  // 桁下の天井（暗い）と、腰の下端の見切り
  const corner = (c: [number, number], side: number, grow = 0): V3 => [c[0] - axis.uz * side * (axis.half + grow), base + B.deck, c[1] + axis.ux * side * (axis.half + grow)]
  soffit(cb.roofs, [corner(a, 1), corner(b, 1), corner(b, -1), corner(a, -1)])
  const yaw = Math.atan2(axis.uz, axis.ux)
  const mx = (axis.ax + axis.bx) / 2
  const mz = (axis.az + axis.bz) / 2
  for (const side of [1, -1]) {
    box(cb.walls.blank, mx - axis.uz * side * (axis.half + 0.05), mz + axis.ux * side * (axis.half + 0.05), base + B.deck - 0.3, base + B.deck + 0.25, axis.len / 2, 0.12, TUBE.trim, yaw, 0.8)
  }
  if (!cb.detail) return
  // 桁下の横梁（下から見上げたときの骨組み）
  const beams = Math.max(2, Math.round(axis.len / 8.5))
  for (let k = 0; k <= beams; k++) {
    const t = (axis.len * k) / beams
    box(cb.walls.blank, axis.ax + axis.ux * t, axis.az + axis.uz * t, base + B.deck - 0.7, base + B.deck - 0.02, 0.3, axis.half - 0.4, TUBE.beam, yaw, 0.55)
  }
}

/**
 * 高架の駅（明治通りをまたぐガラスの筒）。背の低い棟（塔へつながる渡り）は同じ形を低く作る。
 * 輪郭から中心線が取れないときは何も作らない（呼び出し側がふつうの建物として描く）。
 */
export function ginzaStation(cb: CityBuild, bd: MapBuilding, ext: Extent): boolean {
  const short = tubeAxis(bd.pts)
  if (!short) return false
  const axis = reachWest(short)
  const B = EAST_BRIDGE
  const squash = Math.min(1, Math.max(0.3, (ext.top - bd.y - B.sill) / (B.ridge - B.sill)))
  tube(cb, axis, bd.y, squash)
  for (const [x, z] of tubeColumns(cb.world, axis)) {
    // viaduct_13: 桁下の柱は太い打ち放しの丸柱
    cylinder(cb.walls.blank, x, z, 1.25, 1.25, cb.world.groundY(x, z) - 0.5, bd.y + B.deck, TUBE.column, { seg: cb.detail ? 12 : 6 })
  }
  return true
}
