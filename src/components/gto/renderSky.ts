// Grand Theft Outfit [部品: light] 空・光・霧・ポストプロセス。光と空と色調はここ1か所で決める。
// 入口: createSkyRenderer(ctx)
// 契約: lighting.ts の数字を three に写す。最後の1枚を描く（render）のもここ。
//       ほかの描画部品は自分の材質だけを持ち、光源・霧・トーンマッピングには触らない。
//       色調（gradeGlsl）は lighting.ts の gradeColor と同じ式。ポストプロセスのある画質では最後の1枚に、
//       無い画質（スマホ）では three のトーンマッピングの差し込み口に同じ関数を入れて、見た目をそろえる。
//       夜と夕方は、街灯・ネオン・店先・尾灯の光だまりと、近くの街灯の光源を足す（renderSkyPools.ts）。
//       街灯の灯具のまわりには光の暈を重ねる（renderSkyHalos.ts）。
//       大気のかすみ（scatterGlsl）は lightingLocal.ts の scatterAmount / scatterTint と同じ式。ポストプロセスのある画質では
//       奥行きを読んで最後の1枚に掛け（遠いほど霞み、輪郭もぼける）、無い画質では空と霧の色を太陽の向きへ寄せて近い見た目にする。
//       逆光のにじみ（shaftsGlsl）は lightingLocal.ts の sunGlare と同じ式。太陽へ向かう途中に見える空の割合だけ、
//       太陽の色を建物や車の上へあふれさせる（ポストプロセスのある画質だけ）。
//       路面の照り返し（sheenGlsl）は lighting.ts の roadSheen と同じ式。奥行きから面の向きを戻し、上を向いた面にだけ、
//       鏡の向きに写っている空・太陽・看板の光を浅い角度ほど強く足す（ポストプロセスのある画質だけ）。
//       街灯の柱と灯具は街の部品、ヘッドライトの光だまりは車の部品が描く（強さは lighting.ts の数字を読む）。
//       天気（lib/gto/weather.ts の weatherLook）は、時刻の数字の上に毎フレーム掛ける: 空と雲と霧をくもりの色へ寄せ、直射を弱め、
//       霧で見通しを縮め、濡れた路面の照り返しを強め、稲光で空と街を一瞬照らす。晴れのときは何も変えない（GLSL に埋めた時刻の数字はそのまま）。
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { hexToLinear, SHEEN_LOBES, SHEEN_UP, SHOULDER_KNEE, type LightingParams, type Rgb } from '../../lib/gto/lighting'
import { GLARE_LOBES, scatterLobe } from '../../lib/gto/lightingLocal'
import { SHADOW_CAP } from '../../lib/gto/lightingShadow'
import { WEATHER_TONES, weatherLook } from '../../lib/gto/weather'
import { createLampHalos } from './renderSkyHalos'
import { createLightPools, createLocalLights } from './renderSkyPools'
import { installShadowCap } from './renderSkyShadow'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'

export interface SkyRenderer extends RenderPart {
  /** 最後の1枚を描く */
  render: () => void
  resize: (width: number, height: number) => void
}

/** 影の範囲（主人公の周りの半径 m） */
const SHADOW_RANGE = 120
/** ポストプロセスの無い画質で、霧の色を太陽のかすみへ寄せる割合 */
const FOG_SCATTER_NO_POST = 0.7
const f = (n: number) => n.toFixed(4)
const vec3 = (c: Rgb) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`

/** 色調の GLSL。lighting.ts の gradeColor と同じ式を、時刻の数字を埋め込んで作る */
function gradeGlsl(L: LightingParams): string {
  const g = L.grade
  return `
float gtoShoulder(float x) {
  float k = ${f(SHOULDER_KNEE)};
  return x <= k ? max(x, 0.0) : k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k)));
}
vec3 gtoGrade(vec3 c) {
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  c *= ${f(L.exposure)};
  c = vec3(gtoShoulder(c.r), gtoShoulder(c.g), gtoShoulder(c.b));
  float t = smoothstep(0.0, 0.6, dot(c, W));
  c = pow(c, vec3(${f(g.gamma)})) * mix(${vec3(g.shadowTint)}, ${vec3(g.highlightTint)}, t);
  float y = dot(c, W);
  return clamp(mix(vec3(y), c, ${f(g.saturation)}), 0.0, 1.0);
}`
}

/** 空のかすみを地平線の近くだけに絞る（高い空の色・雲・星は残す）。up は視線の上向きの成分 */
const skyHazeGlsl = (amount: number) => `float gtoSkyHaze(float up) { return ${f(amount)} * (1.0 - smoothstep(0.04, 0.42, up)); }`

/** 大気のかすみの GLSL。lightingLocal.ts の scatterAmount と scatterTint と同じ式 */
function scatterGlsl(L: LightingParams): string {
  const s = L.scatter
  return `
${skyHazeGlsl(s.sky)}
float gtoScatterLobe(float cosSun) { return pow(clamp((cosSun + ${f(s.wrap)}) / ${f(1 + s.wrap)}, 0.0, 1.0), ${f(s.power)}); }
float gtoScatterAmount(float dist, float cosSun) {
  float phase = ${f(s.ambient)} + ${f(1 - s.ambient)} * gtoScatterLobe(cosSun);
  return ${f(s.strength)} * phase * (1.0 - exp(-max(dist, 0.0) / ${f(s.length)}));
}
vec3 gtoScatterTint(float cosSun) {
  return mix(${vec3(hexToLinear(s.backColor))}, ${vec3(scaledRgb(hexToLinear(s.color), s.gain))}, gtoScatterLobe(cosSun));
}`
}

/** 逆光のにじみの段数（太陽へ向かって奥行きを読む回数） */
const SHAFT_STEPS = 16

/** 逆光のにじみの GLSL。lightingLocal.ts の sunGlare と同じ式 */
const shaftsGlsl = () => `
uniform vec2 sunUv;
uniform float shafts;
// その画素から太陽へ向かう途中で、空が見えている割合
float gtoSkyShare(vec2 uv) {
  vec2 stepUv = (sunUv - uv) * (0.9 / float(${SHAFT_STEPS}));
  // 段の縞が出ないよう、出発点を画素ごとにずらす
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 p = uv + stepUv * jitter;
  float acc = 0.0;
  for (int i = 0; i < ${SHAFT_STEPS}; i++) {
    acc += step(0.99999, texture2D(tDepth, clamp(p, 0.0, 1.0)).x);
    p += stepUv;
  }
  return acc / float(${SHAFT_STEPS});
}
float gtoGlare(float cosSun, float visible) {
  float c = max(cosSun, 0.0);
  return shafts * visible * (${GLARE_LOBES.map(([power, weight]) => `${f(weight)} * pow(c, ${f(power)})`).join(' + ')});
}`

/** 照り返しに写り込む像を読む回数（縦へ引き伸ばして、ざらついた路面の写り込みにする） */
const SHEEN_TAPS = 8
/** 写り込みの強さ（太陽の筋に対する割合）。主役は太陽の筋で、写り込みは添える程度 */
const SHEEN_SEEN = 0.3

/** 路面の照り返しの GLSL。太陽の筋は lighting.ts の roadSheen と同じ式 */
const sheenGlsl = () => `
uniform float gloss;
uniform float mirror;
uniform vec3 sheenColor;
// カメラから見たその画素の位置（向きは世界の軸）
vec3 gtoRel(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = camNear * camFar / ((camFar - camNear) * d - camFar);
  return (camForward + camRight * (uv.x * 2.0 - 1.0) + camUp * (uv.y * 2.0 - 1.0)) * (-z);
}
// 戻り値の rgb は足す光、a は「上を向いた面か」（濡れた路面を暗くするのに使う）
vec4 gtoSheen(vec2 uv, vec3 dir, float depth) {
  if (gloss <= 0.0 || depth > 0.99999) return vec4(0.0);
  // 奥行きの傾きから面の向きを戻す。上を向いた面（路面・歩道・車の屋根）だけが照り返す
  vec3 p = gtoRel(uv);
  vec3 n = normalize(cross(gtoRel(uv + vec2(texel.x, 0.0)) - p, gtoRel(uv + vec2(0.0, texel.y)) - p));
  float flatness = smoothstep(${f(SHEEN_UP[0])}, ${f(SHEEN_UP[1])}, n.y);
  if (flatness <= 0.0) return vec4(0.0);
  float vn = dot(dir, n);
  vec3 r = dir - 2.0 * vn * n;
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(-vn, 0.0, 1.0), 3.0);
  // 鏡の向きが画面のどこに当たるか
  float rf = dot(r, camForward);
  if (rf <= 0.001) return vec4(0.0, 0.0, 0.0, flatness);
  vec2 m = vec2(dot(r, camRight) / dot(camRight, camRight), dot(r, camUp) / dot(camUp, camUp)) / rf * 0.5 + 0.5;
  // 画素ごとに読む位置をずらして、段を細かい粒に散らす（粒の並びが目立たない配り方）
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 seen = vec3(0.0);
  float sky = 0.0;
  for (int i = 0; i < ${SHEEN_TAPS}; i++) {
    // 横は決まった2列（画素ごとに散らすと、細いネオン管の写り込みが櫛の歯になる）
    vec2 q = m + vec2((mod(float(i), 2.0) - 0.5) * 0.003, (float(i) + jitter) * 0.026);
    vec2 qc = clamp(q, 0.0, 1.0);
    // 画面の外（上）は、縁の色を弱めて使う
    float inside = (1.0 - smoothstep(1.0, 1.25, q.y)) * step(0.0, q.x) * step(q.x, 1.0);
    vec3 s = min(texture2D(tDiffuse, qc).rgb, vec3(4.0));
    // 乾いた路面には、光っている物（太陽のまわりの空・ネオン・灯り）だけが写る。雨で濡れると（mirror）、壁や空も写る
    seen += s * max(smoothstep(0.45, 1.3, max(s.r, max(s.g, s.b))), mirror) * inside;
    sky += step(0.99999, texture2D(tDepth, qc).x);
  }
  float c = max(dot(r, sunDir), 0.0);
  float lobes = ${SHEEN_LOBES.map(([power, weight]) => `${f(weight)} * pow(c, ${f(power)})`).join(' + ')};
  return vec4(gloss * flatness * fres * (seen * ${f(SHEEN_SEEN)} / float(${SHEEN_TAPS}) + sheenColor * lobes * (sky / float(${SHEEN_TAPS}))), flatness);
}`

const scaledRgb = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]

/**
 * 壁の発光（窓・店先）を整える GLSL。lighting.ts の windowLight と同じ式。
 * 街の壁の材質（頂点色＋発光の絵を持つ Lambert）だけに効く。絵は 8×8 スパンなので、uv×8 の整数部が窓1枚になる
 */
function windowGlsl(L: LightingParams): string {
  const w = L.windowLight
  return `
#if defined( USE_EMISSIVEMAP ) && defined( USE_COLOR )
float gtoWinHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gtoWinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(gtoWinHash(i), gtoWinHash(i + vec2(1.0, 0.0)), u.x), mix(gtoWinHash(i + vec2(0.0, 1.0)), gtoWinHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 gtoWindowLight(vec3 e, vec2 uv) {
  float y = dot(e, vec3(0.2126, 0.7152, 0.0722));
  if (y <= 0.0) return vec3(0.0);
  float h = gtoWinHash(floor(uv * 8.0));
  // 面の中をゆっくり変わるむら（窓 2〜3 枚ぶんの大きさ）
  float mottle = gtoWinNoise(uv * 2.9 + 3.1);
  vec3 tint = h > ${f(1 - w.coolShare)} ? ${vec3(w.cool)} : ${vec3(w.warm)};
  return e * (min(y, ${f(w.cap)}) / y) * tint * (1.0 - ${f(w.vary)} * (1.0 - mottle));
}
#endif`
}

/**
 * 上を向いた面（路面・歩道・車の屋根）の明るさの持ち上げ。lighting.ts の groundLift と同じ式。
 * 光を受けたあとの拡散光に掛ける（どの画質でも同じ。発光と看板には掛からない）
 */
const liftGlsl = (L: LightingParams) => `
{
  float gtoFlat = smoothstep(${f(SHEEN_UP[0])}, ${f(SHEEN_UP[1])}, dot(normal, normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0))));
  float gtoLit = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  float gtoLift = 1.0 + gtoFlat * ${f(L.groundLift.gain)} / (1.0 + ${f(L.groundLift.soft)} * max(gtoLit, 0.0));
  reflectedLight.directDiffuse *= gtoLift;
  reflectedLight.indirectDiffuse *= gtoLift;
}`

// three のシェーダの部品に、色調（トーンマッピングの差し込み口 CustomToneMapping）と壁の発光の整え方を入れる。
// 部品は全体で1つなので、使っている画面の数を数えて、最後の1つが閉じたら元へ戻す。
const CUSTOM_SLOT = 'vec3 CustomToneMapping( vec3 color ) { return color; }'
const chunkOriginal = {
  tone: THREE.ShaderChunk.tonemapping_pars_fragment,
  emissivePars: THREE.ShaderChunk.emissivemap_pars_fragment,
  emissive: THREE.ShaderChunk.emissivemap_fragment,
  lightsEnd: THREE.ShaderChunk.lights_fragment_end,
}
let chunkUsers = 0

function installChunks(grade: string, windows: string, lift: string): () => void {
  chunkUsers++
  THREE.ShaderChunk.tonemapping_pars_fragment = chunkOriginal.tone.replace(CUSTOM_SLOT, `${grade}\nvec3 CustomToneMapping( vec3 color ) { return gtoGrade( color ); }`)
  THREE.ShaderChunk.emissivemap_pars_fragment = `${chunkOriginal.emissivePars}\n${windows}`
  THREE.ShaderChunk.emissivemap_fragment = `${chunkOriginal.emissive}
#if defined( USE_EMISSIVEMAP ) && defined( USE_COLOR )
  totalEmissiveRadiance = gtoWindowLight( totalEmissiveRadiance, vEmissiveMapUv );
#endif`
  THREE.ShaderChunk.lights_fragment_end = `${chunkOriginal.lightsEnd}\n${lift}`
  return () => {
    chunkUsers--
    if (chunkUsers > 0) return
    THREE.ShaderChunk.lights_fragment_end = chunkOriginal.lightsEnd
    THREE.ShaderChunk.tonemapping_pars_fragment = chunkOriginal.tone
    THREE.ShaderChunk.emissivemap_pars_fragment = chunkOriginal.emissivePars
    THREE.ShaderChunk.emissivemap_fragment = chunkOriginal.emissive
  }
}

const SKY_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // いちばん奥に描く
}`

const skyFragment = (scatter: string) => `
${scatter}
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunGlow;
uniform float sunCore;
uniform float wxTint;
uniform float clouds;
uniform vec3 cloudColor;
uniform float stars;
uniform vec3 cityGlow;
uniform float now;
uniform float flash;
uniform vec3 wxColor;
uniform float wxHaze;
varying vec3 vDir;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // 地平線の近くは霧と同じ色の帯にして、遠くの建物がそこへ溶けるようにする
  float k = smoothstep(0.03, 0.8, up);
  vec3 col = mix(horizon, top, pow(k, 0.65));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  float low = 1.0 - smoothstep(0.0, 0.55, up);
  // 太陽のある側の空を太陽の色へ寄せる
  col = mix(col, sunColor, sunGlow * pow(s, 5.0) * 0.32 * (0.35 + 0.65 * low));
  // 街の明かりの照り返し
  col += cityGlow * exp(-max(up, 0.0) * 5.0);
  float cover = 0.0;
  if (clouds > 0.0 && up > 0.02) {
    vec2 p = d.xz / (up + 0.14) * 1.25 + vec2(now * 0.006, now * 0.002);
    float n = fbm(p);
    cover = smoothstep(1.0 - clouds * 0.75, 1.08 - clouds * 0.45, n + 0.32) * smoothstep(0.02, 0.22, up);
    vec3 lit = cloudColor * (0.82 + 0.3 * n) + sunColor * sunGlow * pow(s, 3.0) * 0.22;
    col = mix(col, lit, cover * 0.85);
  }
  if (stars > 0.0) {
    vec3 cell = floor(d * 190.0);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(0.85, 0.9, 1.0) * step(0.9982, h) * stars * smoothstep(0.08, 0.45, up) * (1.0 - cover) * (0.5 + 0.5 * fract(h * 917.0));
  }
  // 太陽（夜は月）の円盤と光芒
  col += sunColor * sunGlow * (smoothstep(0.99935, 0.9997, s) * 3.0 + pow(s, 260.0) * 1.2 + pow(s, 28.0) * 0.28) * (1.0 - cover * 0.7);
  // 太陽の芯。空の中でここだけが白く飛ぶ（光がどこから来ているかの基準点になる）
  col += mix(sunColor, vec3(1.0), 0.7) * sunCore * (smoothstep(0.9995, 0.9999, s) * 4.0 + pow(s, 1800.0) * 1.6 + pow(s, 420.0) * 0.5) * (1.0 - cover * 0.6);
  if (up < 0.0) col = horizon;
  // 稲光。雲の厚い所ほど明るく光る
  col += vec3(0.62, 0.7, 0.92) * flash * (0.45 + 0.55 * cover);
  #ifdef SKY_SCATTER
  // ポストプロセスの無い画質では、空のかすみをここで掛ける（ある画質では最後の1枚で掛ける）
  float cosSun = dot(d, normalize(sunDir));
  col = mix(col, mix(gtoScatterTint(cosSun), wxColor, wxTint), gtoScatterAmount(1.0e6, cosSun) * gtoSkyHaze(up));
  // 天気のかすみ（霧の日は空ごと霧の色になる）
  col = mix(col, wxColor, wxHaze);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const FINAL_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const finalFragment = (grade: string, scatter: string) => `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float camNear;
uniform float camFar;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform vec3 veilColor;
uniform float veil;
uniform float vignette;
uniform vec3 glareColor;
uniform vec2 texel;
uniform float soften;
uniform vec3 wxColor;
uniform float wxTint;
uniform float wxHaze;
uniform float wxLength;
uniform float wxGray;
uniform float wetDark;
varying vec2 vUv;
${grade}
${scatter}
${shaftsGlsl()}
${sheenGlsl()}
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  // 大気のかすみ。奥行きから距離を戻し、遠い物ほど・太陽の方角ほど霧の色へ溶かす
  float depth = texture2D(tDepth, vUv).x;
  float viewZ = camNear * camFar / ((camFar - camNear) * depth - camFar);
  vec3 ray = camForward + camRight * (vUv.x * 2.0 - 1.0) + camUp * (vUv.y * 2.0 - 1.0);
  vec3 dir = normalize(ray);
  float cosSun = dot(dir, sunDir);
  // 空は地平線の近くだけ霞ませる
  float dist = -viewZ * length(ray);
  float haze = gtoScatterAmount(dist, cosSun) * mix(1.0, gtoSkyHaze(dir.y), step(0.99999, depth));
  // 天気のかすみ（霧と雨）。時刻のかすみと違い、空にもそのまま掛かる
  float wx = wxHaze * (1.0 - exp(-dist / wxLength));
  if (soften > 0.0) {
    // かすみの濃い所は輪郭もぼかす（遠くのビルと手前の街路樹で輪郭の硬さを変える）
    vec2 o = texel * soften * smoothstep(0.2, 0.75, max(haze, wx));
    c = c * 0.36 + 0.16 * (texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb);
  }
  // 路面の照り返し（かすみの手前の、面そのものの光）
  vec4 sheen = gtoSheen(vUv, dir, depth);
  // 濡れた路面は地の色が沈み、その上に照り返しが乗る
  c = c * (1.0 - wetDark * sheen.a) + sheen.rgb;
  // くもりと霧の日は、かすみの色も太陽の色から灰色へ寄る
  c = mix(c, mix(gtoScatterTint(cosSun), wxColor, wxTint), haze);
  c = mix(c, wxColor, wx);
  // 逆光のにじみ。太陽の見えている方角では、空の光が建物の輪郭や車の上へあふれる
  if (shafts > 0.0) c += glareColor * gtoGlare(cosSun, gtoSkyShare(vUv));
  // 太陽の方を向いたときの逆光。画面全体が太陽の色へ寄る
  c = c * (1.0 - veil * 0.25) + veilColor * veil;
  // くもり空の下では色が抜ける
  c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), wxGray);
  c = gtoGrade(c);
  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * smoothstep(0.18, 0.8, dot(q, q) * 2.0);
  gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
}`

export function createSkyRenderer(ctx: RenderCtx): SkyRenderer {
  const { scene, camera, renderer, quality } = ctx
  const L = ctx.lighting
  const T = WEATHER_TONES[ctx.time]
  const far = quality.drawDistance
  const fogNear = far * L.fogNear
  const fogFar = far * L.fogFar
  const grade = gradeGlsl(L)
  const scatter = scatterGlsl(L)

  // ポストプロセスが無い画質では、各材質のトーンマッピングとして色調を掛ける
  const uninstallGrade = installChunks(grade, windowGlsl(L), liftGlsl(L))
  // 影を落とす側の高さを丸める（ビルの陰で路面が一面の陰にならないように）
  const uninstallShadowCap = quality.shadows ? installShadowCap(ctx.world, SHADOW_CAP[ctx.time]) : null
  renderer.toneMapping = quality.post ? THREE.NoToneMapping : THREE.CustomToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = quality.shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const fog = new THREE.Fog(L.fogColor, fogNear, fogFar)
  const background = new THREE.Color(L.fogColor)
  scene.fog = fog
  scene.background = background
  // 晴れの色と、くもりの色（天気でこの間を行き来する）
  const clear = { fog: new THREE.Color(L.fogColor), top: new THREE.Color(L.skyTop), horizon: new THREE.Color(L.skyHorizon), cloud: new THREE.Color(L.cloudColor), hemi: new THREE.Color(L.hemiSky), sun: new THREE.Color(L.sunColor) }
  const gray = { fog: new THREE.Color(T.fog), top: new THREE.Color(T.skyTop), horizon: new THREE.Color(T.skyHorizon), cloud: new THREE.Color(T.cloud), hemi: new THREE.Color(T.hemi) }
  const fogBase = new THREE.Color(L.fogColor)
  const fogSun = new THREE.Color(L.scatter.color).multiplyScalar(Math.min(1, L.scatter.gain))
  const fogBack = new THREE.Color(L.scatter.backColor)
  const fogTint = new THREE.Color()
  camera.near = 0.3
  camera.far = far * 1.5
  camera.updateProjectionMatrix()

  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity)
  const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity)
  const sunDir = new THREE.Vector3(...L.sunDir).normalize()
  // 光と影を落とす向き（空に描く太陽の向きとは別に持てる）
  const lightDir = new THREE.Vector3(...(L.lightDir ?? L.sunDir)).normalize()
  sun.castShadow = quality.shadows
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    const cam = sun.shadow.camera
    cam.left = cam.bottom = -SHADOW_RANGE
    cam.right = cam.top = SHADOW_RANGE
    cam.near = 1
    cam.far = 900
    cam.updateProjectionMatrix()
    // 面の向きへのずらしは小さく（大きいと、車や柱の足元の影が路面から浮いて消える）
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.14
  }
  scene.add(hemi, sun, sun.target)

  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: skyFragment(scatter),
    defines: { CLOUD_OCTAVES: quality.id === 'mobile' ? 2 : 4, ...(quality.post ? {} : { SKY_SCATTER: 1 }) },
    uniforms: {
      top: { value: new THREE.Color(L.skyTop) },
      horizon: { value: new THREE.Color(L.skyHorizon) },
      sunDir: { value: sunDir.clone() },
      sunColor: { value: new THREE.Color(L.sunColor) },
      sunGlow: { value: L.sunGlow },
      sunCore: { value: L.sunCore },
      clouds: { value: L.clouds },
      cloudColor: { value: new THREE.Color(L.cloudColor) },
      stars: { value: L.stars },
      cityGlow: { value: new THREE.Color(L.cityGlow).multiplyScalar(L.cityGlowStrength) },
      now: { value: 0 },
      flash: { value: 0 },
      wxColor: { value: new THREE.Color(T.fog) },
      wxTint: { value: 0 },
      wxHaze: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
  const skyGeometry = new THREE.SphereGeometry(1, 24, 12)
  const sky = new THREE.Mesh(skyGeometry, skyMaterial)
  sky.scale.setScalar(far * 1.2)
  sky.frustumCulled = false
  sky.renderOrder = -10
  scene.add(sky)

  const pools = L.lampsOn ? createLightPools(ctx, fogNear, fogFar) : null
  const localLights = createLocalLights(ctx)
  const halos = createLampHalos(ctx, fogNear, fogFar)

  let composer: EffectComposer | null = null
  let bloom: UnrealBloomPass | null = null
  let finalMaterial: THREE.ShaderMaterial | null = null
  if (quality.post) {
    // 明るさを 1 より上まで持てる板に描き、ブルームのあとで色調を掛ける。縁のぎざぎざは板の側で均す
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.antialias ? 4 : 0 })
    // かすみを掛けるために奥行きも持つ
    target.depthTexture = new THREE.DepthTexture(1, 1)
    composer = new EffectComposer(renderer, target)
    composer.addPass(new RenderPass(scene, camera))
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), L.bloom.strength, L.bloom.radius, L.bloom.threshold)
    composer.addPass(bloom)
    finalMaterial = new THREE.ShaderMaterial({
      vertexShader: FINAL_VERTEX,
      fragmentShader: finalFragment(grade, scatter),
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        camNear: { value: camera.near },
        camFar: { value: camera.far },
        camForward: { value: new THREE.Vector3() },
        camRight: { value: new THREE.Vector3() },
        camUp: { value: new THREE.Vector3() },
        sunDir: { value: sunDir.clone() },
        veilColor: { value: new THREE.Color(L.sunColor).multiplyScalar(0.55) },
        veil: { value: 0 },
        vignette: { value: L.grade.vignette },
        glareColor: { value: new THREE.Color(L.sunColor) },
        texel: { value: new THREE.Vector2(1, 1) },
        soften: { value: L.hazeSoften },
        sunUv: { value: new THREE.Vector2(0.5, 0.5) },
        shafts: { value: 0 },
        gloss: { value: L.roadGloss },
        mirror: { value: 0 },
        sheenColor: { value: new THREE.Color(L.sunColor) },
        wxColor: { value: new THREE.Color(T.fog) },
        wxTint: { value: 0 },
        wxHaze: { value: 0 },
        wxLength: { value: 400 },
        wxGray: { value: 0 },
        wetDark: { value: 0 },
      },
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    })
    composer.addPass(new ShaderPass(finalMaterial))
  }

  const texel = (SHADOW_RANGE * 2) / Math.max(1, quality.shadowMapSize)
  const forward = new THREE.Vector3()
  const sunPoint = new THREE.Vector3()
  return {
    update: (frame: FrameInfo) => {
      const p = frame.state.player
      sky.position.copy(camera.position)
      skyMaterial.uniforms.now.value = frame.now
      // ---- 天気: 時刻の数字の上に掛ける ----
      const W = weatherLook(ctx.time, frame.weather)
      const su = skyMaterial.uniforms
      su.top.value.copy(clear.top).lerp(gray.top, W.gray)
      su.horizon.value.copy(clear.horizon).lerp(gray.horizon, W.gray)
      // 雨雲は暗い
      su.cloudColor.value.copy(clear.cloud).lerp(gray.cloud, W.gray).multiplyScalar(1 - 0.3 * frame.weather.rain * W.gray)
      su.clouds.value = L.clouds + (1 - L.clouds) * W.clouds
      su.sunGlow.value = L.sunGlow * W.sun
      su.sunCore.value = L.sunCore * W.sun
      su.stars.value = L.stars * W.stars
      su.flash.value = W.flash
      su.wxTint.value = W.gray
      su.wxHaze.value = W.haze
      sun.intensity = L.sunIntensity * W.sun
      hemi.intensity = L.hemiIntensity * W.hemi + W.flash
      hemi.color.copy(clear.hemi).lerp(gray.hemi, W.gray)
      fogBase.copy(clear.fog).lerp(gray.fog, W.gray)
      fog.near = fogNear * W.fogNear
      fog.far = fogFar * W.fogFar
      if (bloom) bloom.strength = L.bloom.strength * W.bloom
      if (quality.shadows) {
        // 影の範囲を見ている場所に付いて回らせる。影の1画素ぶんに丸めて、動いたときのちらつきを抑える
        const fx = frame.photo ? camera.position.x : p.x
        const fz = frame.photo ? camera.position.z : p.z
        const tx = Math.round(fx / texel) * texel
        const tz = Math.round(fz / texel) * texel
        sun.target.position.set(tx, p.y, tz)
        sun.position.set(tx + lightDir.x * 400, p.y + lightDir.y * 400, tz + lightDir.z * 400)
      } else {
        sun.position.copy(lightDir).multiplyScalar(400)
      }
      pools?.update(frame)
      localLights?.update(frame)
      halos?.update(frame)
      camera.getWorldDirection(forward)
      const facing = Math.max(0, forward.dot(sunDir))
      if (finalMaterial) {
        const u = finalMaterial.uniforms
        // 横を向いていても、太陽の側なら少し染まる
        u.veil.value = L.sunVeil * W.sun * THREE.MathUtils.clamp((forward.dot(sunDir) + L.scatter.wrap) / (1 + L.scatter.wrap), 0, 1) ** 2
        // 太陽が画面のどこにあるか（後ろにあるときは、にじみを消す）
        const ahead = THREE.MathUtils.smoothstep(facing, 0.05, 0.3)
        u.shafts.value = L.sunShafts * W.sun * ahead
        u.gloss.value = L.roadGloss + W.gloss
        u.mirror.value = W.mirror
        // くもると太陽の筋は消え、写り込みだけが残る
        u.sheenColor.value.copy(clear.sun).multiplyScalar(W.sun)
        u.wxTint.value = W.gray
        u.wxHaze.value = W.haze
        u.wxLength.value = W.hazeLength
        u.wxGray.value = W.desaturate
        u.wetDark.value = W.wetDark
        fog.color.copy(fogBase)
        background.copy(fogBase)
        if (ahead > 0) {
          sunPoint.copy(camera.position).addScaledVector(sunDir, 1000).project(camera)
          u.sunUv.value.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5)
        }
        // 画面の各点の視線を戻すための、カメラの向きと画角
        const tan = Math.tan((camera.fov * Math.PI) / 360)
        u.camNear.value = camera.near
        u.camFar.value = camera.far
        u.camForward.value.copy(forward)
        u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(tan * camera.aspect)
        u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(tan)
      } else {
        // 奥行きを読めない画質では、霧の色ごと太陽の向きへ寄せる（画面の中の濃淡は出ない）
        const s = L.scatter
        const lobe = scatterLobe(forward.dot(sunDir), s)
        // くもりと霧の日は、太陽の色へは寄せない
        const k = s.strength * (s.ambient + (1 - s.ambient) * lobe) * FOG_SCATTER_NO_POST * (1 - W.gray)
        fog.color.copy(fogBase).lerp(fogTint.copy(fogBack).lerp(fogSun, lobe), k)
        background.copy(fog.color)
      }
    },
    render: () => {
      if (composer && finalMaterial) {
        // 街を描いた板（色と奥行き）は readBuffer に残る
        finalMaterial.uniforms.tDepth.value = composer.readBuffer.depthTexture
        composer.render()
      } else renderer.render(scene, camera)
    },
    resize: (width, height) => {
      composer?.setPixelRatio(renderer.getPixelRatio())
      composer?.setSize(width, height)
      bloom?.resolution.set(width, height)
      const ratio = renderer.getPixelRatio()
      finalMaterial?.uniforms.texel.value.set(1 / Math.max(1, width * ratio), 1 / Math.max(1, height * ratio))
    },
    dispose: () => {
      scene.remove(hemi, sun, sun.target, sky)
      skyGeometry.dispose()
      skyMaterial.dispose()
      sun.shadow.map?.dispose()
      pools?.dispose()
      localLights?.dispose()
      halos?.dispose()
      finalMaterial?.dispose()
      composer?.dispose()
      scene.fog = null
      uninstallGrade()
      uninstallShadowCap?.()
    },
  }
}
