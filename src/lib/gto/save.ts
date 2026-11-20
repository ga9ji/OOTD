// Grand Theft Outfit: 進行の保存（再読み込みしても続きから遊べるようにする）。
// 入口: saveOf(state)（いまの進行を取り出す） / parseSave(raw)（保存した文字列を読む） / applySave(state, save, outfitKeys)（始めの状態へ戻す）
//       hasProgress(save) / saveSummary(save)（題名の画面の「つづきから」）
//       loadSave() / storeSave(save) / clearSave()（端末の localStorage）
// 契約: 残すのは「所持金・手持ちの服と着ている服・達成した依頼」だけ。
//       場所・乗っている車・手配・進行中の依頼は残さない。続きは駅前の広場から、手配なしで始まり、途中だった依頼は受け直す。
//       服の写真は日々入れ替わり、依頼も増減するので、読むときに「いまも在る物」だけに絞る（applySave）。
//       撮影用の URL（?gtoShot= &demo= &mode=）で始めたときは、呼ぶ側（engine）が読みも書きもしない。
import { MISSIONS } from './missionData'
import { OUTFIT_TUNING } from './outfit'
import type { GtoState } from './types'

export const SAVE_KEY = 'gto.save.v1'
const SAVE_VERSION = 1
/** 所持金の上限（壊れた保存から途方もない額を読まないように） */
const CASH_MAX = 99_999_999

export interface GtoSave {
  v: number
  cash: number
  /** いま着ている服 */
  wearing: string
  /** 手持ちの服（新しい順） */
  wardrobe: string[]
  /** 達成した依頼の id（達成した順） */
  done: string[]
}

export const saveOf = (state: Pick<GtoState, 'cash' | 'outfit' | 'mission'>): GtoSave => ({
  v: SAVE_VERSION,
  cash: state.cash,
  wearing: state.outfit.wearing,
  wardrobe: [...state.outfit.wardrobe],
  done: [...state.mission.done],
})

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? [...new Set(v as string[])] : null)

/** 保存した文字列を読む。形が合わない・版が違う・壊れているときは null（最初から始める） */
export function parseSave(raw: string | null | undefined): GtoSave | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data == null) return null
  const d = data as Record<string, unknown>
  const wardrobe = strings(d.wardrobe)
  const done = strings(d.done)
  if (d.v !== SAVE_VERSION || typeof d.cash !== 'number' || !Number.isFinite(d.cash) || typeof d.wearing !== 'string' || !wardrobe || !done) return null
  return { v: SAVE_VERSION, cash: Math.min(CASH_MAX, Math.max(0, Math.round(d.cash))), wearing: d.wearing, wardrobe, done }
}

/** 達成した依頼のうち、いまも在って、前提の依頼も達成している物だけを残す */
function knownDone(done: readonly string[]): string[] {
  const kept: string[] = []
  // 前提が後ろに並んでいても拾えるよう、増えなくなるまで回す
  for (let grew = true; grew; ) {
    grew = false
    for (const id of done) {
      const def = MISSIONS.find((m) => m.id === id)
      if (!def || kept.includes(id) || (def.after != null && !kept.includes(def.after))) continue
      kept.push(id)
      grew = true
    }
  }
  return kept
}

/**
 * 始めの状態（createGtoState の戻り値）に、保存した進行を戻す。
 * outfitKeys はいま使える服。無くなった服は手持ちから外し、着ていた服が無くなっていたら、手持ちのいちばん新しい服（それも無ければ始めの服）を着る
 */
export function applySave(state: GtoState, save: GtoSave, outfitKeys: readonly string[]): GtoState {
  const known = new Set(outfitKeys)
  const kept = save.wardrobe.filter((k) => known.has(k))
  const wearing = known.has(save.wearing) ? save.wearing : (kept[0] ?? state.outfit.wearing)
  // 着ている服は必ず手持ちに入れる（数の上限で切るときも落とさない）
  const max = OUTFIT_TUNING.wardrobeMax
  const listed = (kept.includes(wearing) ? kept : [wearing, ...kept]).slice(0, max)
  const wardrobe = listed.includes(wearing) ? listed : [wearing, ...listed.slice(0, max - 1)]
  return {
    ...state,
    cash: save.cash,
    outfit: { wearing, wardrobe, changedAt: state.outfit.changedAt },
    mission: { ...state.mission, done: knownDone(save.done) },
  }
}

/** 最初の状態から何か進んでいるか（進んでいなければ、題名の画面は「はじめる」だけでよい）。startCash は始めの所持金 */
export const hasProgress = (save: GtoSave, startCash: number): boolean => save.cash !== startCash || save.wardrobe.length > 1 || save.done.length > 0

export interface SaveSummary {
  cash: number
  /** 手持ちの服の数 */
  outfits: number
  /** 達成した依頼の数と、全部の数 */
  missions: number
  missionTotal: number
}

export const saveSummary = (save: GtoSave): SaveSummary => ({
  cash: save.cash,
  outfits: save.wardrobe.length,
  missions: knownDone(save.done).length,
  missionTotal: MISSIONS.length,
})

// ---- 端末への読み書き（保存できない設定のブラウザでも遊べるよう、失敗は黙って流す） ----
export function loadSave(): GtoSave | null {
  try {
    return parseSave(localStorage.getItem(SAVE_KEY))
  } catch {
    return null
  }
}

export function storeSave(save: GtoSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // 保存できない端末では、その回かぎりで遊ぶ
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // 同上
  }
}
