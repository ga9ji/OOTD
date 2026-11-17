type FullscreenTarget = {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void
}

/**
 * 要素をブラウザの全画面にする。できたら true。
 *
 * iPhone のブラウザは（Safari 以外も中身は WebKit なので）要素の Fullscreen API を持たず、
 * 埋め込み表示などでは要求が拒否されることもある。そのときは false を返すので、
 * 呼び出し側は fixed で画面を覆う「擬似全画面」に切り替える。
 *
 * ユーザー操作の権限が切れないよう、クリックのハンドラーから同期的に呼ぶこと
 * （最初の await までは同期で進むので、この関数をそのまま呼べばよい）。
 */
export async function requestNativeFullscreen(
  element: FullscreenTarget | null | undefined,
): Promise<boolean> {
  if (typeof element?.requestFullscreen !== 'function') return false
  try {
    await element.requestFullscreen()
    return true
  } catch {
    return false
  }
}
