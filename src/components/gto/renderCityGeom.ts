// Grand Theft Outfit [部品: city] 街の形を組み立てる道具。頂点を溜める Builder と、帯・箱・柱・押し出し。
// 入口: Builder / ribbon / disc / box / cylinder / prism
// 契約: three の BufferGeometry を作るだけ。地図や見た目の決まりごとは持たない。
import * as THREE from 'three'
import type { Flat } from '../../lib/gto/types'

/** 頂点を溜めていって、最後に1つの BufferGeometry にまとめる */
export class Builder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  col: number[] = []
  idx: number[] = []
  private c = new THREE.Color()

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, color: number, shade = 1) {
    this.pos.push(x, y, z)
    this.nor.push(nx, ny, nz)
    this.uv.push(u, v)
    this.c.setHex(color)
    this.col.push(this.c.r * shade, this.c.g * shade, this.c.b * shade)
    return this.pos.length / 3 - 1
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d)
  }

  get empty() {
    return this.idx.length === 0
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    return g
  }
}

/** 折れ線を細かく割る（坂に沿わせるため）。[x, z] の列で返す */
export function densify(pts: Flat, step: number): [number, number][] {
  const out: [number, number][] = [[pts[0], pts[1]]]
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2]
    const az = pts[i - 1]
    const len = Math.hypot(pts[i] - ax, pts[i + 1] - az)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((pts[i] - ax) * k) / n, az + ((pts[i + 1] - az) * k) / n])
  }
  return out
}

/** 折れ線を、進行方向の右へ side メートルずらす */
export function offsetLine(line: [number, number][], side: number): [number, number][] {
  return line.map(([x, z], i) => {
    const [px, pz] = line[Math.max(0, i - 1)]
    const [qx, qz] = line[Math.min(line.length - 1, i + 1)]
    const dl = Math.hypot(qx - px, qz - pz) || 1
    return [x - ((qz - pz) / dl) * side, z + ((qx - px) / dl) * side]
  })
}

/**
 * 折れ線に沿った帯を足す。yAt は (x, z, 折れ線の何番目の点か) → 高さ。
 * 横にも分割して、傾いた地面に沿わせる。u は幅方向（0..1）、v は道のり（m）。worldUv なら u,v は地面の座標 ÷4。
 */
export function ribbon(
  b: Builder,
  line: [number, number][],
  width: number,
  yAt: (x: number, z: number, i: number) => number,
  color: number,
  across = 2,
  worldUv = false,
) {
  if (line.length < 2) return
  let dist = 0
  let prev: number[] | null = null
  for (let i = 0; i < line.length; i++) {
    const [x, z] = line[i]
    const [px, pz] = line[Math.max(0, i - 1)]
    const [qx, qz] = line[Math.min(line.length - 1, i + 1)]
    const dx = qx - px
    const dz = qz - pz
    const dl = Math.hypot(dx, dz) || 1
    // 進行方向の右
    const rx = -dz / dl
    const rz = dx / dl
    if (i > 0) dist += Math.hypot(x - px, z - pz)
    const row: number[] = []
    for (let k = 0; k <= across; k++) {
      const t = k / across - 0.5
      const vx = x + rx * width * t
      const vz = z + rz * width * t
      row.push(b.vert(vx, yAt(vx, vz, i), vz, 0, 1, 0, worldUv ? vx / 4 : k / across, worldUv ? vz / 4 : dist, color))
    }
    if (prev) for (let k = 0; k < across; k++) b.quad(prev[k], prev[k + 1], row[k + 1], row[k])
    prev = row
  }
}

/** 角を丸くつなぐための円盤（道の曲がり角と行き止まりの隙間を埋める） */
export function disc(b: Builder, x: number, z: number, r: number, yAt: (x: number, z: number) => number, color: number, seg = 10) {
  const c = b.vert(x, yAt(x, z), z, 0, 1, 0, x / 4, z / 4, color)
  const ring: number[] = []
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2
    const vx = x + Math.cos(a) * r
    const vz = z + Math.sin(a) * r
    ring.push(b.vert(vx, yAt(vx, vz), vz, 0, 1, 0, vx / 4, vz / 4, color))
  }
  for (let k = 0; k < seg; k++) b.idx.push(c, ring[(k + 1) % seg], ring[k])
}

/** 縦の面を1枚。a→b を下辺として、法線 (nx, nz) の側から見える向きに張る */
export function wall(
  b: Builder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  nx: number,
  nz: number,
  color: number,
  shade = 1,
  u0 = 0,
  u1 = 1,
  v0 = 0,
  v1 = 1,
) {
  const p0 = b.vert(ax, y0, az, nx, 0, nz, u0, v0, color, shade)
  const p1 = b.vert(bx, y0, bz, nx, 0, nz, u1, v0, color, shade)
  const p2 = b.vert(bx, y1, bz, nx, 0, nz, u1, v1, color, shade)
  const p3 = b.vert(ax, y1, az, nx, 0, nz, u0, v1, color, shade)
  // 見える側から反時計回りになる順を選ぶ
  const cross = (bx - ax) * nz - (bz - az) * nx
  if (cross > 0) b.quad(p0, p1, p2, p3)
  else b.quad(p0, p3, p2, p1)
}

/** 向きを回せる箱（柱・桁・箱形の小物）。yaw は y 軸まわりの回転（ラジアン）。上面も張る */
export function box(b: Builder, cx: number, cz: number, y0: number, y1: number, hx: number, hz: number, color: number, yaw = 0, shade = 0.9) {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const at = (lx: number, lz: number): [number, number] => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos]
  const corners = [at(-hx, -hz), at(hx, -hz), at(hx, hz), at(-hx, hz)]
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i]
    const [bx, bz] = corners[(i + 1) % 4]
    const len = Math.hypot(bx - ax, bz - az) || 1
    const nx = (bz - az) / len
    const nz = -(bx - ax) / len
    wall(b, ax, az, bx, bz, y0, y1, nx, nz, color, shade * (0.86 + 0.14 * Math.max(0, nx * 0.5 - nz * 0.6 + 0.4)))
  }
  const t = corners.map(([x, z]) => b.vert(x, y1, z, 0, 1, 0, 0, 0, color, shade * 1.08))
  b.quad(t[0], t[3], t[2], t[1])
  const u = corners.map(([x, z]) => b.vert(x, y0, z, 0, -1, 0, 0, 0, color, shade * 0.6))
  b.quad(u[0], u[1], u[2], u[3])
}

/** 縦の円筒（角度の範囲を絞れば曲面の壁）。uPerMeter は周方向の u の進み */
export function cylinder(
  b: Builder,
  cx: number,
  cz: number,
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  color: number,
  opts: { seg?: number; from?: number; to?: number; uPerMeter?: number; v0?: number; v1?: number; cap?: number | null } = {},
) {
  const seg = opts.seg ?? 20
  const from = opts.from ?? 0
  const to = opts.to ?? Math.PI * 2
  const uScale = opts.uPerMeter ?? 0
  const lower: number[] = []
  const upper: number[] = []
  for (let k = 0; k <= seg; k++) {
    const a = from + ((to - from) * k) / seg
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    const shade = 0.8 + 0.2 * Math.max(0, nx * 0.5 - nz * 0.6 + 0.4)
    const u = uScale * a * Math.max(r0, r1)
    lower.push(b.vert(cx + nx * r0, y0, cz + nz * r0, nx, 0, nz, u, opts.v0 ?? 0, color, shade))
    upper.push(b.vert(cx + nx * r1, y1, cz + nz * r1, nx, 0, nz, u, opts.v1 ?? 1, color, shade))
  }
  for (let k = 0; k < seg; k++) b.quad(lower[k], upper[k], upper[k + 1], lower[k + 1])
  if (opts.cap != null) {
    const c = b.vert(cx, y1, cz, 0, 1, 0, 0, 0, opts.cap)
    const ring: number[] = []
    for (let k = 0; k <= seg; k++) {
      const a = from + ((to - from) * k) / seg
      ring.push(b.vert(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, 0, 0, opts.cap))
    }
    for (let k = 0; k < seg; k++) b.idx.push(c, ring[k + 1], ring[k])
  }
}

/** 輪郭（閉じていない [x,z,...]）の向き。上から見て時計回りなら 1 */
export function windingSign(pts: Flat): 1 | -1 {
  const n = pts.length / 2
  let area = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) area += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1]
  return area > 0 ? 1 : -1
}

/** 輪郭の重心（頂点の平均） */
export function centroidOf(pts: Flat): [number, number] {
  let x = 0
  let z = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    x += pts[i * 2]
    z += pts[i * 2 + 1]
  }
  return [x / n, z / n]
}

/** 輪郭を重心まわりに拡大縮小して、ずらす */
export function scaleOutline(pts: Flat, scale: number, dx = 0, dz = 0): Flat {
  const [cx, cz] = centroidOf(pts)
  const out: Flat = []
  for (let i = 0; i < pts.length; i += 2) out.push(cx + (pts[i] - cx) * scale + dx, cz + (pts[i + 1] - cz) * scale + dz)
  return out
}

/** 輪郭の蓋（上向き、または下向き）を張る */
export function cap(b: Builder, pts: Flat, y: number, color: number, up = true, shade = 1) {
  const n = pts.length / 2
  if (n < 3) return
  const contour: THREE.Vector2[] = []
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]))
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const base = b.pos.length / 3
  for (let i = 0; i < n; i++) b.vert(pts[i * 2], y, pts[i * 2 + 1], 0, up ? 1 : -1, 0, 0, 0, color, shade)
  for (const [a, c, d] of tris) {
    const cross = (contour[c].x - contour[a].x) * (contour[d].y - contour[a].y) - (contour[c].y - contour[a].y) * (contour[d].x - contour[a].x)
    // x-z 平面で反時計回り（cross > 0）の三角形は、そのままだと下向きになる
    if (cross > 0 === up) b.idx.push(base + a, base + d, base + c)
    else b.idx.push(base + a, base + c, base + d)
  }
}

export interface PrismOpts {
  color: number
  /** 壁の模様の u/v を決める。bay = 窓1スパンの幅 m、floor = 1階ぶんの高さ m、cells = テクスチャ1枚に並ぶスパン数 */
  bay: number
  floor: number
  cells?: number
  /** v の基準になる高さ（ここが階の境目になる） */
  baseY: number
  uOff?: number
  vOff?: number
  /** 階をまたがず、y0..y1 に模様の縦1枚ぶんをちょうど当てる（店先の帯・桁） */
  fitV?: boolean
}

/** 輪郭を y0..y1 に押し出した壁（蓋は張らない） */
export function prism(b: Builder, pts: Flat, y0: number, y1: number, o: PrismOpts) {
  const n = pts.length / 2
  if (n < 3 || y1 - y0 < 0.05) return
  const sign = windingSign(pts)
  const cells = o.cells ?? 8
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
    // 面の向きで少し明るさを変えて、陰影の無い軽量設定でも立体に見せる
    const shade = 0.82 + 0.18 * Math.max(0, nx * 0.5 - nz * 0.6 + 0.4)
    // 窓が辺の端で半端に切れないよう、スパン数を整数に丸める
    const bays = Math.max(1, Math.round(len / o.bay))
    const u0 = run / cells + (o.uOff ?? 0) / cells
    const u1 = u0 + bays / cells
    const v0 = o.fitV ? 0 : (y0 - o.baseY) / o.floor / cells + (o.vOff ?? 0) / cells
    const v1 = o.fitV ? 1 : (y1 - o.baseY) / o.floor / cells + (o.vOff ?? 0) / cells
    wall(b, ax, az, bx, bz, y0, y1, nx, nz, o.color, shade, u0, u1, v0, v1)
    run += bays
  }
}
