// [onfoot] 開いたドアの縁取りを、傾いた車体に合わせて重ねるための姿勢の復元（renderActorDoorTrim.chassisFrame）
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { chassisFrame } from '../../../components/gto/renderActorDoorTrim'
import { cabinLayout } from '../vehicleCabin'
import { VEHICLE_SPECS } from '../vehicle'
import { VEHICLE_LOOK } from '../../../components/gto/vehicleShape'

describe('gto onfoot: 車体の姿勢を、車の担当が返す3点（左右の座席と頭）から起こす', () => {
  it('傾けて・回して・動かした車体の変換を、そのまま復元する', () => {
    for (const kind of ['sedan', 'taxi', 'van'] as const) {
      const layout = cabinLayout(VEHICLE_SPECS[kind], VEHICLE_LOOK[kind])
      // 車体: 向き 0.8rad、前のめり 0.05、右へ 0.07 傾き、(12, 0.4, -7) にある
      const truth = new THREE.Matrix4().compose(
        new THREE.Vector3(12, 0.4, -7),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.8, 0.07, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      )
      const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(truth)
      const { seat, head } = layout
      const made = chassisFrame(layout, at(seat.x, seat.y, seat.z), at(-seat.x, seat.y, seat.z), at(head.x, head.y, head.z), new THREE.Matrix4())
      // ドアの蝶番の下と、屋根の後ろの端が同じ場所へ写る
      const d = layout.door
      for (const p of [new THREE.Vector3(d.halfBelt, d.sillY, d.hingeZ), new THREE.Vector3(-d.halfRoof, d.roofY, d.rearZ)]) {
        const want = p.clone().applyMatrix4(truth)
        const got = p.clone().applyMatrix4(made)
        expect(got.distanceTo(want)).toBeLessThan(1e-6)
      }
    }
  })
})
