import { describe, expect, it, vi } from 'vitest'
import { requestNativeFullscreen } from '../fullscreen'

describe('requestNativeFullscreen', () => {
  it('reports success when the browser enters fullscreen', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const pending = requestNativeFullscreen({ requestFullscreen })
    // ユーザー操作の権限が切れないよう、呼んだその場で要求している。
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toBe(true)
  })

  it('falls back when the Fullscreen API is missing (iPhone browsers)', async () => {
    await expect(requestNativeFullscreen({})).resolves.toBe(false)
    await expect(requestNativeFullscreen(null)).resolves.toBe(false)
  })

  it('falls back when the request is rejected', async () => {
    const requestFullscreen = () => Promise.reject(new TypeError('Fullscreen request denied'))
    await expect(requestNativeFullscreen({ requestFullscreen })).resolves.toBe(false)
  })

  it('falls back when the request throws synchronously', async () => {
    const requestFullscreen = () => {
      throw new TypeError('not allowed')
    }
    await expect(requestNativeFullscreen({ requestFullscreen })).resolves.toBe(false)
  })
})
