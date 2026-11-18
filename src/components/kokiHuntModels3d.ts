import * as THREE from 'three'
import { ATTACKS, type Battle, type HuntId } from '../lib/kokiHunt'

const sphere = new THREE.SphereGeometry(1, 12, 8)
const box = new THREE.BoxGeometry(1, 1, 1)
const cone = new THREE.ConeGeometry(1, 1, 6)
const taper = new THREE.CylinderGeometry(.82, 1, 1, 8)
const up = new THREE.Vector3(0, 1, 0)

type Shape = 'round' | 'box' | 'tip' | 'tube'
type V = [number, number, number]
type Surface = THREE.MeshStandardMaterial

export function finish(color: number, roughness = .85, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

export function shape(parent: THREE.Object3D, form: Shape, material: Surface, position: V, dimensions: V) {
  const geometry = { round: sphere, box, tip: cone, tube: taper }[form]
  // シーンごとに寿命を管理するため、キャッシュした原型から複製する。
  const part = new THREE.Mesh(geometry.clone(), material)
  part.position.set(...position)
  part.scale.set(...dimensions)
  part.castShadow = true
  part.receiveShadow = true
  parent.add(part)
  return part
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const limb = new THREE.Group()
  limb.position.set(x, y, z)
  parent.add(limb)
  return limb
}

function horn(parent: THREE.Object3D, start: V, end: V, radius: number, material: Surface) {
  const a = new THREE.Vector3(...start)
  const b = new THREE.Vector3(...end)
  const direction = b.clone().sub(a)
  const length = direction.length()
  const center = a.addScaledVector(direction, .5)
  const spike = shape(parent, 'tip', material, [center.x, center.y, center.z], [radius, length, radius])
  spike.quaternion.setFromUnitVectors(up, direction.normalize())
  return spike
}

export function makeHunter() {
  const root = new THREE.Group()
  const body = joint(root, 0, .98, 0)
  const jacket = finish(0x222b35, .93)
  const seam = finish(0x3a4450, .88)
  const tee = finish(0xe4e2d1)
  const trousers = finish(0x4a4b52)
  const leather = finish(0x221f22)
  const skin = finish(0xc99378, .88)
  const hair = finish(0x242126, .93)
  const steel = finish(0xc9dbe2, .38, .54)
  const spine = finish(0x506b79, .55, .45)
  const brass = finish(0xb68d55, .58, .35)
  shape(body, 'tube', trousers, [0, .02, 0], [.23, .28, .15])
  shape(body, 'tube', jacket, [0, .39, 0], [.29, .67, .19])
  shape(body, 'box', tee, [0, .41, .17], [.31, .5, .06])
  for (const side of [-1, 1]) {
    const lapel = shape(body, 'box', seam, [side * .148, .51, .204], [.07, .35, .034])
    lapel.rotation.z = side * -.25
    shape(body, 'box', leather, [side * .09, .16, .2], [.018, .02, .018])
  }
  const head = joint(body, 0, .91, .01)
  shape(head, 'tube', skin, [0, -.13, 0], [.075, .16, .075])
  shape(head, 'round', skin, [0, .08, 0], [.15, .19, .147])
  shape(head, 'round', hair, [0, .175, -.014], [.165, .118, .157])
  shape(head, 'round', hair, [0, .08, -.1], [.15, .144, .08])
  shape(head, 'round', hair, [-.079, .174, .083], [.10, .082, .098]).rotation.z = .24
  shape(head, 'round', skin, [0, .079, .135], [.055, .037, .044])
  for (const side of [-1, 1]) shape(head, 'round', skin, [side * .144, .068, 0], [.027, .043, .029])
  const legs = [-1, 1].map((side) => {
    const thigh = joint(body, side * .132, -.07, 0)
    shape(thigh, 'tube', trousers, [0, -.22, 0], [.099, .45, .103])
    const ankle = joint(thigh, 0, -.46, 0)
    shape(ankle, 'tube', trousers, [0, -.172, 0], [.078, .4, .084])
    shape(ankle, 'round', leather, [0, -.38, .052], [.094, .076, .153])
    return { thigh, ankle }
  })
  const arms = [-1, 1].map((side) => {
    const shoulder = joint(body, side * .32, .62, -.014)
    shape(shoulder, 'round', jacket, [0, -.043, 0], [.12, .145, .12])
    shape(shoulder, 'tube', jacket, [0, -.17, 0], [.087, .32, .092])
    const elbow = joint(shoulder, 0, -.3, 0)
    shape(elbow, 'tube', seam, [0, -.12, 0], [.071, .28, .075])
    shape(elbow, 'round', skin, [0, -.3, .01], [.063, .075, .065])
    return { shoulder, elbow }
  })
  const bag = shape(body, 'box', leather, [0, .37, -.205], [.32, .38, .15])
  bag.rotation.z = -.12
  shape(body, 'box', seam, [.008, .43, -.286], [.23, .22, .02])
  for (const side of [-1, 1]) shape(body, 'box', leather, [side * .17, .45, .09], [.043, .43, .05])

  const blade = joint(arms[1].elbow, 0, -.31, .065)
  shape(blade, 'tube', leather, [0, .03, 0], [.047, .27, .05])
  shape(blade, 'box', brass, [0, .19, 0], [.36, .065, .10])
  shape(blade, 'box', spine, [-.016, .79, 0], [.19, 1.17, .09])
  const edge = shape(blade, 'box', steel, [.063, .78, 0], [.06, 1.18, .055])
  edge.rotation.z = -.029
  horn(blade, [0, 1.35, 0], [.04, 1.56, 0], .103, steel)

  return { root, body, head, legs, arms, blade }
}

function makeCinder() {
  const root = new THREE.Group()
  const body = joint(root, 0, 1.15, 0)
  const charcoal = finish(0x322c29)
  const hide = finish(0x704438)
  const lava = finish(0x93533a, .89)
  const armor = finish(0x392e2a, .94)
  const rim = finish(0xb7774d, .92)
  const bone = finish(0xd3ab7a)
  const pupil = finish(0xfccb65, .55)
  pupil.emissive.setHex(0xb83c10)
  pupil.emissiveIntensity = .6

  shape(body, 'round', charcoal, [0, -.14, .07], [.98, .82, 1.47])
  shape(body, 'round', hide, [0, .22, -.15], [1.17, .9, 1.64])
  shape(body, 'round', lava, [0, .22, .73], [.91, .97, 1.00])
  shape(body, 'round', armor, [0, .64, -.38], [.98, .65, 1.41])
  for (let i = 0; i < 6; i += 1) {
    const z = -1.33 + i * .45
    const height = .7 + .23 * Math.sin(i / 6 * Math.PI)
    const ridge = shape(body, 'tip', i % 2 === 0 ? rim : lava, [0, 1.03, z], [.41, height, .37])
    ridge.rotation.x = -.4
    for (const side of [-1, 1]) {
      const scale = shape(body, 'round', i % 2 === 0 ? armor : hide, [side * .83, .48, z], [.3, .29, .39])
      scale.rotation.z = side * -.34
    }
  }
  const head = joint(body, 0, .30, 1.16)
  shape(head, 'round', hide, [0, .08, .14], [.68, .61, .81])
  shape(head, 'round', armor, [0, .24, .33], [.63, .44, .64])
  const jaw = joint(head, 0, -.25, .45)
  shape(jaw, 'round', charcoal, [0, -.01, .25], [.52, .24, .59])
  shape(head, 'round', lava, [0, -.11, .72], [.53, .3, .51])
  for (const side of [-1, 1]) {
    const eye = shape(head, 'round', pupil, [side * .51, .14, .53], [.063, .059, .12])
    eye.rotation.y = side * .2
    horn(head, [side * .43, .36, .24], [side * .81, .69, .57], .24, bone)
    horn(head, [side * .77, .66, .53], [side * 1.04, .98, 1.20], .145, bone)
    horn(head, [side * .59, .05, .22], [side * .87, .10, -.13], .14, rim)
    horn(jaw, [side * .31, .05, .60], [side * .29, .26, .65], .085, bone)
  }
  const legs = [-1, 1].flatMap((side) => [-.94, .89].map((z) => {
    const limb = joint(body, side * .72, -.23, z)
    shape(limb, 'round', z > 0 ? lava : hide, [0, -.13, 0], [.37, .55, .43])
    shape(limb, 'tube', charcoal, [side * .05, -.58, .04], [.23, .55, .22])
    shape(limb, 'round', armor, [side * .05, -.83, .19], [.27, .13, .36])
    for (let n = -1; n < 2; n += 1) horn(limb, [n * .135, -.82, .38], [n * .15, -.89, .54], .075, bone)
    return limb
  }))
  const tail = joint(body, 0, .24, -1.41)
  horn(tail, [0, 0, 0], [0, -.08, -1.21], .36, hide)
  horn(tail, [0, -.08, -.9], [0, .28, -1.95], .23, armor)
  horn(tail, [0, .15, -1.75], [0, .53, -2.39], .14, rim)
  return { root, body, head, jaw, legs, tail, wings: [] as THREE.Group[] }
}

function wingPanel(parent: THREE.Object3D, side: number, cover: Surface, membrane: Surface) {
  const hinge = joint(parent, side * .4, .39, .1)
  const points = new Float32Array([
    0, 0, 0, side * 1.0, .27, .64, side * 2.18, -.09, .27,
    side * 3.12, -.34, -.46, side * 2.22, -.28, -1.77, side * 1.39, -.13, -1.53, side * .67, -.04, -1.20,
  ])
  const wing = new THREE.BufferGeometry()
  wing.setAttribute('position', new THREE.BufferAttribute(points, 3))
  wing.setIndex([0, 1, 6, 1, 2, 5, 1, 5, 6, 2, 3, 4, 2, 4, 5])
  wing.computeVertexNormals()
  const skin = new THREE.Mesh(wing, membrane)
  skin.castShadow = true
  hinge.add(skin)
  horn(hinge, [0, 0, 0], [side * 1, .27, .64], .20, cover)
  horn(hinge, [side * .84, .27, .58], [side * 3.12, -.34, -.46], .14, cover)
  horn(hinge, [side * 1, .27, .64], [side * 2.22, -.28, -1.77], .09, cover)
  horn(hinge, [side * .81, .15, .45], [side * 1.39, -.13, -1.53], .07, cover)
  return hinge
}

function makeGale() {
  const root = new THREE.Group()
  const body = joint(root, 0, 1.55, 0)
  const blue = finish(0x3d6571)
  const jade = finish(0x688d79)
  const cream = finish(0xd0c497)
  const deep = finish(0x263d44)
  const pink = finish(0x8d6e67, .9)
  pink.side = THREE.DoubleSide
  const eye = finish(0xffe19a, .5)
  eye.emissive.setHex(0x84801b)
  eye.emissiveIntensity = .5
  shape(body, 'round', blue, [0, -.12, 0], [.63, .59, 1.3])
  shape(body, 'round', cream, [0, -.37, .41], [.5, .29, .89])
  shape(body, 'round', jade, [0, .24, .2], [.66, .41, 1.27])
  for (let i = 0; i < 6; i += 1) horn(body, [0, .36, -.97 + i * .37], [0, .8, -1.16 + i * .4], .16, deep)
  const head = joint(body, 0, .3, 1.02)
  shape(head, 'round', jade, [0, .08, .31], [.42, .43, .71])
  horn(head, [0, .047, .62], [0, -.033, 1.35], .28, cream)
  const jaw = joint(head, 0, -.145, .35)
  horn(jaw, [0, 0, 0], [0, -.05, .8], .205, deep)
  for (const side of [-1, 1]) {
    shape(head, 'round', eye, [side * .353, .17, .55], [.057, .061, .087])
    horn(head, [side * .25, .28, .3], [side * .58, .75, -.21], .18, cream)
  }
  const wings = [-1, 1].map((side) => wingPanel(body, side, blue, pink))
  const legs = [-1, 1].map((side) => {
    const limb = joint(body, side * .38, -.4, -.33)
    shape(limb, 'tube', deep, [0, -.42, 0], [.17, .89, .2])
    shape(limb, 'round', blue, [0, -.88, .14], [.2, .14, .26])
    for (let n = -1; n < 2; n += 1) horn(limb, [n * .09, -.9, .23], [n * .1, -.99, .53], .065, cream)
    return limb
  })
  const tail = joint(body, 0, -.05, -.96)
  horn(tail, [0, 0, 0], [0, -.28, -2.09], .43, jade)
  horn(tail, [0, -.27, -1.74], [0, .23, -3.02], .14, blue)
  return { root, body, head, jaw, legs, tail, wings }
}

export function makeMonster(id: HuntId) {
  return id === 'cinder' ? makeCinder() : makeGale()
}

export function poseHunter(model: ReturnType<typeof makeHunter>, battle: Battle, gait: number, motion: number) {
  const { body, legs, arms, blade } = model
  const running = Math.min(1, motion)
  const walking = Math.sin(gait) * running
  body.position.y = .98 + Math.abs(walking) * .056
  body.rotation.set(running * .16, 0, 0)
  legs.forEach(({ thigh, ankle }, i) => {
    thigh.rotation.x = walking * .76 * (i === 0 ? 1 : -1)
    ankle.rotation.x = Math.max(0, -thigh.rotation.x) * 1.04
  })
  arms[0].shoulder.rotation.set(-.05 - walking * .48, 0, -.1)
  arms[1].shoulder.rotation.set(-.33 + walking * .2, 0, .22)
  arms[0].elbow.rotation.x = -.32
  arms[1].elbow.rotation.x = -1.1
  blade.rotation.set(-.5, 0, -.14)
  if (battle.attack) {
    const swing = 1 - battle.playerTimer / ATTACKS[battle.attack].time
    const release = Math.max(0, (swing - .65) / .35)
    const direction = battle.combo === 2 ? -1 : 1
    body.rotation.y = direction * (-.36 + release * 1.03)
    arms[1].shoulder.rotation.set(-1.2 + release * 1.9, direction * (-.65 + release * 1.44), .63)
    arms[1].elbow.rotation.x = battle.attack === 'heavy' ? -1.92 + release * 1.7 : -1.33 + release * 1.02
  } else if (battle.dodgeTimer > 0) {
    const roll = 1 - battle.dodgeTimer / .31
    body.position.y = .8 - .46 * Math.sin(roll * Math.PI)
    body.rotation.x = -roll * Math.PI * 2
    legs.forEach(({ thigh, ankle }) => {
      thigh.rotation.x = -.8
      ankle.rotation.x = 1.06
    })
  }
}

export function poseMonster(model: ReturnType<typeof makeMonster>, battle: Battle) {
  const { body, head, jaw, legs, tail, wings } = model
  const gale = battle.hunt.id === 'gale'
  const time = battle.elapsed
  const windup = battle.phase === 'windup' ? 1 : 0
  const strike = battle.phase === 'strike' ? 1 : 0
  const recovery = battle.phase === 'recover' ? 1 : 0
  const walking = battle.phase === 'prowl' ? 1 : 0
  const rise = windup * Math.sin(time * 16) * .045 + strike * (gale ? .42 : -.15)
  body.position.y = (gale ? 1.55 : 1.15) + Math.sin(time * (5 + walking * 5)) * .065 + rise
  body.rotation.x = windup * -.18 + recovery * .15 + strike * .11
  body.rotation.z = gale && strike ? Math.sin(time * 24) * .18 : 0
  head.rotation.x = windup * -.33 + recovery * .20 + strike * .15
  jaw.rotation.x = windup * .4 + strike * .32
  tail.rotation.y = Math.sin(time * 5) * .27
  legs.forEach((leg, i) => { leg.rotation.x = Math.sin(time * 10 + i * Math.PI) * (walking * .34 + strike * .51) })
  wings.forEach((wing, i) => {
    const side = i === 0 ? -1 : 1
    wing.rotation.z = side * (.16 + windup * .64 + strike * Math.sin(time * 22) * .59 + recovery * -.26)
    wing.rotation.y = side * (-.21 + recovery * -.41)
  })
}
