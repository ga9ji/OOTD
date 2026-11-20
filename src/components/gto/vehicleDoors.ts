// Grand Theft Outfit [部品: vehicle の見た目] 車体のヒンジを軸に開閉する前のドア。
// 入口（ほかの部品から）: requestVehicleDoor(vehicleId, side, open) / vehicleSeatPoint(vehicleId, side, which, out) / vehicleCabin(kind)
// 入口（renderVehicles から）: createDoorKit(shadows) → kit.attach(chassis, kind, paint) → doors.set(side, open) / doors.point(...)
// 契約: ドアは車体（chassis: 傾き・沈み込みごと動く群）の子として置くので、車体がロールしても枠からずれない。
//       閉じているあいだは何も描かない（車体の側面がそのままドア）。開き具合が 0 を超えたら、
//       塗装色の板と窓がヒンジ（フロントガラスの付け根の柱）を軸に外へ開き、車体の側面には暗い開口（車内）が見える。
//       寸法は lib/gto/vehicleCabin.ts（車種の断面から出したドアの枠と座席）。使われるまで何も作らない。
import * as THREE from 'three'
import { isCar, VEHICLE_SPECS } from '../../lib/gto/vehicle'
import { cabinLayout, doorSwing, type CabinLayout } from '../../lib/gto/vehicleCabin'
import type { CarKind, VehicleKind } from '../../lib/gto/types'
import { VEHICLE_LOOK } from './vehicleShape'

// ---- ほかの部品（乗り降りの見た目）との受け渡し ----
// 描画部品どうしは互いを import しないので、ここに「どの車のどちらのドアをどれだけ開けたいか」を預かる。
// 乗り降りの担当は毎フレーム requestVehicleDoor を呼ぶ（呼ばなくなれば、次のフレームで閉じて消える）。

const requests = new Map<number, { right: number; left: number; stamp: number }>()
const seats = new Map<number, CarDoors>()
let stamp = 0

/** 車 vehicleId の side（＋1 が右＝運転席側、−1 が左）のドアを、このフレームは open（0〜1）だけ開けておく */
export function requestVehicleDoor(vehicleId: number, side: DoorSide, open: number): void {
  const found = requests.get(vehicleId)
  const fresh = found && found.stamp === stamp ? found : { right: 0, left: 0, stamp }
  requests.set(vehicleId, side === 1 ? { ...fresh, right: open } : { ...fresh, left: open })
}

/** renderVehicles 用: このフレームに頼まれた開き具合を返す。頼まれていなければ 0 */
export function doorRequest(vehicleId: number, side: DoorSide): number {
  const found = requests.get(vehicleId)
  if (!found || found.stamp !== stamp) return 0
  return side === 1 ? found.right : found.left
}

/** renderVehicles 用: 全車を置き終えたら呼ぶ（頼まれた分を使い切り、次のフレームの受け付けを始める） */
export function endDoorFrame(): void {
  stamp += 1
  for (const [id, r] of requests) if (r.stamp < stamp - 1) requests.delete(id)
}

/** renderVehicles 用: 描いている車のドアを登録・解除する */
export function registerCarDoors(vehicleId: number, doors: CarDoors | null): void {
  if (doors) seats.set(vehicleId, doors)
  else seats.delete(vehicleId)
}

/**
 * 車 vehicleId に座った人物の腰（seat）・頭（head）の中心を、世界の座標で out に入れて返す。
 * 車体の傾き・沈み込みを含む（直前に描いたフレームの姿勢）。その車を描いていなければ null。
 * 頭は窓の下の線と屋根のあいだにあるので、ここに人物の上半身を置けば窓越しに見える高さになる。
 */
export function vehicleSeatPoint(vehicleId: number, side: DoorSide, which: 'seat' | 'head', out: THREE.Vector3): THREE.Vector3 | null {
  const doors = seats.get(vehicleId)
  return doors ? doors.point(side, which, out) : null
}

const layouts = new Map<CarKind, CabinLayout>()

/** 車種ごとのドアの枠と座席の位置（車体の座標: 前が −z、右が ＋x、路面が y=0。x は中心からの距離） */
export function vehicleCabin(of: VehicleKind): CabinLayout {
  // [cheats] 戦車と飛行機には車室が無い（ドアの演技をせず、運転中の体も描かない）。聞かれたらセダンの寸法を返す
  const kind: CarKind = isCar(of) ? of : 'sedan'
  const found = layouts.get(kind)
  if (found) return found
  const made = cabinLayout(VEHICLE_SPECS[kind], VEHICLE_LOOK[kind])
  layouts.set(kind, made)
  return made
}

/** 見た目を決める数字 */
export const DOOR_LOOK = {
  /** 板の厚み m と、車体の側面から浮かせる量 m（閉じかけで側面と重なってちらつかないように） */
  thickness: 0.055,
  proud: 0.006,
  /** 内張り・窓・開口（車内）の色と、窓の濃さ */
  inner: 0x4a4e56,
  glass: 0x18222c,
  glassOpacity: 0.38,
  cabin: 0x0c0e11,
  /** これより開いたら開口を見せる（0〜1） */
  cabinFrom: 0.04,
}

export type DoorSide = 1 | -1

export interface CarDoors {
  /** side（＋1 が右、−1 が左）のドアを open（0〜1）だけ開く。0 で閉じる（描かない） */
  set: (side: DoorSide, open: number) => void
  /** 座った人物の腰（seat）・頭（head）の位置を世界の座標で返す（車体の傾きと沈み込みを含む） */
  point: (side: DoorSide, which: 'seat' | 'head', out: THREE.Vector3) => THREE.Vector3
  layout: CabinLayout
  dispose: () => void
}

export interface DoorKit {
  attach: (chassis: THREE.Group, kind: CarKind, paint: THREE.Material) => CarDoors
  dispose: () => void
}

interface Leaf {
  pivot: THREE.Group
  cabin: THREE.Group
}

export function createDoorKit(shadows: boolean): DoorKit {
  const look = DOOR_LOOK
  // ヒンジを原点に、後ろ（＋z）へ 1、上（＋y）へ 1 伸びる箱。大きさは車ごとに scale で合わせる
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5)
  const innerMaterial = new THREE.MeshLambertMaterial({ color: look.inner })
  const glassMaterial = new THREE.MeshLambertMaterial({ color: look.glass, transparent: true, opacity: look.glassOpacity })
  const cabinMaterial = new THREE.MeshBasicMaterial({ color: look.cabin })

  const attach = (chassis: THREE.Group, kind: CarKind, paint: THREE.Material): CarDoors => {
    const layout = vehicleCabin(kind)
    const d = layout.door
    // chassis の原点は車輪の中心の高さ。車体の座標（路面が 0）からその分だけ下げる
    const drop = VEHICLE_LOOK[kind].wheel
    const length = d.rearZ - d.hingeZ
    const panelH = d.beltY - d.sillY
    const lean = d.halfBelt - d.halfRoof
    const glassH = Math.hypot(d.roofY - d.beltY, lean)
    const tilt = Math.atan2(lean, d.roofY - d.beltY)
    const t = look.thickness
    const leaves = new Map<DoorSide, Leaf>()

    const build = (side: DoorSide): Leaf => {
      const pivot = new THREE.Group()
      pivot.position.set(side * (d.halfBelt + look.proud), d.sillY - drop, d.hingeZ)
      // 下半分: 塗装の板と内張り
      const panel = new THREE.Mesh(box, paint)
      panel.scale.set(t, panelH, length)
      panel.position.x = side * t * 0.5
      panel.castShadow = shadows
      const inner = new THREE.Mesh(box, innerMaterial)
      inner.scale.set(t * 0.4, panelH * 0.94, length * 0.96)
      inner.position.set(-side * t * 0.2, panelH * 0.02, length * 0.02)
      // 上半分: 窓。車体の側面と同じだけ内側へ寝かせる
      const upper = new THREE.Group()
      upper.position.y = panelH
      upper.rotation.z = side * tilt
      const glass = new THREE.Mesh(box, glassMaterial)
      glass.scale.set(t * 0.35, glassH * 0.97, length * 0.9)
      glass.position.set(side * t * 0.3, 0, length * 0.05)
      // 窓枠（前の柱と上の桟）
      const post = new THREE.Mesh(box, paint)
      post.scale.set(t * 0.7, glassH, length * 0.06)
      post.position.x = side * t * 0.35
      const rail = new THREE.Mesh(box, paint)
      rail.scale.set(t * 0.7, 0.045, length)
      rail.position.set(side * t * 0.35, glassH - 0.045, 0)
      upper.add(glass, post, rail)
      pivot.add(panel, inner, upper)
      // 開口: ドアがあった場所の車体の側面に重ねる暗い面（下半分はまっすぐ、上半分は窓と同じ傾き）
      const cabin = new THREE.Group()
      cabin.position.set(side * (d.halfBelt + look.proud * 0.5), d.sillY - drop, d.hingeZ)
      const low = new THREE.Mesh(box, cabinMaterial)
      low.scale.set(0.012, panelH, length)
      const highPivot = new THREE.Group()
      highPivot.position.y = panelH
      highPivot.rotation.z = side * tilt
      const high = new THREE.Mesh(box, cabinMaterial)
      high.scale.set(0.012, glassH * 0.97, length * 0.92)
      high.position.z = length * 0.04
      highPivot.add(high)
      cabin.add(low, highPivot)
      pivot.visible = false
      cabin.visible = false
      chassis.add(pivot, cabin)
      return { pivot, cabin }
    }

    return {
      layout,
      set: (side, open) => {
        let leaf = leaves.get(side)
        if (!leaf) {
          if (open <= 0) return
          leaf = build(side)
          leaves.set(side, leaf)
        }
        const shown = open > 0.005
        leaf.pivot.visible = shown
        leaf.cabin.visible = shown && open > look.cabinFrom
        // 後ろの端が外へ振れる向き（右のドアは時計回り、左は反時計回り）
        leaf.pivot.rotation.y = side * doorSwing(open)
      },
      point: (side, which, out) => {
        const p = layout[which]
        return chassis.localToWorld(out.set(side * p.x, p.y - drop, p.z))
      },
      dispose: () => {
        for (const leaf of leaves.values()) chassis.remove(leaf.pivot, leaf.cabin)
        leaves.clear()
      },
    }
  }

  return {
    attach,
    dispose: () => {
      box.dispose()
      innerMaterial.dispose()
      glassMaterial.dispose()
      cabinMaterial.dispose()
    },
  }
}
