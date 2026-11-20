// [部品: vehicle の見た目] 車種ごとの形（components/gto/vehicleShape.ts）のテスト。
// 形が車の寸法に収まること、曲面に見せる法線が付くこと、スマホの簡略版が軽いことを確かめる。
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildVehicleShape, VEHICLE_LOOK } from '../../../components/gto/vehicleShape'
import { isCar, VEHICLE_SPECS } from '../vehicle'
import type { VehicleKind } from '../types'

// 戦車と飛行機（裏コードの乗り物）は専用の形なので、ここでは見ない
const KINDS = (Object.keys(VEHICLE_SPECS) as VehicleKind[]).filter(isCar)
const tris = (g: THREE.BufferGeometry) => g.attributes.position.count / 3
const box = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox()
  return g.boundingBox as THREE.Box3
}

describe('gto vehicleShape: 車体の形', () => {
  it('どの車種も、車体が寸法に収まる（長さはバンパーの分、幅はフェンダーとミラーの分だけ出てよい）', () => {
    for (const kind of KINDS) {
      const spec = VEHICLE_SPECS[kind]
      for (const detail of ['high', 'lite'] as const) {
        const shape = buildVehicleShape(kind, detail)
        const b = box(shape.body).union(box(shape.trim))
        expect(b.min.z).toBeGreaterThan(-spec.length / 2 - 0.12)
        expect(b.max.z).toBeLessThan(spec.length / 2 + 0.12)
        expect(b.max.x).toBeLessThan(spec.width / 2 + 0.2)
        expect(b.min.x).toBeCloseTo(-b.max.x, 2)
        expect(b.min.y).toBeGreaterThan(0.1)
        expect(b.max.y).toBeLessThan(spec.height + 0.25)
      }
    }
  })

  it('PC の形は面が細かく、浅い折れの法線が均されている（同じ位置の頂点が同じ法線を持つ所がある）。スマホは 4 割以下の面数', () => {
    for (const kind of KINDS) {
      const high = buildVehicleShape(kind, 'high')
      const lite = buildVehicleShape(kind, 'lite')
      expect(tris(lite.body) + tris(lite.trim) + tris(lite.wheel)).toBeLessThan((tris(high.body) + tris(high.trim) + tris(high.wheel)) * 0.4)
      // 平らな陰影なら、三角形の 3 頂点の法線は必ず同じ。均してあれば違う三角形がある
      const n = high.body.attributes.normal
      let curved = 0
      for (let i = 0; i < n.count; i += 3) {
        if (Math.abs(n.getX(i) - n.getX(i + 1)) + Math.abs(n.getY(i) - n.getY(i + 1)) + Math.abs(n.getZ(i) - n.getZ(i + 1)) > 0.02) curved++
      }
      expect(curved).toBeGreaterThan(tris(high.body) * 0.3)
      const flat = lite.body.attributes.normal
      for (let i = 0; i < flat.count; i += 3) expect(flat.getX(i)).toBeCloseTo(flat.getX(i + 1), 5)
    }
  })

  it('PC の 1 台は 9000 三角形以内（車体・部品・四輪・灯火）', () => {
    for (const kind of KINDS) {
      const s = buildVehicleShape(kind, 'high')
      expect(tris(s.body) + tris(s.trim) + tris(s.wheel) * 4 + tris(s.head) + tris(s.tail)).toBeLessThan(9000)
    }
  })

  it('タイヤハウスは肩の線の下に収まる（切り欠きが車体の上面に届かない）', () => {
    for (const kind of KINDS) {
      const look = VEHICLE_LOOK[kind]
      const spec = VEHICLE_SPECS[kind]
      const lowestBelt = Math.min(...look.stations.filter((s) => Math.abs(s.z) < 0.4).map((s) => s.belt)) * spec.height
      expect(look.wheel * 2 + 0.1).toBeLessThan(lowestBelt + 0.03)
    }
  })

  it('車輪は半径・幅が寸法どおりで、軸は左右（x）', () => {
    for (const detail of ['high', 'lite'] as const) {
      const look = VEHICLE_LOOK.sedan
      const b = box(buildVehicleShape('sedan', detail).wheel)
      expect(b.max.y).toBeCloseTo(look.wheel, 2)
      expect(b.max.z).toBeCloseTo(look.wheel, 2)
      expect(b.max.x).toBeLessThanOrEqual(look.tire / 2 + 0.011)
      expect(b.max.x).toBeGreaterThan(look.tire / 2 - 0.02)
    }
  })
})

describe('gto vehicleShape: 艶の帯と、車輪の上の肩の高さ', () => {
  it('PC の形には肩の線・屋根の縁に沿う艶の帯があり、車体の左右に対称で、車体の輪郭から 2cm も浮かない。スマホの形には無い', () => {
    for (const kind of KINDS) {
      const high = buildVehicleShape(kind, 'high')
      expect(buildVehicleShape(kind, 'lite').gloss).toBeNull()
      const gloss = high.gloss as THREE.BufferGeometry
      expect(gloss).not.toBeNull()
      expect(tris(gloss)).toBeGreaterThan(20)
      const g = box(gloss)
      const b = box(high.body)
      expect(g.min.x).toBeCloseTo(-g.max.x, 3)
      expect(g.max.x).toBeLessThan(b.max.x + 0.02)
      expect(g.max.y).toBeLessThan(b.max.y + 0.02)
      // 帯は腰より上にだけある（裾や床下には付かない）
      expect(g.min.y).toBeGreaterThan(VEHICLE_SPECS[kind].height * 0.3)
    }
  })

  it('車輪の真上の肩は、タイヤの上端より高く、車高より低い', () => {
    for (const kind of KINDS) {
      const shape = buildVehicleShape(kind, 'lite')
      for (const y of shape.fenderY) {
        expect(y).toBeGreaterThan(VEHICLE_LOOK[kind].wheel * 2)
        expect(y).toBeLessThan(VEHICLE_SPECS[kind].height)
      }
    }
  })
})
