import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameFullscreenProvider, type GameFullscreen } from '../../lib/gameFullscreen'
import { I18nProvider } from '../../lib/i18n'
import GameFullscreenButton from '../GameFullscreenButton'
import GameShareButton from '../GameShareButton'

const render = (node: React.ReactNode, fullscreen?: Partial<GameFullscreen>) => {
  vi.stubGlobal('window', {
    location: { hash: '#/tower' },
    localStorage: { getItem: () => 'ja' },
  })
  const value: GameFullscreen = {
    active: false,
    native: false,
    toggle: () => {},
    exit: () => {},
    ...fullscreen,
  }
  return renderToStaticMarkup(
    <I18nProvider>
      <GameFullscreenProvider value={value}>{node}</GameFullscreenProvider>
    </I18nProvider>,
  )
}

describe('GameFullscreenButton', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('全画面でないときは「全画面にする」を出す', () => {
    const html = render(<GameFullscreenButton />)
    expect(html).toContain('aria-label="全画面にする"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('全画面のあいだは「全画面を終了」に変わる', () => {
    const html = render(<GameFullscreenButton />, { active: true })
    expect(html).toContain('aria-label="全画面を終了"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('共有ボタンの隣に並ぶので、どのゲームも最初の画面から全画面にできる', () => {
    const html = render(<GameShareButton game="tower" title="タワー" />)
    expect(html).toContain('game-fs-btn')
    expect(html).toContain('共有')
  })

  it('全画面ボタンを別に置くゲームでは、共有だけを出せる', () => {
    const html = render(<GameShareButton game="gto" title="Grand Theft Outfit" fullscreen={false} />)
    expect(html).not.toContain('game-fs-btn')
    expect(html).toContain('共有')
  })
})
