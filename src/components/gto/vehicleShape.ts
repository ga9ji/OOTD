// Grand Theft Outfit [部品: vehicle の見た目] 車種ごとの形を作る。
// 入口: buildVehicleShape(kind) / VEHICLE_LOOK
// 契約: VEHICLE_SPECS の寸法に合わせた低ポリの車体（断面を前から後ろへ繋いだ面）と、車輪・灯火の形を返す。
//       前が −z、右が ＋x、地面が y=0。色は頂点色で、塗装色（材質の color）と掛け合わせる。
//       車体の側面には車輪のまわりに丸い穴（タイヤハウス。lib/gto/vehicleArch.ts）が開いていて、
//       別の部品の車輪がその中に収まり、上下に動く。穴の奥は黒い内張りで塞ぐ。
//       断面は肩と上面の縁を面取りし、前後にも滑らかに補って、浅い折れは法線を均して曲面に見せる。
//       バンパー・グリル・灯火・ミラー・スポーク・フェンダーの縁は vehicleShapeParts.ts。スマホの軽量設定は簡略な形（detail = 'lite'）。
//       塗装の面には明暗（裾が暗く、肩に光の帯。lib/gto/vehicleGloss.ts）を頂点色で焼き込む。
//       形はすべて架空の一般的な車（ファストバック・軽・タクシー・バン・パトカー）で、実在の車種は写していない。
import * as THREE from 'three'
import { VEHICLE_SPECS } from '../../lib/gto/vehicle'
import { archColumns, archCut, panelPoint } from '../../lib/gto/vehicleArch'
import { cabinLayout } from '../../lib/gto/vehicleCabin'
import { glossShade, topSheen, VEHICLE_GLOSS } from '../../lib/gto/vehicleGloss'
import type { CarKind } from '../../lib/gto/types'
import { addExterior, addFlares, BLACK, buildLamps, buildWheel, CREASE, GLASS, PAINT, Tris, WELL, type ExteriorDims, type LampStyle, type Rgb, type ShapeDetail } from './vehicleShapeParts'

/** タイヤハウス: 車輪との隙間 m、側面を割る細かさ m、タイヤの外面が車体の側面より引っ込む量 m（負なら外へ張り出す。
 *  背後の高いカメラからも、車体の左右にタイヤが足として見える）、内張りの奥行き m */
// R17 の実測（status/vehicle-measure.md）: バーの車はタイヤハウスの隙間がタイヤの直径の 14〜37%（こちらは 15% だった）、
// 床下の高さがタイヤの直径の 45〜53%（こちらは 29%）。隙間と床下を実測に寄せ、タイヤを車体の外へもう少し出す
const ARCH = { gap: 0.13, step: 0.07, inset: -0.045, depth: 0.06 }

/** 車体の断面。高さは車高に対する割合、幅は車幅に対する割合 */
interface Station {
  /** 前後の位置（−0.5 が前端、0.5 が後端） */
  z: number
  /** 肩（窓の下の線。ボンネットや荷室ではその上面）の高さ */
  belt: number
  /** 屋根の高さ。無ければ屋根なし（ボンネット・荷室） */
  roof?: number
  /** 肩の幅 */
  w: number
  /** 屋根の幅 */
  wRoof?: number
  /** この断面から次の断面までの側面を窓にしない（柱） */
  pillar?: boolean
}

interface Look {
  /** 車輪の半径と幅 m */
  wheel: number
  tire: number
  /** 床下の高さ m */
  clearance: number
  stations: Station[]
  /** 下半分を黒く塗る（パトカー） */
  twoTone?: boolean
  /** 屋根の上の灯り */
  roofLamp?: 'taxi' | 'police'
  /** 灯火の形（丸形は左右に 2 灯ずつ。無ければ角形） */
  lamps?: LampStyle
  /** 荷室の上の羽根 */
  spoiler?: boolean
}

export const VEHICLE_LOOK: Record<CarKind, Look> = {
  // 低く構えた 2 ドア風のファストバック。長い鼻、大きく寝た前後のガラス、短い尻に羽根（主人公の最初の車）
  sedan: {
    wheel: 0.33,
    tire: 0.25,
    clearance: 0.28,
    lamps: 'round',
    spoiler: true,
    stations: [
      { z: -0.5, belt: 0.43, w: 0.8 },
      { z: -0.468, belt: 0.5, w: 0.94 },
      { z: -0.36, belt: 0.56, w: 0.995 },
      // ドアの枠（フロントガラスの付け根 −0.17 と柱 0.08）は乗り降りの担当の表（onFoot.ts の DOOR_FRAME）と揃える
      { z: -0.17, belt: 0.605, w: 1 },
      { z: -0.025, belt: 0.625, roof: 0.955, w: 1, wRoof: 0.72 },
      { z: 0.08, belt: 0.63, roof: 0.97, w: 1, wRoof: 0.73, pillar: true },
      { z: 0.105, belt: 0.63, roof: 0.97, w: 1, wRoof: 0.73 },
      { z: 0.2, belt: 0.635, roof: 0.945, w: 1, wRoof: 0.71 },
      { z: 0.375, belt: 0.65, w: 0.99 },
      { z: 0.468, belt: 0.635, w: 0.93 },
      { z: 0.5, belt: 0.57, w: 0.82 },
    ],
  },
  // 背の高い2ボックス。短い鼻、立った後ろ
  kei: {
    wheel: 0.29,
    tire: 0.19,
    clearance: 0.24,
    stations: [
      { z: -0.5, belt: 0.4, w: 0.88 },
      { z: -0.46, belt: 0.47, w: 0.98 },
      { z: -0.3, belt: 0.55, w: 1 },
      { z: -0.14, belt: 0.56, roof: 0.975, w: 1, wRoof: 0.84 },
      { z: 0.07, belt: 0.56, roof: 1, w: 1, wRoof: 0.85, pillar: true },
      { z: 0.1, belt: 0.56, roof: 1, w: 1, wRoof: 0.85 },
      { z: 0.36, belt: 0.56, roof: 0.99, w: 1, wRoof: 0.84, pillar: true },
      { z: 0.44, belt: 0.56, roof: 0.97, w: 0.99, wRoof: 0.83 },
      { z: 0.5, belt: 0.55, w: 0.94 },
    ],
  },
  // 背の高いタクシー（ハイトワゴン型）。鼻が短く、後ろの窓が立っている
  taxi: {
    wheel: 0.33,
    tire: 0.22,
    clearance: 0.26,
    roofLamp: 'taxi',
    stations: [
      { z: -0.5, belt: 0.4, w: 0.86 },
      { z: -0.46, belt: 0.47, w: 0.97 },
      { z: -0.25, belt: 0.55, w: 1 },
      { z: -0.1, belt: 0.56, roof: 0.975, w: 1, wRoof: 0.8 },
      { z: 0.06, belt: 0.56, roof: 1, w: 1, wRoof: 0.81, pillar: true },
      { z: 0.09, belt: 0.56, roof: 1, w: 1, wRoof: 0.81 },
      { z: 0.33, belt: 0.56, roof: 0.99, w: 1, wRoof: 0.8, pillar: true },
      { z: 0.4, belt: 0.56, roof: 0.975, w: 1, wRoof: 0.79 },
      { z: 0.48, belt: 0.56, w: 0.97 },
      { z: 0.5, belt: 0.5, w: 0.9 },
    ],
  },
  // 1ボックスの商用バン。鼻がほとんど無く、荷室の側面は窓なし
  van: {
    wheel: 0.36,
    tire: 0.24,
    clearance: 0.3,
    stations: [
      { z: -0.5, belt: 0.36, w: 0.9 },
      { z: -0.475, belt: 0.44, w: 0.98 },
      { z: -0.4, belt: 0.49, w: 1 },
      { z: -0.29, belt: 0.5, roof: 0.975, w: 1, wRoof: 0.88 },
      { z: -0.1, belt: 0.5, roof: 1, w: 1, wRoof: 0.89, pillar: true },
      { z: 0.43, belt: 0.5, roof: 1, w: 1, wRoof: 0.89, pillar: true },
      { z: 0.47, belt: 0.5, roof: 0.985, w: 1, wRoof: 0.88 },
      { z: 0.5, belt: 0.49, w: 0.97 },
    ],
  },
  // セダン型のパトカー。下半分が黒、屋根に赤色灯
  police: {
    wheel: 0.35,
    tire: 0.25,
    clearance: 0.28,
    twoTone: true,
    roofLamp: 'police',
    stations: [
      { z: -0.5, belt: 0.47, w: 0.85 },
      { z: -0.455, belt: 0.54, w: 0.97 },
      { z: -0.18, belt: 0.63, w: 1 },
      { z: -0.04, belt: 0.65, roof: 0.985, w: 1, wRoof: 0.75 },
      { z: 0.07, belt: 0.655, roof: 1, w: 1, wRoof: 0.76, pillar: true },
      { z: 0.095, belt: 0.655, roof: 1, w: 1, wRoof: 0.76 },
      { z: 0.23, belt: 0.66, roof: 0.975, w: 1, wRoof: 0.74 },
      { z: 0.35, belt: 0.66, w: 0.99 },
      { z: 0.465, belt: 0.64, w: 0.93 },
      { z: 0.5, belt: 0.59, w: 0.83 },
    ],
  },
}

/** 前後の端へ向けて床下が上がる量 m（車軸のあたりから上がり始め、端で最大） */
function endLift(z: number): number {
  return (z > 0 ? 0.17 : 0.09) * endTuck(z)
}

/** 前後の端へ向けて、車体の下半分が内へ絞られる割合 0..1（後ろから見て、タイヤが車体の角の外に見える） */
function endTuck(z: number): number {
  const k = Math.min(1, Math.max(0, (Math.abs(z) - 0.33) / 0.17))
  return k * k * (3 - 2 * k)
}


/** 断面のあいだを滑らかに補う（ボンネット・屋根・荷室が前後に丸みを持つ）。ガラスの区間（屋根の有無が変わる所）は割らない */
function densify(st: Station[]): Station[] {
  const slope = (i: number, pick: (s: Station) => number | undefined): number => {
    const at = (k: number) => (k >= 0 && k < st.length ? pick(st[k]) : undefined)
    const here = at(i) as number
    const prev = at(i - 1)
    const next = at(i + 1)
    const before = prev == null ? null : (here - prev) / (st[i].z - st[i - 1].z)
    const after = next == null ? null : (next - here) / (st[i + 1].z - st[i].z)
    if (before == null || after == null) return before ?? after ?? 0
    // 山や谷では傾きを 0 にして、行き過ぎ（波打ち）を防ぐ
    if (before * after <= 0) return 0
    return Math.sign(before) * Math.min(Math.abs(before + after) / 2, 3 * Math.abs(before), 3 * Math.abs(after))
  }
  const out: Station[] = []
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i]
    const b = st[i + 1]
    out.push(a)
    const roofs = (a.roof != null ? 1 : 0) + (b.roof != null ? 1 : 0)
    const h = b.z - a.z
    const n = roofs === 1 ? 1 : Math.min(4, Math.ceil(h / 0.065 - 1e-9))
    for (let k = 1; k < n; k++) {
      const u = k / n
      const mix = (pick: (s: Station) => number | undefined): number => {
        const va = pick(a) as number
        const vb = pick(b) as number
        const u2 = u * u
        const u3 = u2 * u
        return (2 * u3 - 3 * u2 + 1) * va + (u3 - 2 * u2 + u) * h * slope(i, pick) + (-2 * u3 + 3 * u2) * vb + (u3 - u2) * h * slope(i + 1, pick)
      }
      const made: Station = { z: a.z + h * u, belt: mix((s) => s.belt), w: mix((s) => s.w), pillar: a.pillar }
      if (roofs === 2) {
        made.roof = mix((s) => s.roof)
        made.wRoof = mix((s) => (s.roof != null ? (s.wRoof ?? s.w * 0.8) : undefined))
      }
      out.push(made)
    }
  }
  out.push(st[st.length - 1])
  return out
}

/** 艶の帯: 面から浮かせる量 m、付ける前後の範囲（車長に対する割合。中心から）、帯ごとの明るさ（肩の面取り・ボンネットと荷室の肩・屋根の縁） */
const GLOSS_LIFT = 0.006
const GLOSS_SPAN = 0.44
const GLOSS_BAND = { shoulder: 1, deck: 0.55, roof: 0.8, sheen: 0.75 }
/** 上面の光の帯の印（頂点色に入れておき、作り終えてから明るさに置き換える） */
const SHEEN_MARK = -1

/** 輪の点の番号: 左の 裾・腰・肩の下・肩・上面の縁・上面、右はその逆順 */
const RING = 12
const LEFT_PANEL = [0, 1, 2]
const RIGHT_PANEL = [11, 10, 9]

/**
 * 断面1つぶんの輪（左下から時計回りに 12 点）。肩と上面の縁を面取りして、ボンネットと屋根に丸みを付ける。
 * glassEdge は、ガラスの付け根になる屋根なしの断面（上面の点を外へ寄せて、ガラスの下辺を車幅いっぱいに取る）。
 */
function ring(st: Station, look: Look, length: number, width: number, height: number, glassEdge: boolean): THREE.Vector3[] {
  const z = st.z * length
  const half = (width / 2) * st.w
  // 前後の端は床下を持ち上げる（バンパーの下の逃げ。後ろや前から見てもタイヤが車体の下に見える）
  const low = look.clearance + endLift(st.z)
  const belt = st.belt * height
  const waist = low + (belt - low) * 0.5
  const tuck = endTuck(st.z)
  const lowHalf = half * (0.9 - 0.22 * tuck)
  const waistHalf = half * (1 - 0.1 * tuck)
  const beltHalf = half * 0.98
  const shoulderHalf = half * 0.945
  let edge: [number, number]
  let top: [number, number]
  if (st.roof != null) {
    const roofHalf = (width / 2) * (st.wRoof ?? st.w * 0.8)
    edge = [roofHalf, st.roof * height - 0.04]
    top = [roofHalf - 0.085, st.roof * height]
  } else {
    edge = [half * 0.85, belt + 0.022]
    top = glassEdge ? [half * 0.8, belt + 0.028] : [half * 0.5, belt + 0.042]
  }
  const side: [number, number][] = [[lowHalf, low], [waistHalf, waist], [beltHalf, belt - 0.035], [shoulderHalf, belt], edge, top]
  return [...side.map(([x, y]) => new THREE.Vector3(-x, y, z)), ...[...side].reverse().map(([x, y]) => new THREE.Vector3(x, y, z))]
}

/** 車体を作る。塗装色を掛ける面（paint）と、窓・黒い部品（trim）に分けて返す */
function buildBody(kind: CarKind, detail: ShapeDetail): { paint: THREE.BufferGeometry; trim: THREE.BufferGeometry; gloss: THREE.BufferGeometry | null } {
  const s = VEHICLE_SPECS[kind]
  const look = VEHICLE_LOOK[kind]
  const high = detail === 'high'
  const paint = new Tris()
  const trim = new Tris()
  // 艶の帯: 肩の面取りと屋根の縁に、面から少し浮かせて重ねる細い面（白を足して描く。色は明るさ）
  const gloss = new Tris()
  const shine = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, k: number) => {
    const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize().multiplyScalar(GLOSS_LIFT)
    gloss.quad(a.clone().add(n), b.clone().add(n), c.clone().add(n), d.clone().add(n), [k, k, k])
  }
  // 塗装色の面だけ paint へ、それ以外は trim へ振り分ける
  const t = {
    tri: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: Rgb) => (color === PAINT ? paint : trim).tri(a, b, c, color),
    quad: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: Rgb) => (color === PAINT ? paint : trim).quad(a, b, c, d, color),
  }
  const stations = high ? densify(look.stations) : look.stations
  const rings = stations.map((st, i) => {
    const glassEdge = st.roof == null && (stations[i - 1]?.roof != null || stations[i + 1]?.roof != null)
    return ring(st, look, s.length, s.width, s.height, glassEdge)
  })
  // タイヤハウス: 車輪より一回り大きい丸い穴と、その奥の壁の位置（車輪の内側の面より少し奥）
  const wheelZ = [-s.wheelbase / 2, s.wheelbase / 2]
  const archR = look.wheel + ARCH.gap
  const backX = wheelTrack(kind) - look.tire / 2 - ARCH.depth
  const lower: Rgb = look.twoTone ? BLACK : PAINT

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    const sa = stations[i]
    const sb = stations[i + 1]
    const roofs = (sa.roof != null ? 1 : 0) + (sb.roof != null ? 1 : 0)
    // 屋根のある区間の側面は窓。フロント・リアのガラスの脇（A・C ピラー）と柱は塗装（窓が黒い塊にならず、屋根の縁が読める）
    const side: Rgb = roofs === 2 && !sa.pillar ? GLASS : PAINT
    // 上面: 両方に屋根があれば屋根、片方だけならガラス（フロント・リア）、無ければボンネットや荷室
    const top: Rgb = roofs === 1 ? GLASS : PAINT
    const colors: Rgb[] = [lower, PAINT, PAINT, side, PAINT, top, PAINT, side, PAINT, PAINT, lower, BLACK]
    const cols = archColumns(a[0].z, b[0].z, wheelZ, archR, ARCH.step)
    for (let j = 0; j < RING; j++) {
      const k = (j + 1) % RING
      // 車輪に掛かる区間の側面の下半分（裾〜腰〜肩の下）は、タイヤハウスを切り欠いて張る
      if (cols.length > 2 && (j === 0 || j === 1 || j === 9 || j === 10)) continue
      // 断面は前（−z）から後ろへ並ぶ。外向きの面になる順に張る
      t.quad(a[j], b[j], b[k], a[k], colors[j])
      // 艶の帯（鼻先と尻の絞りには付けない）: 肩の面取り、ボンネット・荷室の肩、屋根の縁
      if (!high || Math.abs(sa.z + sb.z) / 2 > GLOSS_SPAN) continue
      if (j === 2 || j === 8) shine(a[j], b[j], b[k], a[k], GLOSS_BAND.shoulder)
      else if ((j === 3 || j === 7) && roofs === 0) shine(a[j], b[j], b[k], a[k], GLOSS_BAND.deck)
      else if ((j === 4 || j === 6) && roofs === 2) shine(a[j], b[j], b[k], a[k], GLOSS_BAND.roof)
      // 上面（ボンネット・屋根・荷室）を横切る光の帯: 明るさは前後の位置で決める（あとで頂点ごとに入れる。ここでは印だけ）
      if (j === 5 && roofs !== 1) shine(a[j], b[j], b[k], a[k], SHEEN_MARK)
      else if ((j === 4 || j === 6) && roofs === 0) shine(a[j], b[j], b[k], a[k], SHEEN_MARK)
    }
    if (cols.length <= 2) continue
    for (const sx of [-1, 1]) {
      const idx = sx < 0 ? LEFT_PANEL : RIGHT_PANEL
      const column = (z: number) => {
        const u = (z - a[0].z) / (b[0].z - a[0].z)
        const [low, waist, belt] = idx.map((n) => a[n].clone().lerp(b[n], u))
        const cut = archCut(z, wheelZ, archR, look.wheel)
        const edge = panelPoint([low, waist, belt].map((v) => [Math.abs(v.x), v.y] as [number, number]), cut)
        const p0 = new THREE.Vector3(sx * edge.x, edge.y, z)
        return { p0, p1: edge.above === 1 ? p0 : waist, belt, open: cut > low.y }
      }
      let c = column(cols[0])
      for (let n = 1; n < cols.length; n++) {
        const d = column(cols[n])
        // 面の向きは元の側面と同じ（左は 前下 → 後下 → 後上 → 前上、右はその逆）
        if (sx < 0) {
          if (c.p0 !== c.p1 || d.p0 !== d.p1) t.quad(c.p0, d.p0, d.p1, c.p1, lower)
          t.quad(c.p1, d.p1, d.belt, c.belt, PAINT)
        } else {
          t.quad(c.belt, d.belt, d.p1, c.p1, PAINT)
          if (c.p0 !== c.p1 || d.p0 !== d.p1) t.quad(c.p1, d.p1, d.p0, c.p0, lower)
        }
        // 内張り: 切り欠きの縁から奥へ伸びる黒い帯（車輪の側を向く）
        if (c.open || d.open) {
          const wz = wheelZ.reduce((best, w) => (Math.abs(w - d.p0.z) < Math.abs(best - d.p0.z) ? w : best))
          const ci = new THREE.Vector3(sx * backX, c.p0.y, c.p0.z)
          const di = new THREE.Vector3(sx * backX, d.p0.y, d.p0.z)
          const axle = new THREE.Vector3(sx * backX, look.wheel, wz)
          trim.quadFacing(c.p0, d.p0, di, ci, WELL, axle.clone().sub(c.p0).add(axle.clone().sub(d.p0)))
        }
        c = d
      }
    }
  }
  // タイヤハウスの奥の壁（車輪の内側に立つ黒い板。外を向く）
  for (const sx of [-1, 1]) {
    for (const wz of wheelZ) {
      const y0 = look.clearance - 0.02
      const y1 = look.wheel + archR + 0.02
      const p = (z: number, y: number) => new THREE.Vector3(sx * backX, y, z)
      trim.quadFacing(p(wz - archR - 0.04, y0), p(wz - archR - 0.04, y1), p(wz + archR + 0.04, y1), p(wz + archR + 0.04, y0), WELL, new THREE.Vector3(sx, 0, 0))
    }
  }
  // 前後のふた
  const cap = (r: THREE.Vector3[], front: boolean) => {
    const c = r.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length)
    for (let j = 0; j < RING; j++) {
      const k = (j + 1) % RING
      const color: Rgb = j === 0 || j === 10 || j === 11 ? lower : PAINT
      if (front) t.tri(c, r[j], r[k], color)
      else t.tri(c, r[k], r[j], color)
    }
  }
  cap(rings[0], true)
  cap(rings[rings.length - 1], false)

  /** 側面の、前後 z・高さ y での中心からの距離（裾 → 腰 → 肩の下 → 肩 の折れ線の上） */
  const sideAt = (z: number, y: number): number => {
    let i = 0
    while (i < rings.length - 2 && rings[i + 1][0].z < z) i++
    const u = Math.min(1, Math.max(0, (z - rings[i][0].z) / (rings[i + 1][0].z - rings[i][0].z)))
    const line = [11, 10, 9, 8].map((n) => rings[i][n].clone().lerp(rings[i + 1][n], u))
    if (y <= line[0].y) return line[0].x
    for (let n = 0; n < line.length - 1; n++) {
      if (y > line[n + 1].y) continue
      const k = (y - line[n].y) / Math.max(1e-6, line[n + 1].y - line[n].y)
      return line[n].x + (line[n + 1].x - line[n].x) * k
    }
    return line[line.length - 1].x
  }
  const beltAt = (z: number): number => {
    let i = 0
    while (i < rings.length - 2 && rings[i + 1][0].z < z) i++
    const u = Math.min(1, Math.max(0, (z - rings[i][0].z) / (rings[i + 1][0].z - rings[i][0].z)))
    return rings[i][8].y + (rings[i + 1][8].y - rings[i][8].y) * u
  }

  const first = look.stations[0]
  const last = look.stations[look.stations.length - 1]
  const cowl = look.stations.find((st) => st.roof != null)
  const door = cowl ? cabinLayout(s, look).door : null
  const dims: ExteriorDims = {
    halfL: s.length / 2,
    width: s.width,
    height: s.height,
    frontW: s.width * first.w,
    rearW: s.width * last.w,
    noseY: first.belt * s.height,
    tailY: last.belt * s.height,
    frontLow: look.clearance + endLift(-0.5),
    rearLow: look.clearance + endLift(0.5),
    clearance: look.clearance,
    headY: first.belt * s.height - 0.1,
    lampY: last.belt * s.height - 0.07,
    lamps: look.lamps ?? 'rect',
    cowl: cowl ? { y: cowl.belt * s.height, z: cowl.z * s.length } : null,
    door: door ? { hingeZ: door.hingeZ, rearZ: door.rearZ, beltY: door.beltY } : null,
    wheelZ,
    archR,
    twoTone: !!look.twoTone,
    spoiler: !!look.spoiler && high,
    sideAt,
  }
  addExterior(paint, trim, dims, detail)
  if (high) addFlares(paint, trim, dims, look.wheel, beltAt)
  if (look.roofLamp === 'police') trim.box(s.width * 0.62, 0.05, 0.3, 0, s.height + 0.025, 0.02 * s.length, BLACK)
  const painted = paint.build(high ? CREASE : undefined)
  // 塗装の明暗（lib/gto/vehicleGloss.ts）: 側面は裾が暗く肩へ向けて明るく、肩の面取りに光の帯。単色の平塗りにしない
  const pos = painted.attributes.position
  const nor = painted.attributes.normal
  const col = painted.attributes.color
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const low = look.clearance + endLift(z / s.length)
    const ny = nor.getY(i)
    // 上を向く面（ボンネット・屋根・荷室）には、前後に横切る光の帯を重ねる（一枚のベタ塗りにしない）
    const sheen = ny > 0.75 ? 1 + (topSheen(z / s.length) - 1) * Math.min(1, (ny - 0.75) / 0.15) : 1
    const k = glossShade(ny, (pos.getY(i) - low) / Math.max(0.05, beltAt(z) - low)) * sheen
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k)
  }
  const glossed = high ? gloss.build() : null
  if (glossed) {
    // 印を付けた上面の帯に、前後の位置に応じた明るさを入れる（帯の芯で白く、外では消える）
    const gp = glossed.attributes.position
    const gc = glossed.attributes.color
    const span = VEHICLE_GLOSS.sheenPeak - VEHICLE_GLOSS.sheenBase
    for (let i = 0; i < gc.count; i++) {
      if (gc.getX(i) >= 0) continue
      const k = (GLOSS_BAND.sheen * (topSheen(gp.getZ(i) / s.length) - VEHICLE_GLOSS.sheenBase)) / span
      gc.setXYZ(i, k, k, k)
    }
  }
  return { paint: painted, trim: trim.build(high ? CREASE : undefined), gloss: glossed }
}

export interface VehicleShape {
  /** 塗装色を掛ける面 */
  body: THREE.BufferGeometry
  /** 窓・バンパー・タイヤハウスなど、塗装色に染まらない面 */
  trim: THREE.BufferGeometry
  /** 艶の帯（肩の線と屋根の縁に沿う細い面。白を足して描く）。スマホの簡略な形には無い */
  gloss: THREE.BufferGeometry | null
  /** 車輪1つ（原点が車輪の中心）。四輪とも別々に置く */
  wheel: THREE.BufferGeometry
  head: THREE.BufferGeometry
  tail: THREE.BufferGeometry
  /** 屋根の灯り（タクシーの行灯、パトカーの赤色灯）。無い車種は null */
  roofLamp: THREE.BufferGeometry | null
  look: Look
  /** 車輪の中心の左右の位置（車体の中心から）。タイヤの外面は車体の側面より少し引っ込み、タイヤハウスに収まる */
  track: number
  /** 前照灯と尾灯の位置（光だまりと光の筋を置く場所。車体の座標） */
  headY: number
  tailY: number
  /** 前輪・後輪の真上の車体（フェンダーの肩）の高さ m。車体が沈み込んだとき、これより上に出るタイヤは描かない */
  fenderY: [front: number, rear: number]
}

/** 車輪（前後の位置 wheelZ m、半径 radius m）の真上で、肩の線がいちばん低い所の高さ m */
function fenderTop(kind: CarKind, wheelZ: number, radius: number): number {
  const s = VEHICLE_SPECS[kind]
  const st = VEHICLE_LOOK[kind].stations
  const beltAt = (z: number): number => {
    const f = Math.min(0.5, Math.max(-0.5, z / s.length))
    let i = 0
    while (i < st.length - 2 && st[i + 1].z < f) i++
    const u = Math.min(1, Math.max(0, (f - st[i].z) / (st[i + 1].z - st[i].z)))
    return (st[i].belt + (st[i + 1].belt - st[i].belt) * u) * s.height
  }
  return Math.min(...[-1, -0.5, 0, 0.5, 1].map((k) => beltAt(wheelZ + k * radius)))
}

/** 車輪の中心の左右の位置（車体の中心から） */
function wheelTrack(kind: CarKind): number {
  return VEHICLE_SPECS[kind].width / 2 - VEHICLE_LOOK[kind].tire / 2 - ARCH.inset
}

/** 屋根の灯りの箱を並べた形（材質の color で明るさを変える） */
function lampBoxes(boxes: [w: number, h: number, l: number, x: number, y: number, z: number, color: Rgb][]): THREE.BufferGeometry {
  const t = new Tris()
  for (const [w, h, l, x, y, z, color] of boxes) t.box(w, h, l, x, y, z, color)
  return t.build()
}

/** 車種の形を作る。detail が 'lite'（スマホの軽量設定）なら、断面を補わず部品も省いた簡略な形 */
export function buildVehicleShape(kind: CarKind, detail: ShapeDetail = 'high'): VehicleShape {
  const s = VEHICLE_SPECS[kind]
  const look = VEHICLE_LOOK[kind]
  const halfL = s.length / 2
  const first = look.stations[0]
  const last = look.stations[look.stations.length - 1]
  const headY = first.belt * s.height - 0.1
  const tailY = last.belt * s.height - 0.07
  const track = wheelTrack(kind)
  const wheel = buildWheel(look.wheel, look.tire, detail)
  const lamps = buildLamps(look.lamps ?? 'rect', detail, { frontHalf: (s.width / 2) * first.w, rearHalf: (s.width / 2) * last.w, headY, tailY, halfL })
  const roofZ = (look.stations.find((st) => st.roof === 1)?.z ?? 0) * s.length
  const roofLamp =
    look.roofLamp === 'taxi'
      ? lampBoxes([[0.36, 0.13, 0.15, 0, s.height + 0.065, roofZ - 0.25, [1, 0.82, 0.3]]])
      : look.roofLamp === 'police'
        ? lampBoxes([
            [s.width * 0.27, 0.12, 0.2, -s.width * 0.16, s.height + 0.11, 0.02 * s.length, [1, 0.08, 0.06]],
            [s.width * 0.27, 0.12, 0.2, s.width * 0.16, s.height + 0.11, 0.02 * s.length, [1, 0.08, 0.06]],
          ])
        : null
  const body = buildBody(kind, detail)
  const fenderY: [number, number] = [fenderTop(kind, -s.wheelbase / 2, look.wheel), fenderTop(kind, s.wheelbase / 2, look.wheel)]
  return { body: body.paint, trim: body.trim, gloss: body.gloss, wheel, head: lamps.head, tail: lamps.tail, roofLamp, look, track, headY, tailY, fenderY }
}

export function disposeVehicleShape(shape: VehicleShape) {
  shape.body.dispose()
  shape.trim.dispose()
  shape.gloss?.dispose()
  shape.wheel.dispose()
  shape.head.dispose()
  shape.tail.dispose()
  shape.roofLamp?.dispose()
}
