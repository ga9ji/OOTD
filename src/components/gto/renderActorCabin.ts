// Grand Theft Outfit [部品: onfoot の見た目] 開いたドアの開口越しに見える車内（座席・ハンドル・向こう側の内張りと窓）。
// 入口: createCabinSet(scene, shade) → cabin.show(args) / cabin.hide()
// 契約: 車体は閉じた箱で、開口は暗い面（vehicleDoors.ts）。そこへ体を描くだけだと、暗い服の主人公は黒い面に溶けて
//       「車体の黒い側面にめり込んだ」ように見える。ここでは乗り降りのあいだだけ、開口の奥に車内の部品を置く。
//       のぞき窓（renderActorSeat.ts）が開口の奥行きを抜いたあと・主人公の前に描くので、開口の形の中にだけ見え、
//       主人公とは奥行きで前後する（背もたれは腰の後ろ、ハンドルは手の先）。開口の外では車体に隠れる。
//       背後のカメラは屋根とほぼ同じ高さなので、開口の上半分の奥は天井と前のガラスになる（明るい面の前に頭と肩が抜けて見える）。
//       寸法は車の担当の CabinLayout（ドアの枠・座席・頭の位置）から出す。陰影は付けず、時刻の明るさ（shade）だけ掛ける。
//       [vehicle への要望] 車内（座席・ハンドル・内張り）を車体の部品として持ってもらえれば、この部品は消せる。
import * as THREE from 'three'
import { dirOf } from '../../lib/gto/math'
import type { CabinLayout } from '../../lib/gto/vehicleCabin'
import { SEAT_WINDOW_ORDER } from './renderActorSeat'

/** 見た目を決める数字（m と色） */
export const CABIN_LOOK = {
  /** 内張り（向こう側の壁・天井の影）・床・座席・座席の縁・ダッシュボード・ハンドル・向こうの窓の明るさ */
  wall: 0x5b5a5e,
  ceiling: 0x6a696c,
  floor: 0x3a393c,
  seat: 0xb9a98c,
  seatEdge: 0x8f8068,
  dash: 0x47474c,
  wheel: 0x1b1b1e,
  farGlass: 0xa9c4cc,
  /** 座面: 幅・奥行き・厚み。背もたれ: 高さ（座面から）・厚み・後ろへ寝かせる角度 rad */
  seatWide: 0.5,
  seatDeep: 0.5,
  seatThick: 0.13,
  backTall: 0.46,
  backThick: 0.11,
  recline: 0.16,
  /** ヘッドレスト: 幅・高さ */
  restWide: 0.24,
  restTall: 0.17,
  /** ハンドル: 半径・太さ・座席からの前への距離・肩の線からの下がり */
  wheelR: 0.155,
  wheelTube: 0.018,
  wheelAhead: 0.52,
  wheelDrop: 0.1,
  /** 向こう側の壁: 車の中心から反対側へ（肩の幅に対する割合） */
  farSide: 0.9,
}

export interface CabinSetArgs {
  /** 車の位置と向き、路面の高さ（車体の座標の y=0 に当たる世界の高さ） */
  x: number
  z: number
  heading: number
  baseY: number
  layout: CabinLayout
  side: 1 | -1
  /** 座った体を描いている横の位置（車体の中心から m。座席もここへ寄せる） */
  seenX: number
}

export interface CabinSet {
  show: (args: CabinSetArgs) => void
  hide: () => void
  dispose: () => void
}

export function createCabinSet(scene: THREE.Scene, shade: THREE.Color): CabinSet {
  const look = CABIN_LOOK
  const box = new THREE.BoxGeometry(1, 1, 1)
  const ring = new THREE.TorusGeometry(look.wheelR, look.wheelTube, 6, 14)
  const materials: THREE.MeshBasicMaterial[] = []
  const paint = (color: number) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiply(shade) })
    materials.push(m)
    return m
  }
  // 車体の座標（前が −z、右が ＋x、路面が y=0）で部品を置く群。のぞき窓の「抜く面」と主人公のあいだに描く
  const root = new THREE.Group()
  root.name = 'gto-cabin-set'
  root.renderOrder = SEAT_WINDOW_ORDER.cabin
  root.matrixAutoUpdate = false
  root.visible = false
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const m = new THREE.Mesh(geometry, material)
    m.renderOrder = SEAT_WINDOW_ORDER.cabin
    m.frustumCulled = false
    root.add(m)
    return m
  }
  const wall = part(box, paint(look.wall))
  const farGlass = part(box, paint(look.farGlass))
  const windshield = part(box, paint(look.farGlass))
  const ceiling = part(box, paint(look.ceiling))
  const floor = part(box, paint(look.floor))
  const dash = part(box, paint(look.dash))
  const cushion = part(box, paint(look.seat))
  const back = part(box, paint(look.seat))
  const bolster = part(box, paint(look.seatEdge))
  const rest = part(box, paint(look.seatEdge))
  const wheel = part(ring, paint(look.wheel))
  const column = part(box, paint(look.wheel))
  scene.add(root)

  const xAxis = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3()

  const show = (a: CabinSetArgs) => {
    const d = a.layout.door
    const s = a.side
    const f = dirOf(a.heading)
    // 車体の ＋x（右）は世界の (−f.z, f.x)、＋z（後ろ）は −f
    xAxis.set(-f.z, 0, f.x)
    zAxis.set(-f.x, 0, -f.z)
    root.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(a.x, a.baseY, a.z)
    root.matrixWorldNeedsUpdate = true

    const seatX = s * a.seenX
    const seatY = a.layout.seat.y
    const seatZ = a.layout.seat.z
    const length = d.rearZ - d.hingeZ
    const farX = -s * d.halfBelt * look.farSide

    // 車体の輪郭からはみ出さないよう、どの面も車体の箱より内側に置く（屋根より上のカメラから、向こうの縁の外に見えない）
    const deep = length + 0.45
    const midZ = d.hingeZ + deep / 2
    // 向こう側の内張り（肩の線まで）と、その上の窓（外の明るさ。屋根の幅に合わせて内へ寄せる）
    const lowTall = d.beltY - d.sillY
    wall.scale.set(0.04, lowTall, deep)
    wall.position.set(farX, d.sillY + lowTall / 2, midZ)
    const glassTall = d.roofY - d.beltY - 0.1
    farGlass.scale.set(0.02, glassTall, deep)
    farGlass.position.set(-s * d.halfRoof * 0.84, d.beltY + glassTall / 2, midZ)
    // 天井（屋根の高さから見下ろさないカメラでは、開口の上半分の奥は天井）と、前のガラス（外の明るさ。頭の影が抜けて見える）
    ceiling.scale.set(d.halfRoof * 2 * 0.84, 0.03, deep)
    ceiling.position.set(0, d.roofY - 0.085, midZ)
    windshield.scale.set(d.halfRoof * 2 * 0.84, glassTall, 0.02)
    windshield.position.set(0, d.beltY + glassTall / 2, d.hingeZ + 0.02)
    // 床
    floor.scale.set(d.halfBelt * 2 * 0.9, 0.03, deep)
    floor.position.set(0, d.sillY - 0.015, midZ)
    // ダッシュボード（開口の前の端の奥）
    const dashTall = d.beltY - d.sillY - 0.12
    // 幅は車体の側面より内側（側面と同じ幅だと、ドアの前の外板に灰色の面がにじむ）
    dash.scale.set(d.halfBelt * 2 * 0.9, dashTall, 0.3)
    dash.position.set(0, d.sillY + 0.12 + dashTall / 2, d.hingeZ + 0.06)
    // 座面と背もたれ（背もたれは腰の後ろ。肩と頭は背もたれの上に出る）
    cushion.scale.set(look.seatWide, look.seatThick, look.seatDeep)
    cushion.position.set(seatX, seatY - look.seatThick / 2 - 0.04, seatZ - 0.08)
    const backZ = seatZ + 0.21
    back.scale.set(look.seatWide * 0.92, look.backTall, look.backThick)
    back.position.set(seatX, seatY - 0.06 + look.backTall / 2, backZ + Math.sin(look.recline) * look.backTall * 0.5)
    back.rotation.set(look.recline, 0, 0)
    // 背もたれの内側の縁（向こう側。座った体に隠れない）
    bolster.scale.set(0.07, look.backTall * 0.96, look.backThick + 0.03)
    bolster.position.set(seatX - s * look.seatWide * 0.46, back.position.y, back.position.z)
    bolster.rotation.set(look.recline, 0, 0)
    const restY = Math.min(d.roofY - 0.1, a.layout.head.y + 0.02)
    rest.scale.set(look.restWide, look.restTall, 0.08)
    rest.position.set(seatX, restY, backZ + Math.sin(look.recline) * look.backTall + 0.05)
    // ハンドルと柱
    const wheelY = d.beltY - look.wheelDrop
    const wheelZ = Math.max(d.hingeZ + 0.26, seatZ - look.wheelAhead)
    wheel.position.set(seatX, wheelY, wheelZ)
    wheel.rotation.set(-0.42, 0, 0)
    column.scale.set(0.05, 0.05, 0.26)
    column.position.set(seatX, wheelY - 0.05, wheelZ - 0.13)
    column.rotation.set(-0.42, 0, 0)
    root.visible = true
  }

  return {
    show,
    hide: () => {
      root.visible = false
    },
    dispose: () => {
      scene.remove(root)
      box.dispose()
      ring.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
