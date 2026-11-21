// Grand Theft Outfit [部品: weather] 雨粒。カメラのまわりの箱の中に、落ちていく短い線を描く。
// 入口: createWeatherRenderer(ctx)
// 契約: 天気の量（FrameInfo.weather）を読むだけ。粒の位置は頂点シェーダが時刻から決める（毎フレーム配列を書き換えない）。
//       箱はカメラに付いて回り、外へ出た粒は反対側から入り直す。描くのは1回（線分の束）。
//       空・光・霧・路面の濡れは renderSky.ts が受け持つ。屋根やガードの下でも降る（遮る物は調べない）。
import * as THREE from 'three'
import { WEATHER_TONES } from '../../lib/gto/weather'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'

/** 箱の大きさ m（幅・高さ・奥行き） */
const BOX: [number, number, number] = [44, 26, 44]
/** 落ちる速さ m/s と、1粒の線の長さ（秒。速さ×この秒だけ尾を引く） */
const FALL = 21
const STREAK = 0.045
/** 風がいちばん強いときに横へ流れる速さ m/s */
const DRIFT = 9

const VERTEX = `
attribute float tail;
attribute float pace;
uniform vec3 eye;
uniform vec3 box;
uniform vec3 velocity;
uniform float now;
uniform float streak;
varying float vFade;
void main() {
  vec3 v = velocity * vec3(1.0, pace, 1.0);
  // 箱の中をくり返し落ちる。カメラからの相対位置で折り返すので、箱ごとカメラに付いて回る
  vec3 p = mod(position * box + v * now - eye, box) - box * 0.5;
  p -= v * streak * tail;
  vec4 mv = viewMatrix * vec4(p + eye, 1.0);
  gl_Position = projectionMatrix * mv;
  // 箱の縁と目の前では消す（折り返しの瞬間と、画面を横切る太い線を見せない）
  float d = length(p.xz);
  vFade = smoothstep(box.x * 0.5, box.x * 0.3, d) * smoothstep(0.6, 3.0, -mv.z) * (0.55 + 0.45 * tail);
}`

const FRAGMENT = `
uniform vec3 color;
uniform float opacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(color, opacity * vFade);
  #include <colorspace_fragment>
}`

export function createWeatherRenderer(ctx: RenderCtx): RenderPart {
  const { scene, camera, quality } = ctx
  const count = quality.id === 'mobile' ? 2600 : 5200
  const tone = WEATHER_TONES[ctx.time]

  // 粒ごとに決まった乱数（位置 0..1 と速さのばらつき）。線分の上端と下端で同じ値を持つ
  const position = new Float32Array(count * 6)
  const tail = new Float32Array(count * 2)
  const pace = new Float32Array(count * 2)
  let seed = 20261121
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const x = random()
    const y = random()
    const z = random()
    const speed = 0.8 + random() * 0.4
    position.set([x, y, z, x, y, z], i * 6)
    tail.set([0, 1], i * 2)
    pace.set([speed, speed], i * 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('tail', new THREE.BufferAttribute(tail, 1))
  geometry.setAttribute('pace', new THREE.BufferAttribute(pace, 1))

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      eye: { value: new THREE.Vector3() },
      box: { value: new THREE.Vector3(...BOX) },
      velocity: { value: new THREE.Vector3(0, -FALL, 0) },
      now: { value: 0 },
      streak: { value: STREAK },
      color: { value: new THREE.Color(0xc8d6e6).multiplyScalar(tone.drop) },
      opacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const rain = new THREE.LineSegments(geometry, material)
  rain.frustumCulled = false
  // 街と人のあとに描く（手前の雨が、奥の半透明の物に消されない）
  rain.renderOrder = 30
  rain.visible = false
  scene.add(rain)

  return {
    update: (frame: FrameInfo) => {
      const w = frame.weather
      rain.visible = w.rain > 0.01
      if (!rain.visible) return
      const u = material.uniforms
      u.eye.value.copy(camera.position)
      u.now.value = frame.now
      u.velocity.value.set(ctx.wind[0] * w.wind * DRIFT, -FALL, ctx.wind[1] * w.wind * DRIFT)
      // 弱い雨は粒の数を減らす（強い雨ほど、数も濃さも増える）
      geometry.setDrawRange(0, Math.max(1, Math.round(count * Math.min(1, w.rain * 1.1))) * 2)
      // 線は画面の 1 画素幅。解像度の低い画質では、その分だけ濃くする
      u.opacity.value = (0.3 + 0.25 * w.rain) * (quality.post ? 1 : 1.5)
    },
    dispose: () => {
      scene.remove(rain)
      geometry.dispose()
      material.dispose()
    },
  }
}
