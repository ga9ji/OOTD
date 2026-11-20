// Grand Theft Outfit [部品: cheats] スマホで打つ裏コード。
// 入口: CHEATS（番号の表） / findCheat(digits) / dialModel(digits)（スマホの画面） / lowerWanted(w) / spawnSpecial(...)
// 契約: 主人公のスマホに番号を打って発信すると、その番号の裏コードが 1 回効く。
//       画面（components/gto/GtoPhone.tsx）は通じた裏コードを engine.cheat(id) に渡し、次の 1 歩の入力（InputFrame.cheat）に載って sim が効かせる。
//       番号・名前・語呂はこのゲームのための架空のもの（実在の番号や、ほかの作品の番号は使わない）。
//       ・calm  …… 手配度を 1 つ下げる（1 のときは手配が消える）
//       ・plane …… 飛行機を、主人公の近くの車道に出す（乗り方・飛び方は aircraft.ts）
//       ・tank  …… 戦車を、主人公の近くの車道に出す（走り方は vehicle.ts の pivot / armor）
//       同じ乗り物を出し直すと、乗っていない古いほうは消える（街に溜まらない）。
//       進行の保存（save.ts）には何も足さない。出した乗り物は、ほかの車と同じく、再読み込みで消える。
import { angleDiff, dirOf } from './math'
import type { CheatId, GtoWorld, SpecialKind, VehicleState, WantedState } from './types'
import { createVehicle, VEHICLE_SPECS } from './vehicle'
import { createWanted, WANTED_TUNING } from './wanted'

export interface CheatDef {
  id: CheatId
  /** 打つ番号（数字だけ） */
  code: string
  /** メモに書く語呂（番号の読み方） */
  reading: string
  /** 何が起きるか（メモと、通じたときの一言） */
  label: string
  /** 効いたあと、街の画面に出す一言 */
  banner: string
}

export const CHEATS: CheatDef[] = [
  { id: 'calm', code: '5963', reading: 'ごくろうさん', label: '手配度を下げる', banner: '裏コード: 手配度を下げた' },
  { id: 'plane', code: '1059', reading: 'てんごく', label: '飛行機を呼ぶ', banner: '裏コード: 飛行機が届いた' },
  { id: 'tank', code: '100048', reading: 'せん・しゃ', label: '戦車を呼ぶ', banner: '裏コード: 戦車が届いた' },
]

/** 打てる桁数の上限 */
export const DIAL_MAX = 8

export const findCheat = (digits: string): CheatDef | null => CHEATS.find((c) => c.code === digits) ?? null

export const cheatOf = (id: CheatId): CheatDef => CHEATS.find((c) => c.id === id) ?? CHEATS[0]

/** 数字を 1 つ足す（上限を超えたら足さない。数字でない物は足さない） */
export const dialPush = (digits: string, key: string): string => (/^[0-9]$/.test(key) && digits.length < DIAL_MAX ? digits + key : digits)

/** 手配度を 1 つ下げる。1 から下げると手配が消える。熱さは、下げた段に収まるところまで冷ます */
export function lowerWanted(w: WantedState): WantedState {
  if (w.level <= 1) return createWanted()
  const level = w.level - 1
  return { ...w, level, heat: Math.min(w.heat, WANTED_TUNING.levels[level] - 1), bust: 0 }
}

/** 出す乗り物の色（戦車はくすんだ緑、飛行機は生成り） */
export const SPECIAL_PAINT: Record<SpecialKind, number> = { tank: 0x66704a, plane: 0xf1e7d0 }

/** 主人公からどれだけ先に出すか m（乗り物の長さの半分＋これ） */
const SPAWN_AHEAD = 2.6

/** 車体（中心と四隅と前後の端）が建物にかからないか */
function fits(world: GtoWorld, kind: SpecialKind, x: number, z: number, heading: number): boolean {
  const spec = VEHICLE_SPECS[kind]
  const f = dirOf(heading)
  const halfL = spec.length / 2
  const halfW = spec.width / 2
  for (const fw of [-halfL, 0, halfL]) {
    for (const out of [-halfW, 0, halfW]) {
      if (world.insideBuilding(x + f.x * fw - f.z * out, z + f.z * fw + f.x * out)) return false
    }
  }
  return true
}

/** その場所に置くと、ほかの車に重なるか（中心どうしの距離で見る） */
const crowded = (kind: SpecialKind, x: number, z: number, others: readonly VehicleState[]): boolean =>
  others.some((v) => Math.hypot(v.x - x, v.z - z) < VEHICLE_SPECS[kind].length / 2 + VEHICLE_SPECS[v.kind].length / 2 + 0.6)

/** 目の前がふさがっているとき、先へずらして探す刻み m と回数 */
const SPAWN_STEP = 3
const SPAWN_TRIES = 6

/**
 * 乗り物を出す場所: 主人公の目の前に、主人公と同じ向きで。
 * そこが建物やほかの車にかかるなら、少しずつ先へずらして探す。
 * 見つからなければ、いちばん近い車道の上に、道の向き（主人公の向きに近いほう）で出す。
 * 車道も無ければ、目の前の点を建物の外へ押し出した所に出す（そこにいる車は spawnSpecial が片付ける）
 */
export function specialSpot(
  world: GtoWorld,
  kind: SpecialKind,
  at: { x: number; z: number; heading: number },
  others: readonly VehicleState[] = [],
): { x: number; z: number; heading: number } {
  const spec = VEHICLE_SPECS[kind]
  const f = dirOf(at.heading)
  const reach = spec.length / 2 + SPAWN_AHEAD
  const ahead = { x: at.x + f.x * reach, z: at.z + f.z * reach }
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const x = ahead.x + f.x * SPAWN_STEP * i
    const z = ahead.z + f.z * SPAWN_STEP * i
    if (fits(world, kind, x, z, at.heading) && !crowded(kind, x, z, others)) return { x, z, heading: at.heading }
  }
  const road = world.nearestRoad(ahead.x, ahead.z, true, 60)
  if (road) {
    const along = Math.abs(angleDiff(road.heading, at.heading)) < Math.PI / 2 ? road.heading : road.heading + Math.PI
    if (fits(world, kind, road.x, road.z, along)) return { x: road.x, z: road.z, heading: along }
  }
  const out = world.resolveCircle(ahead.x, ahead.z, spec.length / 2)
  return { x: out.x, z: out.z, heading: at.heading }
}

/**
 * 乗り物を出す。同じ種類で、主人公が乗っていない古いほうは消す。
 * ほかの車に重ならない場所を探して出す（specialSpot）
 */
export function spawnSpecial(
  world: GtoWorld,
  kind: SpecialKind,
  id: number,
  at: { x: number; z: number; heading: number },
  vehicles: VehicleState[],
): VehicleState[] {
  // 同じ種類の古いほう（乗っていない物）は先に消す。その空いた場所も使える
  const others = vehicles.filter((v) => v.driver === 'player' || v.kind !== kind)
  // 主人公が乗っている車は、目の前の点から外れているので、重なりの相手に数えない場所から探し始める
  const spot = specialSpot(world, kind, at, others)
  const made = createVehicle(id, kind, spot.x, spot.z, spot.heading, world, SPECIAL_PAINT[kind])
  // それでも重なる車（空きが無くて車道へ出したとき）は片付ける。主人公の乗っている車は残す
  const kept = others.filter((v) => v.driver === 'player' || !crowded(kind, spot.x, spot.z, [v]))
  return [...kept, made]
}
