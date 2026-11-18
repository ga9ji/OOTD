// Grand Theft Outfit [部品: vehicle] タイヤハウス（車体の側面の丸い切り欠き）の形。
// 入口: archCut / archColumns / panelPoint
// 契約: 車体の側面（裾 → 腰 → 肩の折れ線を前後に繋いだ面）に、車輪のまわりだけ丸い穴を開けるための計算。
//       車輪は車体とは別の部品で、この穴の中で上下に動く。描画（vehicleShape.ts）がこれで面を張る。
//       z は車体の前後（前が −z）、y は地面からの高さ m。

/** 前後の位置 z で、側面をどの高さまで切り欠くか（切らない所は −Infinity）。axle は車軸の高さ */
export function archCut(z: number, wheelZ: readonly number[], radius: number, axle: number): number {
  let cut = -Infinity
  for (const wz of wheelZ) {
    const d = Math.abs(z - wz)
    if (d > radius + 1e-9) continue
    cut = Math.max(cut, axle + Math.sqrt(Math.max(0, radius * radius - d * d)))
  }
  return cut
}

/**
 * 区間 za〜zb の側面を割る位置（両端を含み、前から後ろへ）。車輪に掛からなければ両端だけ。
 * 切り欠きの中は step より細かく割り、切り欠きの両端と、その少し外（切り欠きの立ち上がり）にも置く。
 */
export function archColumns(za: number, zb: number, wheelZ: readonly number[], radius: number, step: number): number[] {
  const out = new Set<number>([za, zb])
  const skirt = 0.03
  for (const wz of wheelZ) {
    const from = Math.max(za, wz - radius)
    const to = Math.min(zb, wz + radius)
    if (to <= from) continue
    for (const edge of [wz - radius - skirt, wz - radius, wz + radius, wz + radius + skirt]) if (edge > za && edge < zb) out.add(edge)
    const n = Math.max(1, Math.ceil((to - from) / step - 1e-9))
    for (let i = 1; i < n; i++) out.add(from + ((to - from) * i) / n)
  }
  const sorted = [...out].sort((a, b) => a - b)
  // ほとんど同じ位置は1つにまとめる（両端は残す）
  return sorted.filter((z, i) => i === 0 || i === sorted.length - 1 || (z - sorted[i - 1] > 1e-6 && sorted[sorted.length - 1] - z > 1e-6))
}

/**
 * 側面の折れ線（[幅, 高さ] を下から上へ3点: 裾・腰・肩）の上で、高さ y にある点。
 * above は、その点が乗っている辺（0 = 裾〜腰、1 = 腰〜肩）。裾より下は裾、肩より上は肩の少し下に丸める。
 */
export function panelPoint(profile: readonly (readonly [number, number])[], y: number): { x: number; y: number; above: 0 | 1 } {
  const [low, waist, belt] = profile
  if (y <= low[1]) return { x: low[0], y: low[1], above: 0 }
  if (y < waist[1]) {
    const k = (y - low[1]) / (waist[1] - low[1])
    return { x: low[0] + (waist[0] - low[0]) * k, y, above: 0 }
  }
  // 肩の線は残す（切り欠きが肩を越えると、車体の上面に穴が開く）
  const top = Math.min(y, belt[1] - 0.03)
  const k = (top - waist[1]) / Math.max(1e-6, belt[1] - waist[1])
  return { x: waist[0] + (belt[0] - waist[0]) * k, y: top, above: 1 }
}
