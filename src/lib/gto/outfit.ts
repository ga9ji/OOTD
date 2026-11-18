// Grand Theft Outfit [部品: outfit] 服の強奪と着替え。
// 入口: createOutfit / findStealTarget / stealOutfit / wearFromWardrobe（ルール）
//       stealBeat / wearBeat（演出の時間割）、detectSwap / outfitNotice（何が起きたかの見分け）、
//       wardrobeModel / moveCursor（着替え画面）
// 契約: 主人公の位置と通行人の一覧から奪う相手を選び、着替えた後の OutfitState と、
//       服を取り替えられた通行人を返す。通行人の逃げ方は pedestrians.ts、手配は wanted.ts の担当。
//       状態の上では奪った1歩で服が入れ替わる。画面は changedAt からの経過秒を時間割に通して、
//       「掴む → 服が飛んでくる → 着地の瞬間に姿が替わる → 決めの弾み」に引きのばして見せる。
import { angleDiff, clamp, dist2, headingOf } from './math'
import type { OutfitState, PedState, PlayerState } from './types'

/** 手触りを決める数字 */
export const OUTFIT_TUNING = {
  /** 手が届く距離 m */
  range: 2.3,
  /** 正面からこの角度の内側だけ狙える（ラジアン） */
  cone: 1.9,
  /** 奪う動作の硬直（秒）。姿が替わって、決めの弾みが収まるまで */
  busy: 0.8,
  /** 奪われた通行人が立ちすくむ秒（演出が終わるまで） */
  stun: 1.15,
  /** ワードローブに残す数 */
  wardrobeMax: 24,
}

/** 最初から持っている服（extra）を足して始められる。着ている服がいちばん新しい */
export function createOutfit(wearing: string, extra: readonly string[] = []): OutfitState {
  const wardrobe = [wearing, ...extra.filter((k, i) => k !== wearing && extra.indexOf(k) === i)].slice(0, OUTFIT_TUNING.wardrobeMax)
  return { wearing, wardrobe, changedAt: 0 }
}

/** 目の前にいる、服を奪える通行人（同じ服の相手・警官・立ちすくんでいる相手は選ばない） */
export function findStealTarget(p: PlayerState, peds: PedState[], wearing: string): PedState | null {
  let best: PedState | null = null
  let bestD2 = OUTFIT_TUNING.range * OUTFIT_TUNING.range
  for (const ped of peds) {
    if (ped.cop || ped.mood === 'stunned' || ped.outfitKey === wearing) continue
    const d2 = dist2(p.x, p.z, ped.x, ped.z)
    if (d2 >= bestD2) continue
    const facing = Math.abs(angleDiff(p.heading, headingOf(ped.x - p.x, ped.z - p.z)))
    if (d2 > 0.6 && facing > OUTFIT_TUNING.cone) continue
    bestD2 = d2
    best = ped
  }
  return best
}

/** 服を取り替える。主人公は相手の服を着て、相手には主人公が着ていた服が残る */
export function stealOutfit(outfit: OutfitState, ped: PedState, t: number): { outfit: OutfitState; ped: PedState } {
  const wardrobe = [ped.outfitKey, ...outfit.wardrobe.filter((k) => k !== ped.outfitKey)].slice(0, OUTFIT_TUNING.wardrobeMax)
  return {
    outfit: { wearing: ped.outfitKey, wardrobe, changedAt: t },
    ped: { ...ped, outfitKey: outfit.wearing, mood: 'stunned', timer: OUTFIT_TUNING.stun, speed: 0 },
  }
}

/** 手持ちの服に着替える（持っていない服なら何もしない） */
export function wearFromWardrobe(outfit: OutfitState, key: string, t: number): OutfitState {
  if (key === outfit.wearing || !outfit.wardrobe.includes(key)) return outfit
  return { ...outfit, wearing: key, changedAt: t }
}

// ----------------------------------------------------------------------------
// 演出の時間割（changedAt からの経過秒 → 画面の動き。状態は持たない）
// ----------------------------------------------------------------------------

/** 奪う演出の節目（秒）。音（gtoAudioCues の steal: 布を引く 0s、ファスナー 0.1s〜、鈴 0.44s）に合わせてある */
export const STEAL_BEAT = {
  /** 手を伸ばしきるまで */
  reach: 0.12,
  /** 服が相手から離れて飛びはじめる */
  flyStart: 0.1,
  /** 服が主人公に届く。ここで姿が替わる */
  land: 0.44,
  /** 着地の光が消えるまで */
  flash: 0.24,
  /** 足元の輪が広がりきるまで */
  shock: 0.45,
  /** 小さく跳ねる長さ */
  hop: 0.3,
  /** 演出の全長（相手の「!?」が消えるまで） */
  total: 1.1,
}

export interface StealBeat {
  /** 主人公が相手へ踏み込む度合い 0..1 */
  lunge: number
  /** 相手が主人公のほうへ引っぱられる度合い 0..1 */
  tug: number
  /** 服が飛んでいる最中か */
  flying: boolean
  /** 服の飛んだ割合 0..1（0=相手、1=主人公） */
  fly: number
  /** 相手の回転 0..1（1 で1回転）。服を抜かれて回る */
  spin: number
  /** 見た目の服がもう替わったか */
  swapped: boolean
  /** 着地の光 1→0 */
  flash: number
  /** 決めの弾み（1 から減衰しながら振動して 0 へ） */
  pop: number
  /** 跳ねる高さ 0..1 */
  hop: number
  /** 足元の輪の広がり 0..1 */
  shock: number
  /** 相手の震え 1→0 */
  shiver: number
  /** 演出が終わっている（始まる前も含む） */
  done: boolean
}

const REST: StealBeat = { lunge: 0, tug: 0, flying: false, fly: 0, spin: 0, swapped: true, flash: 0, pop: 0, hop: 0, shock: 0, shiver: 0, done: true }
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/** 奪ってから tau 秒後の動き */
export function stealBeat(tau: number): StealBeat {
  const B = STEAL_BEAT
  if (!(tau >= 0) || tau >= B.total) return REST
  const u = tau - B.land
  const swapped = u >= 0
  const fly = clamp((tau - B.flyStart) / (B.land - B.flyStart), 0, 1)
  const reach = easeOut(clamp(tau / B.reach, 0, 1))
  return {
    lunge: reach * (1 - smooth(B.reach + 0.08, B.land, tau)),
    tug: reach * (1 - smooth(B.flyStart, B.land, tau)),
    flying: tau >= B.flyStart && !swapped,
    fly,
    spin: smooth(0, 1, fly),
    swapped,
    flash: swapped ? clamp(1 - u / B.flash, 0, 1) : 0,
    pop: swapped ? Math.exp(-9 * u) * Math.cos(20 * u) : 0,
    hop: swapped && u < B.hop ? Math.sin((u / B.hop) * Math.PI) : 0,
    shock: swapped ? clamp(u / B.shock, 0, 1) : 0,
    shiver: swapped ? clamp(1 - u / (B.total - B.land), 0, 1) : 0,
    done: false,
  }
}

/** 着替えの演出の節目（秒） */
export const WEAR_BEAT = {
  /** くるりと回って真横を向く瞬間。ここで姿が替わる */
  swap: 0.16,
  flash: 0.22,
  total: 0.6,
}

export interface WearBeat {
  /** 板の幅の倍率（1=正面、0=真横、負=裏返し） */
  turn: number
  swapped: boolean
  flash: number
  pop: number
  done: boolean
}

/** ワードローブから着替えて tau 秒後の動き */
export function wearBeat(tau: number): WearBeat {
  const B = WEAR_BEAT
  if (!(tau >= 0) || tau >= B.total) return { turn: 1, swapped: true, flash: 0, pop: 0, done: true }
  const u = tau - B.swap
  const swapped = u >= 0
  return {
    turn: tau < B.swap * 2 ? Math.abs(Math.cos((tau / B.swap) * (Math.PI / 2))) : 1,
    swapped,
    flash: swapped ? clamp(1 - u / B.flash, 0, 1) : 0,
    pop: swapped ? Math.exp(-9 * u) * Math.cos(20 * u) : 0,
    done: false,
  }
}

// ----------------------------------------------------------------------------
// 何が起きたかの見分け（前の状態と今の状態を比べる。描画と HUD が使う）
// ----------------------------------------------------------------------------

export type OutfitSwap =
  | { kind: 'steal'; victimId: number; taken: string; given: string; at: number }
  | { kind: 'wear'; from: string; to: string; at: number }

/** 服が替わったなら、奪ったのか着替えたのかと、その相手を返す */
export function detectSwap(prev: OutfitState, next: OutfitState, p: PlayerState, peds: PedState[]): OutfitSwap | null {
  if (prev.wearing === next.wearing || prev.changedAt === next.changedAt) return null
  // 奪った直後なら、すぐそばに「主人公が着ていた服」で立ちすくむ相手がいる
  let victim: PedState | null = null
  let bestD2 = (OUTFIT_TUNING.range * 1.6) ** 2
  for (const ped of peds) {
    if (ped.outfitKey !== prev.wearing || ped.mood !== 'stunned') continue
    const d2 = dist2(p.x, p.z, ped.x, ped.z)
    if (d2 >= bestD2) continue
    bestD2 = d2
    victim = ped
  }
  const stolen = victim != null && next.wardrobe[0] === next.wearing
  if (stolen && victim) return { kind: 'steal', victimId: victim.id, taken: next.wearing, given: prev.wearing, at: next.changedAt }
  return { kind: 'wear', from: prev.wearing, to: next.wearing, at: next.changedAt }
}

export interface OutfitNotice {
  kind: 'steal' | 'wear'
  key: string
  /** 初めて手に入れた服か */
  isNew: boolean
  /** 手持ちの数 */
  count: number
  at: number
}

/** 画面のお知らせ用（相手は要らない）。奪ったときは手持ちの先頭に来るので、それで見分ける */
export function outfitNotice(prev: OutfitState, next: OutfitState): OutfitNotice | null {
  if (prev.wearing === next.wearing || prev.changedAt === next.changedAt) return null
  const stolen = next.wardrobe[0] === next.wearing && (next.wardrobe.length !== prev.wardrobe.length || next.wardrobe.some((k, i) => k !== prev.wardrobe[i]) || prev.wardrobe[0] !== prev.wearing)
  return {
    kind: stolen ? 'steal' : 'wear',
    key: next.wearing,
    isNew: stolen && !prev.wardrobe.includes(next.wearing),
    count: next.wardrobe.length,
    at: next.changedAt,
  }
}

// ----------------------------------------------------------------------------
// 着替え画面
// ----------------------------------------------------------------------------

export interface WardrobeItem {
  key: string
  wearing: boolean
  selected: boolean
}

export interface WardrobeModel {
  items: WardrobeItem[]
  /** 選んでいる服（手持ちが無ければ空） */
  selected: string
  /** 選んでいる服に着替えられるか（いま着ている服は選べない） */
  canWear: boolean
  count: number
  max: number
}

export function wardrobeModel(outfit: OutfitState, cursor: number): WardrobeModel {
  const at = clamp(Math.round(cursor), 0, Math.max(0, outfit.wardrobe.length - 1))
  const selected = outfit.wardrobe[at] ?? ''
  return {
    items: outfit.wardrobe.map((key, i) => ({ key, wearing: key === outfit.wearing, selected: i === at })),
    selected,
    canWear: selected !== '' && selected !== outfit.wearing,
    count: outfit.wardrobe.length,
    max: OUTFIT_TUNING.wardrobeMax,
  }
}

/** 選ぶ位置を左右（dx）・上下（dy）に動かす。端で止まり、行き先に服が無ければ動かない */
export function moveCursor(cursor: number, dx: number, dy: number, count: number, cols: number): number {
  if (count <= 0) return 0
  const next = cursor + dx + dy * Math.max(1, cols)
  return next < 0 || next >= count ? clamp(cursor, 0, count - 1) : next
}
