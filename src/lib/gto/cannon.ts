// Grand Theft Outfit [部品: cheats] 戦車の砲（裏コードで出す戦車。lib/gto/cheats.ts）。
// 入口: CANNON_TUNING / muzzleOf(tank) / aimShot(world, tank, vehicles) / blastVehicle(v, blast) / canFire(tank)
// 契約: 砲は車体と同じ向きに固定（砲塔は回らない）。撃つと、砲口からまっすぐ飛んで、最初に当たった建物の壁か車、
//       何にも当たらなければ射程の先の地面で弾ける。弾の飛ぶ時間は持たない（撃った 1 歩で着く）。
//       着いた場所のまわりの車は、近いほど強く突き飛ばされて壊れる（煙 → 炎は vehicleDamage.ts の段階のまま）。
//       交通の車は道筋から外れて運転手が逃げ、通行人は逃げ出す（pedestrians.ts）。人が倒れる・消える表現は無い。
//       撃った戦車は反動で少し下がり、次に撃てるまで間が空く（VehicleState.reload）。街なかで撃てば手配が付く（wanted.ts の blast）。
//       頭の上を飛んでいる飛行機には当たらない。
import { clamp, dirOf } from './math'
import type { GtoWorld, VehicleState } from './types'
import { shoveVehicle, VEHICLE_SPECS } from './vehicle'
import { applyImpact } from './vehicleDamage'

export const CANNON_TUNING = {
  /** 次に撃てるまでの秒 */
  reload: 1.3,
  /** 砲口の位置: 車体の中心から前へ m、地面から上へ m */
  muzzleAhead: 5.1,
  muzzleUp: 1.78,
  /** 射程 m（砲口から） */
  range: 140,
  /** 爆風の届く半径 m */
  blast: 7.5,
  /** 真ん中にいた車が突き飛ばされる速さ m/s と、回される速さ rad/s */
  shove: 15,
  spin: 2.4,
  /** 真ん中にいた車に積む壊れ具合（1 発で黒煙、2 発で炎） */
  damage: 0.62,
  /** 凹みの元にする当たりの強さ m/s（真ん中） */
  dentImpact: 30,
  /** 撃った戦車が反動で下がる速さ m/s */
  recoil: 1.6,
}

export interface Shot {
  /** 砲口 */
  from: { x: number; z: number }
  /** 弾の着いた場所 */
  to: { x: number; z: number }
  /** 砲口からの距離 m */
  dist: number
  /** 直に当たった車の id（壁・地面なら null） */
  hitId: number | null
}

export const canFire = (tank: Pick<VehicleState, 'kind' | 'reload'>): boolean => tank.kind === 'tank' && (tank.reload ?? 0) <= 0

/** 砲口の位置（世界の座標） */
export function muzzleOf(tank: Pick<VehicleState, 'x' | 'z' | 'heading'>): { x: number; z: number } {
  const f = dirOf(tank.heading)
  return { x: tank.x + f.x * CANNON_TUNING.muzzleAhead, z: tank.z + f.z * CANNON_TUNING.muzzleAhead }
}

/** 車を上から見た円とみなしたときの半径 m（横向きでも当たるよう、長さも見る） */
const bodyRadius = (v: VehicleState): number => {
  const spec = VEHICLE_SPECS[v.kind]
  return Math.hypot(spec.length / 2, spec.width / 2) * 0.72
}

/** 弾の着く場所を決める: 砲口からまっすぐ先の、最初の壁か車。無ければ射程の先 */
export function aimShot(world: GtoWorld, tank: VehicleState, vehicles: readonly VehicleState[]): Shot {
  const T = CANNON_TUNING
  const f = dirOf(tank.heading)
  const from = muzzleOf(tank)
  // 壁: 車体の中心から見る（砲身が壁に刺さっているときは、砲口より手前で弾ける）
  const reach = T.muzzleAhead + T.range
  let along = world.segmentClear(tank.x, tank.z, tank.x + f.x * reach, tank.z + f.z * reach) * reach
  let hitId: number | null = null
  for (const v of vehicles) {
    if (v.id === tank.id || (v.alt ?? 0) > 3) continue
    const dx = v.x - tank.x
    const dz = v.z - tank.z
    const ahead = dx * f.x + dz * f.z
    const side = Math.abs(-dx * f.z + dz * f.x)
    const r = bodyRadius(v)
    if (ahead <= VEHICLE_SPECS[tank.kind].length / 2 || side > r) continue
    // 円の手前の縁
    const near = ahead - Math.sqrt(r * r - side * side)
    if (near < along) {
      along = near
      hitId = v.id
    }
  }
  along = Math.max(0.5, along)
  return { from, to: { x: tank.x + f.x * along, z: tank.z + f.z * along }, dist: Math.max(0, along - T.muzzleAhead), hitId }
}

/**
 * 爆風を 1 台に当てる。届かなければ null。
 * 近いほど強く、着いた場所から外へ突き飛ばし、回し、壊す。直に当たった車（direct）は、真ん中にいたものとして扱う
 */
export function blastVehicle(v: VehicleState, at: { x: number; z: number }, direct: boolean, away: { x: number; z: number }): VehicleState | null {
  const T = CANNON_TUNING
  if ((v.alt ?? 0) > 3) return null
  const dx = v.x - at.x
  const dz = v.z - at.z
  const d = Math.hypot(dx, dz)
  const k = direct ? 1 : clamp(1 - (d - bodyRadius(v)) / T.blast, 0, 1)
  if (k <= 0) return null
  // 外へ向かう向き（真上で弾けたときは、弾の飛んできた向き）
  const ux = d > 0.5 ? dx / d : away.x
  const uz = d > 0.5 ? dz / d : away.z
  const f = dirOf(v.heading)
  // 着いた場所が車体の右か左かで、回る向きが決まる
  const side = -(at.x - v.x) * f.z + (at.z - v.z) * f.x
  const front = (at.x - v.x) * f.x + (at.z - v.z) * f.z
  const shoved = shoveVehicle(v, ux * T.shove * k, uz * T.shove * k, (front >= 0 ? 1 : -1) * (side >= 0 ? -1 : 1) * T.spin * k)
  const spec = VEHICLE_SPECS[v.kind]
  if (spec.armor) return shoved
  const dented = applyImpact(shoved, T.dentImpact * k, clamp(side, -spec.width / 2, spec.width / 2), clamp(front, -spec.length / 2, spec.length / 2), spec.length / 2, spec.width / 2)
  return { ...dented, damage: Math.min(1, (v.damage ?? 0) + T.damage * k) }
}
