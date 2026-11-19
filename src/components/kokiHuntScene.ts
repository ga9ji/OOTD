import * as THREE from 'three'
import { ATTACKS, CHARGE_SPEED, CHARGE_TIME, CHARGE_WIDTH, SWEEP_RADIUS, type Battle } from '../lib/kokiHunt'
import { makeBlade, makeHanger, makeScarf, photoActor, posePlayer, poseRival } from './kokiHuntModels3d'
import { RIVAL_LOOKS, type HuntLook } from '../lib/kokiHuntLooks'
import { GROUND_SCALE, groundHeight, groundPosition, makeWorld } from './kokiHuntWorld3d'

const yawOf = (x: number, z: number) => Math.atan2(x, z)

function approachAngle(current: number, goal: number, factor: number) {
  return current + Math.atan2(Math.sin(goal - current), Math.cos(goal - current)) * factor
}

function clearScene(scene: THREE.Scene) {
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Points) {
      geometries.add(node.geometry)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    }
    if (node instanceof THREE.DirectionalLight) node.shadow.dispose()
    if (node instanceof THREE.InstancedMesh) node.dispose()
  })
  geometries.forEach((geometry) => geometry.dispose())
  const textures = new Set<THREE.Texture>()
  materials.forEach((material) => {
    if (material instanceof THREE.MeshBasicMaterial && material.map) textures.add(material.map)
    material.dispose()
  })
  textures.forEach((texture) => texture.dispose())
}

function makeWarning() {
  const geometry = new THREE.PlaneGeometry(1, 1, 18, 10)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      extent: { value: new THREE.Vector2() },
      inset: { value: new THREE.Vector2() },
      clock: { value: 0 },
      danger: { value: 0 },
    },
    vertexShader: `
      varying vec2 mark;
      varying vec2 point;
      void main() {
        mark=uv-0.5;
        vec4 world=modelMatrix*vec4(position,1.0);
        point=world.xz;
        world.y=.19*sin(world.x*.28)*cos(world.z*.38)+.07*sin(world.z*.82+world.x*.37)+.075;
        gl_Position=projectionMatrix*viewMatrix*world;
      }
    `,
    fragmentShader: `
      uniform vec2 extent, inset;
      uniform float clock, danger;
      varying vec2 mark;
      varying vec2 point;
      void main() {
        vec2 xy=mark*extent;
        float radius=extent.y*.5;
        float shaft=extent.x*.5-radius;
        float distance=length(vec2(max(0.0,abs(xy.x)-shaft),xy.y))/radius;
        if(distance>=1.0 || abs(point.x)>inset.x || abs(point.y)>inset.y) discard;
        float border=smoothstep(.89,.95,distance);
        float hatch=sin((xy.x+xy.y)*9.5+clock*4.0);
        float front=1.0-smoothstep(.025,.095,abs(distance-danger));
        float stitch=step(.45,fract((xy.x+xy.y)*1.85));
        vec3 tint=mix(vec3(.61,.074,.02),vec3(1.0,.49,.105),border);
        tint=mix(tint,vec3(1.,.84,.64),front*.85+border*stitch*.12);
        float alpha=.245+smoothstep(.65,1.0,hatch)*.11+border*.52+front*.29+danger*.12;
        gl_FragColor=vec4(tint,alpha);
        #include <colorspace_fragment>
      }
    `,
  })
  const mark = new THREE.Mesh(geometry, material)
  mark.renderOrder = 2
  mark.visible = false
  return mark
}

function updateWarning(warning: ReturnType<typeof makeWarning>, battle: Battle, x: number, z: number) {
  const { uniforms } = warning.material
  const charging = battle.pattern === 'charge'
  const strike = battle.phase === 'strike'
  warning.visible = battle.phase === 'windup' || strike
  if (!warning.visible) return
  const reach = charging ? CHARGE_SPEED * (strike ? battle.phaseTimer : CHARGE_TIME) * GROUND_SCALE : 0
  const diameter = (charging ? CHARGE_WIDTH : SWEEP_RADIUS * 2) * GROUND_SCALE
  warning.scale.set(reach + diameter, 1, diameter)
  warning.rotation.y = -Math.atan2(battle.aim.y, battle.aim.x)
  warning.position.set(x + battle.aim.x * reach * .5, 0, z + battle.aim.y * reach * .5)
  uniforms.extent.value.set(reach + diameter, diameter)
  uniforms.inset.value.set(battle.field.width * GROUND_SCALE * .5, battle.field.height * GROUND_SCALE * .5)
  uniforms.clock.value = battle.elapsed
  uniforms.danger.value = strike ? 1 : THREE.MathUtils.clamp(1 - battle.phaseTimer / (battle.hunt.windup * (battle.monsterHp <= battle.hunt.hp * .35 ? .8 : 1)), 0, 1)
}

function makeSparks() {
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(new Float32Array(24 * 3), 3)
  position.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  const material = new THREE.PointsMaterial({
    color: 0xffc160, size: .125, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const group = new THREE.Points(geometry, material)
  group.frustumCulled = false
  group.renderOrder = 4
  return group
}

function updateSparks(sparks: ReturnType<typeof makeSparks>, battle: Battle, x: number, z: number) {
  sparks.visible = battle.impact > 0
  if (!sparks.visible) return
  const age = 1 - battle.impact / .24
  const points = sparks.geometry.getAttribute('position')
  for (let i = 0; i < points.count; i += 1) {
    const angle = i * 2.4
    const range = age * (.78 + i % 5 * .29)
    points.setXYZ(i, x + Math.cos(angle) * range, 1.11 + age * (1.4 + i % 7 * .2) - age ** 2 * 1.6, z + Math.sin(angle) * range)
  }
  points.needsUpdate = true
  sparks.material.opacity = Math.max(0, 1 - age)
  sparks.material.color.setHex(battle.impactedMonster ? 0xffbd57 : 0xff7b57)
}

function makeSlash() {
  const slash = new THREE.Mesh(
    new THREE.RingGeometry(.85, 1.02, 23, 1, -.86, 1.72),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a4, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  )
  slash.renderOrder = 3
  return slash
}

export function makeHuntScene(canvas: HTMLCanvasElement, initial: Battle, look: HuntLook, photos: [HTMLImageElement, HTMLImageElement]) {
  const mobile = window.matchMedia('(pointer: coarse), (max-width: 700px)').matches
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: !mobile, powerPreference: mobile ? 'default' : 'high-performance' })
  renderer.setClearColor(0x364844)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  const dust = makeWorld(scene, initial.hunt.id, mobile)
  const player = photoActor(look, photos[0], 2.10, makeBlade())
  const rivalProp = initial.hunt.id === 'cinder' ? makeHanger() : makeScarf()
  const monster = photoActor(RIVAL_LOOKS[initial.hunt.id], photos[1], 2.70, rivalProp)
  const warning = makeWarning()
  const sparks = makeSparks()
  const slash = makeSlash()
  scene.add(player.root, monster.root, warning, sparks, slash)

  const camera = new THREE.PerspectiveCamera(56, 1, .08, 175)
  const desired = new THREE.Vector3()
  const focus = new THREE.Vector3()
  const target = new THREE.Vector3()
  let yaw = yawOf(initial.monster.x - initial.player.x, initial.monster.y - initial.player.y)
  let preceding = groundPosition(initial.player, initial.field)
  let gait = 0
  let fitted = false
  let dirty = true
  let width = 0
  let height = 0
  let ratio = mobile ? 1 : 1.45
  let smoothFrameMs = 16
  let slowFrames = 0
  let lastBattle: Battle | null = null

  function frameSize() {
    const nextWidth = canvas.clientWidth
    const nextHeight = canvas.clientHeight
    if (nextWidth === 0 || nextHeight === 0) return
    if (!dirty && nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    const cap = Math.sqrt((mobile ? 720000 : 1400000) / (width * height))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio, cap))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.fov = camera.aspect < .8 ? 68 : 53
    camera.updateProjectionMatrix()
    dirty = false
  }

  function render(battle: Battle, dt: number, paused: boolean) {
    if (dt > 0 && !paused && mobile) {
      smoothFrameMs += (dt * 1000 - smoothFrameMs) * .05
      slowFrames = smoothFrameMs > 26 ? slowFrames + 1 : 0
      if (slowFrames >= 55 && ratio > .70) {
        ratio = Math.max(.7, ratio - .15)
        slowFrames = 0
        dirty = true
      }
    }
    const resized = dirty || width !== canvas.clientWidth || height !== canvas.clientHeight
    if (paused && lastBattle === battle && !resized) return
    frameSize()
    lastBattle = battle
    const p = groundPosition(battle.player, battle.field)
    const m = groundPosition(battle.monster, battle.field)
    const dx = m.x - p.x
    const dz = m.z - p.z
    const distance = Math.hypot(dx, dz)
    const driftX = p.x - preceding.x
    const driftZ = p.z - preceding.z
    const speed = dt > 0 ? Math.min(1, Math.hypot(driftX, driftZ) / dt / 8.7) : 0
    gait += speed * dt * 15
    preceding = p
    const blend = 1 - Math.exp(-dt * 9)
    if (distance > 1.6) yaw = approachAngle(yaw, yawOf(dx, dz), 1 - Math.exp(-dt * 4.2))

    player.root.position.set(p.x, groundHeight(p.x, p.z), p.z)
    monster.root.position.set(m.x, groundHeight(m.x, m.z), m.z)
    posePlayer(player, battle, gait, speed)
    poseRival(monster, battle)

    updateWarning(warning, battle, m.x, m.z)
    const impact = battle.impactedMonster ? m : p
    updateSparks(sparks, battle, impact.x, impact.z)
    slash.visible = Boolean(battle.attack && battle.playerTimer <= ATTACKS[battle.attack].time * .4)
    if (slash.visible) {
      const heavy = battle.attack === 'heavy'
      slash.material.color.setHex(heavy ? 0xffbd59 : 0xffe9d0)
      slash.material.opacity = Math.min(.81, (battle.playerTimer / ATTACKS[battle.attack!].time) * 2.3)
      slash.position.set(p.x, player.root.position.y + 1.25, p.z)
      slash.rotation.set(-1.1, yaw - Math.PI * .5, .15, 'YXZ')
      slash.scale.setScalar(heavy ? 2.46 : 1.92)
    }

    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const narrow = camera.aspect < .8
    const follow = narrow ? 6.6 : 5.4
    const shoulder = narrow ? .40 : .79
    const lift = groundHeight(p.x, p.z)
    const shake = battle.impact * (battle.impactedMonster ? .16 : .28) * Math.sin(battle.elapsed * 87)
    desired.set(p.x - sin * follow - cos * shoulder, lift + (narrow ? 3.15 : 2.91) + shake, p.z - cos * follow + sin * shoulder)
    target.set(p.x + sin * 4.1, lift + 1.48, p.z + cos * 4.1)
    if (!fitted) {
      camera.position.copy(desired)
      focus.copy(target)
      fitted = true
    } else {
      camera.position.lerp(desired, blend)
      focus.lerp(target, blend)
    }
    camera.lookAt(focus)
    for (const actor of [player, monster]) {
      actor.root.rotation.y = yawOf(camera.position.x - actor.root.position.x, camera.position.z - actor.root.position.z)
    }
    dust.position.x = Math.sin(battle.elapsed * .16) * 1.7
    dust.position.z = Math.cos(battle.elapsed * .22) * .7
    renderer.render(scene, camera)
  }

  return {
    render,
    get yaw() { return yaw },
    dispose() {
      clearScene(scene)
      renderer.dispose()
    },
  }
}
