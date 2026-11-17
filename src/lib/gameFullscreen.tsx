import { createContext, useCallback, useContext, useEffect, useMemo, useState, type RefObject } from 'react'
import { requestNativeFullscreen } from './fullscreen'

/**
 * ゲームの全画面。App のルート要素ごと切り替えるので、ゲーム内で画面が変わっても
 * （選択 → 対戦 → 再戦など）全画面のまま続く。
 */
export type GameFullscreen = {
  /** 全画面かどうか（ブラウザの全画面でも擬似全画面でも true）。 */
  active: boolean
  /** ブラウザの Fullscreen API で全画面になっている（画面の向きを固定できるのはこのときだけ）。 */
  native: boolean
  toggle: () => void
  exit: () => void
}

const GameFullscreenContext = createContext<GameFullscreen>({
  active: false,
  native: false,
  toggle: () => {},
  exit: () => {},
})

export const GameFullscreenProvider = GameFullscreenContext.Provider

// 全画面のあいだは、ウィンドウではなく全画面にした要素の中でスクロールする。
let fullscreenScroller: HTMLElement | null = null

/** ゲームの画面を切り替えたときに先頭へ戻す。全画面でもそうでなくても効く。 */
export function scrollGameToTop() {
  window.scrollTo({ top: 0 })
  fullscreenScroller?.scrollTo({ top: 0 })
}

export function useGameFullscreen(): GameFullscreen {
  return useContext(GameFullscreenContext)
}

/**
 * 全画面の状態を持つ。`enabled` が false になったら（ゲームから出たら）全画面を解く。
 * Fullscreen API が無い端末（iPhone のブラウザ）や要求が拒否されたときは、
 * fixed で画面を覆う擬似全画面（`pseudo`）に切り替える。
 */
export function useGameFullscreenController(
  targetRef: RefObject<HTMLElement>,
  enabled: boolean,
): GameFullscreen & { pseudo: boolean } {
  const [native, setNative] = useState(false)
  const [pseudo, setPseudo] = useState(false)

  useEffect(() => {
    const onChange = () => setNative(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // 擬似全画面のあいだは、背後のページをスクロールさせない。
  useEffect(() => {
    if (!pseudo) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [pseudo])

  const exit = useCallback(() => {
    setPseudo(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement || pseudo) {
      exit()
      return
    }
    void requestNativeFullscreen(targetRef.current).then((entered) => {
      if (!entered) setPseudo(true)
    })
  }, [exit, pseudo, targetRef])

  useEffect(() => {
    if (!enabled) exit()
  }, [enabled, exit])

  const active = enabled && (native || pseudo)
  useEffect(() => {
    if (!active) return
    fullscreenScroller = targetRef.current
    return () => {
      fullscreenScroller = null
    }
  }, [active, targetRef])
  return useMemo(
    () => ({ active, native: enabled && native, pseudo: enabled && pseudo, toggle, exit }),
    [active, enabled, native, pseudo, toggle, exit],
  )
}
