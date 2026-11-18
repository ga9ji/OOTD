// Grand Theft Outfit [部品: city] JR の鉄桁ガードの裏（viaduct_05: 桁の下に入ると、画面の上半分を鉄の骨組みが覆う）。
// 入口: buildGuardSoffit(world, detail) → { steel, lamps }
// 契約: 形の決まりごとは lib/gto/mapGuard.ts。ここは箱を並べるだけ。steel は自分でも少し光る材質で描く
//       （桁の下は昼でも夕方でも灯具と路面の照り返しで骨組みが読める。真っ黒な天井にしない）。
import { GUARD_SOFFIT, guardSoffit, soffitFrame, type Seg } from '../../lib/gto/mapGuard'
import type { GtoWorld } from '../../lib/gto/types'
import { box, Builder, cylinder } from './renderCityGeom'

const C = {
  /** 床板の下面（骨組みの奥。暗い灰緑） */
  plate: 0x272d2a,
  /** 主桁と横桁（薄い灰緑の塗装） */
  main: 0x5d6761,
  cross: 0x4f5853,
  brace: 0x6b7570,
  gusset: 0x48514c,
  /** リベットの帯（主桁の下フランジに並ぶ暗い点） */
  rivet: 0x363d39,
  /** 汚れの筋 */
  stain: 0x4d4a3f,
  lamp: 0xd9ffe6,
  lampRim: 0x3d4440,
}

const mid = (s: Seg): [number, number, number, number] => [(s.ax + s.bx) / 2, (s.az + s.bz) / 2, Math.hypot(s.bx - s.ax, s.bz - s.az), Math.atan2(s.bz - s.az, s.bx - s.ax)]

export function buildGuardSoffit(world: GtoWorld, detail: boolean): { steel: Builder; lamps: Builder } {
  const steel = new Builder()
  const lamps = new Builder()
  const q = guardSoffit(world.map)
  if (!q) return { steel, lamps }
  const G = GUARD_SOFFIT
  const f = soffitFrame(q)
  const top = q.y + G.plate
  const bottom = top - G.beam
  // 床板の下面（下から見える向きに 1 枚）
  const v = [q.nw, q.ne, q.se, q.sw].map(([x, z]) => steel.vert(x, top + 0.02, z, 0, -1, 0, 0, 0, C.plate, 1))
  steel.quad(v[0], v[1], v[2], v[3])
  f.mains.forEach((s, i) => {
    const [cx, cz, len, yaw] = mid(s)
    const edge = i === 0 || i === f.mains.length - 1
    // 両端の主桁は背が高い（ガードの外から見える鼻先）
    box(steel, cx, cz, bottom - (edge ? 0.55 : 0), top, len / 2, G.mainW / 2, C.main, yaw, 1.15)
    // 下フランジ（桁より幅広の板）
    box(steel, cx, cz, bottom - (edge ? 0.6 : 0.05), bottom - (edge ? 0.55 : 0), len / 2, G.mainW * 0.9, C.main, yaw, 1.3)
    if (!detail) return
    // リベットの列と汚れ（下フランジの下面に、暗い小さな板を等間隔に）
    const n = Math.floor(len / 0.9)
    for (let k = 1; k < n; k++) {
      const t = k / n
      const px = s.ax + (s.bx - s.ax) * t
      const pz = s.az + (s.bz - s.az) * t
      if (k % 4 === 0) box(steel, px, pz, bottom - 0.12, bottom - 0.05, 0.3, G.mainW * 1.05, C.gusset, yaw, 1.15)
      else box(steel, px, pz, bottom - 0.075, bottom - 0.05, 0.05, G.mainW * 0.7, k % 7 === 3 ? C.stain : C.rivet, yaw, 1.15)
    }
  })
  f.crosses.forEach((s) => {
    const [cx, cz, len, yaw] = mid(s)
    box(steel, cx, cz, bottom + 0.14, top, len / 2, G.crossW / 2, C.cross, yaw, 1.15)
  })
  if (detail) {
    for (const s of f.braces) {
      const [cx, cz, len, yaw] = mid(s)
      box(steel, cx, cz, bottom + 0.2, bottom + 0.3, len / 2, G.braceW / 2, C.brace, yaw, 1.3)
    }
    for (const [x, z] of f.gussets) box(steel, x, z, bottom + 0.17, bottom + 0.2, 0.34, 0.34, C.gusset, Math.PI / 4, 1.2)
  }
  for (const [x, z] of f.lamps) {
    cylinder(steel, x, z, 0.3, 0.24, bottom + 0.05, bottom + 0.3, C.lampRim, { seg: 8 })
    // 灯具の面は下向きの円盤
    const c = lamps.vert(x, bottom + 0.04, z, 0, -1, 0, 0, 0, C.lamp)
    const ring: number[] = []
    for (let k = 0; k <= 8; k++) ring.push(lamps.vert(x + Math.cos((k / 8) * Math.PI * 2) * 0.24, bottom + 0.04, z + Math.sin((k / 8) * Math.PI * 2) * 0.24, 0, -1, 0, 0, 0, C.lamp))
    for (let k = 0; k < 8; k++) lamps.idx.push(c, ring[k], ring[k + 1])
  }
  return { steel, lamps }
}
