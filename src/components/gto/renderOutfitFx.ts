// Grand Theft Outfit [部品: outfit の見た目] 服を奪う・着替える瞬間の演出と、狙いの印。
// 入口: createOutfitFx(ctx, deps) → plan(frame) / place(frame, hero, actorOf) / dispose()
// 契約: renderActors.ts が毎フレーム plan → 全員の姿勢 → place の順に呼ぶ。
//       plan は「いま見せる服」（状態の上では奪った1歩で入れ替わるが、服が飛んで届くまでは元の服を見せる）と、
//       主人公・相手の姿勢の上書きを返す。place は印・光・飛ぶ服を、その人の板に合わせて置く。
//       時間割は lib/gto/outfit.ts の stealBeat / wearBeat（状態の秒で進むので、止めている間は止まる）。
import * as THREE from 'three'
import { detectSwap, findStealTarget, STEAL_BEAT, stealBeat, wearBeat, type OutfitSwap, type StealBeat } from '../../lib/gto/outfit'
import type { OutfitState } from '../../lib/gto/types'
import { applyGait, type GaitUniform } from './renderActorGait'
import { makeBubbleTexture, makeStarTexture, makeTagTexture } from './renderOutfitTextures'
import type { FrameInfo, RenderCtx } from './renderTypes'

/** 見た目を決める数字 */
export const OUTFIT_FX_STYLE = {
  mint: 0x2fd3a6,
  cloth: 0xf1e7d0,
  thread: 0xff6a2b,
  /** 狙いの縁取りの太さ（板の幅・高さに対する割合） */
  outlineX: 0.14,
  outlineY: 0.035,
  /** 狙いが決まった瞬間に、印が外から締まる秒 */
  lockTime: 0.16,
  /** 踏み込む距離 m と、相手が引っぱられる距離 m */
  lunge: 0.42,
  tug: 0.2,
  /** 決めの弾みの伸び縮み（高さ・幅）と、跳ねる高さ m */
  popY: 0.14,
  popX: 0.07,
  hop: 0.16,
  /** 飛ぶ服の高さ m と、弧の高さ m、進む向きへ傾ける角（ラジアン） */
  flyerHeight: 1.3,
  flyerArc: 0.7,
  flyerTilt: 0.55,
  /** 足元の輪の大きさ（半径 m）: 始めと終わり */
  shockFrom: 0.4,
  shockTo: 3,
  /** 飛び散る星の数（PC・スマホ）と寿命（秒） */
  stars: 18,
  starsMobile: 10,
  starLife: 0.7,
}

/** 演出が触る、1人ぶんの描画物（renderActors の Actor の一部） */
export interface ActorLike {
  root: THREE.Group
  tilt: THREE.Group
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  gait: GaitUniform
  height: number
  width: number
}

/** 姿勢の上書き（pose のあとに重ねる） */
export interface ActorTweak {
  dx: number
  dz: number
  lift: number
  sx: number
  sy: number
  roll: number
}

export interface OutfitPlan {
  /** 主人公に見せる服 */
  heroKey: string
  hero: ActorTweak | null
  /** 演出の相手（いなければ null）と、その人に見せる服・姿勢 */
  victimId: number | null
  victimKey: string
  victim: ActorTweak | null
}

export interface OutfitFx {
  plan: (frame: FrameInfo, showHero: boolean) => OutfitPlan
  place: (frame: FrameInfo, hero: ActorLike | null, actorOf: (id: number) => ActorLike | undefined) => void
  dispose: () => void
}

export interface OutfitFxDeps {
  group: THREE.Group
  /** 足元が原点の、歩きの変形に対応した板 */
  planeGeometry: THREE.PlaneGeometry
  textureOf: (key: string) => THREE.Texture
  tint: THREE.Color
}

/** pose のあとに、演出ぶんの姿勢を重ねる */
export function applyTweak(a: ActorLike, tw: ActorTweak): void {
  a.root.position.x += tw.dx
  a.root.position.z += tw.dz
  a.plane.position.y += tw.lift
  a.plane.scale.x *= Math.abs(tw.sx) < 0.06 ? 0.06 * Math.sign(tw.sx || 1) : tw.sx
  a.plane.scale.y *= tw.sy
  a.plane.rotation.z += tw.roll
}

interface Solid {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  gait: GaitUniform
}

export function createOutfitFx(ctx: RenderCtx, deps: OutfitFxDeps): OutfitFx {
  const S = OUTFIT_FX_STYLE
  const { camera, world } = ctx
  const { group, textureOf } = deps
  const disposables: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(o: T): T => {
    disposables.push(o)
    return o
  }

  /** スプライトの形のまま1色で塗る板（縁取りと光）。歩きの変形も同じに掛かる */
  const makeSolid = (color: number, order: number): Solid => {
    const gait: GaitUniform = { value: new THREE.Vector4() }
    const uSolid = { value: new THREE.Color(color) }
    const material = keep(new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false }))
    applyGait(material, gait)
    const inner = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
      inner.call(material, shader, renderer)
      shader.uniforms.uSolid = uSolid
      // 抜きは不透明度に関係なくスプライトの形で決める
      shader.fragmentShader = `uniform vec3 uSolid;\n${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nif (diffuseColor.a < 0.5 * opacity) discard;\ndiffuseColor.rgb = uSolid;',
      )
    }
    material.customProgramCacheKey = () => 'gto-outfit-solid'
    const mesh = new THREE.Mesh(deps.planeGeometry, material)
    mesh.visible = false
    mesh.renderOrder = order
    group.add(mesh)
    return { mesh, gait }
  }

  const viewDir = new THREE.Vector3()
  const quat = new THREE.Quaternion()

  /** 1色の板を、その人の板にぴったり重ねる（grow で外へ広げ、push でカメラから遠ざける。負なら手前） */
  const overlay = (s: Solid, a: ActorLike, growX: number, growY: number, push: number, opacity: number) => {
    const m = s.mesh
    m.visible = true
    if (m.material.map !== a.plane.material.map) {
      m.material.map = a.plane.material.map
      m.material.needsUpdate = true
    }
    m.material.opacity = opacity
    s.gait.value.copy(a.gait.value)
    viewDir.set(a.root.position.x - camera.position.x, 0, a.root.position.z - camera.position.z).normalize()
    m.position.set(a.root.position.x + viewDir.x * push, a.root.position.y + a.plane.position.y - a.height * growY * 0.35, a.root.position.z + viewDir.z * push)
    quat.setFromEuler(a.plane.rotation)
    m.quaternion.copy(a.tilt.quaternion).multiply(quat)
    m.scale.set(a.plane.scale.x * (1 + growX), a.plane.scale.y * (1 + growY), 1)
  }

  // ---- 狙いの印: 縁取り・足元の輪・頭上の札 ----
  const outline = makeSolid(S.mint, 2)
  const arcGeometry = keep(new THREE.RingGeometry(0.5, 0.58, 14, 1, 0.18, Math.PI / 2 - 0.36))
  arcGeometry.rotateX(-Math.PI / 2)
  const arcMaterial = keep(
    new THREE.MeshBasicMaterial({ color: S.mint, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  )
  const reticle = new THREE.Group()
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(arcGeometry, arcMaterial)
    arc.rotation.y = (i * Math.PI) / 2
    arc.renderOrder = 2
    reticle.add(arc)
  }
  reticle.visible = false
  group.add(reticle)
  const tagTexture = keep(makeTagTexture())
  const tagMaterial = keep(new THREE.SpriteMaterial({ map: tagTexture, transparent: true, depthWrite: false, toneMapped: false, fog: false }))
  const tag = new THREE.Sprite(tagMaterial)
  tag.center.set(0.5, 0)
  tag.visible = false
  tag.renderOrder = 4
  group.add(tag)

  // ---- 奪う瞬間: 飛ぶ服（残像つき）・光・足元の輪・星・相手の「!?」 ----
  const flyerGeometry = keep(new THREE.PlaneGeometry(1, 1))
  const flyers = [1, 0.45, 0.22].map((opacity, i) => {
    const material = keep(new THREE.MeshBasicMaterial({ color: deps.tint, transparent: i > 0, opacity, alphaTest: 0.5 * opacity, side: THREE.DoubleSide, depthWrite: i === 0 }))
    const mesh = new THREE.Mesh(flyerGeometry, material)
    mesh.visible = false
    mesh.renderOrder = 3
    group.add(mesh)
    return mesh
  })
  const heroFlash = makeSolid(0xffffff, 5)
  const victimFlash = makeSolid(0xffffff, 5)
  const shockGeometry = keep(new THREE.RingGeometry(0.88, 1, 48))
  shockGeometry.rotateX(-Math.PI / 2)
  const shockMaterial = keep(
    new THREE.MeshBasicMaterial({ color: S.cloth, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  )
  const shock = new THREE.Mesh(shockGeometry, shockMaterial)
  shock.visible = false
  shock.renderOrder = 2
  group.add(shock)

  const starCount = ctx.quality.id === 'mobile' ? S.starsMobile : S.stars
  const starPositions = new Float32Array(starCount * 3)
  const starColors = new Float32Array(starCount * 3)
  const palette = [new THREE.Color(S.cloth), new THREE.Color(S.thread), new THREE.Color(S.mint)]
  for (let i = 0; i < starCount; i++) palette[i % palette.length].toArray(starColors, i * 3)
  const starGeometry = keep(new THREE.BufferGeometry())
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3))
  const starTexture = keep(makeStarTexture())
  const starMaterial = keep(new THREE.PointsMaterial({ map: starTexture, size: 0.3, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true, toneMapped: false, fog: false }))
  const stars = new THREE.Points(starGeometry, starMaterial)
  stars.frustumCulled = false
  stars.visible = false
  stars.renderOrder = 6
  group.add(stars)

  const bubbleTexture = keep(makeBubbleTexture())
  const bubbleMaterial = keep(new THREE.SpriteMaterial({ map: bubbleTexture, transparent: true, depthWrite: false, toneMapped: false, fog: false }))
  const bubble = new THREE.Sprite(bubbleMaterial)
  bubble.center.set(0.5, 0)
  bubble.visible = false
  bubble.renderOrder = 6
  group.add(bubble)

  // ---- 進行中の演出 ----
  let prev: OutfitState | null = null
  let active: OutfitSwap | null = null
  let beat: StealBeat | null = null
  let wearFlash = 0
  let targetId: number | null = null
  let lockedAt = 0
  /** 奪った瞬間の、主人公と相手の場所（服の飛ぶ道と輪の中心） */
  const origin = { hx: 0, hz: 0, vx: 0, vz: 0, vh: 1.7 }

  const plan = (frame: FrameInfo, showHero: boolean): OutfitPlan => {
    const { state } = frame
    const o = state.outfit
    const p = state.player
    if (prev && prev !== o && showHero) {
      const swap = detectSwap(prev, o, p, state.peds)
      if (swap) {
        active = swap
        origin.hx = p.x
        origin.hz = p.z
        const v = swap.kind === 'steal' ? state.peds.find((q) => q.id === swap.victimId) : undefined
        origin.vx = v?.x ?? p.x
        origin.vz = v?.z ?? p.z
      }
    }
    prev = o
    beat = null
    wearFlash = 0
    const out: OutfitPlan = { heroKey: o.wearing, hero: null, victimId: null, victimKey: '', victim: null }

    // 狙い: 動ける間だけ
    const aim = showHero && state.mode === 'foot' && p.busy <= 0 && !p.boarding ? findStealTarget(p, state.peds, o.wearing) : null
    if ((aim?.id ?? null) !== targetId) {
      targetId = aim?.id ?? null
      lockedAt = frame.now
    }
    if (!active || !showHero) {
      active = showHero ? active : null
      return out
    }

    const tau = state.t - active.at
    if (active.kind === 'wear') {
      const w = wearBeat(tau)
      if (w.done) {
        active = null
        return out
      }
      wearFlash = w.flash
      out.heroKey = w.swapped ? o.wearing : active.from
      out.hero = { dx: 0, dz: 0, lift: 0, sx: w.turn * (1 - S.popX * w.pop), sy: 1 + S.popY * w.pop, roll: 0 }
      return out
    }

    const b = stealBeat(tau)
    if (b.done) {
      active = null
      return out
    }
    beat = b
    const victim = state.peds.find((q) => q.id === (active as { victimId: number }).victimId)
    const dx = origin.vx - origin.hx
    const dz = origin.vz - origin.hz
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len
    const uz = dz / len
    // 画面の上で相手が右にいるか左にいるか（体をそちらへ倒す）
    const side = Math.sign(ux * -(origin.hz - camera.position.z) + uz * (origin.hx - camera.position.x)) || 1
    out.heroKey = b.swapped ? o.wearing : active.given
    out.hero = {
      dx: ux * S.lunge * b.lunge,
      dz: uz * S.lunge * b.lunge,
      lift: S.hop * b.hop,
      sx: 1 - S.popX * b.pop,
      sy: 1 + S.popY * b.pop,
      roll: -side * 0.24 * b.lunge,
    }
    if (victim) {
      const shake = Math.sin(frame.now * 58) * b.shiver
      out.victimId = victim.id
      out.victimKey = b.swapped ? victim.outfitKey : active.taken
      out.victim = {
        dx: -ux * S.tug * b.tug + ux * 0.14 * b.shiver + shake * 0.018,
        dz: -uz * S.tug * b.tug + uz * 0.14 * b.shiver,
        lift: 0,
        sx: Math.cos(b.spin * Math.PI * 2) * (1 + 0.05 * b.pop),
        sy: 1 - 0.06 * b.tug - 0.05 * b.pop,
        roll: -side * 0.16 * b.tug + side * 0.1 * b.shiver + shake * 0.035,
      }
    }
    return out
  }

  const hide = (...objects: THREE.Object3D[]) => {
    for (const o of objects) o.visible = false
  }

  const place = (frame: FrameInfo, hero: ActorLike | null, actorOf: (id: number) => ActorLike | undefined) => {
    const { now } = frame
    hide(outline.mesh, reticle, tag, heroFlash.mesh, victimFlash.mesh, shock, stars, bubble, ...flyers)

    // ---- 狙いの印 ----
    const target = targetId != null ? actorOf(targetId) : undefined
    if (target && hero) {
      const lock = Math.min(1, (now - lockedAt) / S.lockTime)
      const snap = 1 + (1 - lock) * (1 - lock) * 0.9
      const pulse = 0.5 + 0.5 * Math.sin(now * 7)
      overlay(outline, target, S.outlineX * snap, S.outlineY * snap, 0.05, 0.75 + 0.25 * pulse)
      const tp = target.root.position
      reticle.visible = true
      reticle.position.set(tp.x, world.groundY(tp.x, tp.z) + 0.07, tp.z)
      reticle.rotation.y = now * 1.6
      reticle.scale.setScalar((Math.max(0.9, target.width * 1.5) + pulse * 0.06) * snap)
      arcMaterial.opacity = 0.55 + 0.45 * lock
      tag.visible = true
      const size = 0.46 * (1 + (1 - lock) * 0.6)
      tag.scale.set(size * 0.8, size, 1)
      tag.position.set(tp.x, tp.y + target.height + 0.1 + Math.abs(Math.sin(now * 4.2)) * 0.07, tp.z)
      tagMaterial.opacity = lock
    }

    // ---- 着替えの光 ----
    if (wearFlash > 0 && hero) overlay(heroFlash, hero, 0.2 * (1 - wearFlash), 0.08 * (1 - wearFlash), -0.05, wearFlash * 0.95)

    const b = beat
    if (!b || !active || active.kind !== 'steal' || !hero) return
    const victim = actorOf(active.victimId)
    const hy = world.groundY(origin.hx, origin.hz)

    // 服が相手から弧を描いて飛んでくる
    if (b.flying) {
      const tex = textureOf(active.taken)
      const aspect = ctx.spriteAspect(active.taken)
      const vy = world.groundY(origin.vx, origin.vz)
      const face = Math.atan2(camera.position.x - origin.hx, camera.position.z - origin.hz)
      viewDir.set(origin.hx - camera.position.x, 0, origin.hz - camera.position.z).normalize()
      // 画面の上で、相手から主人公へ向かうのが右向きか左向きか
      const flySide = Math.sign((origin.hx - origin.vx) * (origin.hz - camera.position.z) - (origin.hz - origin.vz) * (origin.hx - camera.position.x)) || 1
      flyers.forEach((mesh, i) => {
        const f = b.fly - i * 0.09
        if (f <= 0) return
        mesh.visible = true
        if (mesh.material.map !== tex) {
          mesh.material.map = tex
          mesh.material.needsUpdate = true
        }
        const h = S.flyerHeight * (1 - 0.2 * f)
        mesh.scale.set(h * aspect, h, 1)
        // 2人の頭の上を越えて飛ぶ。2人の板に隠れないよう、少しカメラ寄りを通す
        mesh.position.set(
          origin.vx + (origin.hx - origin.vx) * f - viewDir.x * 0.35,
          vy + (hy - vy) * f + (victim?.height ?? 1.7) * (0.75 - 0.2 * f) + Math.sin(f * Math.PI) * S.flyerArc,
          origin.vz + (origin.hz - origin.vz) * f - viewDir.z * 0.35,
        )
        // 進む向きへ頭から倒れ込み、届く手前で起き上がる
        mesh.rotation.set(0, face, flySide * S.flyerTilt * Math.sin(f * Math.PI))
      })
    }

    if (!b.swapped) return
    // 着地: 2人が白く光り、足元から輪が広がり、星が散る
    if (b.flash > 0) {
      const grow = 1 - b.flash
      overlay(heroFlash, hero, 0.22 * grow, 0.08 * grow, -0.05, b.flash * 0.95)
      if (victim) overlay(victimFlash, victim, 0.16 * grow, 0.06 * grow, -0.05, b.flash * 0.7)
    }
    if (b.shock < 1) {
      shock.visible = true
      shock.position.set(origin.hx, hy + 0.08, origin.hz)
      shock.scale.setScalar(S.shockFrom + (S.shockTo - S.shockFrom) * (1 - (1 - b.shock) * (1 - b.shock)))
      shockMaterial.opacity = (1 - b.shock) * 0.9
    }
    const u = frame.state.t - active.at - STEAL_BEAT.land
    if (u < S.starLife) {
      stars.visible = true
      // カメラから見た右向き（星は画面の面に沿って散る）
      viewDir.set(origin.hx - camera.position.x, 0, origin.hz - camera.position.z).normalize()
      const rx = -viewDir.z
      const rz = viewDir.x
      for (let i = 0; i < starCount; i++) {
        const a = (i / starCount) * Math.PI * 2 + (i % 3) * 0.4
        const speed = 2.4 + ((i * 7) % 5) * 0.5
        const side = Math.cos(a) * speed * u
        starPositions[i * 3] = origin.hx + rx * side - viewDir.x * 0.3
        starPositions[i * 3 + 1] = hy + hero.height * 0.6 + (Math.sin(a) * speed + 1.6) * u - 4.5 * u * u
        starPositions[i * 3 + 2] = origin.hz + rz * side - viewDir.z * 0.3
      }
      starGeometry.attributes.position.needsUpdate = true
      const life = u / S.starLife
      starMaterial.opacity = 1 - life * life
      starMaterial.size = 0.3 * (1 - life * 0.5)
    }
    // 相手の頭の上に「!?」
    if (victim && b.shiver > 0) {
      const inT = Math.min(1, u / 0.14)
      const size = 0.5 * (1 + 0.35 * Math.sin(inT * Math.PI)) * inT * Math.min(1, b.shiver * 5)
      bubble.visible = size > 0.01
      bubble.scale.set(size, size, 1)
      const vp = victim.root.position
      bubble.position.set(vp.x, vp.y + victim.height + 0.06, vp.z)
    }
  }

  return {
    plan,
    place,
    dispose: () => {
      for (const d of disposables) d.dispose()
      group.remove(outline.mesh, reticle, tag, heroFlash.mesh, victimFlash.mesh, shock, stars, bubble, ...flyers)
    },
  }
}
