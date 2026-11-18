// Grand Theft Outfit [部品: vehicle の見た目] 塗装とガラスの材質（空と地面の映り込み）。
// 入口: createPaintKit(mobile)
// 契約: 車体に映り込ませる小さな環境の絵（上が明るい空、地平線に白い帯、下が暗い地面）を1枚作り、
//       塗装・ガラスの材質に持たせる。曲面の法線に沿って地平線の帯が流れ、塗装の艶に見える。
//       スマホの軽量設定では映り込みなしの軽い材質にする。明るさは level(0..1) で時刻に合わせる。
import * as THREE from 'three'

/** 見た目を決める数字 */
export const PAINT_LOOK = {
  /** 映り込みの強さ（塗装・ガラス）。昼の空でこの値、夜は空の暗さに合わせて弱まる。
   *  ガラスは 0.3 だと空の色で灰色の板に見えた。暗い半透明のガラスに見える濃さに留め、艶は鏡面の光で出す */
  paintReflect: 0.13,
  glassReflect: 0.11,
  /** 艶（ハイライトの鋭さと明るさ） */
  shininess: 90,
  specular: 0x565656,
}

/** 映り込ませる環境の絵（横長の全天。上から 空 → 地平線の白い帯 → 地面） */
function envTexture(): THREE.DataTexture {
  const w = 32
  const h = 64
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    // v は 0 が真下、1 が真上
    const v = y / (h - 1)
    const up = (v - 0.5) * 2
    let rgb: [number, number, number]
    if (up < -0.04) {
      // 地面: 車の近くは暗い路面、地平線へ向けて少し明るい
      const k = Math.min(1, -up / 0.6)
      rgb = [70 - 44 * k, 64 - 40 * k, 58 - 36 * k]
    } else if (up < 0.1) {
      // 地平線: 街並みの明るい帯
      const k = 1 - Math.abs(up - 0.03) / 0.07
      rgb = [150 + 100 * k, 150 + 100 * k, 150 + 96 * k]
    } else {
      // 空: 地平線の近くが白く、天頂へ向けて青い
      const k = Math.min(1, (up - 0.1) / 0.9)
      rgb = [205 - 100 * k, 225 - 70 * k, 240 - 30 * k]
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = rgb[0]
      data[i + 1] = rgb[1]
      data[i + 2] = rgb[2]
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

export type PaintMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial

export interface PaintKit {
  /** 車1台ぶんの塗装（色は車ごと） */
  paint: (color: number) => PaintMaterial
  /** 窓と黒い部品（全車で共用） */
  trim: PaintMaterial
  /** 映り込みの明るさを時刻に合わせる（0..1）。塗装は車ごとの材質なので、渡された材質にも掛ける */
  level: (k: number, paints: Iterable<PaintMaterial>) => void
  dispose: () => void
}

export function createPaintKit(mobile: boolean): PaintKit {
  const look = PAINT_LOOK
  if (mobile) {
    const trim = new THREE.MeshLambertMaterial({ vertexColors: true })
    return {
      paint: (color) => new THREE.MeshLambertMaterial({ vertexColors: true, color }),
      trim,
      level: () => undefined,
      dispose: () => trim.dispose(),
    }
  }
  const env = envTexture()
  const trim = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x8a949c, envMap: env, combine: THREE.MixOperation, reflectivity: look.glassReflect })
  // タイヤハウスの内張り（ほぼ黒の頂点色）は艶も映り込みも持たない。持たせると、日の当たる向きで穴の奥が灰色の板に光る
  trim.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <specularmap_fragment>',
      'float specularStrength = smoothstep(0.016, 0.04, max(vColor.r, max(vColor.g, vColor.b)));',
    )
  }
  let last = -1
  return {
    paint: (color) =>
      new THREE.MeshPhongMaterial({ vertexColors: true, color, shininess: look.shininess, specular: look.specular, envMap: env, combine: THREE.MixOperation, reflectivity: look.paintReflect * (last < 0 ? 1 : last) }),
    trim,
    level: (k, paints) => {
      if (Math.abs(k - last) < 0.01) return
      last = k
      trim.reflectivity = look.glassReflect * k
      for (const m of paints) if (m instanceof THREE.MeshPhongMaterial) m.reflectivity = look.paintReflect * k
    },
    dispose: () => {
      trim.dispose()
      env.dispose()
    },
  }
}
