// Grand Theft Outfit [部品: city] 斜めの形の道具と、それで作る物。斜めの梁、内側へ倒れた屋根（高架の駅のルーバー屋根）、
// 駅の建て替え工事のクレーン（赤白のマストと斜めのジブ）。
// 入口: beam / insetOutline / slopedRoof / buildCranes(cb)
// 契約: クレーンの立つ場所は map.ts の CRANES。ここは形にするだけ。
import type { CraneSpec } from '../../lib/gto/areas'
import { pointInPolygon } from '../../lib/gto/math'
import type { Flat } from '../../lib/gto/types'
import type { CityBuild } from './renderCityBuildings'
import { box, cap, windingSign, type Builder } from './renderCityGeom'

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** 4 点の面を、法線 n の側から見える向きで張る。uv は [u0, v0, u1, v1]（p0→p1 が u、p0→p3 が v） */
export function face(b: Builder, p: [V3, V3, V3, V3], n: V3, color: number, shade = 1, uv: [number, number, number, number] = [0, 0, 1, 1]) {
  const us = [uv[0], uv[2], uv[2], uv[0]]
  const vs = [uv[1], uv[1], uv[3], uv[3]]
  const i = p.map((q, k) => b.vert(q[0], q[1], q[2], n[0], n[1], n[2], us[k], vs[k], color, shade))
  if (dot(cross(sub(p[1], p[0]), sub(p[2], p[0])), n) > 0) b.quad(i[0], i[1], i[2], i[3])
  else b.quad(i[0], i[3], i[2], i[1])
}

/** 2 点を結ぶ四角い梁（斜めでもよい）。half は太さの半分 */
export function beam(b: Builder, p0: V3, p1: V3, half: number, color: number) {
  const axis = unit(sub(p1, p0))
  const side = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const up = unit(cross(side, axis))
  const at = (p: V3, s: number, u: number): V3 => [p[0] + side[0] * s * half + up[0] * u * half, p[1] + side[1] * s * half + up[1] * u * half, p[2] + side[2] * s * half + up[2] * u * half]
  const sides: [number, number, V3, number][] = [
    [1, 0, side, 0.92],
    [-1, 0, [-side[0], -side[1], -side[2]], 0.8],
    [0, 1, up, 1],
    [0, -1, [-up[0], -up[1], -up[2]], 0.65],
  ]
  for (const [s, u, n, shade] of sides) {
    // 面に沿うもう一方の向き
    const a = s !== 0 ? 0 : 1
    const c = s !== 0 ? 1 : 0
    face(b, [at(p0, s - a, u - c), at(p0, s + a, u + c), at(p1, s + a, u + c), at(p1, s - a, u - c)], n, color, shade)
  }
}

/** 輪郭を内側へ d だけ縮める（頂点ごとに、両隣の辺の法線の平均の向きへ寄せる） */
export function insetOutline(pts: Flat, d: number): Flat {
  const n = pts.length / 2
  const sign = windingSign(pts)
  const out: Flat = []
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n
    const q = (i + 1) % n
    const x = pts[i * 2]
    const z = pts[i * 2 + 1]
    const l0 = Math.hypot(x - pts[p * 2], z - pts[p * 2 + 1]) || 1
    const l1 = Math.hypot(pts[q * 2] - x, pts[q * 2 + 1] - z) || 1
    // 各辺の外向きの法線（prism と同じ決め方）
    const n0x = ((z - pts[p * 2 + 1]) / l0) * sign
    const n0z = (-(x - pts[p * 2]) / l0) * sign
    const n1x = ((pts[q * 2 + 1] - z) / l1) * sign
    const n1z = (-(pts[q * 2] - x) / l1) * sign
    let mx = n0x + n1x
    let mz = n0z + n1z
    const ml = Math.hypot(mx, mz)
    if (ml < 0.2) {
      mx = n0x
      mz = n0z
    } else {
      // 角が鋭いほど寄せる量を増やす（辺からの距離を d に保つ。増やしすぎない）
      const k = Math.min(2, 2 / (ml * ml))
      mx *= k
      mz *= k
    }
    out.push(x - mx * d, z - mz * d)
  }
  return out
}

/**
 * 内側へ倒れた屋根。輪郭の縁（高さ y0）から、内へ inset 入った所（高さ y1）へ斜めの面を張り、上を蓋で閉じる。
 * 模様は横の細い目地（ルーバー）になるよう、v を斜面の長さ pitch m ごとに1段進める。
 */
export function slopedRoof(b: Builder, roofs: Builder, pts: Flat, y0: number, y1: number, inset: number, color: number, top: number, pitch = 0.5) {
  const inner = insetOutline(pts, inset)
  const n = pts.length / 2
  const sign = windingSign(pts)
  const slope = Math.hypot(inset, y1 - y0)
  let run = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ax = pts[j * 2]
    const az = pts[j * 2 + 1]
    const bx = pts[i * 2]
    const bz = pts[i * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.05) continue
    const nx = ((bz - az) / len) * sign
    const nz = (-(bx - ax) / len) * sign
    const normal = unit([nx * (y1 - y0), inset, nz * (y1 - y0)])
    const shade = 0.86 + 0.14 * Math.max(0, nx * 0.5 - nz * 0.6 + 0.4)
    const u0 = run / 1.5 / 8
    const u1 = (run + len) / 1.5 / 8
    face(b, [[ax, y0, az], [bx, y0, bz], [inner[i * 2], y1, inner[i * 2 + 1]], [inner[j * 2], y1, inner[j * 2 + 1]]], normal, color, shade, [u0, 0, u1, slope / pitch / 8])
    run += len
  }
  cap(roofs, inner, y1, top, true)
}

const CRANE = { red: 0xd8402c, white: 0xf1f0ea, cab: 0xe9e6dc, weight: 0x8a8d90, rope: 0x3a3d40 }

/** タワークレーン 1 基。赤白に塗り分けたマスト、運転室、斜めに起こしたジブ、後ろの釣り合いおもり */
function crane(b: Builder, x: number, z: number, base: number, h: number, headingDeg: number) {
  const top = base + h
  // マスト（赤白を 7m ごとに交互）
  for (let y = base, k = 0; y < top; y += 7, k++) box(b, x, z, y, Math.min(top, y + 7), 0.9, 0.9, k % 2 ? CRANE.white : CRANE.red)
  box(b, x, z, top, top + 2.2, 1.5, 1.5, CRANE.cab)
  const a = (headingDeg * Math.PI) / 180
  const dx = Math.sin(a)
  const dz = -Math.cos(a)
  const jib = Math.min(34, h * 0.7)
  const pivot: V3 = [x + dx * 1.4, top + 1.6, z + dz * 1.4]
  const tip: V3 = [x + dx * (1.4 + jib * 0.62), top + 1.6 + jib * 0.78, z + dz * (1.4 + jib * 0.62)]
  // ジブは赤白 4 区間
  for (let k = 0; k < 4; k++) {
    const p0: V3 = [pivot[0] + ((tip[0] - pivot[0]) * k) / 4, pivot[1] + ((tip[1] - pivot[1]) * k) / 4, pivot[2] + ((tip[2] - pivot[2]) * k) / 4]
    const p1: V3 = [pivot[0] + ((tip[0] - pivot[0]) * (k + 1)) / 4, pivot[1] + ((tip[1] - pivot[1]) * (k + 1)) / 4, pivot[2] + ((tip[2] - pivot[2]) * (k + 1)) / 4]
    beam(b, p0, p1, 0.55, k % 2 ? CRANE.white : CRANE.red)
  }
  // 後ろの腕とおもり、頂部の A 形の支柱、ジブを吊る綱
  const back: V3 = [x - dx * 7, top + 2.4, z - dz * 7]
  beam(b, [x, top + 2.0, z], back, 0.45, CRANE.red)
  box(b, back[0], back[2], top + 0.6, top + 3.0, 1.3, 1.3, CRANE.weight, Math.atan2(dz, dx))
  const mastTop: V3 = [x - dx * 1.2, top + 9, z - dz * 1.2]
  beam(b, [x, top + 2.2, z], mastTop, 0.3, CRANE.red)
  beam(b, mastTop, back, 0.1, CRANE.rope)
  beam(b, mastTop, tip, 0.1, CRANE.rope)
  // 吊り荷の綱
  beam(b, tip, [tip[0], tip[1] - jib * 0.55, tip[2]], 0.06, CRANE.rope)
}

/** 工事のクレーンを立てる。建物の輪郭の中なら、その屋上から立つ。cranes はエリアごとの表（lib/gto/areas.ts） */
export function buildCranes(cb: CityBuild, cranes: readonly CraneSpec[]) {
  for (const c of cranes) {
    let base = cb.world.groundY(c.x, c.z)
    for (const bd of cb.world.map.buildings) {
      if (bd.part || !pointInPolygon(bd.pts, c.x, c.z)) continue
      base = Math.max(base, bd.y + bd.h)
    }
    crane(cb.roofs, c.x, c.z, base - 0.5, c.h, c.heading)
  }
}
