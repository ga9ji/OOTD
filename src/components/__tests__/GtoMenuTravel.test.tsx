import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AreaId } from '../../lib/gto/types'
import { I18nProvider } from '../../lib/i18n'
import GtoMenuTravel from '../gto/GtoMenuTravel'
import type { GtoEngine } from '../gto/engine'

/** メニューの「のりかえ」が読むのは、いまいるエリアと手配度・依頼の有無だけ */
const fakeEngine = (area: AreaId, status: { wanted: number; onMission: boolean }) =>
  ({ world: { area }, status: () => status, subscribe: () => () => {} }) as unknown as GtoEngine

const render = (engine: GtoEngine) => {
  vi.stubGlobal('window', {
    location: { hash: '#/gto' },
    localStorage: { getItem: () => 'ja' },
  })
  return renderToStaticMarkup(
    <I18nProvider>
      <GtoMenuTravel engine={engine} onTravel={() => {}} />
    </I18nProvider>,
  )
}

describe('GtoMenuTravel（メニューの「のりかえ」）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('いまいるエリアを示し、ほかのエリアへ行くボタンだけを出す', () => {
    const html = render(fakeEngine('shibuya', { wanted: 0, onMission: false }))
    expect(html).toContain('いま: 渋谷')
    expect(html).toContain('新宿へ行く')
    expect(html).not.toContain('渋谷へ行く')
    expect(html).not.toContain('disabled')
  })

  it('新宿にいるときは、渋谷へ行くボタンになる', () => {
    const html = render(fakeEngine('shinjuku', { wanted: 0, onMission: false }))
    expect(html).toContain('いま: 新宿')
    expect(html).toContain('渋谷へ行く')
    expect(html).not.toContain('新宿へ行く')
  })

  it('手配が付いているあいだは押せず、そのわけを添える', () => {
    const html = render(fakeEngine('shibuya', { wanted: 2, onMission: false }))
    expect(html).toContain('disabled')
    expect(html).toContain('手配中は移動できない')
  })

  it('依頼の途中なら、移ると取り消しになると添える（押せはする）', () => {
    const html = render(fakeEngine('shibuya', { wanted: 0, onMission: true }))
    expect(html).not.toContain('disabled')
    expect(html).toContain('移動すると、進行中の依頼は取り消しになる')
  })
})
