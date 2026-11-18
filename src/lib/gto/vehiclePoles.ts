// Grand Theft Outfit [部品: vehicle] 車が当たる細い柱（街灯・信号柱・街路樹の幹）。
// 入口: polesNear(world, x, z, range) / setPoles(world, poles) / limitPoleKinds(world, keep) / hitPole(...)
// 契約: 柱の置き場所は map.ts の streetProps（描画と同じ並び）から取り、世界ごとに1回だけ格子へ入れる。
//       柱は動かない。車体（向きのある長方形）と柱（円）の重なりを返すだけで、車をどう弾くかは vehicle.ts が決める。
import { streetProps, type PropKind } from './map'
import type { GtoWorld } from './types'

export interface Pole {
  x: number
  z: number
  /** 当たりの半径 m */
  r: number
}

const CELL = 8
/** 柱の当たりの半径（見た目の柱より少し太い） */
const RADIUS: Partial<Record<PropKind, number>> = { tree: 0.2, signal: 0.17 }
const DEFAULT_RADIUS = 0.14

type Index = Map<number, Pole[]>
const cache = new WeakMap<GtoWorld, Index>()
const keyOf = (cx: number, cz: number) => cx * 65536 + cz

function build(poles: readonly Pole[]): Index {
  const index: Index = new Map()
  for (const p of poles) {
    const k = keyOf(Math.floor(p.x / CELL), Math.floor(p.z / CELL))
    const list = index.get(k)
    if (list) list.push(p)
    else index.set(k, [p])
  }
  return index
}

/** 地図の街具から柱を作る。keep で種類を絞れる */
function fromProps(world: GtoWorld, keep: (kind: PropKind) => boolean = () => true): Pole[] {
  // 地図を持たない仮の世界（テスト）には柱が無い
  if (!world.map) return []
  return streetProps(world)
    .filter((p) => keep(p.kind))
    .map((p) => ({ x: p.x, z: p.z, r: RADIUS[p.kind] ?? DEFAULT_RADIUS }))
}

function indexOf(world: GtoWorld): Index {
  const found = cache.get(world)
  if (found) return found
  const made = build(fromProps(world))
  cache.set(world, made)
  return made
}

/**
 * 当たる柱を、描画が実際に描く種類だけに絞る（軽量設定は街路樹とふつうの道路照明を描かないので、
 * 見えない柱にぶつからないようにする）。keep を省くと全部に戻す
 */
export function limitPoleKinds(world: GtoWorld, keep?: (kind: PropKind) => boolean): void {
  cache.set(world, build(fromProps(world, keep)))
}

/** 世界の柱を差し替える（テストと撮影用） */
export function setPoles(world: GtoWorld, poles: readonly Pole[]): void {
  cache.set(world, build(poles))
}

/** (x, z) から range メートル以内にあるかもしれない柱 */
export function polesNear(world: GtoWorld, x: number, z: number, range: number): Pole[] {
  const index = indexOf(world)
  if (index.size === 0) return []
  const out: Pole[] = []
  for (let cx = Math.floor((x - range) / CELL); cx <= Math.floor((x + range) / CELL); cx++) {
    for (let cz = Math.floor((z - range) / CELL); cz <= Math.floor((z + range) / CELL); cz++) {
      const list = index.get(keyOf(cx, cz))
      if (list) out.push(...list)
    }
  }
  return out
}

export interface PoleHit {
  /** 車を押し出す向き（世界の座標）と距離 */
  nx: number
  nz: number
  push: number
  /** 当たった場所（車体の座標、右 lx・前 lz） */
  lx: number
  lz: number
}

/**
 * 車体（中心 x,z、前向き fx,fz、半分の長さと幅）と柱の重なり。重なっていなければ null。
 * 柱の中心が車体の中まで入っていたら、いちばん近い面から押し出す。
 */
export function hitPole(x: number, z: number, fx: number, fz: number, halfL: number, halfW: number, pole: Pole): PoleHit | null {
  const dx = pole.x - x
  const dz = pole.z - z
  // 車体の座標（右が＋x、前が＋z）
  const pz = dx * fx + dz * fz
  const px = -dx * fz + dz * fx
  if (Math.abs(pz) >= halfL + pole.r || Math.abs(px) >= halfW + pole.r) return null
  const qx = Math.max(-halfW, Math.min(halfW, px))
  const qz = Math.max(-halfL, Math.min(halfL, pz))
  let lnx: number
  let lnz: number
  let push: number
  const ox = qx - px
  const oz = qz - pz
  const d = Math.hypot(ox, oz)
  if (d > 1e-6) {
    // 柱は車体の外。いちばん近い点から柱と逆へ押す
    if (d >= pole.r) return null
    lnx = ox / d
    lnz = oz / d
    push = pole.r - d
  } else {
    // 柱が車体の中。浅いほうの面から出す
    const outFront = halfL - Math.abs(pz)
    const outSide = halfW - Math.abs(px)
    if (outFront <= outSide) {
      lnx = 0
      lnz = pz >= 0 ? -1 : 1
      push = outFront + pole.r
    } else {
      lnx = px >= 0 ? -1 : 1
      lnz = 0
      push = outSide + pole.r
    }
  }
  return { nx: -fz * lnx + fx * lnz, nz: fx * lnx + fz * lnz, push, lx: qx, lz: qz }
}
