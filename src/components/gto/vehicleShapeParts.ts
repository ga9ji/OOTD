// Grand Theft Outfit [部品: vehicle の見た目] 車体に付ける部品の形: 車輪、灯火、バンパー・グリル・ミラー・フェンダーの縁など。
// 入口: Tris / buildWheel / buildLamps / addExterior / addFlares
// 契約: vehicleShape.ts の車体（断面を繋いだ面）に足す部品を作るだけ。前が −z、右が ＋x、地面が y=0。
//       色は頂点色。塗装色を掛ける面は PAINT（白）で作り、それ以外は部品の色そのもの。
//       detail が 'lite'（スマホの軽量設定）のときは、数の少ない簡略な形にする。
import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Rgb = [number, number, number]
export type ShapeDetail = 'high' | 'lite'

export const PAINT: Rgb = [1, 1, 1]
export const GLASS: Rgb = [0.045, 0.07, 0.095]
export const BLACK: Rgb = [0.035, 0.035, 0.04]
// バンパーは灰色（車体の下の影の上に水平の線が1本通り、車体の傾きと沈みが読める）
export const BUMPER: Rgb = [0.2, 0.205, 0.215]
// タイヤは日なたでも黒く見える暗さ（明るいと、車体の下に灰色の筒が立っているように見える）
const TIRE: Rgb = [0.02, 0.02, 0.023]
const TIRE_WALL: Rgb = [0.05, 0.05, 0.056]
export const WELL: Rgb = [0.012, 0.012, 0.014]
const HUB_LIGHT: Rgb = [0.82, 0.83, 0.85]
const HUB_DARK: Rgb = [0.2, 0.2, 0.22]
const RIM_DEEP: Rgb = [0.07, 0.07, 0.08]
const CHROME: Rgb = [0.62, 0.63, 0.66]
const SEAM: Rgb = [0.03, 0.03, 0.035]
const PLATE: Rgb = [0.9, 0.9, 0.86]

/** 三角形をためて、面ごとの色を持つ形にする */
export class Tris {
  private pos: number[] = []
  private col: number[] = []

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: Rgb) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    this.col.push(...color, ...color, ...color)
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: Rgb) {
    this.tri(a, b, c, color)
    this.tri(a, c, d, color)
  }

  /** 四角を、表が toward（向き）の側を向くように張る */
  quadFacing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: Rgb, toward: THREE.Vector3) {
    const normal = b.clone().sub(a).cross(d.clone().sub(a))
    if (normal.lengthSq() < 1e-12) normal.copy(c.clone().sub(b).cross(d.clone().sub(b)))
    if (normal.dot(toward) >= 0) this.quad(a, b, c, d, color)
    else this.quad(a, d, c, b, color)
  }

  /** 箱（中心と大きさ）。turnY を渡すと、その場で縦軸まわりに回す rad */
  box(w: number, h: number, l: number, x: number, y: number, z: number, color: Rgb, turnY = 0) {
    const g = new THREE.BoxGeometry(w, h, l)
    if (turnY) g.rotateY(turnY)
    this.geometry(g.translate(x, y, z), color)
  }

  /** three の形を取り込む（色は面ごとに pick で決められる） */
  geometry(g: THREE.BufferGeometry, color: Rgb | ((faceIndex: number, center: THREE.Vector3) => Rgb)) {
    const flat = g.index ? g.toNonIndexed() : g
    const p = flat.attributes.position
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const center = new THREE.Vector3()
    for (let i = 0; i < p.count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, i + k)
      center.copy(v[0]).add(v[1]).add(v[2]).multiplyScalar(1 / 3)
      this.tri(v[0], v[1], v[2], typeof color === 'function' ? color(i / 3, center) : color)
    }
    if (flat !== g) flat.dispose()
    g.dispose()
  }

  /**
   * 形にする。crease（rad）を渡すと、隣り合う面の折れがそれより浅い所は法線を均して曲面に見せ、
   * 深い折れ（窓の縁・バンパーの角）は折れ目のまま残す。渡さなければ面ごとの平らな陰影。
   */
  build(crease?: number): THREE.BufferGeometry {
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    out.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    if (crease == null) {
      out.computeVertexNormals()
      return out
    }
    const smooth = toCreasedNormals(out, crease)
    if (smooth !== out) out.dispose()
    return smooth
  }
}

/** 法線を均す折れの深さ rad（これより浅い折れは曲面に見せる） */
export const CREASE = (48 * Math.PI) / 180

/** 車輪1つ（中心が原点、軸が x）。肩の丸いタイヤと、奥まったリムに 5 本のスポーク。回っているのがスポークで見える */
export function buildWheel(radius: number, tire: number, detail: ShapeDetail): THREE.BufferGeometry {
  const t = new Tris()
  if (detail === 'lite') {
    const rubber = new THREE.CylinderGeometry(radius, radius, tire, 12)
    rubber.rotateZ(Math.PI / 2)
    t.geometry(rubber, (_face, c) => (Math.abs(c.x) > tire * 0.45 ? TIRE_WALL : TIRE))
    const hub = new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, tire + 0.02, 10)
    hub.rotateZ(Math.PI / 2)
    // 扇ごとに色を変える（中心からの角度で決める）
    t.geometry(hub, (_face, c) => {
      if (Math.abs(c.x) < tire * 0.4) return HUB_DARK
      const sector = Math.floor(((Math.atan2(c.y, c.z) + Math.PI) / (Math.PI * 2)) * 10)
      return sector % 2 === 0 ? HUB_LIGHT : HUB_DARK
    })
    return t.build()
  }
  const half = tire / 2
  const rim = radius * 0.64
  // タイヤ: 軸に沿った断面を回す。接地面の両肩を丸める
  const profile = [
    [rim, -half + 0.012],
    [radius * 0.9, -half],
    [radius * 0.985, -half * 0.74],
    [radius, -half * 0.4],
    [radius, half * 0.4],
    [radius * 0.985, half * 0.74],
    [radius * 0.9, half],
    [rim, half - 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const rubber = new THREE.LatheGeometry(profile, 20)
  rubber.rotateZ(-Math.PI / 2)
  t.geometry(rubber, (_face, c) => (Math.abs(c.x) > half * 0.8 ? TIRE_WALL : TIRE))
  for (const sx of [-1, 1]) {
    const face = (g: THREE.BufferGeometry, depth: number) => g.rotateY((sx * Math.PI) / 2).translate(sx * (half - depth), 0, 0)
    // 奥まった暗い皿と、縁の明るい輪
    t.geometry(face(new THREE.CircleGeometry(rim, 16), 0.05), RIM_DEEP)
    t.geometry(face(new THREE.RingGeometry(rim * 0.84, rim * 1.02, 20), 0.006), HUB_LIGHT)
    // スポーク 5 本（根元が太く、縁へ向けて細い板）と、真ん中のキャップ
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.BoxGeometry(0.03, rim * 0.86, rim * 0.24).translate(0, rim * 0.47, 0).rotateX((k * Math.PI * 2) / 5)
      t.geometry(spoke.translate(sx * (half - 0.03), 0, 0), k % 2 === 0 ? HUB_LIGHT : CHROME)
    }
    const cap = new THREE.CylinderGeometry(rim * 0.24, rim * 0.28, 0.035, 10).rotateZ(Math.PI / 2)
    t.geometry(cap.translate(sx * (half - 0.022), 0, 0), HUB_DARK)
  }
  return t.build(CREASE)
}

export type LampStyle = 'round' | 'rect'

const WARM: Rgb = [1, 0.95, 0.8]
const AMBER: Rgb = [1, 0.5, 0.08]
const RED: Rgb = [1, 0.03, 0.02]
const RED_DEEP: Rgb = [0.75, 0.02, 0.02]

/** 軸が前後（z）を向いた丸い灯り */
function roundLamp(t: Tris, r: number, x: number, y: number, z: number, color: Rgb) {
  t.geometry(new THREE.CylinderGeometry(r, r * 0.92, 0.05, 12).rotateX(Math.PI / 2).translate(x, y, z), color)
}

/**
 * 前照灯と尾灯の形（材質の color で明るさを変える）。
 * 丸形は左右に丸い灯りを 2 つずつ、角形は横長のレンズ（前は外側に橙の方向指示、後ろは 2 段）。
 */
export function buildLamps(
  style: LampStyle,
  detail: ShapeDetail,
  at: { frontHalf: number; rearHalf: number; headY: number; tailY: number; halfL: number },
): { head: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
  const head = new Tris()
  const tail = new Tris()
  const { frontHalf, rearHalf, headY, tailY, halfL } = at
  for (const sx of [-1, 1]) {
    if (detail === 'lite') {
      head.box(0.36, 0.13, 0.08, sx * (frontHalf - 0.2), headY, -halfL + 0.005, WARM)
      tail.box(0.46, 0.13, 0.08, sx * (rearHalf - 0.25), tailY, halfL - 0.005, RED)
      continue
    }
    if (style === 'round') {
      roundLamp(head, 0.085, sx * (frontHalf - 0.13), headY, -halfL - 0.012, WARM)
      roundLamp(head, 0.068, sx * (frontHalf - 0.32), headY - 0.005, -halfL - 0.012, WARM)
      roundLamp(tail, 0.085, sx * (rearHalf - 0.14), tailY, halfL + 0.012, RED)
      roundLamp(tail, 0.072, sx * (rearHalf - 0.34), tailY, halfL + 0.012, RED_DEEP)
    } else {
      head.box(0.3, 0.13, 0.07, sx * (frontHalf - 0.22), headY, -halfL - 0.004, WARM)
      head.box(0.08, 0.13, 0.07, sx * (frontHalf - 0.03), headY, -halfL + 0.012, AMBER, sx * -0.5)
      tail.box(0.4, 0.075, 0.07, sx * (rearHalf - 0.24), tailY + 0.04, halfL - 0.002, RED)
      tail.box(0.4, 0.06, 0.07, sx * (rearHalf - 0.24), tailY - 0.035, halfL - 0.002, RED_DEEP)
    }
  }
  return { head: head.build(detail === 'high' ? CREASE : undefined), tail: tail.build(detail === 'high' ? CREASE : undefined) }
}

/** 車体の外まわりを決める寸法（vehicleShape.ts が断面から出して渡す） */
export interface ExteriorDims {
  halfL: number
  width: number
  height: number
  /** 前端・後端の幅と、その肩の高さ、床下の高さ */
  frontW: number
  rearW: number
  noseY: number
  tailY: number
  frontLow: number
  rearLow: number
  clearance: number
  /** 灯火の高さと、丸形か角形か */
  headY: number
  lampY: number
  lamps: LampStyle
  /** フロントガラスの付け根（ミラーを付ける所）の高さと前後の位置。屋根の無い車は null */
  cowl: { y: number; z: number } | null
  /** 前のドアの前端・後端の前後の位置と、窓の下の線の高さ */
  door: { hingeZ: number; rearZ: number; beltY: number } | null
  /** 車輪の前後の位置と、タイヤハウスの半径 */
  wheelZ: readonly number[]
  archR: number
  /** 下半分を黒く塗る（パトカー） */
  twoTone: boolean
  /** 荷室の上の羽根 */
  spoiler: boolean
  /** 側面の、前後 z・高さ y での中心からの距離 m */
  sideAt: (z: number, y: number) => number
}

/** バンパー・グリル・ナンバー・ミラー・ドアの継ぎ目・敷居・排気管・羽根を足す */
export function addExterior(paint: Tris, trim: Tris, d: ExteriorDims, detail: ShapeDetail) {
  const { halfL, frontW, rearW, noseY, tailY, frontLow, rearLow } = d
  const high = detail === 'high'
  // バンパー（車体の端より少し狭い棒。後ろから見て、その外にタイヤが見える）
  trim.box(frontW * 0.96, 0.11, 0.14, 0, frontLow + 0.08, -halfL + 0.02, BUMPER)
  trim.box(rearW * 0.94, 0.11, 0.12, 0, rearLow + 0.08, halfL - 0.045, BUMPER)
  if (high) {
    // 鼻の下の黒い整流板と、その両端の小さな灯り
    trim.box(frontW * 0.84, 0.06, 0.1, 0, frontLow - 0.005, -halfL + 0.07, BLACK)
    for (const sx of [-1, 1]) trim.box(0.16, 0.045, 0.03, sx * frontW * 0.36, frontLow + 0.085, -halfL - 0.055, [0.95, 0.75, 0.35])
  }
  // 尾灯の帯: 左右の尾灯を繋ぐ黒い水平の帯（後ろから見て、車体の傾きがこの線で読める）
  trim.box(rearW * 0.94, 0.17, 0.04, 0, tailY - 0.07, halfL, BLACK)
  // グリル: 黒い口に、横の桟
  const grilleW = frontW * (d.lamps === 'round' ? 0.4 : 0.5)
  trim.box(grilleW, 0.11, 0.05, 0, noseY - 0.12, -halfL - 0.012, BLACK)
  if (high) {
    for (const dy of [-0.03, 0, 0.03]) trim.box(grilleW * 0.94, 0.012, 0.012, 0, noseY - 0.12 + dy, -halfL - 0.04, CHROME)
    // 灯火の座（黒い枠）
    for (const sx of [-1, 1]) {
      trim.box(0.5, 0.2, 0.03, sx * (frontW / 2 - 0.22), d.headY, -halfL + 0.004, BLACK)
    }
    // 排気管 2 本
    for (const x of [-0.42, -0.3]) {
      trim.geometry(new THREE.CylinderGeometry(0.038, 0.038, 0.12, 8).rotateX(Math.PI / 2).translate(x * (rearW / 1.5), rearLow + 0.0, halfL - 0.02), CHROME)
    }
  }
  trim.box(0.34, 0.12, 0.03, 0, frontLow + 0.1, -halfL - 0.06, PLATE)
  trim.box(0.34, 0.12, 0.03, 0, tailY - 0.2, halfL + 0.012, PLATE)
  // ドアミラー（フロントガラスの付け根の左右）: 腕と、後ろが黒い鏡
  if (d.cowl) {
    for (const sx of [-1, 1]) {
      const body = d.twoTone ? trim : paint
      const color = d.twoTone ? BLACK : PAINT
      const x = sx * (d.sideAt(d.cowl.z + 0.14, d.cowl.y) + 0.07)
      if (!high) {
        body.box(0.16, 0.1, 0.08, x, d.cowl.y + 0.06, d.cowl.z + 0.12, color)
        continue
      }
      body.box(0.1, 0.03, 0.05, x - sx * 0.06, d.cowl.y + 0.03, d.cowl.z + 0.14, color)
      body.box(0.17, 0.105, 0.07, x + sx * 0.03, d.cowl.y + 0.075, d.cowl.z + 0.13, color, sx * -0.2)
      trim.box(0.15, 0.085, 0.012, x + sx * 0.035, d.cowl.y + 0.075, d.cowl.z + 0.168, GLASS, sx * -0.2)
    }
  }
  if (!high) return
  // 敷居: 前後の車輪のあいだの裾に沿う黒い帯
  const z0 = d.wheelZ[0] + d.archR + 0.05
  const z1 = d.wheelZ[1] - d.archR - 0.05
  for (const sx of [-1, 1]) {
    trim.box(0.035, 0.07, z1 - z0, sx * (d.sideAt((z0 + z1) / 2, d.clearance) + 0.012), d.clearance + 0.03, (z0 + z1) / 2, BLACK)
  }
  // ドアの継ぎ目（側面に沿う細い溝）と、取っ手
  if (d.door) {
    const strip = (sx: number, z: number, yFrom: number, yTo: number) => {
      const n = 4
      for (let i = 0; i < n; i++) {
        const ya = yFrom + ((yTo - yFrom) * i) / n
        const yb = yFrom + ((yTo - yFrom) * (i + 1)) / n
        const xa = sx * (d.sideAt(z, ya) + 0.004)
        const xb = sx * (d.sideAt(z, yb) + 0.004)
        trim.quadFacing(new THREE.Vector3(xa, ya, z - 0.016), new THREE.Vector3(xa, ya, z + 0.016), new THREE.Vector3(xb, yb, z + 0.016), new THREE.Vector3(xb, yb, z - 0.016), SEAM, new THREE.Vector3(sx, 0, 0))
      }
    }
    const top = d.door.beltY - 0.035
    for (const sx of [-1, 1]) {
      const frontSeam = Math.max(d.door.hingeZ + 0.03, d.wheelZ[0] + d.archR + 0.07)
      strip(sx, frontSeam, d.clearance + 0.07, top)
      strip(sx, d.door.rearZ, d.clearance + 0.07, top)
      const hy = d.door.beltY - 0.12
      const hz = d.door.rearZ - 0.2
      trim.box(0.022, 0.03, 0.15, sx * (d.sideAt(hz, hy) + 0.008), hy, hz, CHROME)
    }
  }
  // 荷室の上の羽根
  if (d.spoiler) {
    const y = tailY + 0.15
    paint.box(rearW * 0.98, 0.03, 0.2, 0, y, halfL - 0.15, PAINT)
    for (const sx of [-1, 1]) {
      paint.box(0.03, 0.14, 0.14, sx * rearW * 0.4, y - 0.075, halfL - 0.16, PAINT)
      paint.box(0.03, 0.07, 0.22, sx * rearW * 0.49, y + 0.012, halfL - 0.15, PAINT)
    }
  }
}

/**
 * ふくらんだフェンダー: タイヤハウスの縁を外へ張り出す。縁の輪（車体の面）から、切り欠きの縁（外へ out だけ出た所）へ面を張り、
 * 切り欠きの縁から車体の面まで黒い返しを付ける。
 */
export function addFlares(paint: Tris, trim: Tris, d: ExteriorDims, axle: number, beltAt: (z: number) => number) {
  const out = 0.07
  const ro = d.archR + 0.11
  const ri = d.archR - 0.006
  const steps = 14
  const lower = d.twoTone ? trim : paint
  const lowerColor = d.twoTone ? BLACK : PAINT
  for (const sx of [-1, 1]) {
    for (const wz of d.wheelZ) {
      const point = (r: number, angle: number, push: number) => {
        const z = wz + Math.cos(angle) * r
        const y = Math.min(Math.max(axle + Math.sin(angle) * r, d.clearance + 0.02), beltAt(z) - 0.035)
        return new THREE.Vector3(sx * (d.sideAt(z, y) + push), y, z)
      }
      const toward = new THREE.Vector3(sx, 0.4, 0)
      const axis = new THREE.Vector3(sx * 0.2, axle, wz)
      let prev: THREE.Vector3[] | null = null
      for (let i = 0; i <= steps; i++) {
        // 車軸より少し下から、上を回って反対側の少し下まで
        const angle = -0.35 + ((Math.PI + 0.7) * i) / steps
        const now = [point(ro, angle, -0.006), point(ri, angle, out), point(ri, angle, -0.012)]
        if (prev) {
          lower.quadFacing(prev[0], now[0], now[1], prev[1], lowerColor, toward)
          // 返しは車輪のほうを向く
          const mid = prev[1].clone().add(now[1]).multiplyScalar(0.5)
          trim.quadFacing(prev[1], now[1], now[2], prev[2], WELL, new THREE.Vector3(0, axis.y - mid.y, axis.z - mid.z))
        }
        prev = now
      }
    }
  }
}
