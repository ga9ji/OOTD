// Grand Theft Outfit [部品: missions の見た目] ミッションの目印（開始地点と目的地）を街の中に立てる。
// 入口: createMarkersRenderer(ctx)
// 契約: view.markers を読んで、目印を置く。1つの目印は次の4つでできている。
//   ・足元の輪 …… 地面の起伏に沿わせる。主人公が中に立っても体を隠さない
//   ・光の筋 …… ハンガーの印の上から空へ伸びる細い筋。印より下には描かないので、主人公の体や頭に重ならない。近づくと消える
//   ・ハンガーの印 …… 頭の上で回りながら上下する。遠いほど大きく高く描き、画面の上で同じ大きさに見せる。
//                     建物ごしにも見えるが、主人公と手前の物よりは後ろに描く（下の「奥行きの上限」）
//   ・人 …… look が 'person' の目印（依頼人・尾行の相手）は、出勤服のくり抜きを立たせる
//   ・見回り …… threat の目印は「入ってはいけない輪」。赤い輪と薄い赤の面、頭の上に「！」。
//                主人公が中にいるあいだは輪と面が速く明滅する（光の筋とハンガーは出さない）
//   ・居残り …… 依頼を受けた直後、開始地点の印は消えるが、依頼人はその場に立ったまま見送る（人だけを描く。離れると消える）
import * as THREE from 'three'
import cutoutsJson from '../../data/cutouts.json'
import { hash } from '../../lib/gto/math'
import type { Marker } from '../../lib/gto/types'
import type { FrameInfo, RenderCtx, RenderPart } from './renderTypes'

/** 見た目を決める数字 */
export const MARKER_STYLE = {
  color: { start: 0xff7a2b, goal: 0x2fd3a6, threat: 0xff2f45 },
  /** 見回りの輪の面の濃さ（ふだん／主人公が中にいるとき）と、「！」を出す距離 m */
  zoneAlpha: [0.12, 0.22],
  alarmRange: 120,
  /** 輪の太さ（半径に対する割合）と、地面から浮かせる高さ m */
  ringBand: 0.12,
  ringLift: 0.3,
  /** 光の筋はハンガーの印の上端から始める（印の大きさに対する割合）。長さ m */
  beamFromIcon: 1.02,
  beamLength: { start: 16, goal: 70 },
  /** 光の筋が消え始める距離と、消えきる距離 m */
  beamFade: [34, 12],
  /** 印の大きさ = 距離 × この値（画面の高さの 1 割ほどに見える）。下限と上限 m */
  iconPerMeter: 0.115,
  iconMin: 0.9,
  iconMax: 30,
  /** 印の下端の高さ = 地面 + iconBase + 距離 × iconRise（遠くても主人公の頭の上に来る） */
  iconBase: 3.3,
  iconBasePerson: 2.5,
  iconRise: 0.16,
  /** 開始地点の印は、この距離より遠いと出さない（街じゅうの印で画面が埋まらないように） */
  startIconRange: 170,
  /** 人の背丈 m と、時刻ごとの明るさ（住人のスプライトと同じ掛け方） */
  /** 依頼を受けたあと、依頼人がその場に立っている範囲 m（これより離れると消える） */
  lingerRange: 60,
  personHeight: 1.72,
  tint: { day: 0xffffff, dusk: 0xe6c9b4, night: 0x8f93b8 },
}

const RING_SEGMENTS = 48
const outfitKeys = Object.keys((cutoutsJson as { sprites: Record<string, unknown> }).sprites)

/** 目印ごとに決まった出勤服を選ぶ（同じミッションの人は、いつも同じ服） */
const outfitFor = (ref: string, salt: number) => {
  let h = salt
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) % 100003
  return outfitKeys[Math.floor(hash(h, 7) * outfitKeys.length)] ?? ''
}

/** ハンガーの形（幅 1、下向きの矢じり付き）。服のゲームなので、矢印の代わりにハンガーを目印にする */
function hangerGeometries(): THREE.BufferGeometry[] {
  const body = new THREE.Shape()
  const outline: [number, number][] = [
    [-0.5, 0.3],
    [0.5, 0.3],
    [0.5, 0.39],
    [0.07, 0.64],
    [0.07, 0.72],
    [-0.07, 0.72],
    [-0.07, 0.64],
    [-0.5, 0.39],
  ]
  outline.forEach(([x, y], i) => (i === 0 ? body.moveTo(x, y) : body.lineTo(x, y)))
  body.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-0.27, 0.39)
  hole.lineTo(0, 0.55)
  hole.lineTo(0.27, 0.39)
  hole.closePath()
  body.holes.push(hole)
  const frame = new THREE.ExtrudeGeometry(body, { depth: 0.12, bevelEnabled: false })
  frame.translate(0, 0, -0.06)
  // 首の上のフック
  const hook = new THREE.TorusGeometry(0.1, 0.035, 6, 14, Math.PI * 1.45)
  hook.rotateZ(-Math.PI * 0.3)
  hook.translate(0.0, 0.82, 0)
  // 「ここ」を指す下向きの矢じり
  const tip = new THREE.ConeGeometry(0.15, 0.26, 4)
  tip.rotateX(Math.PI)
  tip.translate(0, 0.13, 0)
  return [frame, hook, tip]
}

interface Pin {
  root: THREE.Group
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  icon: THREE.Group
  zone: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  alarm: THREE.Group
  zoneKey: string
  person: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  shadow: THREE.Mesh
  ringKey: string
  personKey: string
  stride: number
}

export function createMarkersRenderer(ctx: RenderCtx): RenderPart {
  const { scene, world, camera } = ctx
  const S = MARKER_STYLE
  const group = new THREE.Group()
  group.name = 'gto-markers'
  scene.add(group)

  // ---- 共有する形と材質 ----
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true)
  beamGeometry.translate(0, 0.5, 0)
  // 光の筋は、下が濃く上へ行くほど薄い
  const fade = new Uint8Array(32 * 4)
  for (let i = 0; i < 32; i++) {
    const a = Math.round(255 * Math.pow(1 - i / 31, 1.6))
    fade.set([a, a, a, 255], i * 4)
  }
  const fadeTexture = new THREE.DataTexture(fade, 1, 32)
  fadeTexture.magFilter = THREE.LinearFilter
  fadeTexture.minFilter = THREE.LinearFilter
  fadeTexture.needsUpdate = true
  const hanger = hangerGeometries()
  const planeGeometry = new THREE.PlaneGeometry(1, 1)
  planeGeometry.translate(0, 0.5, 0)
  const shadowGeometry = new THREE.CircleGeometry(0.5, 16)
  shadowGeometry.rotateX(-Math.PI / 2)
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })

  // 奥行きの上限: ハンガーの印は「主人公のすこし奥」より遠くには描かない。
  // こうすると建物ごしにも見えるが、主人公・乗っている車・手前の人には隠れる（印が体に重ならない）。
  const depthCap = { value: 1 }
  const capDepth = (material: THREE.Material) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDepthCap = depthCap
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform float uDepthCap;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          // 上限より奥は、前後の順だけ残して上限のすぐ奥へ寄せる
          '#include <project_vertex>\n  float gtoZ = gl_Position.z / gl_Position.w;\n  if (gtoZ > uDepthCap) gl_Position.z = (uDepthCap + (gtoZ - uDepthCap) * 0.01) * gl_Position.w;',
        )
    }
    return material
  }
  const iconMaterials = {
    start: capDepth(new THREE.MeshLambertMaterial({ color: S.color.start, emissive: S.color.start, emissiveIntensity: 0.55 })),
    goal: capDepth(new THREE.MeshLambertMaterial({ color: S.color.goal, emissive: S.color.goal, emissiveIntensity: 0.55 })),
  }
  // 見回りの頭の上の「！」（棒と点）
  const alarmBar = new THREE.CylinderGeometry(0.17, 0.07, 0.62, 10)
  alarmBar.translate(0, 0.66, 0)
  const alarmDot = new THREE.SphereGeometry(0.11, 10, 8)
  alarmDot.translate(0, 0.14, 0)
  const alarmMaterial = capDepth(new THREE.MeshLambertMaterial({ color: S.color.threat, emissive: S.color.threat, emissiveIntensity: 0.8 }))
  const tint = new THREE.Color(S.tint[ctx.time])

  const loader = new THREE.TextureLoader()
  const textures = new Map<string, THREE.Texture>()
  const textureOf = (key: string) => {
    const cached = textures.get(key)
    if (cached) return cached
    ctx.loading.begin()
    const tex = loader.load(
      ctx.spriteUrl(key),
      () => ctx.loading.end(),
      undefined,
      () => ctx.loading.end(),
    )
    tex.colorSpace = THREE.SRGBColorSpace
    textures.set(key, tex)
    return tex
  }

  /** 地面に沿わせる帯（輪・面）の形。頂点は fitBand が置く */
  const bandGeometry = () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEGMENTS + 1) * 2 * 3), 3))
    const index: number[] = []
    for (let i = 0; i < RING_SEGMENTS; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    g.setIndex(index)
    return g
  }

  const makePin = (): Pin => {
    const ringGeometry = bandGeometry()
    const flat = { transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ ...flat, opacity: 0.8 }))
    ring.frustumCulled = false
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ ...flat, alphaMap: fadeTexture, opacity: 0.5 }))
    const icon = new THREE.Group()
    for (const g of hanger) icon.add(new THREE.Mesh(g, iconMaterials.goal))
    const zone = new THREE.Mesh(bandGeometry(), new THREE.MeshBasicMaterial({ ...flat, color: S.color.threat, opacity: S.zoneAlpha[0] }))
    zone.frustumCulled = false
    const alarm = new THREE.Group()
    alarm.add(new THREE.Mesh(alarmBar, alarmMaterial), new THREE.Mesh(alarmDot, alarmMaterial))
    const person = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({ color: tint, alphaTest: 0.5, side: THREE.DoubleSide }))
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    const root = new THREE.Group()
    root.add(zone, ring, beam, icon, alarm, shadow, person)
    group.add(root)
    return { root, ring, beam, icon, zone, alarm, person, shadow, ringKey: '', zoneKey: '', personKey: '', stride: 0 }
  }

  /** 帯を地面の起伏に沿わせて置く（inner〜outer の半径。inner が 0 なら面になる） */
  const fitBand = (geometry: THREE.BufferGeometry, m: Marker, inner: number, outer: number, lift: number) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      pos.setXYZ(i * 2, c * inner, world.groundY(m.x + c * inner, m.z + s * inner) + lift, s * inner)
      pos.setXYZ(i * 2 + 1, c * outer, world.groundY(m.x + c * outer, m.z + s * outer) + lift, s * outer)
    }
    pos.needsUpdate = true
  }

  /** 輪（と見回りの面）を作り直す。場所か半径が変わったときだけ（歩く見回りは 0.5m 動くごと） */
  const fitRing = (pin: Pin, m: Marker) => {
    const grid = m.threat ? 0.5 : 0.01
    const key = `${Math.round(m.x / grid)},${Math.round(m.z / grid)},${m.radius}`
    if (key !== pin.ringKey) {
      pin.ringKey = key
      fitBand(pin.ring.geometry, m, m.radius * (1 - (m.threat ? S.ringBand * 0.6 : S.ringBand)), m.radius, S.ringLift)
    }
    if (m.threat && key !== pin.zoneKey) {
      pin.zoneKey = key
      fitBand(pin.zone.geometry, m, 0, m.radius * (1 - S.ringBand * 0.6), S.ringLift - 0.06)
    }
  }

  const place = (pin: Pin, m: Marker, i: number, frame: FrameInfo, personOnly: boolean) => {
    const ground = world.groundY(m.x, m.z)
    const d = Math.hypot(camera.position.x - m.x, camera.position.z - m.z)
    const isPerson = m.look === 'person'
    // 輪は世界の高さで作るので、根は高さ 0 に置く
    pin.root.position.set(m.x, 0, m.z)
    pin.ring.visible = !personOnly
    if (!personOnly) fitRing(pin, m)
    const threat = m.threat === true
    const pl = frame.state.player
    // 見回り: 主人公が輪の中にいるあいだは速く明滅させる
    const inside = threat && Math.hypot(pl.x - m.x, pl.z - m.z) < m.radius
    const blink = inside ? 0.5 + 0.5 * Math.sin(frame.now * 14) : 0
    pin.ring.material.color.setHex(threat ? S.color.threat : S.color[m.kind])
    pin.ring.material.opacity = inside ? 0.7 + blink * 0.3 : 0.62 + Math.sin(frame.now * 3.2 + i) * 0.2
    pin.zone.visible = threat && !personOnly
    if (threat) pin.zone.material.opacity = inside ? S.zoneAlpha[1] * (0.7 + blink * 0.3) : S.zoneAlpha[0]

    // ハンガーの印: 遠いほど大きく高く。回って、上下に揺れる
    const size = THREE.MathUtils.clamp(d * S.iconPerMeter, S.iconMin, S.iconMax) * (m.kind === 'start' ? 0.8 : 1)
    const iconY = ground + (isPerson ? S.iconBasePerson : S.iconBase) + d * S.iconRise

    // 光の筋: ハンガーの印の上端から始める（印は主人公の頭より上に見えるので、筋が体や頭に重ならない）。近づいたら消す
    const [far, near] = S.beamFade
    const beamAlpha = THREE.MathUtils.clamp((d - near) / (far - near), 0, 1)
    pin.beam.visible = !personOnly && !threat && beamAlpha > 0.01 && !(isPerson && m.kind === 'goal')
    if (pin.beam.visible) {
      const r = Math.max(0.3, d * 0.007)
      pin.beam.position.y = iconY + size * S.beamFromIcon
      pin.beam.scale.set(r, S.beamLength[m.kind], r)
      pin.beam.material.color.setHex(S.color[m.kind])
      pin.beam.material.opacity = 0.55 * beamAlpha
    }

    // 見回りの「！」: 頭の上で揺れる。中にいるあいだは大きく
    pin.alarm.visible = !personOnly && threat && d < S.alarmRange
    if (pin.alarm.visible) {
      const a = THREE.MathUtils.clamp(d * 0.06, 0.32, 5) * (inside ? 1.25 + blink * 0.2 : 1)
      pin.alarm.position.y = ground + S.personHeight + 0.25 + d * 0.035 + Math.sin(frame.now * 3 + i) * 0.06 * a
      pin.alarm.scale.setScalar(a)
    }

    pin.icon.visible = !personOnly && !threat && (m.kind === 'goal' || d < S.startIconRange)
    if (pin.icon.visible) {
      const bob = Math.sin(frame.now * 2.4 + i * 1.7) * 0.14 * size
      pin.icon.position.y = iconY + bob
      pin.icon.scale.setScalar(size)
      pin.icon.rotation.y = frame.now * 1.8 + i
      for (const part of pin.icon.children as THREE.Mesh[]) part.material = iconMaterials[m.kind]
    }

    // 人（依頼人・尾行の相手）
    pin.person.visible = pin.shadow.visible = isPerson
    if (isPerson) {
      const key = outfitFor(m.ref, m.kind === 'goal' ? 11 : 3)
      if (key !== pin.personKey) {
        pin.personKey = key
        pin.person.material.map = textureOf(key)
        pin.person.material.needsUpdate = true
      }
      const w = S.personHeight * ctx.spriteAspect(key)
      if (m.moving) pin.stride += frame.dt * 1.7
      const step = m.moving ? Math.abs(Math.sin(pin.stride * Math.PI * 2)) * 0.05 : 0
      // 依頼人は、手を振る代わりに、ゆっくり体を揺らして待つ
      const sway = m.moving ? Math.sin(pin.stride * Math.PI * 2) * 0.035 : Math.sin(frame.now * 1.3 + i) * 0.02
      pin.person.position.y = ground + step
      pin.person.scale.set(w, S.personHeight, 1)
      pin.person.rotation.set(0, Math.atan2(camera.position.x - m.x, camera.position.z - m.z), sway)
      pin.shadow.position.y = ground + 0.2
      pin.shadow.scale.set(Math.max(0.7, w * 1.1), 1, 0.55)
    }
  }

  const pool: Pin[] = []
  const view = new THREE.Vector3()
  // 居残り: 直前のコマに立っていた依頼人と、いま見送っている依頼人
  let waiting: Marker[] = []
  let lingering: Marker | null = null

  return {
    update: (frame: FrameInfo) => {
      // 固定カメラ（現地写真との見比べ）のときは目印を出さない
      const markers = frame.photo ? [] : frame.view.markers
      const p = frame.state.player
      // 依頼を受けた瞬間に開始地点の印は消える。そこに立っていた依頼人は、主人公が離れるまで残す
      const active = frame.state.mission.active
      if (active && !lingering) lingering = waiting.find((m) => m.ref === active.id) ?? null
      if (lingering && (!active || active.id !== lingering.ref || Math.hypot(p.x - lingering.x, p.z - lingering.z) > S.lingerRange)) lingering = null
      waiting = markers.filter((m) => m.kind === 'start' && m.look === 'person' && !m.threat)
      const drawn = lingering && !frame.photo ? markers.length + 1 : markers.length
      while (pool.length < drawn) pool.push(makePin())

      // 奥行きの上限を、主人公（車なら車体）のすこし奥に合わせる
      const reach = view.set(p.x, p.y + 1, p.z).distanceTo(camera.position) + (frame.state.mode === 'drive' ? 3.2 : 1.2)
      const { near, far } = camera
      depthCap.value = (far + near) / (far - near) - (2 * far * near) / ((far - near) * Math.max(reach, near * 2))

      pool.forEach((pin, i) => {
        const m = i < markers.length ? markers[i] : i < drawn ? lingering : null
        pin.root.visible = m != null
        if (m) place(pin, m, i, frame, i >= markers.length)
      })
    },
    dispose: () => {
      scene.remove(group)
      for (const pin of pool) {
        pin.ring.geometry.dispose()
        pin.ring.material.dispose()
        pin.zone.geometry.dispose()
        pin.zone.material.dispose()
        pin.beam.material.dispose()
        pin.person.material.dispose()
      }
      for (const g of hanger) g.dispose()
      for (const t of textures.values()) t.dispose()
      beamGeometry.dispose()
      planeGeometry.dispose()
      shadowGeometry.dispose()
      shadowMaterial.dispose()
      fadeTexture.dispose()
      iconMaterials.start.dispose()
      iconMaterials.goal.dispose()
      alarmBar.dispose()
      alarmDot.dispose()
      alarmMaterial.dispose()
    },
  }
}
