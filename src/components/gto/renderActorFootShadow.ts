// Grand Theft Outfit [部品: onfoot の見た目] 主人公の足の真下に貼り付く影。
// 入口: createFootShadows(blob, opacity) → shadows.update(pose, tall, yaw, legHalf) / shadows.root / shadows.dispose()
//       makeDenseBlobTexture() … 明るい地面でも濃く出る丸い影の絵
// 契約: 体の下の丸い影だけでは、走りで足が体の前後へ出たとき影が足から離れて「浮いて滑っている」ように見える。
//       ここは左右の足それぞれの真下に小さな濃い影を置く。足が上がるほど薄く広がり、着いた瞬間に濃くなるので、
//       1コマだけ見ても「どちらの足が地面を踏んでいるか」が分かる。位置は lib/gto/onFootRig.ts の footContacts。
import * as THREE from 'three'
import { contactShade, footContacts, type RigPose } from '../../lib/gto/onFootRig'

/** 見た目を決める数字（長さは身長に対する割合） */
export const FOOT_SHADOW_STYLE = {
  /** 影の幅と奥行き */
  wide: 0.15,
  deep: 0.24,
  /** いちばん濃いときの不透明度 [色調を後段で掛ける画質（明るさが 1 を超える）, 掛けない画質] */
  opacity: [1, 0.6],
  /** 濃い影の絵: 中心で地面の明るさを残す割合（小さいほど黒い） */
  denseFloor: 0.05,
  /** 地面から浮かせる高さ m（地面と重なってちらつかない） */
  lift: 0.03,
  /** 足の長さの真ん中へ寄せる量（くるぶしより前） */
  ahead: 0.025,
}

export interface FootShadows {
  root: THREE.Group
  update: (pose: RigPose, tall: number, yaw: number, legHalf: number) => void
  dispose: () => void
}

/**
 * 明るい地面でも濃く出る丸い影。色調を後段で掛ける画質では、日なたの地面の明るさは 1 を大きく超えていて、
 * 半分暗くしても画面ではほとんど変わらない。そこで「地面の明るさを残す割合」を中心から縁へ等比で変える
 * （中心 denseFloor 倍 → 縁 1 倍）。どの明るさの地面でも、縁がなだらかな濃い影になる。
 */
export function makeDenseBlobTexture(): THREE.Texture {
  const size = 64
  const k = Math.log(1 / FOOT_SHADOW_STYLE.denseFloor)
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
      const a = Math.max(0, 1 - d)
      const s = a * a * (3 - 2 * a)
      data[(y * size + x) * 4 + 3] = Math.round(255 * (1 - Math.exp(-k * s)))
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** @param opacity いちばん濃いときの不透明度 */
export function createFootShadows(blob: THREE.Texture, opacity: number): FootShadows {
  const S = FOOT_SHADOW_STYLE
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  const make = () => {
    const material = new THREE.MeshBasicMaterial({
      map: blob,
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 2
    return { mesh, material }
  }
  const feet = [make(), make()]
  const root = new THREE.Group()
  root.name = 'gto-foot-shadows'
  for (const f of feet) root.add(f.mesh)

  return {
    root,
    update: (pose, tall, yaw, legHalf) => {
      // 体の座標（+z が前・+x が左）を世界へ: 人形と同じ向きに回し、身長で拡大する
      root.rotation.y = Math.PI - yaw
      root.scale.set(tall, 1, tall)
      const at = footContacts(pose, legHalf)
      ;[at.l, at.r].forEach((p, i) => {
        const shade = contactShade(p.y)
        const f = feet[i]
        f.mesh.visible = shade.opacity > 0.01
        f.mesh.position.set(p.x, S.lift, p.z + S.ahead)
        f.mesh.scale.set(S.wide * shade.scale, 1, S.deep * shade.scale)
        f.material.opacity = opacity * shade.opacity
      })
    },
    dispose: () => {
      geometry.dispose()
      for (const f of feet) f.material.dispose()
    },
  }
}
