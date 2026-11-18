// Grand Theft Outfit [部品: light] その場の光（街灯・店先・尾灯・太陽の側のかすみ）の置き方。
// 入口: lampLights / boardLights / plazaLights / pickLamps / scatterAmount / scatterTint / sunGlare / haloPixels / shopStrips / tailPoolOf
// 契約: 「どこに・どの強さで光を置くか」だけを決める（three なし）。描画は renderSky.ts と renderSkyPools.ts。
//       街灯は、見ている場所に近い数個だけを本物の光源にして、路面・壁・車体に明暗の勾配を落とす。
//       scatterAmount / scatterTint / sunGlare は renderSky.ts の GLSL（scatterGlsl / shaftsGlsl）と同じ式。片方を変えたらもう片方も変える。
import { hexToLinear, spillColor, type Rgb, type ScatterParams } from './lighting'
import { isSolidBuilding, type StreetProp } from './map'
import { clamp, dirOf } from './math'
import type { Sign } from './signage'
import type { GtoWorld, VehicleState } from './types'
import { VEHICLE_SPECS } from './vehicle'

export interface LampLight {
  x: number
  z: number
  /** 灯具の高さ m（地表から） */
  height: number
  /** 光が届く距離 m */
  range: number
}

/**
 * 光源を柱から車道の側へ離す距離 m・光源の高さ m・光が届く距離 m。
 * 街の部品が描く灯具より少し下・少し車道寄りに置く（柱と灯具そのものが白く飛ばないように）
 */
const LAMP_HEAD: Record<string, [reach: number, height: number, range: number]> = {
  'lamp-plain': [3, 6.6, 34],
  'lamp-dogenzaka': [2, 4.2, 24],
  'lamp-miyamasu': [1.6, 3.8, 22],
  'lamp-koen': [1.6, 4, 22],
  'lamp-center': [1.4, 4.2, 22],
}

/** 街灯の灯具の位置に置く光源の一覧。plain を false にすると、軽量設定で柱を描かない道路照明を除く */
export function lampLights(props: readonly Pick<StreetProp, 'kind' | 'x' | 'z' | 'heading'>[], plain: boolean): LampLight[] {
  return props.flatMap((p) => {
    const spec = LAMP_HEAD[p.kind]
    if (!spec || (!plain && p.kind === 'lamp-plain')) return []
    const d = dirOf(p.heading)
    return [{ x: p.x + d.x * spec[0], z: p.z + d.z * spec[0], height: spec[1], range: spec[2] }]
  })
}

export interface BoardLight {
  x: number
  z: number
  /** 光源の高さ m（標高。看板の中心の高さ） */
  y: number
  range: number
  /** 光の色（いちばん明るい成分が 1） */
  color: Rgb
  /** 街灯1本を 1 としたときの光度 */
  power: number
}

/**
 * 光源にする大型看板の広さの下限 m²、看板の面から前へ離す距離 m、届く距離 m。
 * 光源は面のわずかに裏へ置く。面とその壁は光源に背を向けるので照らされず（看板の絵が白く飛ばない）、
 * 前の路面と向かいの壁だけが染まる
 */
const BOARD_MIN_AREA = 18
const BOARD_OUT = -0.6
const BOARD_RANGE = 55
/** 看板の色を白へ寄せる割合（色の付いた光は暗く見えるので） */
const BOARD_WHITEN = 0.45

/** 大型の広告看板と街頭ビジョン（夜に光るもの）を、前の広場や車道を染める光源にする */
export function boardLights(signs: readonly Pick<Sign, 'kind' | 'x' | 'y' | 'z' | 'w' | 'h' | 'heading' | 'bg' | 'fg' | 'lit'>[]): BoardLight[] {
  return signs.flatMap((s) => {
    if ((s.kind !== 'billboard' && s.kind !== 'vision') || !s.lit || s.w * s.h < BOARD_MIN_AREA) return []
    const d = dirOf(s.heading)
    const tint = spillColor(s.bg, s.fg)
    const color = tint.map((v) => v + (1 - v) * BOARD_WHITEN) as Rgb
    // 高い所の看板ほど遠くから照らすので、広さと高さのぶん強くする
    const power = clamp((s.w * s.h) / 30, 0.8, 3) * clamp(s.y / 6, 1, 3) ** 2
    return [{ x: s.x + d.x * BOARD_OUT, z: s.z + d.z * BOARD_OUT, y: s.y, range: BOARD_RANGE, color, power }]
  })
}

/**
 * スクランブル交差点の広場を照らす光源。広場には街灯を立てない（map.ts）ので、周りの街頭ビジョンと
 * 店の明かりが広場へ落ちる分を、広場の縁に置いた3つの光で表す。
 * 届く距離は広場の中だけにする（周りのビルの壁やビジョンまで照らすと、絵が白く飛ぶ）。
 */
export function plazaLights(world: Pick<GtoWorld, 'groundY'>): BoardLight[] {
  const ring: [angle: number, color: Rgb][] = [
    [0.4, [0.72, 0.9, 1]],
    [2.5, [1, 0.62, 0.82]],
    [4.6, [1, 0.86, 0.62]],
  ]
  return ring.map(([a, color]) => {
    const x = Math.cos(a) * PLAZA_RING
    const z = Math.sin(a) * PLAZA_RING
    return { x, z, y: world.groundY(x, z) + PLAZA_HEIGHT, range: PLAZA_RANGE, color, power: PLAZA_POWER }
  })
}

/** 広場の光源を置く円の半径 m・高さ m・届く距離 m・光度（街灯1本を 1 として） */
const PLAZA_RING = 20
const PLAZA_HEIGHT = 10
const PLAZA_RANGE = 46
const PLAZA_POWER = 7

export interface LampSlot {
  /** lamps の添字。空き枠は −1 */
  index: number
  /** 光の強さに掛ける 0..1 */
  weight: number
}

/** 境目の距離のこの割合から弱め始める */
const FADE_START = 0.72

/**
 * (fx, fz) に近い街灯を count 個選ぶ。返す配列は常に count 個（足りない枠は index −1・重み 0）。
 * 「選ばれなかった中でいちばん近い街灯」の距離を境目にして、そこへ近づくほど重みを 0 へ落とす。
 * 入れ替わる瞬間はどちらも重み 0 なので、走っていても光が跳ねない。
 */
export function pickLamps(lamps: readonly { x: number; z: number }[], fx: number, fz: number, count: number, maxDist: number): LampSlot[] {
  // 近い順に count+1 個だけ覚える（全部を並べ替えない）
  const best: { index: number; d: number }[] = []
  for (let i = 0; i < lamps.length; i++) {
    const d = Math.hypot(lamps[i].x - fx, lamps[i].z - fz)
    if (best.length > count && d >= best[count].d) continue
    let at = best.length
    while (at > 0 && best[at - 1].d > d) at--
    best.splice(at, 0, { index: i, d })
    if (best.length > count + 1) best.pop()
  }
  const cut = Math.min(maxDist, best.length > count ? best[count].d : maxDist)
  return Array.from({ length: count }, (_, i): LampSlot => {
    const b = best[i]
    if (!b) return { index: -1, weight: 0 }
    const t = clamp((b.d - cut * FADE_START) / Math.max(1e-6, cut * (1 - FADE_START)), 0, 1)
    return { index: b.index, weight: 1 - t * t * (3 - 2 * t) }
  })
}

/** 視線が太陽の側をどれだけ向いているか（0..1）。wrap のぶんだけ、横を向いても太陽の側として数える */
export const scatterLobe = (cos: number, s: ScatterParams): number => clamp((cos + s.wrap) / (1 + s.wrap), 0, 1) ** s.power

/**
 * 距離 dist（m）にある物が、太陽の側のかすみ（光る霧）へどれだけ溶けるか（0..1）。
 * cos は「視線と太陽の向きの内積」。太陽の方を向くほど、遠いほど濃い。
 */
export function scatterAmount(dist: number, cos: number, s: ScatterParams): number {
  if (s.strength <= 0) return 0
  const phase = s.ambient + (1 - s.ambient) * scatterLobe(cos, s)
  return s.strength * phase * (1 - Math.exp(-Math.max(0, dist) / s.length))
}

/** かすみの色（リニア）。太陽の方を向くと光る霧の色、背にすると沈んだ霧の色 */
export function scatterTint(cos: number, s: ScatterParams): Rgb {
  const k = scatterLobe(cos, s)
  const sun = hexToLinear(s.color)
  const back = hexToLinear(s.backColor)
  return back.map((b, i) => b + (sun[i] * s.gain - b) * k) as Rgb
}

/** 逆光のにじみの広がり。[太陽からの絞り, 重み] を3段（広い暈・光芒・芯）で重ねる */
export const GLARE_LOBES: readonly (readonly [power: number, weight: number])[] = [
  [8, 0.3],
  [64, 0.9],
  [700, 3],
]

/**
 * 逆光のにじみの量（太陽の色に掛ける）。cos は視線と太陽の向きの内積、
 * visible は「その画素から太陽へ向かう途中で空が見えている割合」（0..1。建物に隠れていれば 0）。
 */
export function sunGlare(cos: number, visible: number, strength: number): number {
  const c = Math.max(0, cos)
  if (strength <= 0 || c <= 0) return 0
  return strength * clamp(visible, 0, 1) * GLARE_LOBES.reduce((sum, [power, weight]) => sum + weight * c ** power, 0)
}

export interface ShopStrip {
  /** 壁の辺の両端 */
  ax: number
  az: number
  bx: number
  bz: number
  /** 建物の外へ向く向き（長さ 1） */
  nx: number
  nz: number
}

/** 店先の帯を持つ建物の高さの下限（街の部品の建て方と同じ）と、帯を置く辺の長さの下限 m */
const SHOP_MIN_HEIGHT = 6.5
const SHOP_MIN_EDGE = 3
/** 壁からこの距離までに道があれば「道に面している」とみなす */
const SHOP_ROAD_REACH = 14

/** 1階が光る店先（道に面した壁の辺）の一覧。ここから歩道へ明かりがこぼれる */
export function shopStrips(world: GtoWorld): ShopStrip[] {
  const out: ShopStrip[] = []
  world.map.buildings.forEach((bd, bi) => {
    if (!isSolidBuilding(bd) || bd.h < SHOP_MIN_HEIGHT || world.passUnder[bi]) return
    const n = bd.pts.length / 2
    for (let i = 0; i < n; i++) {
      const ax = bd.pts[i * 2]
      const az = bd.pts[i * 2 + 1]
      const bx = bd.pts[((i + 1) % n) * 2]
      const bz = bd.pts[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < SHOP_MIN_EDGE) continue
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      for (const side of [1, -1]) {
        const nx = ((bz - az) / len) * side
        const nz = (-(bx - ax) / len) * side
        // 外側が開けている向きだけ（隣の建物との隙間は除く）
        if (world.insideBuilding(mx + nx * 1.5, mz + nz * 1.5) || world.insideBuilding(mx + nx * 3.5, mz + nz * 3.5)) continue
        if (!world.nearestRoad(mx + nx * 3, mz + nz * 3, false, SHOP_ROAD_REACH)) continue
        out.push({ ax, az, bx, bz, nx, nz })
        break
      }
    }
  })
  return out
}

export interface TailPool {
  /** 光だまりの中心 */
  x: number
  z: number
  /** 車の向き（光だまりの長い方向） */
  heading: number
  /** 車の前後方向・左右方向の半径 m */
  along: number
  across: number
  /** 強さに掛ける値（走行中 1、ブレーキ中はそれより強い） */
  strength: number
}

/** これより強く減速していたらブレーキ灯とみなす m/s² */
const BRAKE_DECEL = 3
const BRAKE_BOOST = 2.4

/** 車の後ろの路面にできる赤い光だまり。乗り捨てた車（灯りを消している）は null */
export function tailPoolOf(v: Pick<VehicleState, 'x' | 'z' | 'heading' | 'speed' | 'accel' | 'driver' | 'kind'>): TailPool | null {
  if (v.driver === 'none') return null
  const spec = VEHICLE_SPECS[v.kind]
  const d = dirOf(v.heading)
  const back = spec.length / 2 + 1.5
  const braking = v.speed > 0.5 && v.accel < -BRAKE_DECEL
  return { x: v.x - d.x * back, z: v.z - d.z * back, heading: v.heading, along: 2.6, across: spec.width * 1.25, strength: braking ? BRAKE_BOOST : 1 }
}

/** 光の暈が画面を覆わないための上限（画面の高さに対する割合） */
export const HALO_MAX_SCREEN = 0.45

/**
 * 直径 size m の光の暈が、dist m 先で画面上に何画素で見えるか。
 * viewportHeight は描画先の高さ（画素）、fovDeg は縦の画角（度）。カメラの後ろ（dist <= 0）は 0。
 */
export function haloPixels(size: number, dist: number, viewportHeight: number, fovDeg: number): number {
  if (dist <= 0) return 0
  const scale = viewportHeight / 2 / Math.tan((fovDeg * Math.PI) / 360)
  return Math.min((size * scale) / dist, viewportHeight * HALO_MAX_SCREEN)
}
