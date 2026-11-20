import { describe, expect, it } from 'vitest'
import { MISSIONS } from '../missionData'
import { OUTFIT_TUNING } from '../outfit'
import { applySave, hasProgress, parseSave, saveOf, saveSummary, type GtoSave } from '../save'
import { START_CASH } from '../sim'
import { cfg, start } from './helpers'

// 進行の保存: 所持金・服・達成した依頼を残し、再読み込みのあと始めの状態へ戻す。

const first = MISSIONS[0].id
const second = MISSIONS.find((m) => m.after === first)!.id
const save = (over: Partial<GtoSave> = {}): GtoSave => ({ v: 1, cash: 4200, wearing: 'c', wardrobe: ['c', 'a', 'b'], done: [first], ...over })

describe('gto save: 進行を取り出して戻す', () => {
  it('所持金・手持ちの服・着ている服・達成した依頼が、保存して読み直しても同じ', () => {
    const fresh = start()
    const played = applySave(fresh, save(), cfg.outfitKeys)
    const again = applySave(start(), parseSave(JSON.stringify(saveOf(played)))!, cfg.outfitKeys)
    expect(again.cash).toBe(4200)
    expect(again.outfit.wearing).toBe('c')
    expect(again.outfit.wardrobe).toEqual(['c', 'a', 'b'])
    expect(again.mission.done).toEqual([first])
  })

  it('場所・手配・進行中の依頼は戻さない（始めの状態のまま）', () => {
    const fresh = start()
    const back = applySave(fresh, save(), cfg.outfitKeys)
    expect(back.player).toBe(fresh.player)
    expect(back.wanted).toBe(fresh.wanted)
    expect(back.mission.active).toBeNull()
    expect(back.vehicles).toBe(fresh.vehicles)
  })

  it('始めたばかりの状態は「進行なし」、何か変われば「進行あり」', () => {
    const fresh = saveOf(start())
    expect(hasProgress(fresh, START_CASH)).toBe(false)
    expect(hasProgress({ ...fresh, cash: START_CASH + 500 }, START_CASH)).toBe(true)
    expect(hasProgress({ ...fresh, wardrobe: [...fresh.wardrobe, 'b'] }, START_CASH)).toBe(true)
    expect(hasProgress({ ...fresh, done: [first] }, START_CASH)).toBe(true)
  })

  it('あらましは、手持ちの服の数と、達成した依頼の数／全部の数', () => {
    expect(saveSummary(save({ done: [first, second] }))).toEqual({ cash: 4200, outfits: 3, missions: 2, missionTotal: MISSIONS.length })
  })
})

describe('gto save: いまは無い物を読んだとき', () => {
  it('無くなった服は手持ちから外す', () => {
    const back = applySave(start(), save({ wardrobe: ['c', 'gone', 'a'] }), cfg.outfitKeys)
    expect(back.outfit.wardrobe).toEqual(['c', 'a'])
  })

  it('着ていた服が無くなっていたら、手持ちのいちばん新しい服を着る', () => {
    const back = applySave(start(), save({ wearing: 'gone', wardrobe: ['gone', 'b', 'a'] }), cfg.outfitKeys)
    expect(back.outfit.wearing).toBe('b')
    expect(back.outfit.wardrobe).toEqual(['b', 'a'])
  })

  it('手持ちが全部無くなっていたら、始めの服を着る', () => {
    const fresh = start()
    const back = applySave(fresh, save({ wearing: 'gone', wardrobe: ['gone'] }), cfg.outfitKeys)
    expect(back.outfit.wearing).toBe(fresh.outfit.wearing)
    expect(back.outfit.wardrobe).toEqual([fresh.outfit.wearing])
  })

  it('着ている服は必ず手持ちに入っていて、手持ちは上限を超えない', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const back = applySave(start(), save({ wearing: 'k39', wardrobe: many }), many)
    expect(back.outfit.wardrobe).toHaveLength(OUTFIT_TUNING.wardrobeMax)
    expect(back.outfit.wardrobe).toContain('k39')
  })

  it('無くなった依頼と、前提を達成していない依頼は「達成」に数えない', () => {
    expect(applySave(start(), save({ done: ['no-such-job', first] }), cfg.outfitKeys).mission.done).toEqual([first])
    // 前提（first）を達成していないのに second だけ達成になっている保存は、second を外す
    expect(applySave(start(), save({ done: [second] }), cfg.outfitKeys).mission.done).toEqual([])
    // 並びが前後していても、前提がそろっていれば残す
    expect(applySave(start(), save({ done: [second, first] }), cfg.outfitKeys).mission.done.sort()).toEqual([first, second].sort())
  })

  it('戻したあと、次の依頼が受けられる（達成した依頼の次が開く）', () => {
    const back = applySave(start(), save({ done: [first] }), cfg.outfitKeys)
    const open = MISSIONS.filter((m) => !back.mission.done.includes(m.id) && (m.after == null || back.mission.done.includes(m.after)))
    expect(open.map((m) => m.id)).toContain(second)
  })
})

describe('gto save: 保存した文字列を読む', () => {
  it('壊れている・形が違う・版が違うときは null（最初から始める）', () => {
    expect(parseSave(null)).toBeNull()
    expect(parseSave('')).toBeNull()
    expect(parseSave('{oops')).toBeNull()
    expect(parseSave('[]')).toBeNull()
    expect(parseSave('"text"')).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), v: 2 }))).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), cash: 'lots' }))).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), cash: null }))).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), wardrobe: 'a,b' }))).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), wardrobe: ['a', 3] }))).toBeNull()
    expect(parseSave(JSON.stringify({ ...save(), done: undefined }))).toBeNull()
  })

  it('所持金は 0 以上の整数に丸め、重なった服と依頼は 1 つにする', () => {
    expect(parseSave(JSON.stringify(save({ cash: -50 })))!.cash).toBe(0)
    expect(parseSave(JSON.stringify(save({ cash: 1234.6 })))!.cash).toBe(1235)
    expect(parseSave(JSON.stringify(save({ cash: 1e12 })))!.cash).toBe(99_999_999)
    const read = parseSave(JSON.stringify(save({ wardrobe: ['a', 'b', 'a'], done: [first, first] })))!
    expect(read.wardrobe).toEqual(['a', 'b'])
    expect(read.done).toEqual([first])
  })
})
