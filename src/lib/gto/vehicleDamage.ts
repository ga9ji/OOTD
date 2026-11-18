// Grand Theft Outfit [部品: vehicle] 車の損傷。
// 入口: VEHICLE_DAMAGE / DENT / applyImpact / damageStage
// 契約: 当たった強さ（m/s）と当たった場所（車体の座標）から、壊れ具合（damage）と凹み（dents）を積んだ新しい車を返す。
//       損傷は段階的に進む（無傷 → 白煙 → 黒煙 → 炎）。見た目（凹み・煙・炎）は描画が damage と dents を読んで作る。
import { clamp } from './math'
import type { VehicleState } from './types'

export const VEHICLE_DAMAGE = {
  /** これより弱い当たりでは傷まない m/s（擦っただけ・軽く触れただけ） */
  minImpact: 3.5,
  /** この強さで「1回ぶんの最大」になる m/s（72km/h） */
  fullImpact: 20,
  /** 最大の当たり1回で進む壊れ具合と、付く凹み */
  perHit: 0.3,
  dentPerHit: 0.85,
  /** 狭い物（柱）に当たったとき、隣の区画へ広がる凹みの割合 */
  spread: 0.3,
  /** 段階の境目 */
  smoke: 0.25,
  blackSmoke: 0.58,
  fire: 0.88,
}

/** 凹みの区画の並び */
export const DENT = { frontL: 0, frontC: 1, frontR: 2, rearL: 3, rearC: 4, rearR: 5, left: 6, right: 7 } as const
export const NO_DENTS: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0]

export type DamageStage = 'ok' | 'smoke' | 'black' | 'fire'

export function damageStage(damage: number | undefined): DamageStage {
  const d = damage ?? 0
  const t = VEHICLE_DAMAGE
  return d >= t.fire ? 'fire' : d >= t.blackSmoke ? 'black' : d >= t.smoke ? 'smoke' : 'ok'
}

/** 当たった場所（右 lx・前 lz、車体の中心から m）がどの区画か。[区画, 隣の区画…] */
function zonesAt(lx: number, lz: number, halfL: number, halfW: number): number[] {
  const u = lz / halfL
  const s = lx / halfW
  if (Math.abs(u) > 0.6 || Math.abs(u) >= Math.abs(s)) {
    const base = u >= 0 ? DENT.frontL : DENT.rearL
    const col = s < -0.33 ? 0 : s > 0.33 ? 2 : 1
    return col === 1 ? [base + 1, base, base + 2] : [base + col, base + 1]
  }
  return [s < 0 ? DENT.left : DENT.right]
}

/**
 * 当たりを車に積む。
 * @param impact 当たった強さ m/s
 * @param lx 当たった場所（車体の座標、右が＋）
 * @param lz 当たった場所（車体の座標、前が＋）
 * @param narrow 柱のような細い物か（凹みが1区画に集まる）。壁や車は端の全幅が潰れる
 */
export function applyImpact(v: VehicleState, impact: number, lx: number, lz: number, halfL: number, halfW: number, narrow = false): VehicleState {
  const t = VEHICLE_DAMAGE
  if (impact <= t.minImpact) return v
  const strength = clamp((impact - t.minImpact) / (t.fullImpact - t.minImpact), 0, 1)
  const [main, ...near] = zonesAt(lx, lz, halfL, halfW)
  const add = (0.25 + 0.75 * strength) * t.dentPerHit
  const dents = (v.dents ?? NO_DENTS).map((d, i) => {
    if (i === main) return Math.min(1, d + add)
    if (near.includes(i)) return Math.min(1, d + add * (narrow ? t.spread : 1))
    return d
  })
  return { ...v, damage: Math.min(1, (v.damage ?? 0) + strength * t.perHit), dents }
}
