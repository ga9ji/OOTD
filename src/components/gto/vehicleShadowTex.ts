// Grand Theft Outfit [部品: vehicle の見た目] 車の下の影の絵。
// 入口: contactShadowTexture() / tireBlobTexture()
// 契約: 車体の下に敷く接地の影と、タイヤ1本ずつの真下の影の絵を作るだけ（renderVehicles.ts が全車で使い回す）。
import * as THREE from 'three'
import { clamp } from '../../lib/gto/math'

/** 接地の影の絵: 車体の真下が濃く、四隅が丸く、縁へ向けて消える */
export function contactShadowTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const image = g.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 角の丸い長方形からの距離で濃さを決める（中は一様に濃く、外側 3 割でなだらかに消える）
        const dx = Math.max(0, Math.abs((x + 0.5) / size - 0.5) * 2 - 0.76) / 0.24
        const dy = Math.max(0, Math.abs((y + 0.5) / size - 0.5) * 2 - 0.82) / 0.18
        const k = clamp(1 - Math.hypot(dx, dy), 0, 1)
        const i = (y * size + x) * 4
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 255
        image.data[i + 3] = Math.round(255 * k * k * (3 - 2 * k))
      }
    }
    g.putImageData(image, 0, 0)
  }
  return new THREE.CanvasTexture(canvas)
}

/** タイヤの真下の影の絵: 真ん中が濃く、丸く消える */
export function tireBlobTexture(): THREE.Texture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const image = g.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = clamp(1 - Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2, 0, 1)
        const i = (y * size + x) * 4
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 255
        image.data[i + 3] = Math.round(255 * Math.min(1, k * 1.8))
      }
    }
    g.putImageData(image, 0, 0)
  }
  return new THREE.CanvasTexture(canvas)
}
