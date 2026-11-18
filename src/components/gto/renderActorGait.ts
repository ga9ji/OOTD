// Grand Theft Outfit [部品: onfoot の見た目] くり抜きスプライトを「体が動いている」ように見せる仕掛け。
// 入口: makeGaitGeometry / applyGait / gaitUniform / setRig / makeBlobTexture
// 契約: 板を細かく割っておき、頂点シェーダで「脚2本・腕2本・腰から上」に分けて紙人形のように曲げる。
//       関節の角度は src/lib/gto/onFootPose.ts の BodyPose（歩き・走り・乗り降り）をそのまま受け取る。
//       足の裏（板の下端）は、接地している脚では動かない。板そのものを上下させないので足が滑らない。
//       [outfit] renderOutfitFx.ts は GaitUniform の value を copy して縁取りの板を重ねる。
//       value は RigValue（Vector4 の拡張）で、copy すると関節ぶんも一緒に写る。
import * as THREE from 'three'
import type { BodyPose } from '../../lib/gto/onFootPose'

/** 体の区切り（板の高さに対する割合）と、関節の横位置（板の幅に対する割合） */
export const RIG_STYLE = {
  hip: 0.49,
  knee: 0.27,
  shoulder: 0.8,
  elbow: 0.63,
  hipX: 0.16,
  shoulderX: 0.3,
  elbowX: 0.38,
  /** 腕とみなす、板の中心からの横の距離（ここから外） */
  armFrom: 0.25,
  armTo: 0.36,
  /** 腕とみなす高さの下端（手先） */
  handLow: 0.36,
  handHigh: 0.44,
  /** 腰を落としたとき、膝が外へ開く量（落とした高さに対する割合） */
  kneeSplay: 0.45,
  /** 左右の脚がこれ以上離れたら（身長に対する割合）、あいだの布を抜いて股を割る */
  split: 0.03,
  /** 足を上げる割合（lift）を、すねとももの縮みへ割り振る倍率 */
  shinFold: 1.9,
  shinFoldMax: 0.85,
  thighFold: 0.35,
}

/** 板の割り数（横・縦）。横は奇数（真ん中の1列が左右の脚の境目になる）。スマホは粗く */
export const RIG_SEGMENTS = { high: [13, 26], mobile: [9, 18] } as const

/** 足元が原点の、細かく割った板。左右の脚の境目（体の中心を含む1列）はシェーダが uRigMeta から決める */
export function makeGaitGeometry(mobile = false): THREE.PlaneGeometry {
  const [sx, sy] = mobile ? RIG_SEGMENTS.mobile : RIG_SEGMENTS.high
  const g = new THREE.PlaneGeometry(1, 1, sx, sy)
  g.translate(0, 0.5, 0)
  return g
}

/**
 * 1人ぶんの姿勢。本体（Vector4）= (板の縦横比, 上体の横の傾き, 前かがみ, 腰の沈み)。
 * copy すると関節（legL / legR / arms）も写る。
 */
export class RigValue extends THREE.Vector4 {
  /** 左脚・右脚 = (付け根の振り, 膝の曲げ, 畳む割合, 体の幅の縮み) */
  readonly legL = new THREE.Vector4()
  readonly legR = new THREE.Vector4()
  /** 腕 = (左肩, 左肘, 右肩, 右肘) */
  readonly arms = new THREE.Vector4()
  /** (体の中心の横位置 u 0..1, 境目とみなす幅 u, 未使用, 未使用)。写真の中で人が片側に寄っていても、脚の分かれ目を体の中心に合わせる */
  readonly meta = new THREE.Vector4(0.5, 0.5 / RIG_SEGMENTS.high[0], 0, 0)

  copy(v: THREE.Vector4): this {
    super.copy(v)
    if (v instanceof RigValue) {
      this.legL.copy(v.legL)
      this.legR.copy(v.legR)
      this.arms.copy(v.arms)
      this.meta.copy(v.meta)
    }
    return this
  }
}

export type GaitUniform = { value: THREE.Vector4 }
export const gaitUniform = (): GaitUniform => ({ value: new RigValue(0.4, 0, 0, 0) })

/** 姿勢を uniform へ書く。aspect は板の幅÷高さ（回転で体が歪まないようにするため） */
export function setRig(uniform: GaitUniform, pose: BodyPose, aspect: number, centerU = 0.5, mobile = false): void {
  const v = uniform.value
  v.set(Math.max(0.05, aspect), pose.bend, pose.hunch, pose.drop)
  if (!(v instanceof RigValue)) return
  v.legL.set(pose.hipL, pose.kneeL, pose.liftL, pose.twist)
  v.legR.set(pose.hipR, pose.kneeR, pose.liftR, pose.twist)
  v.arms.set(pose.armL, pose.foreL, pose.armR, pose.foreR)
  // 境目は「体の中心を含む1列」の両端の頂点（列の幅より少し狭く取ると、ちょうど2列が当たる）
  v.meta.set(centerU, 0.98 / (mobile ? RIG_SEGMENTS.mobile[0] : RIG_SEGMENTS.high[0]), 0, 0)
}

const s = RIG_STYLE
const f = (n: number) => n.toFixed(3)
const HEAD = /* glsl */ `
varying vec2 vGtoSeam;
uniform vec4 uGait;
uniform vec4 uRigLegL;
uniform vec4 uRigLegR;
uniform vec4 uRigArms;
uniform vec4 uRigMeta;
vec2 gtoRot(vec2 p, vec2 o, float a) {
  float sn = sin(a);
  float cs = cos(a);
  vec2 d = p - o;
  return o + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
}
// 片脚: 膝から下を曲げ、すねを膝へ畳み、付け根で振る
vec2 gtoLeg(vec2 p, float hx, vec3 r) {
  vec2 knee = vec2(hx, ${f(s.knee)});
  float below = 1.0 - smoothstep(${f(s.knee - 0.05)}, ${f(s.knee + 0.03)}, p.y);
  vec2 q = mix(p, gtoRot(p, knee, r.y), below);
  vec2 hip = vec2(hx, ${f(s.hip)});
  // 畳むのは主にすね（かかとが尻へ上がる蹴り上げ）。ももは少しだけ短く見せる
  q.y = knee.y - (knee.y - q.y) * (1.0 - min(r.z * ${f(s.shinFold)}, ${f(s.shinFoldMax)}) * step(q.y, knee.y));
  q.y = hip.y - (hip.y - q.y) * (1.0 - r.z * ${f(s.thighFold)});
  return gtoRot(q, hip, r.x);
}
`

const BODY = /* glsl */ `
{
  float gAsp = uGait.x;
  // 体の中心が u=0.5 に来るようにずらして考える（板の原点も体の中心へ寄せる）
  float gu = uv.x - uRigMeta.x + 0.5;
  float gv = uv.y;
  // 高さを 1 とした座標で曲げる（幅と高さの倍率が違っても回転で歪まない）
  vec2 p = vec2((transformed.x - uRigMeta.x + 0.5) * gAsp, transformed.y);

  // 脚: 板の左半分が左脚、右半分が右脚
  float wLeg = 1.0 - smoothstep(${f(s.hip - 0.07)}, ${f(s.hip + 0.02)}, gv);
  float hx = gAsp * ${f(s.hipX)};
  vec2 legL = gtoLeg(p, -hx, uRigLegL.xyz);
  vec2 legR = gtoLeg(p, hx, uRigLegR.xyz);
  vec2 legP = gu < 0.5 ? legL : legR;
  // 境目の列では、左右の脚の離れ具合を渡す（離れたら断片シェーダで抜く）
  vGtoSeam = vec2(step(abs(gu - 0.5), uRigMeta.y), length(legL - legR) * wLeg);

  // 腕: 胴の高さの、板の端のほう。肘から先を曲げ、肩で振る
  float gSign = gu < 0.5 ? -1.0 : 1.0;
  float wArm = smoothstep(${f(s.armFrom)}, ${f(s.armTo)}, abs(gu - 0.5))
    * (1.0 - smoothstep(${f(s.shoulder - 0.04)}, ${f(s.shoulder + 0.02)}, gv))
    * smoothstep(${f(s.handLow)}, ${f(s.handHigh)}, gv);
  vec2 gArm = gu < 0.5 ? uRigArms.xy : uRigArms.zw;
  vec2 elbow = vec2(gSign * gAsp * ${f(s.elbowX)}, ${f(s.elbow)});
  vec2 shoulder = vec2(gSign * gAsp * ${f(s.shoulderX)}, ${f(s.shoulder)});
  float wFore = 1.0 - smoothstep(${f(s.elbow - 0.04)}, ${f(s.elbow + 0.03)}, gv);
  vec2 armP = gtoRot(mix(p, gtoRot(p, elbow, gArm.y), wFore), shoulder, gArm.x);

  vec2 q = mix(mix(p, armP, wArm), legP, wLeg);

  // 腰から上: 前かがみ（縮む）と、横への傾き（背骨が曲がるように、上ほど大きく）
  float up = smoothstep(${f(s.hip - 0.04)}, ${f(s.hip + 0.1)}, gv);
  q.y -= max(q.y - ${f(s.hip)}, 0.0) * uGait.z * up;
  q = mix(q, gtoRot(q, vec2(0.0, ${f(s.hip)}), uGait.y), smoothstep(${f(s.hip - 0.02)}, ${f(s.hip + 0.3)}, gv));

  // 腰を落とす: 腰から上はそのまま下がり、脚は縮んで膝が外へ開く
  float gLow = clamp(q.y / ${f(s.hip)}, 0.0, 1.0);
  q.y -= uGait.w * gLow;
  q.x += gSign * uGait.w * ${f(s.kneeSplay)} * 4.0 * gLow * (1.0 - gLow) * wLeg;

  // 体をひねる（幅が縮む）
  q.x *= 1.0 - uRigLegL.w;

  transformed.x = q.x / gAsp;
  transformed.y = q.y;
}
`

/** 脚が開いたら、あいだに引き伸ばされた布を抜く（スカートのように広がって見えないように） */
const SPLIT = /* glsl */ `if (vGtoSeam.x > 0.9 && vGtoSeam.y > ${f(s.split)}) discard;`

/** 材質の頂点シェーダへ体の変形を差し込む（影用の深度材質にも同じものを使える） */
export function applyGait(material: THREE.Material, uniform: GaitUniform): void {
  // 関節ぶんを持たない入れ物を渡されたら、ここで持たせる（copy で関節も写るように）
  if (!(uniform.value instanceof RigValue)) uniform.value = new RigValue().copy(uniform.value)
  const rig = uniform.value as RigValue
  const legL = { value: rig.legL }
  const legR = { value: rig.legR }
  const arms = { value: rig.arms }
  const meta = { value: rig.meta }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGait = uniform
    shader.uniforms.uRigLegL = legL
    shader.uniforms.uRigLegR = legR
    shader.uniforms.uRigArms = arms
    shader.uniforms.uRigMeta = meta
    shader.vertexShader = HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${BODY}`)
    shader.fragmentShader = `varying vec2 vGtoSeam;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>\n${SPLIT}`)
  }
  material.customProgramCacheKey = () => 'gto-rig2'
}

/** 足元の丸い影（中心が濃く、縁へ向かって消える） */
export function makeBlobTexture(): THREE.Texture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
      const a = Math.max(0, 1 - d)
      const i = (y * size + x) * 4
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = Math.round(255 * a * a * (3 - 2 * a))
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}
