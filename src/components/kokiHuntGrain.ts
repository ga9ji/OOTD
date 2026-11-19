import * as THREE from 'three'

export type Grain = 'hide' | 'horn' | 'canvas'

// Small periodic tiles keep the surface relief stable as the camera moves.
// The same linear grayscale sample modulates diffuse color and bump height.
export function makeGrain(kind: Grain) {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  const tau = Math.PI * 2
  const cells = 8
  const jitter = (x: number, y: number, seed: number) => {
    const n = Math.sin((x % cells + cells) % cells * 127.1 + (y % cells + cells) % cells * 311.7 + seed) * 43758.5453
    return (n - Math.floor(n) - .5) * .64
  }
  const sites = Array.from({ length: cells * cells }, (_, i) => {
    const x = i % cells, y = Math.floor(i / cells)
    return [jitter(x, y, 1), jitter(x, y, 13)]
  })
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size
    let light: number
    if (kind === 'hide') {
      const col = Math.floor(u * cells), row = Math.floor(v * cells)
      let nearest = Infinity, next = Infinity
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const a = col + i, b = row + j
        const site = sites[((b + cells) % cells) * cells + (a + cells) % cells]
        const dx = u * cells - a - .5 - site[0], dy = v * cells - b - .5 - site[1]
        const d = dx * dx + dy * dy
        if (d < nearest) { next = nearest; nearest = d } else if (d < next) next = d
      }
      light = .63 + .34 * THREE.MathUtils.smoothstep(next - nearest, 0, .22) - .07 * nearest
    } else if (kind === 'horn') {
      const bend = .28 * Math.sin(tau * u) + .18 * Math.sin(tau * 3 * u)
      light = .80 + .12 * Math.cos(tau * 7 * v + bend) + .046 * Math.sin(tau * 19 * v + bend)
    } else {
      const weft = Math.cos(tau * 16 * v), warp = Math.sin(tau * 16 * u)
      light = .80 + .093 * weft * warp + .04 * (weft + warp)
    }
    const k = (y * size + x) * 4
    pixels.fill(Math.round(light * 255), k, k + 3)
    pixels[k + 3] = 255
  }
  const texture = new THREE.DataTexture(pixels, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
