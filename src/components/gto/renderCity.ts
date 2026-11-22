// Grand Theft Outfit [部品: city] 渋谷の街並み。地面（坂）・道路・横断歩道・建物・線路と道路の高架・街具。
// 入口: createCityRenderer(ctx)
// 契約: world（地図）だけから動かない街を1回組み立てる。毎フレームの仕事は窓明かりと大型ビジョンの強さだけ。
//       建物の実名は読まない。看板は renderSigns.ts、光と空は renderSky.ts の担当。
// 中身: renderCityRoads（地面と道と高架）/ renderCityBuildings（ふつうの建物）/ renderCityLandmarks（目印の建物）
//       / renderCityProps（街灯・街路樹・信号・ゲート）/ renderCityTextures（模様）/ renderCityGeom（形の道具）
import * as THREE from 'three'
import { hexToLinear, type ScatterParams } from '../../lib/gto/lighting'
import { areaDef } from '../../lib/gto/areas'
import { isHiddenBuilding, landmarkOf } from '../../lib/gto/map'
import { isSkylineTower } from '../../lib/gto/mapSkyline'
import type { MapBuilding } from '../../lib/gto/types'
import { wallAds } from '../../lib/gto/mapStreet'
import { createBoardTexture, wallBoard } from './renderCityBoards'
import { buildBlock, extentOf, newCityBuild } from './renderCityBuildings'
import type { Builder } from './renderCityGeom'
import { buildCranes } from './renderCityExtras'
import { buildEastSite } from './renderCityEast'
import { buildEastSide } from './renderCityEastSide'
import { buildFaceDecos, buildPinkStair, buildWestSite } from './renderCityFacade'
import { buildLattice } from './renderCityLattice'
import { buildBrickWalks, buildGuardFace } from './renderCityVista'
import { buildLandmark } from './renderCityLandmarks'
import { buildArch, createArchTexture } from './renderCityArch'
import { buildGate, createGateTexture } from './renderCityGate'
import { buildGuardSoffit } from './renderCityGuard'
import { buildProps } from './renderCityProps'
import { buildRails, buildRoads, buildTerrain } from './renderCityRoads'
import { createCityTextures, WALL_KINDS, type WallKind } from './renderCityTextures'
import type { RenderCtx, RenderPart } from './renderTypes'

/** 夜の窓明かりの強さを、壁の種類ごとに変える（店先は明るく、鉄桁と金属は光らない） */
const GLOW_SCALE: Record<string, number> = { shop: 2.4, band: 1.6, curtain: 0.9, girder: 0, metal: 0, blank: 0, tube: 5, lit: 3.4 }
/** 壁が空の色を映す強さ。ガラスは強く、ふつうの壁もわずかに（日陰の白い壁が茶色く沈まず、青みの灰色に見える） */
const SKY_REFLECT: Record<string, number> = { curtain: 0.34, band: 0.4, metal: 0.25, lit: 0.25, tube: 0.3, office: 0.12, ribbon: 0.14, tile: 0.1, panel: 0.14, blank: 0.1, stream: 0.1 }

/** 遠くの塔に掛かるかすみのうち、先に引いておく割合（残りが遠近感になる） */
const HAZE_UNDO = 0.97
/** 暗い面でも引きすぎて真っ黒にならないよう、元の色のこの割合は残す（窓の格子が消えない） */
const HAZE_UNDO_FLOOR = 0.45

/** 大気のかすみ（renderSky.ts の最後の1枚、lightingLocal.ts の scatterAmount / scatterTint と同じ式）を先に引く GLSL */
function hazeUndoGlsl(s: ScatterParams): string | null {
  if (s.strength <= 0) return null
  const f = (n: number) => n.toFixed(4)
  const vec = (c: readonly number[], k = 1) => `vec3(${f(c[0] * k)}, ${f(c[1] * k)}, ${f(c[2] * k)})`
  return `{
    float gtoLobe = pow(clamp((dot(normalize(-vViewPosition), uSunView) + ${f(s.wrap)}) / ${f(1 + s.wrap)}, 0.0, 1.0), ${f(s.power)});
    float gtoHaze = ${f(HAZE_UNDO * s.strength)} * (${f(s.ambient)} + ${f(1 - s.ambient)} * gtoLobe) * (1.0 - exp(-length(vViewPosition) / ${f(s.length)}));
    vec3 gtoTint = mix(${vec(hexToLinear(s.backColor))}, ${vec(hexToLinear(s.color), s.gain)}, gtoLobe);
    gl_FragColor.rgb = max((gl_FragColor.rgb - gtoTint * gtoHaze) / (1.0 - gtoHaze), gl_FragColor.rgb * ${f(HAZE_UNDO_FLOOR)});
  }`
}

/** 遠くの塔のガラスが空を映す強さの割合（強いと空に溶けて輪郭が消える） */
const FAR_SKY_REFLECT = 0.45
/** 遠くの塔の窓明かりの倍率。夜の写真（center-gai_09、towers_04/07）の塔は、暗い空の中でいちばん明るい格子として立つ。近くの棟と同じ強さだと空より暗く沈む */
const FAR_GLOW = 2.6
/** 遠くの塔のガラスが、空の明るさに応じて返す青（線形の RGB の係数） */
const FAR_GLASS_BLUE = ['0.20', '0.52', '1.05']

export function createCityRenderer(ctx: RenderCtx): RenderPart {
  const { scene, world, quality, lighting } = ctx
  const group = new THREE.Group()
  group.name = 'gto-city'
  const disposables: { dispose: () => void }[] = []
  const add = (b: Builder, material: THREE.Material, opts: { cast?: boolean; receive?: boolean } = {}) => {
    disposables.push(material)
    if (b.empty) return null
    const geometry = b.build()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = !!opts.cast && quality.shadows
    mesh.receiveShadow = opts.receive !== false && quality.shadows
    mesh.matrixAutoUpdate = false
    group.add(mesh)
    disposables.push(geometry)
    return mesh
  }
  const tex = createCityTextures(quality.facadeTexture)
  disposables.push(tex)
  // 重なる面のちらつきを避けるため、地面に貼る物は少し手前へずらす
  const flat = (factor: number, map: THREE.Texture | null = null) =>
    new THREE.MeshLambertMaterial({ vertexColors: true, map, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor })

  // ---- 地面と道 ----
  const terrain = new THREE.Mesh(buildTerrain(world, quality.terrainStep), new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.paving }))
  terrain.receiveShadow = quality.shadows
  terrain.matrixAutoUpdate = false
  group.add(terrain)
  disposables.push(terrain.geometry, terrain.material as THREE.Material)

  const roads = buildRoads(world, quality.props)
  // 宮益坂とガードの手前の、レンガ調の歩道と緑の柵
  buildBrickWalks(world, roads.walk, roads.decks, quality.props)
  add(roads.walk, flat(-1, tex.paving))
  add(roads.drive, flat(-2, tex.asphalt))
  add(roads.lines, flat(-3))
  add(roads.zebra, new THREE.MeshLambertMaterial({ map: tex.zebra, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }))
  add(buildRails(world, roads.decks, roads.sides, quality.props), flat(-1), { cast: false })
  // 床は裏からも見えるよう両面。影は裏面だけで落とす（表の面が自分の影で暗くならないように）
  add(roads.decks, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, shadowSide: THREE.BackSide }), { cast: true })

  // ---- 建物 ----
  const cb = newCityBuild(world, quality.props)
  // 遠くの目印になる高い塔は、別の入れ物に溜めて霧の掛からない材質で描く
  const nearWalls = cb.walls
  const farWalls = newCityBuild(world, false).walls
  // 高架の桁の側面は、鉄桁の模様の壁として一緒に描く
  const girderSides = roads.sides
  world.map.buildings.forEach((bd: MapBuilding, bi) => {
    if (isHiddenBuilding(bd)) return
    const ext = extentOf(world, bd, bi)
    if (!ext) return
    const landmark = landmarkOf(bd)
    cb.walls = isSkylineTower(bd) ? farWalls : nearWalls
    if (!(landmark && buildLandmark(cb, landmark, bd, ext, bi))) buildBlock(cb, bd, ext, bi)
    buildFaceDecos(cb, bd)
    buildLattice(cb, bd)
    cb.walls = nearWalls
  })
  // 主な通りに面した壁の広告面（看板ビルの谷間）。軽量設定では駅前だけ
  const byId = new Map(world.map.buildings.map((b) => [b.id, b]))
  for (const ad of wallAds(world.map.buildings, world.map.roads, (b) => landmarkOf(b) != null || isHiddenBuilding(b), world.insideBuilding)) {
    if (!quality.props && Math.hypot(ad.x, ad.z) > 220) continue
    const owner = byId.get(ad.building)
    if (owner) wallBoard(cb, ad, owner.y)
  }
  // 工事のクレーン（遠くからの目印なので、軽量設定でも立てる）。立つ場所はエリアごとの表（lib/gto/areas.ts）
  const area = areaDef(world)
  buildCranes(cb, area.cranes)
  // [areas] ここから下は、固定の座標に建てる渋谷だけの作り込み。ほかのエリアでは建てない（宙に出てしまう）
  if (area.shibuyaSet) {
    // 東口の工事中の躯体とバス乗り場の上屋（宮益坂下から南を見たときの手前の層）
    buildEastSite(cb)
    // 乗り場のバスと、工事中の JR の高架の東の面（線路が右にある＝東口だと読める決め手）
    buildEastSide(cb)
    // ハチ公前広場の南の解体現場（白い仮囲いと黒い幕の足場）
    buildWestSite(cb)
    // センター街の桃色の棟の外階段（通りの中から駅を振り返ったときの、右半分の棟の右端）
    buildPinkStair(cb)
    // ガードを東から見た面（宮益坂下から西を見たときの、道の突き当たり）
    buildGuardFace(cb)
  }
  const wallMaterials: { material: THREE.MeshLambertMaterial; scale: number }[] = []
  // カメラから見た太陽の向き（遠くの塔のかすみの見越しに使う）
  const sunView = { value: new THREE.Vector3() }
  const sunWorld = new THREE.Vector3(...lighting.sunDir).normalize()
  const hazeGlsl = quality.post ? hazeUndoGlsl(lighting.scatter) : null
  const skyUniform = { value: new THREE.Color() }
  // 壁の材質。far は遠くの目印になる高い塔の分で、霧で消さず、描画距離の外でも輪郭を残す
  const wallMaterial = (kind: WallKind, far: boolean) => {
    const scale = (GLOW_SCALE[kind] ?? 1) * (far ? FAR_GLOW : 1)
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: tex.walls[kind].color,
      emissiveMap: scale > 0 ? tex.walls[kind].glow : null,
      emissive: new THREE.Color(scale > 0 ? 0xffffff : 0x000000),
      emissiveIntensity: lighting.windowGlow * scale,
      fog: !far,
    })
    // ガラスは空を映す。光の当たり方に関係なく、空の色を上乗せする（遠くの塔は空に溶けないよう弱める）
    const amount = (SKY_REFLECT[kind] ?? 0) * (far ? FAR_SKY_REFLECT : 1)
    if (amount > 0 || far) {
      material.onBeforeCompile = (shader) => {
        // 外装ごと光る壁は、明かりに壁の色を掛ける
        if (kind === 'lit') shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;')
        if (amount > 0) {
          shader.uniforms.uSky = skyUniform
          shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'uniform vec3 uSky;\nvoid main() {')
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uSky * diffuseColor.rgb * ${amount.toFixed(2)};` +
                // 遠くの塔のガラスは、日陰の面でも空の明るさぶんだけ青く返す（写真の塔は北面でも青いガラスに見える。夜は空が暗いので効かない）
                (far && kind === 'curtain' ? `\n\ttotalEmissiveRadiance += dot(uSky, vec3(0.3333)) * vec3(${FAR_GLASS_BLUE.join(', ')}) * diffuseColor.rgb;` : ''),
            )
        }
        if (far) {
          // 描画距離の奥の面で切られないよう、奥行きを奥の面の手前で止める
          // 奥の面より先では全部が同じ奥行きになるので、ガラスの壁だけほんの少し奥に置く
          // （白い横の帯・頂部の縁・裾が、400m 先のセンター街から見てもガラスの壁に埋もれない）
          const limit = kind === 'curtain' ? '0.99997' : '0.9999'
          shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n\tgl_Position.z = min(gl_Position.z, gl_Position.w * ${limit});`)
          // 最後の1枚で掛かる大気のかすみを見越して、先に引いておく（かすみの中でも塔の輪郭と格子が残る）
          if (hazeGlsl) {
            shader.uniforms.uSunView = sunView
            shader.fragmentShader = shader.fragmentShader
              .replace('void main() {', 'uniform vec3 uSunView;\nvoid main() {')
              .replace('#include <tonemapping_fragment>', `${hazeGlsl}\n\t#include <tonemapping_fragment>`)
          }
        }
      }
      material.customProgramCacheKey = () => `gto-wall-${kind}-${far ? 'far' : 'near'}`
    }
    wallMaterials.push({ material, scale })
    return material
  }
  for (const kind of WALL_KINDS) {
    add(nearWalls[kind], wallMaterial(kind, false), { cast: true })
    if (!farWalls[kind].empty) add(farWalls[kind], wallMaterial(kind, true), { cast: true })
  }
  add(girderSides, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.walls.girder.color }), { cast: true })
  add(cb.roofs, new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true })

  // 大型ビジョン。昼は控えめ、夜は自分で光る
  const screenMaterial = new THREE.MeshLambertMaterial({ map: tex.screens, emissiveMap: tex.screens, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.35 + lighting.neon * 0.3 })
  add(cb.screens, screenMaterial, { receive: false })

  // 屋上の広告塔の板。昼は印刷の板、夜は灯具に照らされて少し明るい
  const boardTexture = createBoardTexture(quality.facadeTexture >= 512 ? 256 : 128)
  disposables.push(boardTexture)
  const boardMaterial = new THREE.MeshLambertMaterial({ map: boardTexture, emissiveMap: boardTexture, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.1 })
  add(cb.boards, boardMaterial, { receive: false })

  // 透明なガラス（地下への出入口の囲い）。向こうの塔と橋が透ける。奥行きは書かず、不透明な物のあとに描く
  const glassMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, emissive: new THREE.Color(0x9fb4c2), emissiveIntensity: 0.32 })
  const glassMesh = add(cb.glass, glassMaterial, { receive: false })
  if (glassMesh) glassMesh.renderOrder = 2

  // ---- 街具 ----
  const props = buildProps(world, quality.props)
  add(props.solid, new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true })
  const glowMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 })
  // 灯具は頂点色のまま光らせる（emissiveMap が無いので、色を掛けるために白い 1px の絵は使わず強さだけ変える）
  glowMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;')
  }
  add(props.glow, glowMaterial, { receive: false })
  // JR の鉄桁ガードの裏の骨組み。灯具と路面の照り返しのぶん、自分でも少し光らせる（桁の下が真っ黒な天井にならない）
  const soffit = buildGuardSoffit(world, quality.props)
  const soffitMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.2 })
  soffitMaterial.onBeforeCompile = glowMaterial.onBeforeCompile
  soffitMaterial.customProgramCacheKey = () => 'gto-soffit'
  add(soffit.steel, soffitMaterial, { receive: false })
  add(soffit.lamps, glowMaterial, { receive: false })
  // センター街入口のゲート（軽量設定でも必ず置く。ここが無いと通りの見分けが付かない）
  const gate = buildGate(world, quality.props)
  add(gate.solid, new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true })
  const gateTexture = createGateTexture()
  disposables.push(gateTexture)
  add(gate.art, new THREE.MeshLambertMaterial({ map: gateTexture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { cast: true })
  // [areas] 歌舞伎町の通りの入口の赤い門（新宿だけ。通りが地図に無ければ空）。板の字は夜に自分で光る
  const arch = buildArch(world, quality.props)
  add(arch.solid, new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true })
  add(arch.glow, glowMaterial, { receive: false })
  let archMaterial: THREE.MeshLambertMaterial | null = null
  if (!arch.art.empty && arch.look) {
    const archTexture = createArchTexture(arch.look)
    disposables.push(archTexture)
    archMaterial = new THREE.MeshLambertMaterial({ map: archTexture, emissiveMap: archTexture, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.15 })
    add(arch.art, archMaterial, { receive: false })
  }
  // 行灯の街灯の通り名の札の字（ゲートと同じ絵の字を貼る）
  add(props.art, new THREE.MeshLambertMaterial({ map: gateTexture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { receive: false })

  scene.add(group)
  const skyTint = new THREE.Color()
  const apply = () => {
    const l = ctx.lighting
    sunView.value.copy(sunWorld).transformDirection(ctx.camera.matrixWorldInverse)
    for (const w of wallMaterials) w.material.emissiveIntensity = l.windowGlow * w.scale
    skyUniform.value.setHex(l.skyTop).lerp(skyTint.setHex(l.skyHorizon), 0.4)
    screenMaterial.emissiveIntensity = 0.35 + l.neon * 0.3
    boardMaterial.emissiveIntensity = 0.08 + l.neon * 0.45
    glowMaterial.emissiveIntensity = l.lampsOn ? 1.6 : 0.15
    soffitMaterial.emissiveIntensity = l.lampsOn ? 0.24 : 0.18
    if (archMaterial) archMaterial.emissiveIntensity = 0.12 + l.neon * 0.9
  }
  apply()
  return {
    update: apply,
    dispose: () => {
      scene.remove(group)
      for (const d of disposables) d.dispose()
    },
  }
}
