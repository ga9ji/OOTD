import { describe, expect, it } from 'vitest'
import { KO } from '../i18n-ko'
import { detectLocale, EN, translate } from '../i18n'

const variables = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('i18n', () => {
  it('uses the locale the user saved by switching explicitly', () => {
    expect(detectLocale('en')).toBe('en')
    expect(detectLocale('ja')).toBe('ja')
    expect(detectLocale('ko')).toBe('ko')
  })

  it('defaults to Japanese when nothing valid is saved, regardless of the browser language', () => {
    expect(detectLocale(null)).toBe('ja')
    expect(detectLocale('')).toBe('ja')
    expect(detectLocale('fr')).toBe('ja')
  })

  it('translates and interpolates English UI text', () => {
    expect(
      translate('en', '近い順に {shown} 件を表示しています（全 {total} 件）', {
        shown: 12,
        total: 42,
      }),
    ).toBe('Showing the 12 closest matches out of 42.')
  })

  it('keeps Japanese text and interpolates variables', () => {
    expect(translate('ja', '{count}日', { count: 3 })).toBe('3日')
  })

  it('translates and interpolates Korean UI text', () => {
    expect(
      translate('ko', '近い順に {shown} 件を表示しています（全 {total} 件）', {
        shown: 12,
        total: 42,
      }),
    ).toBe('가까운 순으로 12건을 표시합니다(전체 42건).')
    expect(translate('ko', '髪色: 金')).toBe('머리 색: 금발')
  })

  it('keeps the Korean catalog complete and preserves interpolation variables', () => {
    expect(Object.keys(KO).sort()).toEqual(Object.keys(EN).sort())
    for (const [message, translation] of Object.entries(KO)) {
      expect(variables(translation), message).toEqual(variables(message))
    }
  })

  it('handles dynamic labels and falls back safely', () => {
    expect(translate('en', '髪色: 金')).toBe('Hair color: Blond')
    expect(translate('en', '未登録の文言')).toBe('未登録の文言')
  })
})
