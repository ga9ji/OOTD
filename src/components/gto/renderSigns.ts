// Grand Theft Outfit [部品: signs] 看板とネオン。
// 入口: createSignsRenderer(ctx)
// 契約: signage.ts が決めた配置（Sign と NeonTube の配列）を絵にするだけ。文字はすべて架空の店名・広告。
//       昼の看板は1枚のアトラス（renderSignsAtlas.ts）を使う印刷の板の集まり。
//       夜は「発光する色面」を作らない。板と壁は暗く落とし、光るのは管の線だけにする:
//       (0) 店の看板と袖看板は、暗い板に屋号を管の線で書いた夜の絵（renderSignsNeonCells.ts）に差し替える。
//           広告の板は暗く沈める（signage.ts の signLook）。
//       (1) 看板の縁と軒を、芯が白く外側が色の管でなぞる（signageNeon.ts の buildSignTubes と signage.ts の buildNeonTubes）
//       (2) 管のまわりに色のにじみを置く（芯の近くが濃く、外へ広く薄く伸びる）
//       (3) 看板の光の色（neonAccent）を、看板のすぐ下の壁に落とす。管の直下がいちばん明るく、1〜2m で消える
//       (4) 路面には、街ぜんたいの光の場（signageGlow.ts）を頂点色の網で落とす。壁際がいちばん明るく、距離で落ち、
//           隣の看板の色と混ざる。同じ場を、そこに立つ人と車にも被せる（renderSignsGlow.ts）。
//       (5) 壁と路面の光は「足す」前に「染める」（下の色に倍率を掛け、補色を落とす。signageGlow.ts の tintFactor）。
//           白いシャッターや明るい歩道も、白く飛ばずに看板の色になる。
//       (6) 板のない筆記体のネオン文字（kind 'neon'）は、管の絵（renderSignsNeonText.ts）を加算で壁の前に重ねる。
//       光の部品（renderSky.ts）も先頭の看板に薄い光だまりを置くが、「看板の色」はここで落とす。
//       軽量設定（quality.mobile）は配置を 'lite' にし、壁に落とす色を省き、光の場の升目を粗くする。
import * as THREE from 'three'
import { hexToLinear, type Rgb } from '../../lib/gto/lighting'
import { dirOf } from '../../lib/gto/math'
import { buildNeonTubes, buildSignage, buildStorefrontShades, signLook, wallNormalOf, type NeonTube, type Sign, type StorefrontShade } from '../../lib/gto/signage'
import { buildGlowEmitters, buildGlowField, TINT_TUNING } from '../../lib/gto/signageGlow'
import { buildSignTubes, neonAccent, spillWeights } from '../../lib/gto/signageNeon'
import { createNightAtlas, createSignAtlas, createVisionTexture, SOLID_CELL, VISION_GRID, type UvRect } from './renderSignsAtlas'
import { buildGroundGlow, createBodyGlow, type BodyGlow } from './renderSignsGlow'
import { createNeonWordTexture } from './renderSignsNeonText'
import type { RenderCtx, RenderPart } from './renderTypes'

type P3 = [x: number, y: number, z: number]

interface Buf {
  pos: number[]
  uv: number[]
  col: number[]
  /** 光の板だけ: にじみの形（SHAPE） */
  shape: number[]
  idx: number[]
}
const emptyBuf = (): Buf => ({ pos: [], uv: [], col: [], shape: [], idx: [] })

/** 光の板のにじみの形（シェーダの vShape） */
const SHAPE = {
  /** 丸 */
  round: 0,
  /** 横に長い帯（軒の管が壁に落とす色） */
  band: 1,
  /** 路面の網（頂点色をそのまま足す） */
  ground: 2,
  /** 角の丸い四角（看板が背にした壁） */
  box: 3,
  /** 横の管のにじみ */
  haloH: 4,
  /** 縦の管のにじみ */
  haloV: 5,
  /** 上の辺（管の直下）がいちばん明るく、下へ距離で落ちる（看板の下の壁・シャッター） */
  fall: 6,
  /** 店先の陰: 下の色を暗く落とすだけ（色の赤成分 = 落とす割合） */
  shade: 7,
}

const FULL_UV: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 }

/** 4隅（見る側から見て左下・右下・右上・左上）の板を1枚足す */
function pushQuad(b: Buf, p0: P3, p1: P3, p2: P3, p3: P3, r: UvRect, col: Rgb, shape = 0) {
  const base = b.pos.length / 3
  b.pos.push(...p0, ...p1, ...p2, ...p3)
  b.uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1)
  for (let i = 0; i < 4; i++) {
    b.col.push(col[0], col[1], col[2])
    b.shape.push(shape)
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** 中心 (x, y, z)・面の向き n の、幅 w・高さ h の立った板 */
function pushUpright(b: Buf, x: number, y: number, z: number, n: { x: number; z: number }, w: number, h: number, r: UvRect, col: Rgb, shape = 0) {
  // 面に向かって左の向き
  const lx = (-n.z * w) / 2
  const lz = (n.x * w) / 2
  pushQuad(b, [x + lx, y - h / 2, z + lz], [x - lx, y - h / 2, z - lz], [x - lx, y + h / 2, z - lz], [x + lx, y + h / 2, z + lz], r, col, shape)
}

function toGeometry(b: Buf, withShape: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
  if (withShape) g.setAttribute('shape', new THREE.Float32BufferAttribute(b.shape, 1))
  g.setIndex(b.idx)
  return g
}

const gray = (v: number): Rgb => [v, v, v]
const scaled = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
const cssLinear = (css: string): Rgb => hexToLinear(Number.parseInt(css.slice(1), 16))

// ----------------------------------------------------------------------------
// 看板の板
// ----------------------------------------------------------------------------

interface SignBufs {
  /** 昼のアトラスを使う看板（印刷の板） */
  boards: Buf
  /** 夜のアトラスを使う看板（暗い板に管の文字） */
  tubeBoards: Buf
  /** 映像の流れるビジョン */
  visions: Buf
  /** 筆記体のネオン文字（加算） */
  words: Buf
}

function pushSign(out: SignBufs, s: Sign, uvOf: (key: string, night: boolean) => UvRect, wordUv: (design: number) => UvRect, neon: number, post: boolean, index: number) {
  const n = dirOf(s.heading)
  if (s.kind === 'neon') {
    // 管の絵は黒地。にじみが切れないよう、板を少し大きく取る必要はない（絵の中に余白がある）
    pushUpright(out.words, s.x + n.x * 0.05, s.y, s.z + n.z * 0.05, n, s.w, s.h, wordUv(s.design), gray(1))
    return
  }
  const back = { x: -n.x, z: -n.z }
  const look = signLook(s, neon)
  const gain = gray(look.tube && !post ? 1 : look.gain)
  const target = look.tube ? out.tubeBoards : out.boards
  const solid = gray(Math.min(1, neon) * (neon > 1 ? 0.3 : 0.9))
  if (s.kind === 'vision') {
    const cell = 1 / VISION_GRID
    const u = (index % VISION_GRID) * cell
    const v = (Math.floor(index / VISION_GRID) % VISION_GRID) * cell
    pushUpright(out.visions, s.x + n.x * 0.03, s.y, s.z + n.z * 0.03, n, s.w, s.h, { u0: u, v0: v, u1: u + cell, v1: v + cell }, gray(1))
    return
  }
  const r = uvOf(look.cell, look.tube)
  pushUpright(target, s.x + n.x * 0.03, s.y, s.z + n.z * 0.03, n, s.w, s.h, r, gain)
  if (s.kind === 'blade') {
    // 袖看板は両面
    pushUpright(target, s.x - n.x * 0.03, s.y, s.z - n.z * 0.03, back, s.w, s.h, r, gain)
  } else if (s.kind === 'rooftop') {
    // 屋上の広告塔は裏面と脚を付ける
    const dark = uvOf(SOLID_CELL, false)
    pushUpright(out.boards, s.x - n.x * 0.12, s.y, s.z - n.z * 0.12, back, s.w, s.h, dark, solid)
    const foot = s.footY ?? s.y - s.h / 2
    const legH = s.y - s.h / 2 - foot
    if (legH > 0.2) {
      for (const side of [-0.38, 0, 0.38]) {
        const lx = s.x - n.z * s.w * side - n.x * 0.06
        const lz = s.z + n.x * s.w * side - n.z * 0.06
        pushUpright(out.boards, lx, foot + legH / 2, lz, n, 0.24, legH, dark, solid)
        pushUpright(out.boards, lx, foot + legH / 2, lz, back, 0.24, legH, dark, solid)
      }
    }
  }
}

// ----------------------------------------------------------------------------
// 壁と路面に落ちる色（加算の板）
// ----------------------------------------------------------------------------

/** 壁から光の板までの距離（壁とちらつかない最小の浮き） */
const WASH_LIFT = 0.06
/** ポストプロセスが無い画質では、加算の光をこの倍率に抑える（色調が板ごとに掛かり、重なりが飛びやすい） */
const WASH_GAIN_NO_POST = 0.35

/** 看板が落とす光の色（看板ごとの濃い色。白い看板も、文字や決めたネオンの色で光る） */
const washColor = (s: Sign, strength: number): Rgb => scaled(cssLinear(neonAccent(s)), strength)

/** 光の強さの配分（L.neonSpill に掛ける）。夜の路面が看板の色に染まって見える強さに合わせた */
const GLOW = {
  /** 看板のすぐ下の壁（管の直下の値。下へ距離で落ちる） */
  wall: 1.3,
  /** 筆記体のネオン文字のまわりの壁 */
  wordWall: 0.45,
  /** 袖看板の付け根の壁 */
  bladeWall: 0.16,
  /** 路面の光の場（場の 1 = 店の看板1枚の壁際） */
  ground: 2.6,
  /** 人と車に被せる色（下の色 ×（1 ＋ 場 × これ）） */
  body: 4.5,
  /** 管のすぐまわりのにじみ */
  halo: 2.6,
  /** 軒の管が壁に落とす帯 */
  tubeWall: 0.5,
}
/** 看板の下の壁に光が届く高さ m（管の直下から。半分の明るさになるのは 0.8m ほど） */
const WALL_FALL = 3.2
/** 軒の管が壁に落とす帯の高さ m（管を中心に上下へ） */
const TUBE_BAND = 2.4
/** 染める強さ: 光の板の色（L.neonSpill を掛ける前の 1 = 看板1枚の壁際）に掛けて s にする */
const TINT_GAIN = 1.5
/** 路面を染める強さ: 光の場の値（壁際で 0.8 ほど）に掛けて s にする。壁際でいちばん濃く、道の中ほどで半分、先で消える */
const GROUND_TINT_GAIN = 0.95
/** 筆記体のネオン文字の明るさ（夜はブルームに乗せる・昼は灯の入っていない管） */
const WORD_GAIN = { night: 1.55, day: 0.32 }
/** 管のにじみの板の幅 m（管の太さの 10 倍ほど。芯の近くだけが濃い） */
const HALO_SPREAD = { eave: 1.7, frame: 1.1 }
/** 光の場の升目 m（PC・スマホ） */
const FIELD_CELL = { high: 2, mobile: 4 }

/** 看板が背にした壁に落とす色。壁を面で塗らない: 管の直下がいちばん明るく、すぐ下で消える */
function pushSignWash(b: Buf, s: Sign, strength: number) {
  if (!s.lit) return
  const n = wallNormalOf(s)
  if (s.kind === 'blade') {
    // 袖看板の付け根の壁に、細く薄い色
    const ax = s.x - n.x * (s.w / 2 + 0.28 - WASH_LIFT)
    const az = s.z - n.z * (s.w / 2 + 0.28 - WASH_LIFT)
    pushUpright(b, ax, s.y, az, n, 1.5, s.h + 0.5, FULL_UV, washColor(s, strength * GLOW.bladeWall), SHAPE.round)
    return
  }
  if (s.kind === 'neon') {
    // 筆記体のネオン文字は、文字のすぐまわりの壁だけを丸く染める（文字の高さの半分ぶん外まで）
    const pad = s.h * 0.5
    pushUpright(b, s.x - n.x * (0.22 - WASH_LIFT), s.y, s.z - n.z * (0.22 - WASH_LIFT), n, s.w + pad * 2, s.h + pad * 2, FULL_UV, washColor(s, strength * GLOW.wordWall), SHAPE.round)
    return
  }
  // 板が光らない広告・屋上の広告塔・ビジョンは、壁に色を落とさない（縁の管のにじみだけ）
  if (s.kind !== 'fascia') return
  // 店の看板: 下の縁の管から、店先のシャッターへ向かって距離で落ちる
  const top = s.y - s.h / 2
  pushUpright(b, s.x - n.x * (0.12 - WASH_LIFT), top - WALL_FALL / 2, s.z - n.z * (0.12 - WASH_LIFT), n, s.w + 1, WALL_FALL, FULL_UV, washColor(s, strength * GLOW.wall), SHAPE.fall)
}

/** 夜の店先（閉めたシャッター）を暗く落とす割合。明るい色面のままだと、管の線と落ちる光が沈む */
const SHADE = 0.8

/** 店先の陰。壁のすぐ手前に、足元から軒までの板を1枚 */
function pushShade(b: Buf, f: StorefrontShade) {
  const o = WASH_LIFT * 0.6
  const ax = f.ax + f.nx * o
  const az = f.az + f.nz * o
  const bx = f.bx + f.nx * o
  const bz = f.bz + f.nz * o
  pushQuad(b, [ax, f.ya, az], [bx, f.yb, bz], [bx, f.yb + f.h, bz], [ax, f.ya + f.h, az], FULL_UV, [SHADE, 0, 0], SHAPE.shade)
}

/** ネオン管のにじみと、軒の管が壁に落とす色（路面の色は光の場 signageGlow.ts で落とす） */
function pushTubeWash(b: Buf, t: NeonTube, strength: number) {
  const color = scaled(cssLinear(t.color), strength)
  const n = { x: t.nx, z: t.nz }
  const len = Math.hypot(t.x1 - t.x0, t.z1 - t.z0)
  const cx = (t.x0 + t.x1) / 2
  const cz = (t.z0 + t.z1) / 2
  const halo = scaled(color, GLOW.halo)
  const spread = t.frame ? HALO_SPREAD.frame : HALO_SPREAD.eave
  // 管のすぐまわりのにじみ（管より少し奥に置く）。芯の近くが濃く、外へ広く薄く伸びる
  if (len < 0.01) {
    pushUpright(b, cx - n.x * 0.02, (t.y0 + t.y1) / 2, cz - n.z * 0.02, n, spread, Math.abs(t.y1 - t.y0) + spread * 0.5, FULL_UV, halo, SHAPE.haloV)
    // どの向きから見てもにじむよう、横向きの板も足す
    pushUpright(b, cx, (t.y0 + t.y1) / 2, cz, { x: -n.z, z: n.x }, spread, Math.abs(t.y1 - t.y0) + spread * 0.5, FULL_UV, scaled(halo, 0.7), SHAPE.haloV)
  } else {
    pushUpright(b, cx - n.x * 0.02, t.y0, cz - n.z * 0.02, n, len + spread * 0.5, spread, FULL_UV, halo, SHAPE.haloH)
  }
  // 看板を縁取る管は、壁の色を看板の側（pushSignWash）で落とす
  if (t.frame) return
  const back = 0.2 - WASH_LIFT
  const mx = cx - n.x * back
  const mz = cz - n.z * back
  if (len < 0.01) {
    // 縦の管: 角のまわりの壁を縦長に染める
    pushUpright(b, mx, (t.y0 + t.y1) / 2, mz, n, 1.6, Math.abs(t.y1 - t.y0) + 0.8, FULL_UV, scaled(color, 0.3), SHAPE.round)
    return
  }
  pushUpright(b, mx, t.y0, mz, n, len + 0.8, TUBE_BAND, FULL_UV, scaled(color, GLOW.tubeWall), SHAPE.band)
}

const WASH_VERTEX = `
attribute float shape;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec3 vTint;
varying float vShape;
void main() {
  vUv = uv;
  vShape = shape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 加算で重ねるので、霧は「色を混ぜる」のではなく「薄くする」
  vTint = color * (1.0 - smoothstep(fogNear, fogFar, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

const WASH_FRAGMENT = `
uniform float tintPass;
uniform float tintGain;
varying vec2 vUv;
varying vec3 vTint;
varying float vShape;
// 管のにじみ: 芯のすぐ近くが濃く、外へ広く薄く伸びる（d は管からの距離 0..1）
float tubeGlow(float d) {
  return exp(-d * d * 60.0) * 0.9 + exp(-d * d * 9.0) * 0.36 * (1.0 - d);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec2 q = abs(p);
  float endsX = smoothstep(0.0, 0.14, min(vUv.x, 1.0 - vUv.x));
  float endsY = smoothstep(0.0, 0.1, min(vUv.y, 1.0 - vUv.y));
  float a = 1.0;
  float cover = 0.0;
  if (vShape < 0.5) {
    a = pow(max(1.0 - length(p), 0.0), 1.5);
  } else if (vShape < 1.5) {
    // 管からの距離で落ちる（管のすぐ脇が明るく、帯の縁で 0）
    a = (1.0 - q.y) / (1.0 + q.y * q.y * 22.0) * endsX;
  } else if (vShape < 2.5) {
    a = 1.0;
  } else if (vShape < 3.5) {
    a = (1.0 - smoothstep(0.25, 1.0, q.x)) * (1.0 - smoothstep(0.25, 1.0, q.y));
    // 壁に落とす色は、足すだけでなく下の色を少し覆う（明るい店先でも白く飛ばず、看板の色に染まる）
    cover = min(max(vTint.r, max(vTint.g, vTint.b)) * a * 0.6, 0.5);
  } else if (vShape < 4.5) {
    a = tubeGlow(q.y) * endsX;
  } else if (vShape < 5.5) {
    a = tubeGlow(q.x) * endsY;
  } else if (vShape > 6.5) {
    // 店先の陰: 色は足さず、下の色を落とす。軒のすぐ下でなだらかに消える
    if (tintPass > 0.5) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, vTint.r * (1.0 - smoothstep(0.9, 1.0, vUv.y)));
    return;
  } else {
    // 上の辺が管の直下。逆二乗に近い落ち方で、下の辺で 0
    float t = 1.0 - vUv.y;
    a = (1.0 - t) / (1.0 + t * t * 9.0) * endsX;
    cover = min(max(vTint.r, max(vTint.g, vTint.b)) * a * 0.4, 0.3);
  }
  if (tintPass > 0.5) {
    // 染める: 下の色 ×（光の色相 × boost × s ＋（1 − cut × s））。空中のにじみ（管のまわり）は染めない
    if (vShape > 3.5 && vShape < 5.5) discard;
    // 網の縁では補間した色がわずかに負になることがある（MSAA の外挿）。負のまま割ると巨大な倍率になるので 0 で止める
    vec3 light = max(vTint, vec3(0.0));
    float hi = max(light.r, max(light.g, light.b));
    float s = clamp(hi * a * tintGain, 0.0, float(TINT_MAX));
    gl_FragColor = vec4(light / max(hi, 1e-4) * (float(TINT_BOOST) * s), 1.0 - float(TINT_CUT) * s);
    return;
  }
  gl_FragColor = vec4(vTint * a, cover);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

// ----------------------------------------------------------------------------
// ネオン管
// ----------------------------------------------------------------------------

/** 管の太さ m。軒の管は太く、看板を縁取る管は細い */
const TUBE_WIDTH = 0.15
const FRAME_TUBE_WIDTH = 0.085

function pushTube(b: Buf, t: NeonTube, col: Rgb) {
  const width = t.frame ? FRAME_TUBE_WIDTH : TUBE_WIDTH
  const n = { x: t.nx, z: t.nz }
  const len = Math.hypot(t.x1 - t.x0, t.z1 - t.z0)
  if (len < 0.01) {
    // 縦の管は、正面と横の2枚を十字に組む（どこから見ても線に見える）
    const h = Math.abs(t.y1 - t.y0)
    const y = (t.y0 + t.y1) / 2
    pushUpright(b, t.x0, y, t.z0, n, width, h, FULL_UV, col)
    pushUpright(b, t.x0, y, t.z0, { x: -n.z, z: n.x }, width, h, FULL_UV, col)
    return
  }
  const mx = (t.x0 + t.x1) / 2
  const mz = (t.z0 + t.z1) / 2
  pushUpright(b, mx, t.y0, mz, n, len, width, FULL_UV, col)
  // 見上げても線が消えないよう、下向きの面も付ける
  const o = width
  pushQuad(b, [t.x0, t.y0 - o / 2, t.z0], [t.x1, t.y0 - o / 2, t.z1], [t.x1 + n.x * o, t.y0 - o / 2, t.z1 + n.z * o], [t.x0 + n.x * o, t.y0 - o / 2, t.z0 + n.z * o], FULL_UV, col)
}

// ----------------------------------------------------------------------------

/** ビジョンの絵を切り替える間隔（秒） */
const VISION_HOLD = 4

export function createSignsRenderer(ctx: RenderCtx): RenderPart {
  const { scene, quality, world } = ctx
  const L = ctx.lighting
  const mobile = quality.id === 'mobile'
  const detail = mobile ? 'lite' : 'full'
  const signs = buildSignage(world, detail)
  // 軒と建物の角をなぞる管と、看板を縁取る管
  const tubes = [...buildNeonTubes(world, detail), ...buildSignTubes(signs, detail)]
  const atlas = createSignAtlas(mobile ? 2048 : 4096)
  // 夜だけ: 暗い板に管の文字を書いた絵（店の看板と袖看板）
  const nightAtlas = L.neonSpill > 0 ? createNightAtlas(mobile ? 2048 : 4096) : null
  const disposables: { dispose: () => void }[] = nightAtlas ? [atlas, nightAtlas] : [atlas]
  const meshes: THREE.Mesh[] = []
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, order = 0) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.matrixAutoUpdate = false
    // 街じゅうに散らばる1つの形なので、視錐台での間引きはしない
    mesh.frustumCulled = false
    mesh.renderOrder = order
    scene.add(mesh)
    meshes.push(mesh)
    disposables.push(geometry, material)
  }

  // 看板
  const bufs: SignBufs = { boards: emptyBuf(), tubeBoards: emptyBuf(), visions: emptyBuf(), words: emptyBuf() }
  const uvOf = (key: string, tube: boolean) => (tube && nightAtlas ? nightAtlas.uv(key) : atlas.uv(key))
  // 夜の絵が無いとき（昼）は昼の明るさで並べる
  const neonLevel = nightAtlas ? L.neon : Math.min(L.neon, 0.95)
  const wordTexture = createNeonWordTexture(mobile ? 1024 : 2048)
  disposables.push(wordTexture)
  signs.forEach((s, i) => pushSign(bufs, s, uvOf, wordTexture.uv, neonLevel, quality.post, i))
  add('gto-signs', toGeometry(bufs.boards, false), new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }))
  if (nightAtlas && bufs.tubeBoards.idx.length > 0) {
    add('gto-signs-tubes', toGeometry(bufs.tubeBoards, false), new THREE.MeshBasicMaterial({ map: nightAtlas.texture, vertexColors: true }))
  }
  let visionTexture: THREE.CanvasTexture | null = null
  if (bufs.visions.idx.length > 0) {
    visionTexture = createVisionTexture(mobile ? 512 : 1024)
    disposables.push(visionTexture)
    const material = new THREE.MeshBasicMaterial({ map: visionTexture })
    // 夜は画面として光るが、ブルームには乗せない（白く飛ぶ色面にしない）。昼はほかの看板と同じ
    material.color.setScalar(L.lampsOn ? 0.8 : Math.min(L.neon, 0.95))
    add('gto-visions', toGeometry(bufs.visions, false), material)
  }

  // ネオン管。灯の入らない昼は、色の抜けた管として見せる
  const night = L.neonSpill > 0
  if (tubes.length > 0) {
    const tubeBuf = emptyBuf()
    for (const t of tubes) {
      const c = cssLinear(t.color)
      // 夜は芯が白く飛ぶ明るさ（外側の色はブルームと壁の色で出す）
      const col: Rgb = night ? [c[0] * 2.1 + 0.9, c[1] * 2.1 + 0.9, c[2] * 2.1 + 0.9] : [c[0] * 0.45 + 0.2, c[1] * 0.45 + 0.2, c[2] * 0.45 + 0.2]
      pushTube(tubeBuf, t, col)
    }
    add('gto-neon-tubes', toGeometry(tubeBuf, false), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
  }

  // 筆記体のネオン文字。夜は芯が白く飛ぶ明るさ、昼は灯の入っていない薄い管
  if (bufs.words.idx.length > 0) {
    const material = new THREE.MeshBasicMaterial({ map: wordTexture.texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })
    material.color.setScalar(night ? (quality.post ? WORD_GAIN.night : 1) : WORD_GAIN.day)
    add('gto-neon-words', toGeometry(bufs.words, false), material, 4)
  }

  // 壁と路面に落ちる色
  let bodyGlow: BodyGlow | null = null
  if (night) {
    const wash = emptyBuf()
    const strength = L.neonSpill * (quality.post ? 1 : WASH_GAIN_NO_POST)
    // 先に店先を暗く落とす（同じ形の中で先に描かれ、その上に光を足す）
    for (const f of buildStorefrontShades(world)) pushShade(wash, f)
    // 同じ壁に重なる看板は、後のものほど弱く光を落とす（加算で白く飛ばさない）
    if (!mobile) {
      const weights = spillWeights(signs)
      signs.forEach((s, i) => {
        if (weights[i] >= 0.08) pushSignWash(wash, s, strength * weights[i])
      })
    }
    for (const t of tubes) pushTubeWash(wash, t, strength)
    // 路面と、そこに立つ人・車に落とす光の場
    const field = buildGlowField(world, buildGlowEmitters(world, signs, tubes), FIELD_CELL[mobile ? 'mobile' : 'high'])
    const ground = buildGroundGlow(world, field, strength * GLOW.ground, SHAPE.ground)
    bodyGlow = createBodyGlow(ctx, field, L.neonSpill * GLOW.body * (quality.post ? 1 : 0.5), mobile ? { people: 24, cars: 12, range: 45 } : { people: 80, cars: 32, range: 90 })
    if (wash.idx.length > 0) {
      const fog = scene.fog instanceof THREE.Fog ? scene.fog : null
      const fogUniforms = { fogNear: { value: fog?.near ?? quality.drawDistance * 0.1 }, fogFar: { value: fog?.far ?? quality.drawDistance } }
      const defines = { TINT_MAX: TINT_TUNING.max, TINT_BOOST: TINT_TUNING.boost, TINT_CUT: TINT_TUNING.cut }
      const washGeometry = toGeometry(wash, true)
      // 染める（足す前に描く）。PC だけ（重ね塗りが倍になるので、軽量設定では足すだけにする）
      if (!mobile) {
        const tint = new THREE.ShaderMaterial({
          vertexShader: WASH_VERTEX,
          fragmentShader: WASH_FRAGMENT,
          defines,
          uniforms: { ...fogUniforms, tintPass: { value: 1 }, tintGain: { value: TINT_GAIN / Math.max(strength, 1e-4) } },
          vertexColors: true,
          // 色 = 下の色 × 光の色 ＋ 下の色 × 残す割合（アルファ）
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.DstColorFactor,
          blendDst: THREE.SrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        })
        add('gto-sign-tint', washGeometry, tint, 1)
        if (ground) {
          // 路面は場の値そのものに比例して染める（壁の光と同じ倍率だと、通りぜんたいが同じ濃さの色面になる）
          const groundTint = tint.clone()
          groundTint.uniforms.tintGain.value = GROUND_TINT_GAIN / Math.max(strength * GLOW.ground, 1e-4)
          add('gto-sign-ground-tint', ground, groundTint, 1)
        }
      }
      const material = new THREE.ShaderMaterial({
        vertexShader: WASH_VERTEX,
        fragmentShader: WASH_FRAGMENT,
        defines,
        uniforms: { ...fogUniforms, tintPass: { value: 0 }, tintGain: { value: 0 } },
        vertexColors: true,
        // 色 = 下の色 ×（1 − 覆う割合）＋ 光の色（覆う割合 0 なら加算と同じ）
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
      add('gto-sign-wash', washGeometry, material, 2)
      if (ground) add('gto-sign-ground', ground, material, 2)
    }
  }

  let step = -1
  return {
    update: (frame) => {
      bodyGlow?.update(frame)
      if (!visionTexture) return
      // ビジョンは数秒ごとに次の絵へ切り替える
      const next = Math.floor(frame.now / VISION_HOLD)
      if (next === step) return
      step = next
      visionTexture.offset.set((next % VISION_GRID) / VISION_GRID, (Math.floor(next / VISION_GRID) % VISION_GRID) / VISION_GRID)
    },
    dispose: () => {
      bodyGlow?.dispose()
      for (const mesh of meshes) scene.remove(mesh)
      for (const d of disposables) d.dispose()
    },
  }
}
