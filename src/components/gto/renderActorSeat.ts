// Grand Theft Outfit [部品: onfoot の見た目] 開いたドアの開口越しに、車内へ入った主人公を見せる「のぞき窓」。
// 入口: createSeatWindow(scene) → window.show(args) / window.hide() / SEAT_WINDOW_ORDER
// 契約: 車体は閉じた箱で、開口は側面に重ねた暗い面（vehicleDoors.ts）。そのままだと、車内へ入った体は側面に隠れて
//       「ドアの陰で消える」ように見える。ここでは開口の形の見えない面を2枚、主人公の前後に描く:
//         1. 抜く面 … 開口の形に、奥行きだけを「いちばん遠く」に書き換える（色は書かない）
//         2. 主人公 … ふつうに描く。開口の中では車体の面に遮られず、開口の外では車体に隠れる
//         3. 戻す面 … 開口の奥行きを元の面の位置へ書き戻す（あとから描く半透明の物が車内に透けない）
//       描く順は renderOrder（SEAT_WINDOW_ORDER）で決める。主人公の部位は body の順にしておくこと。
//       開いたドアの板がカメラから見て開口に掛かるぶんは、開口の前の端から縮める（板の上に体が透けない）。
//       カメラが車の内側寄り・ドアの前に回ったときは出さない（そのときは体は車体に隠れるだけ）。
//       ドアが閉まったあと（運転中）は、同じ仕掛けでドアの窓の形だけを抜き、座った上半身を窓越しに見せる（glass）。
//       開口の奥に見える車内の部品（座席など）は renderActorCabin.ts。抜く面と主人公のあいだの順（cabin）で描く。
import * as THREE from 'three'
import { dirOf } from '../../lib/gto/math'
import { doorSwing, type CabinLayout } from '../../lib/gto/vehicleCabin'

/** 描く順: 抜く面 → 主人公の体 → 戻す面（ほかの不透明な物より後） */
export const SEAT_WINDOW_ORDER = { punch: 20, cabin: 20.5, body: 21, restore: 22 }

/** 閉じたドアの窓越しに見せるとき: 窓の形（ドアの枠から内へ詰める割合と m）と、窓の色・濃さ */
export const SEAT_GLASS = { front: 0.1, rear: 0.07, bottom: 0.03, top: 0.07, color: 0x1a242c, opacity: 0.3, /** 窓の面に対する見る向きの浅さの限度（外への距離 ÷ 前後のずれ） */ slant: 0.4 }

export interface SeatWindowArgs {
  /** 車の位置と向き、路面の高さ（車体の座標の y=0 に当たる世界の高さ） */
  x: number
  z: number
  heading: number
  baseY: number
  layout: CabinLayout
  side: 1 | -1
  /** ドアの開き具合 0..1 */
  door: number
  camera: THREE.Vector3
  /** 閉じたドアの窓越しに見せる（運転中）。開口ではなく窓の形だけを抜き、上から窓の色を薄く掛ける */
  glass?: boolean
}

/**
 * カメラから見て、開いたドアの板に隠れずに見える開口の範囲（ヒンジから後ろへ m）の前の端。
 * 見えない（板が全部に掛かる・カメラが開口の裏にいる）ときは null。
 * @param cb カメラの位置: ヒンジから後ろへ m
 * @param co カメラの位置: 車体の側面から外へ m
 * @param length ドアの長さ m
 * @param angle ドアの開いた角度 rad
 */
export function openingFrom(cb: number, co: number, length: number, angle: number): number | null {
  if (co <= 0.05) return null
  const tb = length * Math.cos(angle)
  const to = length * Math.sin(angle)
  if (co <= to + 1e-4) {
    // カメラが板の先端より側面に近い: 板と車体のあいだから覗いていれば全部見え、板の外側にいれば全部隠れる
    return co * tb < to * cb ? 0 : null
  }
  // カメラと板の先端を結ぶ線が側面と交わる所までが、板の陰
  const edge = cb + ((tb - cb) * co) / (co - to)
  const from = Math.max(0, edge)
  return from < length - 0.03 ? from : null
}

/**
 * 閉じたドアの窓越しに、座った体を見せてよい向きか。窓をほぼ正面〜斜めから見ているときだけ
 * （真後ろ・真ん前からの浅い角度では、窓の面が車体の輪郭の外へ線のように見えてしまう）。
 * @param back カメラの位置: 頭の真横から後ろへ m（前は負）
 * @param out カメラの位置: 窓の面から外へ m
 */
export function glassSeen(back: number, out: number): boolean {
  return out > 0.3 && out > Math.abs(back) * SEAT_GLASS.slant
}

export interface SeatWindow {
  show: (args: SeatWindowArgs) => void
  hide: () => void
  dispose: () => void
}

export function createSeatWindow(scene: THREE.Scene): SeatWindow {
  // 下半分（敷居〜肩）と上半分（肩〜屋根。内へ寝ている）の四角を2枚。頂点は毎フレーム世界の座標で入れる
  const positions = new Float32Array(8 * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7])
  const punchMaterial = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    colorWrite: false,
    depthFunc: THREE.AlwaysDepth,
    side: THREE.DoubleSide,
  })
  const restoreMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const glassMaterial = new THREE.MeshBasicMaterial({ color: SEAT_GLASS.color, transparent: true, opacity: SEAT_GLASS.opacity, depthWrite: false, side: THREE.DoubleSide })
  const punch = new THREE.Mesh(geometry, punchMaterial)
  const restore = new THREE.Mesh(geometry, restoreMaterial)
  // 窓越しのとき、体の上へ掛ける窓の色（半透明なので、不透明な物を描き終えたあとに描かれる）
  const glass = new THREE.Mesh(geometry, glassMaterial)
  // three は「群の順 → 物の順」で並べる。主人公の部位は群の中にあるので、こちらも群に入れて群の順をそろえる
  const holders: THREE.Group[] = []
  for (const [m, order] of [
    [punch, SEAT_WINDOW_ORDER.punch],
    [restore, SEAT_WINDOW_ORDER.restore],
    [glass, SEAT_WINDOW_ORDER.restore],
  ] as const) {
    m.frustumCulled = false
    m.visible = false
    m.renderOrder = order
    const holder = new THREE.Group()
    holder.renderOrder = order
    holder.add(m)
    holders.push(holder)
    scene.add(holder)
  }

  const hide = () => {
    punch.visible = false
    restore.visible = false
    glass.visible = false
  }

  const show = (a: SeatWindowArgs) => {
    const d = a.layout.door
    const f = dirOf(a.heading)
    const length = d.rearZ - d.hingeZ
    // カメラを車体の座標へ（後ろが ＋、使う側の外が ＋）
    const rx = a.camera.x - a.x
    const rz = a.camera.z - a.z
    const camBack = -(rx * f.x + rz * f.z)
    const camOut = (rx * -f.z + rz * f.x) * a.side
    const from = a.glass ? (glassSeen(camBack - a.layout.head.z, camOut - d.halfBelt) ? 0 : null) : a.door > 0.02 ? openingFrom(camBack - d.hingeZ, camOut - d.halfBelt, length, doorSwing(a.door)) : null
    if (from == null) {
      hide()
      return
    }
    const put = (i: number, back: number, half: number, y: number) => {
      const out = half * a.side
      const fw = -back
      positions[i * 3] = a.x - f.z * out + f.x * fw
      positions[i * 3 + 1] = a.baseY + y
      positions[i * 3 + 2] = a.z + f.x * out + f.z * fw
    }
    if (a.glass) {
      // 窓の形だけ（肩の線から屋根まで。枠のぶん内へ詰める）。下半分の四角は潰しておく
      const g = SEAT_GLASS
      const g0 = d.hingeZ + length * g.front
      const g1 = d.rearZ - length * g.rear
      const span = d.roofY - d.beltY
      const lowK = g.bottom / span
      const highK = 1 - g.top / span
      const half = (k: number) => d.halfBelt + (d.halfRoof - d.halfBelt) * k
      for (const i of [0, 1, 2, 3]) put(i, g0, half(lowK), d.beltY + g.bottom)
      put(4, g0, half(lowK), d.beltY + g.bottom)
      put(5, g1, half(lowK), d.beltY + g.bottom)
      put(6, g0, half(highK), d.roofY - g.top)
      put(7, g1, half(highK), d.roofY - g.top)
    } else {
      const b0 = d.hingeZ + from
      const b1 = d.rearZ
      put(0, b0, d.halfBelt, d.sillY)
      put(1, b1, d.halfBelt, d.sillY)
      put(2, b0, d.halfBelt, d.beltY)
      put(3, b1, d.halfBelt, d.beltY)
      put(4, b0, d.halfBelt, d.beltY)
      put(5, b1, d.halfBelt, d.beltY)
      put(6, b0, d.halfRoof, d.roofY)
      put(7, b1, d.halfRoof, d.roofY)
    }
    ;(geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    punch.visible = true
    restore.visible = true
    glass.visible = a.glass === true
  }

  return {
    show,
    hide,
    dispose: () => {
      scene.remove(...holders)
      geometry.dispose()
      punchMaterial.dispose()
      restoreMaterial.dispose()
      glassMaterial.dispose()
    },
  }
}
