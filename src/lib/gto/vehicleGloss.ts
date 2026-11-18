// Grand Theft Outfit [部品: vehicle] 塗装の明暗（艶の帯）。
// 入口: VEHICLE_GLOSS / glossShade(ny, t) / topSheen(z)
// 契約: 面の向き（法線の上向きの成分 ny）と、側面の中での高さ（t: 裾が 0、肩が 1）だけから、塗装色に掛ける明るさを返す。
//       磨いた車体は、上を向く面に空が、横を向く面の下のほうに路面が映る。側面は裾が暗く肩へ向けて明るくなり、
//       肩の面取りに細い光の帯が乗る。描画（components/gto/vehicleShape.ts）が頂点色に掛ける。
import { clamp } from './math'

/** 明暗を決める数字（塗装色に掛ける倍率） */
export const VEHICLE_GLOSS = {
  /** 側面: 裾・腰・肩のすぐ下 */
  sill: 0.4,
  waist: 0.8,
  belt: 1.16,
  /** 肩の面取り（斜め上を向く面）の光の帯と、上面（ボンネット・屋根） */
  shoulder: 1.5,
  top: 1.1,
  /** 下を向く面 */
  under: 0.32,
  /** 上面（ボンネット・屋根・荷室）を前後に横切る光の帯: 帯の外の明るさ、帯の芯の明るさ（上面の明るさに掛ける）、
   *  帯の位置（車長に対する割合。前端 −0.5 〜 後端 0.5）と半分の幅 */
  sheenBase: 0.86,
  sheenPeak: 1.42,
  sheenBands: [
    { z: -0.3, half: 0.085 },
    { z: 0.035, half: 0.055 },
    { z: 0.43, half: 0.05 },
  ],
}

const smooth = (k: number) => k * k * (3 - 2 * k)

/** 塗装色に掛ける明るさ。ny は法線の上向きの成分（−1〜1）、t は側面の中での高さ（裾 0 〜 肩 1） */
export function glossShade(ny: number, t: number): number {
  const g = VEHICLE_GLOSS
  const h = clamp(t, 0, 1)
  // 横を向く面: 裾 → 腰 → 肩の下 へ明るくなる
  const side = h < 0.5 ? g.sill + (g.waist - g.sill) * smooth(h / 0.5) : g.waist + (g.belt - g.waist) * smooth((h - 0.5) / 0.5)
  if (ny <= 0) return side + (Math.min(g.under, side) - side) * smooth(clamp(-ny / 0.6, 0, 1))
  // 斜め上（0.5 あたり）で光の帯、真上へ向けて上面の明るさへ
  if (ny <= 0.5) return side + (g.shoulder - side) * smooth(ny / 0.5)
  return g.shoulder + (g.top - g.shoulder) * smooth((ny - 0.5) / 0.5)
}

/** 上面の光の帯。z は前後の位置（車長に対する割合）。空の明るい所がボンネット・屋根・荷室に帯になって映る */
export function topSheen(z: number): number {
  const g = VEHICLE_GLOSS
  let k = 0
  for (const band of g.sheenBands) k = Math.max(k, smooth(clamp(1 - Math.abs(z - band.z) / (band.half * 2), 0, 1)))
  return g.sheenBase + (g.sheenPeak - g.sheenBase) * k
}
