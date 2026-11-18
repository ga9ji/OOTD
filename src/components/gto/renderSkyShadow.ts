// Grand Theft Outfit [部品: light] 太陽の影を落とす側の高さを丸める。
// 入口: installShadowCap(world, cap)
// 契約: three が影を描くときに使う材質（奥行きだけ描く ShaderLib.depth）の頂点に、lightingShadow.ts の casterHeight と同じ式を入れる。
//       高いビルも「上限の高さの建物」として影を落とすので、通りの路面に日が届き、車・街路樹・ビルの影の向きと境目が見える。
//       街を描く材質には触らない（受ける側の形と明るさは変わらない）。地面の高さは粗い格子を GLSL の定数として持つ。
//       材質の部品は全体で1つなので、使っている画面の数を数えて、最後の1つが閉じたら元へ戻す。
import * as THREE from 'three'
import { GROUND_CELLS, groundGrid, type GroundGrid, type ShadowCap } from '../../lib/gto/lightingShadow'
import type { GtoWorld } from '../../lib/gto/types'

const f = (n: number) => n.toFixed(4)
const PROJECT = '#include <project_vertex>'
const MAIN = 'void main() {'
const original = THREE.ShaderLib.depth.vertexShader
let users = 0

/** 地面の高さ（格子の間は線形に補う）と、影を落とす高さの GLSL。lightingShadow.ts の sampleGround / casterHeight と同じ式 */
function capGlsl(grid: GroundGrid, cap: ShadowCap): string {
  const span = Math.max(cap.max - cap.keep, 0.001)
  return `
const float GTO_GROUND[${grid.data.length}] = float[${grid.data.length}](${grid.data.map((v) => v.toFixed(2)).join(',')});
float gtoGroundY(vec2 p) {
  float fx = clamp((p.x - ${f(grid.x0)}) / ${f(grid.stepX)}, 0.0, ${f(grid.cols - 1.001)});
  float fz = clamp((p.y - ${f(grid.z0)}) / ${f(grid.stepZ)}, 0.0, ${f(grid.rows - 1.001)});
  int c = int(floor(fx));
  int r = int(floor(fz));
  float tx = fx - float(c);
  float tz = fz - float(r);
  int i = r * ${grid.cols} + c;
  return mix(mix(GTO_GROUND[i], GTO_GROUND[i + 1], tx), mix(GTO_GROUND[i + ${grid.cols}], GTO_GROUND[i + ${grid.cols + 1}], tx), tz);
}
float gtoCasterHeight(float h) {
  return h <= ${f(cap.keep)} ? h : ${f(cap.keep)} + ${f(span)} * (1.0 - exp(-(h - ${f(cap.keep)}) / ${f(span)}));
}`
}

/** 世界の位置へ直してから高さを丸め、影のカメラへ写す（three の project_vertex の代わり） */
const PROJECT_CAPPED = `
  vec4 gtoWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    gtoWorld = batchingMatrix * gtoWorld;
  #endif
  #ifdef USE_INSTANCING
    gtoWorld = instanceMatrix * gtoWorld;
  #endif
  gtoWorld = modelMatrix * gtoWorld;
  float gtoBase = gtoGroundY( gtoWorld.xz );
  gtoWorld.y = gtoBase + gtoCasterHeight( gtoWorld.y - gtoBase );
  vec4 mvPosition = viewMatrix * gtoWorld;
  gl_Position = projectionMatrix * mvPosition;`

/** 影の描画に高さの上限を入れる。返す関数で元へ戻す */
export function installShadowCap(world: GtoWorld, cap: ShadowCap): () => void {
  users++
  const grid = groundGrid(world.groundY, world.map.meta.bounds, GROUND_CELLS)
  if (original.includes(PROJECT) && original.includes(MAIN)) {
    THREE.ShaderLib.depth.vertexShader = original.replace(MAIN, `${capGlsl(grid, cap)}\n${MAIN}`).replace(PROJECT, PROJECT_CAPPED)
  }
  return () => {
    users--
    if (users <= 0) THREE.ShaderLib.depth.vertexShader = original
  }
}
