// Grand Theft Outfit [部品: city] 道玄坂下の北の角の棟。暗い外壁の前に立つ鉄骨の格子と、通りへ突き出した袖看板（109_12・dogenzaka_13 の左手前）。
// 入口: buildLattice(cb, bd)
// 契約: 置き場所と寸法は lib/gto/mapLattice.ts。看板の絵は renderCityAds（架空の名前）。当たり判定を持たない飾り。
import { pickEdge } from '../../lib/gto/mapFacade'
import { LATTICE, latticeBlades, latticeMembers } from '../../lib/gto/mapLattice'
import type { MapBuilding } from '../../lib/gto/types'
import { boardUv } from './renderCityBoards'
import type { CityBuild } from './renderCityBuildings'
import { beam } from './renderCityExtras'
import { box, wall } from './renderCityGeom'

const EDGE = 0x23262b

/** 格子・袖看板・青い帯を載せる（袖看板だけの棟もある）。決めた棟でなければ何もしない */
export function buildLattice(cb: CityBuild, bd: MapBuilding) {
  for (const m of latticeMembers(bd, cb.detail)) beam(cb.walls.blank, m.a, m.b, m.half, LATTICE.color)
  for (const b of latticeBlades(bd)) {
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az)
    const ux = (b.bx - b.ax) / len
    const uz = (b.bz - b.az) / len
    const [u0, u1, v0, v1] = boardUv(b.art)
    // 両面（通りのどちらから歩いて来ても読める）。板の厚みの分だけ表と裏を離す
    for (const side of [1, -1]) {
      const nx = -uz * side
      const nz = ux * side
      const [sx, sz, ex, ez] = side === 1 ? [b.ax, b.az, b.bx, b.bz] : [b.bx, b.bz, b.ax, b.az]
      wall(cb.boards, sx + nx * 0.16, sz + nz * 0.16, ex + nx * 0.16, ez + nz * 0.16, b.y0, b.y1, nx, nz, 0xffffff, 1, u0, u1, v0, v1)
    }
    box(cb.roofs, (b.ax + b.bx) / 2, (b.az + b.bz) / 2, b.y0 - 0.12, b.y1 + 0.12, len / 2 + 0.08, 0.13, EDGE, Math.atan2(uz, ux), 0.8)
  }
  if (bd.id !== LATTICE.building) return
  const e = pickEdge(bd.pts, LATTICE.faces[0].near)
  if (!e) return
  const { t0, t1, y0, y1, color } = LATTICE.band
  const off = LATTICE.out + 0.25
  const at = (t: number): [number, number] => [e.ax + (e.bx - e.ax) * t + e.nx * off, e.az + (e.bz - e.az) * t + e.nz * off]
  const [ax, az] = at(t0)
  const [bx, bz] = at(t1)
  box(cb.walls.blank, (ax + bx) / 2, (az + bz) / 2, bd.y + y0, bd.y + y1, Math.hypot(bx - ax, bz - az) / 2, 0.22, color, Math.atan2(bz - az, bx - ax), 1.1)
}
