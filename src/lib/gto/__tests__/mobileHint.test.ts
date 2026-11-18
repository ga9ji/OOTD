import { describe, expect, it } from 'vitest'
import { TOUCH_CAPTION, TOUCH_HINT_BEAT, touchButtons, touchHint, visibleTouchButtons, type TouchButtonId, type TouchHintContext } from '../input'

const REST: TouchHintContext = { canEnter: false, canSteal: false, speed: 0, outfits: 0 }
const icons = (ctx: TouchHintContext, mode: 'foot' | 'drive', beat = 0) => touchHint(mode, ctx, beat).parts.map((p) => p.icon)

describe('gto mobile: ボタンの名前', () => {
  it('どのボタンにも、絵の下に出す短い名前がある', () => {
    const ids = [...touchButtons('foot'), ...touchButtons('drive')].map((b) => b.id)
    for (const id of ids) {
      expect(TOUCH_CAPTION[id].length).toBeGreaterThan(0)
      expect(TOUCH_CAPTION[id].length).toBeLessThanOrEqual(7)
    }
    // 名前で見分けられる（同じ名前のボタンが無い）
    expect(new Set(ids.map((id) => TOUCH_CAPTION[id])).size).toBe(ids.length)
  })
})

describe('gto mobile: 場面ごとの操作の案内', () => {
  it('徒歩で何も無いときは、動かし方・見回し方・走り方を順に出す', () => {
    const seen = [0, 1, 2].map((beat) => touchHint('foot', REST, beat))
    expect(seen.map((h) => h.parts[0].icon)).toEqual(['stick', 'look', 'run'])
    // 一巡したら最初に戻る
    expect(touchHint('foot', REST, 3).id).toBe(seen[0].id)
    expect(new Set(seen.map((h) => h.id)).size).toBe(3)
  })

  it('手持ちの服があると、着替えの案内が順番に加わる', () => {
    const withOutfits = [0, 1, 2, 3].map((beat) => icons({ ...REST, outfits: 2 }, 'foot', beat)[0])
    expect(withOutfits).toContain('wardrobe')
    expect([0, 1, 2, 3].map((beat) => icons(REST, 'foot', beat)[0])).not.toContain('wardrobe')
  })

  it('乗れる・奪えるときは、順番を待たずにそのボタンの案内へ切り替わる', () => {
    for (const beat of [0, 1, 2, 5]) {
      expect(icons({ ...REST, canEnter: true }, 'foot', beat)).toEqual(['enter'])
      expect(icons({ ...REST, canSteal: true }, 'foot', beat)).toEqual(['steal'])
      expect(icons({ ...REST, canEnter: true, canSteal: true }, 'foot', beat)).toEqual(['enter', 'steal'])
    }
    expect(touchHint('foot', { ...REST, canEnter: true }, 0).id).not.toBe(touchHint('foot', { ...REST, canSteal: true }, 0).id)
  })

  it('運転で止まっているときは、進む・後退・降りるをまとめて出す', () => {
    expect(icons(REST, 'drive', 0)).toEqual(['gas', 'brake', 'exit'])
    expect(icons(REST, 'drive', 7)).toEqual(['gas', 'brake', 'exit'])
  })

  it('走っているときは、ハンドル・サイドブレーキ・ブレーキ・警笛を順に出す', () => {
    const fast = { ...REST, speed: 12 }
    expect([0, 1, 2, 3].map((beat) => icons(fast, 'drive', beat)[0])).toEqual(['steer', 'handbrake', 'brake', 'horn'])
    // 後退でも同じ（速さの大きさで見る）
    expect(icons({ ...REST, speed: -12 }, 'drive', 1)).toEqual(['handbrake'])
  })

  it('案内に出るボタンは、その場面で画面に出ているボタンだけ', () => {
    const cases: [('foot' | 'drive'), TouchHintContext][] = [
      ['foot', REST],
      ['foot', { ...REST, outfits: 3 }],
      ['foot', { ...REST, canEnter: true }],
      ['foot', { ...REST, canSteal: true, canEnter: true }],
      ['drive', REST],
      ['drive', { ...REST, speed: 3 }],
      ['drive', { ...REST, speed: 20 }],
    ]
    const notButtons = new Set(['stick', 'look', 'steer'])
    for (const [mode, ctx] of cases) {
      const shown = new Set<string>(visibleTouchButtons(mode, ctx).map((b) => b.id))
      for (let beat = 0; beat < 6; beat++) {
        for (const part of touchHint(mode, ctx, beat).parts) {
          expect(part.text.length).toBeGreaterThan(0)
          if (part.icon && !notButtons.has(part.icon)) expect(shown.has(part.icon as TouchButtonId)).toBe(true)
        }
      }
    }
  })

  it('1行に収まる長さで、順送りは数秒おき', () => {
    for (const mode of ['foot', 'drive'] as const) {
      for (const ctx of [REST, { ...REST, canEnter: true, canSteal: true, outfits: 2 }, { ...REST, speed: 15 }]) {
        for (let beat = 0; beat < 6; beat++) {
          const length = touchHint(mode, ctx, beat).parts.reduce((n, p) => n + p.text.length + (p.icon ? 2 : 0), 0)
          expect(length).toBeLessThanOrEqual(30)
        }
      }
    }
    expect(TOUCH_HINT_BEAT).toBeGreaterThanOrEqual(3)
    expect(TOUCH_HINT_BEAT).toBeLessThanOrEqual(8)
  })
})
