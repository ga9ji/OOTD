// Grand Theft Outfit [部品: light] 街灯の灯具のまわりの光の暈（空気が光って見える丸いにじみ）。
// 入口: createLampHalos(ctx, fogNear, fogFar)
// 契約: renderSky.ts から呼ばれる。灯具の位置（lightingLocal.ts の lampLights）に、加算で重ねる点を1つずつ置く。
//       全部で描画1回。光源は増やさない。建物の陰に入った灯りは奥行きで隠れる。
import * as THREE from 'three'
import { hexToLinear } from '../../lib/gto/lighting'
import { HALO_MAX_SCREEN, lampLights } from '../../lib/gto/lightingLocal'
import { streetProps } from '../../lib/gto/map'
import type { RenderCtx, RenderPart } from './renderTypes'

/** 暈の直径 m */
const HALO_SIZE = 7
/** ポストプロセスの無い画質では、色調を掛けたあとの色で足されるので弱める（光だまりと同じ理由） */
const HALO_GAIN_NO_POST = 0.3

// 画面上の大きさは lightingLocal.ts の haloPixels と同じ式
const HALO_VERTEX = `
uniform float pxScale;
uniform float pxMax;
uniform float fogNear;
uniform float fogFar;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 加算で重ねるので、霧は「薄くする」
  vFade = 1.0 - smoothstep(fogNear, fogFar, -mv.z);
  gl_PointSize = min(${HALO_SIZE.toFixed(1)} * pxScale / max(-mv.z, 0.001), pxMax);
  gl_Position = projectionMatrix * mv;
}`

const HALO_FRAGMENT = `
uniform vec3 tint;
varying float vFade;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  // 広い暈と、灯具のすぐまわりの明るい芯
  float a = pow(max(1.0 - d, 0.0), 2.4) * 0.55 + pow(max(1.0 - d * 2.6, 0.0), 2.0) * 0.9;
  gl_FragColor = vec4(tint * a * vFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function createLampHalos(ctx: RenderCtx, fogNear: number, fogFar: number): RenderPart | null {
  const { scene, camera, renderer, world, quality } = ctx
  const L = ctx.lighting
  if (!L.lampsOn || L.lampHalo <= 0) return null
  // 軽量設定では街の部品がふつうの道路照明を描かないので、暈も置かない（quality.props と同じ条件）
  const lamps = lampLights(streetProps(world), quality.props)
  if (lamps.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap((l) => [l.x, world.groundY(l.x, l.z) + l.height + 0.5, l.z]), 3))
  const gain = L.lampHalo * (quality.post ? 1 : HALO_GAIN_NO_POST)
  const tint = hexToLinear(L.lampColor).map((v) => v * gain)
  const material = new THREE.ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: {
      tint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
      pxScale: { value: 1 },
      pxMax: { value: 1 },
      fogNear: { value: fogNear },
      fogFar: { value: fogFar },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'gto-lamp-halos'
  points.matrixAutoUpdate = false
  points.frustumCulled = false
  points.renderOrder = 4
  scene.add(points)
  const size = new THREE.Vector2()
  return {
    update: () => {
      const height = renderer.getDrawingBufferSize(size).y
      material.uniforms.pxScale.value = height / 2 / Math.tan((camera.fov * Math.PI) / 360)
      material.uniforms.pxMax.value = height * HALO_MAX_SCREEN
    },
    dispose: () => {
      scene.remove(points)
      geometry.dispose()
      material.dispose()
    },
  }
}
