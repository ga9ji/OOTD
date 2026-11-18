// Grand Theft Outfit [部品: city] 街具。通りごとの街灯・街路樹・信号柱（センター街入口のゲートは renderCityGate.ts）。
// 入口: buildProps(world, all) → 形（頂点色だけ）と、光る部分（灯具・信号の灯）
// 契約: 置き場所は map.ts の streetProps が決める。ここは形にするだけ。文字やロゴは描かない。
import { streetProps, type StreetProp } from '../../lib/gto/map'
import { hash } from '../../lib/gto/math'
import type { GtoWorld } from '../../lib/gto/types'
import { box, Builder, cylinder } from './renderCityGeom'

const C = {
  darkGreen: 0x1f4a3a,
  black: 0x1c1d20,
  silver: 0xc3c7cb,
  grey: 0x8c9094,
  trunk: 0x5a4a3c,
  leaves: [0x4f7a3c, 0x5c8a44, 0x45703a, 0x6a9450],
  /** 街灯に下がる縦長バナーの色（架空の催しの色面だけ） */
  banners: [0xd8366f, 0x2b6cff, 0xf2c230, 0x18b7c9, 0xf4f1ea, 0x7a3cc9],
  lampGlow: 0xfff2cf,
}

interface PropBuild {
  solid: Builder
  glow: Builder
  /** 通り名の札の字（renderCityGate の createGateTexture の上半分を貼る） */
  art: Builder
}

/** 行灯の街灯の寸法 m（center-gai_11/15: 太い銀の柱、丸い灯具 4 つの房、その下に通り名の横長の札） */
// 札は街灯の小さな銘板（center-gai_12）。通りをまたぐ入口の看板に見えない大きさにする
const CENTER_LAMP = { poleH: 5.0, pole: 0.11, plateY: 3.9, plateH: 0.3, plateHalf: 0.62, char: 0.155, globe: 0.3 }
/** 通り名の字の数と、絵の中の 1 字ぶんの範囲（renderCityGate の割り付け: 横 1/8 ずつ、縦は字の入る帯だけ） */
const NAME_CHARS = 7
const NAME_V: [number, number] = [0.617, 0.867]

/** 通り名の札。通りを歩く人が前からも後ろからも読めるよう、通りと直角に両面。(sx, sz) は通りに沿う向き、yaw は通りの中心へ向く向き */
function namePlate(pb: PropBuild, x: number, z: number, y: number, sx: number, sz: number, yaw: number) {
  const L = CENTER_LAMP
  // 札の縁（銀）
  box(pb.solid, x, z, y - 0.05, y + L.plateH + 0.05, L.plateHalf + 0.06, 0.15, C.grey, yaw)
  for (const dir of [-1, 1]) {
    const nx = sx * dir
    const nz = sz * dir
    // 見る人の右向き
    const rx = nz
    const rz = -nx
    const quad = (b: Builder, u0: number, u1: number, v0: number, v1: number, off: number, t: [number, number, number, number], color: number) => {
      const at = (u: number, v: number) => b.vert(x + rx * u + nx * off, y + v, z + rz * u + nz * off, nx, 0, nz, u === u0 ? t[0] : t[1], v === v0 ? t[2] : t[3], color)
      const i = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
      // 表が法線の側を向く並び（(右 × 上)・法線 の符号で決める）
      if (rx * nz - rz * nx > 0) b.quad(i[0], i[1], i[2], i[3])
      else b.quad(i[0], i[3], i[2], i[1])
    }
    quad(pb.solid, -L.plateHalf, L.plateHalf, 0, L.plateH, 0.16, [0, 0, 0, 0], 0xe4e6e8)
    const total = L.char * NAME_CHARS
    for (let k = 0; k < NAME_CHARS; k++) {
      const u0 = -total / 2 + k * L.char
      quad(pb.art, u0, u0 + L.char, (L.plateH - L.char) / 2, (L.plateH + L.char) / 2, 0.172, [k / 8, (k + 1) / 8, NAME_V[0], NAME_V[1]], 0xffffff)
    }
  }
}

/** 柱から (dx, dz) の向きへ伸びる水平の腕 */
function arm(b: Builder, x: number, z: number, y: number, dx: number, dz: number, len: number, color: number, thick = 0.06) {
  box(b, x + (dx * len) / 2, z + (dz * len) / 2, y - thick, y + thick, len / 2, thick, color, Math.atan2(dz, dx))
}

function lamp(pb: PropBuild, p: StreetProp, y: number) {
  const { solid, glow } = pb
  // 車道の中心へ向く向き
  const dx = Math.sin(p.heading)
  const dz = -Math.cos(p.heading)
  // 道に沿う向き
  const sx = -dz
  const sz = dx
  const yaw = Math.atan2(dz, dx)
  const seed = hash(p.x, p.z)
  const banner = (h0: number, h1: number, side: number, color: number) =>
    box(solid, p.x + sx * 0.42 * side, p.z + sz * 0.42 * side, y + h0, y + h1, 0.03, 0.3, color, yaw)
  switch (p.kind) {
    case 'lamp-dogenzaka': {
      // 濃緑の柱に釣鐘型の灯具。柱に白い札と縦長バナー2枚
      box(solid, p.x, p.z, y, y + 5.6, 0.09, 0.09, C.darkGreen)
      box(solid, p.x, p.z, y, y + 0.9, 0.16, 0.16, C.darkGreen)
      arm(solid, p.x, p.z, y + 5.5, dx, dz, 0.9, C.darkGreen)
      cylinder(solid, p.x + dx * 0.9, p.z + dz * 0.9, 0.34, 0.1, y + 5.2, y + 5.5, C.darkGreen, { seg: 8 })
      cylinder(glow, p.x + dx * 0.9, p.z + dz * 0.9, 0.2, 0.3, y + 4.8, y + 5.2, C.lampGlow, { seg: 8 })
      const c = Math.floor(seed * C.banners.length)
      banner(3.0, 4.5, 1, C.banners[c])
      banner(3.0, 4.5, -1, C.banners[(c + 1) % C.banners.length])
      box(solid, p.x + dx * 0.14, p.z + dz * 0.14, y + 1.7, y + 2.7, 0.02, 0.11, 0xf4f4f0, yaw)
      break
    }
    case 'lamp-koen': {
      // 濃緑の柱に丸い灯具2つ、縦長バナー2枚
      box(solid, p.x, p.z, y, y + 4.8, 0.08, 0.08, C.darkGreen)
      arm(solid, p.x - sx * 0.5, p.z - sz * 0.5, y + 4.6, sx, sz, 1.0, C.darkGreen)
      for (const s of [-1, 1]) cylinder(glow, p.x + sx * 0.5 * s, p.z + sz * 0.5 * s, 0.22, 0.22, y + 4.65, y + 5.05, C.lampGlow, { seg: 8, cap: C.lampGlow })
      const c = Math.floor(seed * C.banners.length)
      banner(2.8, 4.2, 1, C.banners[c])
      banner(2.8, 4.2, -1, C.banners[c])
      break
    }
    case 'lamp-miyamasu': {
      // 黒い柱に 2 灯のランタン（miyamasuzaka_04/05: 横木の両端に、黒い笠を載せた台形のガラスの灯具）
      box(solid, p.x, p.z, y, y + 4.5, 0.08, 0.08, C.black)
      box(solid, p.x, p.z, y, y + 1.0, 0.13, 0.13, C.black)
      // 横木は通りと直角（歩道を歩く人から 2 灯が左右に並んで見える）
      arm(solid, p.x - dx * 0.7, p.z - dz * 0.7, y + 4.15, dx, dz, 1.4, C.black, 0.05)
      for (const s of [-1, 1]) {
        const lx = p.x + dx * 0.7 * s
        const lz = p.z + dz * 0.7 * s
        cylinder(solid, lx, lz, 0.1, 0.14, y + 4.2, y + 4.32, C.black, { seg: 4 })
        cylinder(glow, lx, lz, 0.15, 0.24, y + 4.32, y + 4.86, C.lampGlow, { seg: 4 })
        cylinder(solid, lx, lz, 0.32, 0.06, y + 4.86, y + 5.08, C.black, { seg: 4, cap: C.black })
      }
      break
    }
    case 'lamp-center': {
      // 太い銀色の柱。上に丸い灯具 4 つの房、その下に通り名の横長の札（通り名は実名）
      const L = CENTER_LAMP
      cylinder(solid, p.x, p.z, L.pole + 0.07, L.pole + 0.07, y, y + 1.0, C.grey, { seg: 8 })
      cylinder(solid, p.x, p.z, L.pole, L.pole, y + 1.0, y + L.poleH, C.silver, { seg: 8 })
      // 柱の中ほどの巻き広告（色の帯だけ）
      cylinder(solid, p.x, p.z, L.pole + 0.1, L.pole + 0.1, y + 1.9, y + 2.9, C.banners[Math.floor(seed * C.banners.length)], { seg: 8 })
      cylinder(solid, p.x, p.z, 0.5, 0.5, y + L.poleH - 0.12, y + L.poleH, C.grey, { seg: 8, cap: C.grey })
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4
        const gx = p.x + Math.cos(a) * 0.42
        const gz = p.z + Math.sin(a) * 0.42
        cylinder(glow, gx, gz, L.globe * 0.6, L.globe, y + L.poleH, y + L.poleH + 0.22, C.lampGlow, { seg: 8 })
        cylinder(glow, gx, gz, L.globe, L.globe * 0.5, y + L.poleH + 0.22, y + L.poleH + 0.46, C.lampGlow, { seg: 8, cap: C.lampGlow })
        cylinder(solid, gx, gz, L.globe * 0.75, L.globe * 0.2, y + L.poleH + 0.46, y + L.poleH + 0.56, C.grey, { seg: 8, cap: C.grey })
      }
      namePlate(pb, p.x, p.z, y + L.plateY, sx, sz, yaw)
      break
    }
    default: {
      // 灰色の柱から車道へ腕を伸ばす道路照明
      box(solid, p.x, p.z, y, y + 8, 0.1, 0.1, C.grey)
      arm(solid, p.x, p.z, y + 7.9, dx, dz, 2.2, C.grey)
      box(solid, p.x + dx * 2.2, p.z + dz * 2.2, y + 7.78, y + 7.9, 0.45, 0.16, C.grey, yaw)
      box(glow, p.x + dx * 2.2, p.z + dz * 2.2, y + 7.7, y + 7.78, 0.36, 0.12, C.lampGlow, yaw)
    }
  }
}

/**
 * ケヤキ。幹が 2 階の上まで伸び、そこから枝が扇形に広がって 4〜5 階の高さに届く（109_09 / dogenzaka_03 / miyamasuzaka_13）。
 * 葉の塊は、下が細く上が広い逆さの円錐を芯に、まわりへ 4 つ。
 */
function tree(pb: PropBuild, p: StreetProp, y: number) {
  const seed = hash(p.x, p.z, 3)
  const h = 11 + seed * 5
  const r = 2.6 + hash(p.x, p.z, 4) * 1.4
  const li = Math.floor(seed * C.leaves.length)
  const leaf = C.leaves[li]
  const dark = C.leaves[(li + 2) % C.leaves.length]
  const fork = h * 0.36
  box(pb.solid, p.x, p.z, y, y + fork, 0.17, 0.17, C.trunk)
  // 足元の植え込みの枠
  box(pb.solid, p.x, p.z, y, y + 0.12, 0.7, 0.7, 0x6f6a62)
  // 扇形に開く太い枝
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + seed * 6
    cylinder(pb.solid, p.x + Math.cos(a) * r * 0.22, p.z + Math.sin(a) * r * 0.22, 0.1, 0.07, y + fork - 0.3, y + h * 0.62, C.trunk, { seg: 4 })
  }
  // 芯: 逆さの円錐の上に丸い頭
  cylinder(pb.solid, p.x, p.z, r * 0.35, r, y + h * 0.42, y + h * 0.7, dark, { seg: 7 })
  cylinder(pb.solid, p.x, p.z, r, r * 0.45, y + h * 0.7, y + h, leaf, { seg: 7, cap: leaf })
  // まわりの塊
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + seed * 9
    const cx = p.x + Math.cos(a) * r * 0.62
    const cz = p.z + Math.sin(a) * r * 0.62
    const s = 0.5 + hash(p.x, p.z, k + 5) * 0.25
    const y0 = y + h * (0.48 + hash(p.x, k, 6) * 0.14)
    const y1 = y0 + h * 0.3
    cylinder(pb.solid, cx, cz, r * s * 0.5, r * s, y0, (y0 + y1) / 2, k % 2 ? leaf : dark, { seg: 6 })
    cylinder(pb.solid, cx, cz, r * s, r * s * 0.4, (y0 + y1) / 2, y1, k % 2 ? dark : leaf, { seg: 6, cap: leaf })
  }
}

/** 信号柱。黒い柱から水平に長い腕、先に横型の灯器 */
function signal(pb: PropBuild, p: StreetProp, y: number) {
  const dx = Math.sin(p.heading)
  const dz = -Math.cos(p.heading)
  const yaw = Math.atan2(dz, dx)
  box(pb.solid, p.x, p.z, y, y + 6.4, 0.12, 0.12, C.black)
  arm(pb.solid, p.x, p.z, y + 6.1, dx, dz, 5.2, C.black, 0.08)
  const hx = p.x + dx * 4.4
  const hz = p.z + dz * 4.4
  box(pb.solid, hx, hz, y + 5.35, y + 5.85, 0.75, 0.12, C.black, yaw)
  // 灯は腕と直角の両面に（青・黄・赤）
  const lights = [0x3ee6a8, 0x6b5a1e, 0x7a1f1f]
  for (const face of [-1, 1]) {
    lights.forEach((color, k) => {
      const o = (k - 1) * 0.46
      box(pb.glow, hx + dx * o - dz * 0.14 * face, hz + dz * o + dx * 0.14 * face, y + 5.46, y + 5.74, 0.14, 0.02, color, yaw)
    })
  }
  // 歩行者用の灯器
  box(pb.solid, p.x + dx * 0.25, p.z + dz * 0.25, y + 2.6, y + 3.3, 0.1, 0.18, C.black, yaw)
  // 歩行者用の赤い灯（腕と直角の両面。viaduct_01 の橋の手前の赤い点）
  for (const face of [-1, 1]) box(pb.glow, p.x + dx * 0.25 - dz * 0.2 * face, p.z + dz * 0.25 + dx * 0.2 * face, y + 3.0, y + 3.24, 0.08, 0.02, 0xff3b2f, yaw)
}

export function buildProps(world: GtoWorld, all: boolean): PropBuild {
  const pb: PropBuild = { solid: new Builder(), glow: new Builder(), art: new Builder() }
  for (const p of streetProps(world)) {
    // 軽量設定では、信号と通りの印になる街灯だけ（街路樹とふつうの道路照明は省く）
    if (!all && (p.kind === 'tree' || p.kind === 'lamp-plain')) continue
    const y = world.groundY(p.x, p.z)
    if (p.kind === 'tree') tree(pb, p, y)
    else if (p.kind === 'signal') signal(pb, p, y)
    else lamp(pb, p, y)
  }
  return pb
}
