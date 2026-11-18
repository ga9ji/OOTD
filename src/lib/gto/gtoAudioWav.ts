// Grand Theft Outfit [部品: audio] 書き出した音を WAV にする道具。
// 入口: encodeWav(channels, sampleRate) / audioStats(channels, sampleRate) / toBase64(bytes)
// 契約: 入力の配列は書き換えない。WAV は 16bit PCM。

/** −1..1 の波形を 16bit PCM の WAV にする（範囲の外は切り詰める） */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * count * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * count * 2, true)
  view.setUint16(32, count * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, Math.round(v < 0 ? v * 32768 : v * 32767), true)
      offset += 2
    }
  }
  return bytes
}

export interface AudioStats {
  /** 最大の振幅 */
  peak: number
  /** 全体の実効値 */
  rms: number
  /** 振幅が 1 以上（音割れ）のサンプルの割合 */
  clipped: number
  /** 0.5 秒ごとの実効値（dB）。場面の移り変わりを数字で追う */
  windows: number[]
}

export function audioStats(channels: readonly Float32Array[], sampleRate: number): AudioStats {
  const frames = channels[0]?.length ?? 0
  const size = Math.max(1, Math.floor(sampleRate / 2))
  const windows: number[] = []
  let peak = 0
  let sum = 0
  let clipped = 0
  let windowSum = 0
  let windowCount = 0
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const v = ch[i]
      const a = Math.abs(v)
      if (a > peak) peak = a
      if (a >= 1) clipped++
      sum += v * v
      windowSum += v * v
    }
    windowCount++
    if (windowCount === size || i === frames - 1) {
      const mean = windowSum / (windowCount * channels.length)
      windows.push(Math.round(10 * Math.log10(Math.max(mean, 1e-10)) * 10) / 10)
      windowSum = 0
      windowCount = 0
    }
  }
  const total = Math.max(1, frames * channels.length)
  return { peak, rms: Math.sqrt(sum / total), clipped: clipped / total, windows }
}

/** 大きなバイト列でも落ちないよう、小分けにして base64 にする */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
