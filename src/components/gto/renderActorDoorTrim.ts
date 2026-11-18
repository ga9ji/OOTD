// Grand Theft Outfit [部品: onfoot の見た目] 開いたドアの内側に載せる、車体色の縁取り。
// 入口: createDoorTrim(scene, shade) → trim.show(args) / trim.hide()
// 契約: ドアそのもの（板・窓・蝶番の動き）は車の担当の vehicleDoors.ts。背後のカメラからは開いたドアの内側と
//       後ろの小口しか見えず、内張りの灰色と日陰の塗装で「黒い板」に見える。ここでは乗り降りのあいだだけ、
//       同じ蝶番・同じ開き角で、内側の縁（上の帯・後ろの帯・下の帯・窓枠）と後ろの小口を車体の色で重ねる。
//       陰影は付けない（日陰でも車体の色が読める）。時刻の明るさは shade で掛ける。
//       [vehicle への要望] 内張りの縁と小口を車体色にする処理を vehicleDoors.ts に入れてもらえれば、この部品は消せる。
import * as THREE from 'three'
import { dirOf } from '../../lib/gto/math'
import { doorSwing, type CabinLayout } from '../../lib/gto/vehicleCabin'

/** 見た目を決める数字（m） */
export const DOOR_TRIM = {
  /** 内側の面から浮かせる量と、帯の厚み */
  lift: 0.034,
  thick: 0.008,
  /** 帯の幅: 上・後ろ・下・前、窓枠 */
  top: 0.15,
  rear: 0.1,
  bottom: 0.07,
  front: 0.08,
  frame: 0.06,
  /** 後ろの小口の厚み（ドアの板の厚みに合わせる）と奥行き */
  capWide: 0.07,
  capDeep: 0.014,
  /** 車体の色に掛ける明るさ（内側は外板より少し暗い） */
  dim: 0.82,
  /** 外板に重ねる車体色の面: 車の担当の板の厚み m（vehicleDoors の DOOR_LOOK.thickness）と、そこから浮かせる量 m、明るさ。
   *  開きかけ・閉じかけの浅い角度では背後のカメラに外板が見え、日陰の塗装が真っ黒な板に写る */
  skinAt: 0.055,
  skinLift: 0.004,
  skinDim: 0.9,
  /** 外から見た窓枠の帯の幅 m */
  skinFrame: 0.05,
  /** 内張り（縁の内側を埋める明るい布地の面）と、肘掛けの帯の色。車の担当の内張りは濃い灰色で、日陰や浅い角度では
   *  ドアごと真っ黒な板に見える。陰影の付かない明るい面を重ねて、どの角度でも「内張りのあるドア」に読ませる */
  card: 0xa59c8a,
  rest: 0x6f685c,
  /** 肘掛けの帯: 内張りの下からの高さ（割合）と幅 m、内へ出す量 m */
  restAt: 0.52,
  restTall: 0.07,
  restOut: 0.02,
}

export interface DoorTrimArgs {
  x: number
  z: number
  heading: number
  baseY: number
  layout: CabinLayout
  side: 1 | -1
  door: number
  color: number
  /** 車体の座標 → 世界（chassisFrame）。あれば位置と向きの代わりに使う（車体の傾き・沈み込みにドアごと付いていく） */
  frame?: THREE.Matrix4 | null
}

const fx = new THREE.Vector3()
const fy = new THREE.Vector3()
const fz = new THREE.Vector3()
const fw = new THREE.Vector3()
const fo = new THREE.Vector3()

/**
 * 車体の座標（前が −z、右が ＋x、路面が y=0）から世界への変換を、車の担当が返す3点（右の座席・左の座席・右の頭）から起こす。
 * 車体は乗り降りの重みやサスペンションで傾く。路面に水平なまま重ねると、傾いた車のドアの板が縁取りの外へはみ出す。
 */
export function chassisFrame(layout: CabinLayout, seatR: THREE.Vector3, seatL: THREE.Vector3, headR: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const a = layout.head.y - layout.seat.y
  const b = layout.head.z - layout.seat.z
  fx.subVectors(seatR, seatL).normalize()
  // 座席 → 頭 の向きから、右向きの成分を除いた残りは「上 × a ＋ 後ろ × b」
  fw.subVectors(headR, seatR).addScaledVector(fx, -(layout.head.x - layout.seat.x))
  fz.crossVectors(fx, fw)
  fy.copy(fw).multiplyScalar(a).addScaledVector(fz, -b).normalize()
  fz.crossVectors(fx, fy)
  fo.copy(seatR).addScaledVector(fx, -layout.seat.x).addScaledVector(fy, -layout.seat.y).addScaledVector(fz, -layout.seat.z)
  return out.makeBasis(fx, fy, fz).setPosition(fo)
}

export interface DoorTrim {
  show: (args: DoorTrimArgs) => void
  hide: () => void
  dispose: () => void
}

/** @param shade 時刻ごとの明るさ（スプライトに掛けているのと同じ色） */
export function createDoorTrim(scene: THREE.Scene, shade: THREE.Color): DoorTrim {
  const T = DOOR_TRIM
  // 蝶番を原点に、後ろ（＋z）へ 1・上（＋y）へ 1 伸びる箱（vehicleDoors と同じ置き方）
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5)
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const cardMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const restMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const skinMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const car = new THREE.Group()
  const pivot = new THREE.Group()
  const upper = new THREE.Group()
  car.add(pivot)
  pivot.add(upper)
  car.visible = false
  car.matrixAutoUpdate = false
  scene.add(car)
  const bar = (parent: THREE.Group, mat: THREE.Material = material) => {
    const m = new THREE.Mesh(box, mat)
    parent.add(m)
    return m
  }
  const low = { top: bar(pivot), rear: bar(pivot), bottom: bar(pivot), front: bar(pivot), cap: bar(pivot) }
  const lining = { card: bar(pivot, cardMaterial), rest: bar(pivot, restMaterial) }
  const skin = { panel: bar(pivot, skinMaterial), post: bar(upper, skinMaterial), rail: bar(upper, skinMaterial), rear: bar(upper, skinMaterial) }
  const high = { rear: bar(upper), top: bar(upper), front: bar(upper), cap: bar(upper) }
  let built: CabinLayout | null = null
  let builtSide = 0

  const build = (layout: CabinLayout, side: 1 | -1) => {
    const d = layout.door
    const length = d.rearZ - d.hingeZ
    const panelH = d.beltY - d.sillY
    const lean = d.halfBelt - d.halfRoof
    const glassH = Math.hypot(d.roofY - d.beltY, lean)
    // 内側（車体の中心の側）へ lift だけ寄せた薄い板
    const inX = -side * T.lift
    const set = (m: THREE.Mesh, z: number, y: number, len: number, h: number, x = inX, wide = T.thick) => {
      m.scale.set(wide, h, len)
      m.position.set(x, y, z)
    }
    pivot.position.set(side * (d.halfBelt + 0.006), d.sillY, d.hingeZ)
    set(low.top, 0, panelH - T.top, length, T.top)
    set(low.rear, length - T.rear, 0, T.rear, panelH)
    set(low.bottom, 0, 0, length, T.bottom)
    set(low.front, 0, 0, T.front, panelH)
    // 後ろの小口（板の厚みの面。背後のカメラからいちばんよく見える）
    set(low.cap, length, 0, T.capDeep, panelH, side * (T.capWide / 2 - T.lift), T.capWide)
    // 内張り: 縁の帯の内側を埋める面（帯より少し奥）と、その上の肘掛け
    const cardLen = length - T.front - T.rear
    const cardH = panelH - T.top - T.bottom
    set(lining.card, T.front, T.bottom, cardLen, cardH, -side * (T.lift - 0.004))
    set(lining.rest, T.front + cardLen * 0.12, T.bottom + cardH * T.restAt, cardLen * 0.7, T.restTall, -side * (T.lift + T.restOut / 2), T.restOut)
    // 外板: 下半分を覆う面と、窓枠（前の柱・上の桟・後ろの柱）
    const outX = side * (T.skinAt + T.skinLift)
    set(skin.panel, 0, 0, length, panelH, outX)
    const frameOut = side * (T.skinAt * 0.7 + T.skinLift)
    set(skin.post, 0, 0, T.skinFrame, glassH, frameOut)
    set(skin.rail, 0, glassH - T.skinFrame, length, T.skinFrame, frameOut)
    set(skin.rear, length - T.skinFrame, 0, T.skinFrame, glassH, frameOut)
    upper.position.y = panelH
    upper.rotation.z = side * Math.atan2(lean, d.roofY - d.beltY)
    const frameX = -side * 0.01
    set(high.rear, length - T.frame, 0, T.frame, glassH, frameX)
    set(high.top, 0, glassH - T.frame, length, T.frame, frameX)
    set(high.front, 0, 0, T.frame, glassH, frameX)
    set(high.cap, length, 0, T.capDeep, glassH, side * 0.012, 0.05)
    built = layout
    builtSide = side
  }

  return {
    show: (a) => {
      if (a.door <= 0.005) {
        car.visible = false
        return
      }
      if (built !== a.layout || builtSide !== a.side) build(a.layout, a.side)
      const f = dirOf(a.heading)
      if (a.frame) {
        car.matrix.copy(a.frame)
      } else {
        car.position.set(a.x, a.baseY, a.z)
        // 車体の座標（前が −z、右が ＋x）を世界へ
        car.rotation.y = Math.atan2(-f.x, -f.z)
        car.updateMatrix()
      }
      car.matrixWorldNeedsUpdate = true
      pivot.rotation.y = a.side * doorSwing(a.door)
      material.color.setHex(a.color).multiply(shade).multiplyScalar(T.dim)
      skinMaterial.color.setHex(a.color).multiply(shade).multiplyScalar(T.skinDim)
      cardMaterial.color.setHex(T.card).multiply(shade)
      restMaterial.color.setHex(T.rest).multiply(shade)
      car.visible = true
    },
    hide: () => {
      car.visible = false
    },
    dispose: () => {
      scene.remove(car)
      box.dispose()
      material.dispose()
      cardMaterial.dispose()
      skinMaterial.dispose()
      restMaterial.dispose()
    },
  }
}
