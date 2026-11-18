// Grand Theft Outfit [部品: vehicle の見た目] 車の損傷の見た目。
// 入口: dentKey(dents) / deformGeometry(source, spec, dents, opts) / crushOf(spec, dents) / DAMAGE_LOOK
// 契約: 無傷の形（vehicleShape.ts）と凹み（VehicleState.dents）から、潰れた形を新しく作って返す。元の形は書き換えない。
//       当たった端は奥へ潰れ、上面が山形に折れ、塗装が擦れて暗くなる。側面は内側へ凹む。
//       面を細かく割ってから動かすので、低ポリの車体でも折れ目が出る。作り直すのは凹みが変わったときだけ。
import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DENT } from '../../lib/gto/vehicleDamage'
import type { VehicleSpec } from '../../lib/gto/vehicle'

export const DAMAGE_LOOK = {
  /** 潰れる範囲（車の長さに対する割合）: 前・後ろ */
  frontZone: 0.3,
  rearZone: 0.24,
  /** いちばん潰れたときに端が奥へ入る量（潰れる範囲に対する割合） */
  frontCrush: 0.44,
  rearCrush: 0.36,
  /** 上面が山形に折れる高さ m、端が垂れる量 m */
  buckle: 0.2,
  droop: 0.1,
  /** 側面が内側へ凹む量 m と、凹む範囲（車の長さに対する割合。中心から前後へ） */
  sideDent: 0.24,
  sideZone: 0.36,
  /** しわの不揃い m */
  wrinkle: 0.11,
  /** 擦れた塗装の暗さ（0 で変わらない、1 で真っ黒） */
  scuff: 0.6,
}

/** 凹みが変わったかを見分ける札（細かい変化では作り直さない） */
export const dentKey = (dents: readonly number[] | undefined): string => (dents ? dents.map((d) => Math.round(d * 12)).join('.') : '')

/** 場所から決まる −0.5..0.5 の不揃い（同じ場所の頂点は同じ値になり、面が割れない） */
const jitter = (x: number, y: number, z: number, salt: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 4.1) * 43758.5453
  return s - Math.floor(s) - 0.5
}

/** 三角形を 4 つに割る（位置と色。色は面ごとなので写すだけ） */
function subdivide(pos: Float32Array, col: Float32Array): { pos: Float32Array; col: Float32Array } {
  const tris = pos.length / 9
  const outPos = new Float32Array(tris * 36)
  const outCol = new Float32Array(tris * 36)
  const mid = (a: number, b: number, k: number, base: number) => (pos[base + a * 3 + k] + pos[base + b * 3 + k]) / 2
  for (let t = 0; t < tris; t++) {
    const base = t * 9
    // 頂点 0,1,2 と、辺の中点 3(01), 4(12), 5(20)
    const p: number[] = []
    for (let k = 0; k < 9; k++) p.push(pos[base + k])
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) for (let k = 0; k < 3; k++) p.push(mid(a, b, k, base))
    const order = [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5]
    order.forEach((v, i) => {
      for (let k = 0; k < 3; k++) {
        outPos[t * 36 + i * 3 + k] = p[v * 3 + k]
        outCol[t * 36 + i * 3 + k] = col[base + k]
      }
    })
  }
  return { pos: outPos, col: outCol }
}

/** 車体の端（前 or 後ろ）の凹みを、左右の位置で補間する */
const acrossDent = (sx: number, left: number, center: number, right: number) => (sx < 0 ? center + (left - center) * -sx : center + (right - center) * sx)

/** 鼻（または尻）の真ん中が奥へ入った量 m。灯りのにじみを置く場所をずらすのに使う */
export function crushOf(spec: VehicleSpec, dents: readonly number[] | undefined): { front: number; rear: number } {
  if (!dents) return { front: 0, rear: 0 }
  const look = DAMAGE_LOOK
  return {
    front: Math.max(dents[DENT.frontL], dents[DENT.frontC], dents[DENT.frontR]) * look.frontCrush * look.frontZone * spec.length,
    rear: Math.max(dents[DENT.rearL], dents[DENT.rearC], dents[DENT.rearR]) * look.rearCrush * look.rearZone * spec.length,
  }
}

export interface DeformOptions {
  /** 面を割る回数（0 なら割らない。灯火の箱など） */
  levels: number
  /** 凹んだ所を暗くする強さ（塗装は scuff、灯火は 1 で消える） */
  darken: number
  /** 法線を均す折れの深さ rad（無ければ面ごとの平らな陰影） */
  crease?: number
}

/**
 * 凹みに合わせて潰した形を作る。前が −z、右が ＋x、地面が y=0（vehicleShape.ts と同じ座標）。
 */
export function deformGeometry(source: THREE.BufferGeometry, spec: VehicleSpec, dents: readonly number[], opts: DeformOptions): THREE.BufferGeometry {
  const look = DAMAGE_LOOK
  let pos = new Float32Array(source.attributes.position.array as ArrayLike<number>)
  let col = new Float32Array(source.attributes.color.array as ArrayLike<number>)
  for (let i = 0; i < opts.levels; i++) ({ pos, col } = subdivide(pos, col))

  const halfL = spec.length / 2
  const halfW = spec.width / 2
  const frontLen = spec.length * look.frontZone
  const rearLen = spec.length * look.rearZone
  const sideLen = spec.length * look.sideZone
  const top = spec.height * 0.42

  for (let i = 0; i < pos.length; i += 3) {
    const x0 = pos[i]
    const y0 = pos[i + 1]
    const z0 = pos[i + 2]
    const sx = Math.max(-1, Math.min(1, x0 / halfW))
    let x = x0
    let y = y0
    let z = z0
    let shade = 0
    // 前後の端: 奥へ潰れ、上面が山形に折れ、端が垂れる
    const ends: [t: number, d: number, dir: number, crush: number][] = [
      [(-halfL + frontLen - z0) / frontLen, acrossDent(sx, dents[DENT.frontL], dents[DENT.frontC], dents[DENT.frontR]), 1, look.frontCrush * frontLen],
      [(z0 - (halfL - rearLen)) / rearLen, acrossDent(sx, dents[DENT.rearL], dents[DENT.rearC], dents[DENT.rearR]), -1, look.rearCrush * rearLen],
    ]
    for (const [tRaw, d, dir, crush] of ends) {
      if (tRaw <= 0 || d <= 0) continue
      const t = Math.min(1, tRaw)
      const k = d * t
      z += dir * (crush * k + jitter(x0, y0, z0, 1) * look.wrinkle * k)
      if (y0 > top) y += d * look.buckle * Math.sin(Math.PI * Math.min(1, t * 1.2)) - look.droop * k + jitter(x0, y0, z0, 2) * look.wrinkle * k
      x += jitter(x0, y0, z0, 3) * look.wrinkle * 0.6 * k
      shade = Math.max(shade, k)
    }
    // 側面: 内側へ凹む
    const sideD = x0 < 0 ? dents[DENT.left] : dents[DENT.right]
    if (sideD > 0 && Math.abs(z0) < sideLen) {
      const w = Math.max(0, (Math.abs(sx) - 0.5) / 0.5)
      const bump = Math.cos((Math.PI / 2) * (z0 / sideLen)) ** 2
      const k = sideD * w * bump
      x -= Math.sign(x0) * (look.sideDent * k + jitter(x0, y0, z0, 4) * look.wrinkle * 0.6 * k)
      shade = Math.max(shade, k * 0.85)
    }
    pos[i] = x
    pos[i + 1] = y
    pos[i + 2] = z
    if (shade > 0) {
      // 擦れは場所ごとにむらを付ける
      const m = 1 - opts.darken * Math.min(1, shade * (1 + jitter(x0, y0, z0, 5) * 0.5))
      col[i] *= m
      col[i + 1] *= m
      col[i + 2] *= m
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  if (opts.crease == null) {
    out.computeVertexNormals()
    return out
  }
  // 無傷の形と同じく、浅い折れは均して曲面に見せる（凹んだ所の深い折れは折れ目のまま残る）
  const smooth = toCreasedNormals(out, opts.crease)
  if (smooth !== out) out.dispose()
  return smooth
}
