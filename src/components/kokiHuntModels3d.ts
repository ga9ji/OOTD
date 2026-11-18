import * as THREE from 'three'
import { ATTACKS, type Battle, type HuntId } from '../lib/kokiHunt'

import { batchRig, carve, surface } from './kokiHuntSculpt'

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
  for (const cloth of [jacket, trousers, seam]) cloth.userData.grain = 'canvas'
  const binding = finish(0x956238)
  const scarf = finish(0xc5572e)
  carve(body, jacket, [[0, .04, 0, .23, .15], [0, .13, -.01, .255, .175], [0, .34, -.016, .22, .158], [0, .56, -.005, .29, .185], [0, .65, -.012, .315, .168], [0, .73, 0, .145, .116]], 20)
  carve(body, tee, [[0, .15, .135, .05, .026], [0, .44, .148, .079, .035], [0, .65, .13, .116, .05], [0, .71, .09, .091, .045]])
  for (const side of [-1, 1]) {
    carve(body, seam, [[side * .15, .68, .114, .089, .042], [side * .13, .57, .155, .076, .035], [side * .07, .45, .169, .034, .025], [side * .044, .33, .158, .008, .01]], 8)
    carve(body, binding, [[side * .17, .19, -.145, .023, .021], [side * .185, .45, -.17, .027, .026], [side * .19, .65, -.14, .036, .027], [side * .18, .69, 0, .041, .024], [side * .175, .58, .155, .031, .025], [side * .164, .28, .145, .023, .021]], 8)
  }
  carve(body, scarf, [[0, .67, 0, .143, .136], [0, .714, 0, .162, .144], [0, .75, 0, .134, .127], [0, .77, 0, .116, .115]], 18)
  const kerchief = joint(body, -.10, .71, -.105)
  carve(kerchief, scarf, [[0, 0, 0, .055, .035], [-.06, -.08, -.093, .088, .025], [-.068, -.22, -.17, .077, .023], [-.12, -.31, -.19, .042, .016], [-.15, -.39, -.20, .005, .01]], 8)
  carve(body, leather, [[0, .108, 0, .251, .177], [0, .16, 0, .254, .181]], 20)
  shape(body, 'box', brass, [.015, .133, .181], [.091, .054, .022])

  const head = joint(body, 0, .91, .01)
  shape(head, 'tube', skin, [0, -.13, 0], [.075, .16, .075])
  shape(head, 'round', skin, [0, .08, 0], [.15, .19, .147])
  shape(head, 'round', hair, [0, .175, -.014], [.165, .118, .157])
  shape(head, 'round', hair, [0, .08, -.1], [.15, .144, .08])
  shape(head, 'round', hair, [-.079, .174, .083], [.10, .082, .098]).rotation.z = .24
  shape(head, 'round', skin, [0, .079, .135], [.055, .037, .044])
  for (const side of [-1, 1]) shape(head, 'round', skin, [side * .144, .068, 0], [.027, .043, .029])
  for (const side of [-1, 1]) {
    shape(head, 'round', hair, [side * .065, .105, .132], [.027, .013, .012])
    carve(head, hair, [[side * .025, .138, .138, .009, .009], [side * .071, .147, .128, .014, .011], [side * .106, .136, .098, .005, .006]], 8)
  }
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .037
    carve(head, hair, [[x + .025, .217, .04, .055, .055], [x, .19, .096, .047, .045], [x - .025, .15 + .013 * Math.sin(i), .132 - Math.abs(x) * .28, .024, .024], [x - .04, .13 + .015 * Math.sin(i), .134 - Math.abs(x) * .3, .004, .006]], 8)
  }
  const legs = [-1, 1].map((side) => {
    const thigh = joint(body, side * .132, -.07, 0)
    carve(thigh, trousers, [[0, .025, 0, .105, .107], [0, -.14, -.01, .114, .13], [0, -.31, 0, .086, .093], [0, -.45, .014, .081, .088]])
    const ankle = joint(thigh, 0, -.46, 0)
    carve(ankle, trousers, [[0, .025, 0, .082, .084], [0, -.093, -.015, .096, .097], [0, -.21, -.012, .075, .079], [0, -.28, 0, .068, .075]])
    carve(ankle, leather, [[0, -.19, 0, .08, .091], [0, -.24, 0, .086, .097], [0, -.3, 0, .074, .082], [0, -.37, .048, .096, .148], [0, -.42, .051, .099, .154]], 14)
    for (const y of [-.24, -.29]) shape(ankle, 'box', binding, [0, y, .075], [.132, .023, .038])

    return { thigh, ankle }
  })
  const arms = [-1, 1].map((side) => {
    const shoulder = joint(body, side * .32, .62, -.014)
    carve(shoulder, jacket, [[0, .055, 0, .061, .065], [0, .023, 0, .107, .113], [side * .008, -.065, .001, .116, .12], [side * .015, -.19, 0, .085, .093], [side * .012, -.292, .012, .076, .081]])
    const elbow = joint(shoulder, 0, -.3, 0)
    carve(elbow, seam, [[0, .025, 0, .078, .084], [side * .007, -.081, -.006, .083, .088], [0, -.175, .009, .073, .076], [0, -.247, .009, .059, .068]])
    shape(elbow, 'round', skin, [0, -.3, .01], [.063, .075, .065])
    return { shoulder, elbow }
  })
  const pack = joint(body, .015, .37, -.18)
  pack.rotation.z = -.08
  carve(pack, binding, [[0, -.18, -.04, .13, .077], [0, -.13, -.065, .177, .098], [0, .08, -.06, .185, .108], [0, .16, -.045, .168, .089]], 16)
  carve(pack, leather, [[0, .135, -.05, .168, .092], [0, .082, -.086, .183, .097], [0, .014, -.132, .146, .061], [0, -.018, -.142, .082, .035]], 16)
  for (const side of [-1, 1]) {
    shape(pack, 'box', binding, [side * .093, -.052, -.16], [.028, .149, .027])
    shape(pack, 'box', brass, [side * .093, -.036, -.179], [.047, .033, .014])
  }
  carve(pack, seam, [[-.208, .169, -.047, .075, .071], [-.186, .169, -.047, .088, .083], [.17, .169, -.047, .086, .082], [.195, .169, -.047, .073, .07]], 14)
  for (const x of [-.119, .101]) carve(pack, binding, [[x, .169, -.047, .091, .086], [x + .031, .169, -.047, .091, .086]], 14)
  const blade = joint(arms[1].elbow, 0, -.31, .065)
  carve(blade, leather, [[0, -.13, 0, .041, .044], [0, -.104, 0, .052, .055], [0, .12, 0, .043, .049], [0, .17, 0, .056, .055]], 12)
  for (let i = 0; i < 5; i++) carve(blade, binding, [[0, -.09 + i * .047, 0, .049, .053], [0, -.079 + i * .047, 0, .05, .053]], 10)
  carve(blade, brass, [[-.21, .145, 0, .016, .023], [-.15, .185, 0, .036, .038], [0, .194, 0, .056, .057], [.16, .165, 0, .034, .037], [.20, .20, 0, .014, .022]], 10)
  // Forged cross-section: the bevel catches a different highlight on either side of the ridge.
  const bladeRows = [[.19, -.079, .092], [.32, -.126, .115], [.47, -.105, .118], [1.13, -.085, .15], [1.37, -.042, .149], [1.61, .117, .12]]
  for (const side of [-1, 1]) {
    const ridge: number[] = [], edge: number[] = [], ix: number[] = []
    bladeRows.forEach(([y, l, r], i) => {
      const mid = l + (r - l) * .57, depth = i === bladeRows.length - 1 ? .002 : .045
      ridge.push(l, y, 0, mid, y, side * depth)
      edge.push(mid, y, side * depth, r, y, 0)
      const a = i * 2
      if (i) ix.push(a - 2, a - 1, a, a - 1, a + 1, a)
    })
    const faces = side === 1 ? ix : ix.slice().reverse()
    surface(blade, spine, ridge, faces)
    surface(blade, steel, edge, faces)
  }
  batchRig(root)
  return { root, body, head, legs, arms, blade, kerchief }
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
  for (const scale of [charcoal, hide, lava, armor]) scale.userData.grain = 'hide'
  for (const horn of [bone, rim]) horn.userData.grain = 'horn'
  const pupil = finish(0xfccb65, .55)
  pupil.emissive.setHex(0xb83c10)
  pupil.emissiveIntensity = .6

  carve(body, hide, [[0, .12, -1.64, .28, .32], [0, .17, -1.4, .72, .62], [0, .18, -.92, 1.01, .8], [0, .10, -.52, 1.04, .77], [0, .08, -.1, .98, .79], [0, .22, .39, 1.14, .96], [0, .26, .78, 1.08, 1.01], [0, .2, 1.1, .84, .83], [0, .23, 1.45, .59, .54]], 32,
    (i, a) => .79 + .20 * Math.sin(a) + .09 * Math.cos(3 * a + i * .65))
  // Overlapping basalt plates progress from small rump scales to a high shoulder shield.
  for (let i = 0; i < 6; i++) {
    const z = -1.16 + i * .405
    const lift = .92 + .30 * Math.exp(-((z - .64) ** 2) / .46) - .20 * Math.max(0, -z)
    carve(body, armor, [[0, lift - .02, z + .25, .23, .145], [0, lift + .045, z + .11, .39, .16], [0, lift + .11, z - .04, .31, .15], [0, lift + .24, z - .30, .13, .083], [0, lift + .34, z - .48, .012, .014]], 10,
      (j, a) => .8 + .24 * Math.cos(a * 4) + j * .16)
    for (const side of [-1, 1]) {
      const x = .69 + .11 * Math.cos(z * 1.2)
      carve(body, i % 2 === 0 ? lava : rim, [[side * x, lift - .27, z + .22, .16, .14], [side * (x + .04), lift - .22, z + .09, .251, .162], [side * (x + .12), lift - .25, z - .10, .196, .115], [side * (x + .22), lift - .32, z - .36, .017, .023]], 10, (j, a) => .63 + .13 * j + .22 * Math.cos(2 * a))
    }
  }
  const head = joint(body, 0, .30, 1.16)
  carve(head, armor, [[0, .10, -.30, .52, .45], [0, .15, -.06, .66, .53], [0, .15, .25, .69, .46], [0, .082, .51, .54, .34], [0, -.04, .78, .45, .244], [0, -.061, .99, .38, .19], [0, -.051, 1.09, .265, .143]], 24)
  const jaw = joint(head, 0, -.245, .29)
  carve(jaw, charcoal, [[0, .01, -.09, .41, .222], [0, -.044, .20, .515, .20], [0, -.068, .52, .385, .147], [0, -.043, .72, .29, .104]], 16)
  for (const side of [-1, 1]) {
    shape(head, 'round', charcoal, [side * .448, -.026, .85], [.042, .064, .093])
    shape(head, 'round', pupil, [side * .568, .171, .515], [.092, .068, .134])
    shape(head, 'round', charcoal, [side * .62, .17, .58], [.043, .046, .041])
    carve(head, lava, [[side * .31, .303, .72, .089, .065], [side * .49, .295, .54, .151, .116], [side * .57, .32, .31, .16, .17], [side * .68, .31, -.09, .055, .07]], 12)
    // Swept horn with fluted base, growth rings, and a pale worn tip.
    carve(head, rim, [[side * .49, .38, .12, .31, .28], [side * .66, .53, .16, .285, .254], [side * .85, .66, .24, .25, .23], [side * .98, .74, .39, .216, .195], [side * 1.08, .83, .57, .19, .166]], 18, (i, a) => .74 + .2 * Math.cos(a * 6) + i * .045)
    carve(head, bone, [[side * 1.04, .80, .50, .206, .178], [side * 1.11, .86, .64, .181, .156], [side * 1.19, .96, .84, .143, .126], [side * 1.23, 1.10, 1.01, .10, .093], [side * 1.22, 1.24, 1.12, .063, .055], [side * 1.16, 1.40, 1.17, .008, .009]], 18, (i, a) => .74 + .07 * i + .10 * Math.cos(a * 6))
    for (let i = 0; i < 4; i++) {
      const z = .18 + i * .155, x = .475 - i * .042
      carve(jaw, bone, [[side * x, .047, z, .055, .060], [side * (x + .009), .126, z + .015, .039, .045], [side * x, .201 + (i === 2 ? .07 : 0), z + .044, .008, .007]], 8)
    }
    carve(head, armor, [[side * .56, .12, .13, .17, .146], [side * .73, .055, .01, .175, .13], [side * .80, -.02, -.12, .145, .097], [side * .91, -.16, -.37, .013, .018]], 10)
  }
  const legs = [-1, 1].flatMap((side) => [-.94, .89].map((z) => {
    const limb = joint(body, side * .72, -.23, z)
    const bend = z > 0 ? -.135 : .205
    carve(limb, z > 0 ? lava : hide, [[0, .25, 0, .229, .27], [side * .022, .09, -.03, .352, .391], [side * .031, -.13, 0, .369, .398], [side * .048, -.31, bend * .42, .285, .302], [side * .05, -.48, bend, .214, .232], [side * .055, -.56, bend, .19, .192]], 18)
    carve(limb, charcoal, [[side * .05, -.42, bend * .88, .209, .212], [side * .05, -.54, bend, .214, .204], [side * .05, -.68, bend * .41, .164, .152], [side * .052, -.79, .064, .176, .154], [side * .05, -.86, .115, .207, .198]], 16)
    carve(limb, armor, [[side * .05, -.79, .01, .168, .085], [side * .05, -.806, .153, .252, .158], [side * .05, -.842, .30, .264, .137], [side * .05, -.872, .421, .206, .078]], 16)
    for (let n = -1; n < 2; n += 1) horn(limb, [n * .135, -.82, .38], [n * .15, -.89, .54], .075, bone)
    return limb
  }))
  const tail = joint(body, 0, .24, -1.41)
  carve(tail, hide, [[0, 0, .18, .41, .35], [0, -.025, -.31, .39, .30], [0, -.09, -.70, .285, .205], [0, -.12, -1.09, .19, .151]])
  const tip = joint(tail, 0, -.12, -1.04)
  carve(tip, armor, [[0, 0, .05, .203, .159], [0, .015, -.27, .23, .18], [0, .09, -.53, .284, .209], [0, .18, -.79, .214, .14], [0, .36, -1.05, .117, .079], [0, .52, -1.19, .018, .017]], 14)
  for (const side of [-1, 1]) carve(tip, rim, [[side * .15, .13, -.45, .119, .12], [side * .26, .18, -.58, .097, .082], [side * .36, .27, -.79, .013, .016]], 9)

  return { root, body, head, jaw, legs, tail, tip, wings: [] as THREE.Group[] }
}

function wingPanel(parent: THREE.Object3D, side: number, cover: Surface, membrane: Surface) {
  const hinge = joint(parent, side * .4, .39, .1)
  // Fingers fan from the wrist. Between each pair the sail bows and the trailing edge scallops.
  const wrist = new THREE.Vector3(side * .99, .35, .59)
  const rays = [[3.13, -.26, -.39], [2.73, -.29, -1.13], [2.16, -.30, -1.67], [1.54, -.21, -1.79], [.88, -.13, -1.54], [.16, -.02, -1.06], [0, 0, 0]]
    .map(([x, y, z]) => new THREE.Vector3(x * side, y, z))
  const ink = new THREE.Color(0x323c52), amber = new THREE.Color(0xe6ab79), teal = new THREE.Color(0x60908d)
  const vertices: number[] = [], colors: number[] = [], indices: number[] = []
  const bands = 12, slices = 8
  for (let panel = 0; panel < rays.length - 1; panel++) {
    const base = vertices.length / 3
    for (let j = 0; j <= slices; j++) for (let i = 0; i <= bands; i++) {
      const u = j / slices, t = i / bands, web = Math.sin(u * Math.PI)
      const span = t * (1 - .145 * web * t * t)
      const v = wrist.clone().lerp(rays[panel].clone().lerp(rays[panel + 1], u), span)
      v.y += .19 * Math.sin(t * Math.PI) * web + .082 * t * (1 - t)
      vertices.push(v.x, v.y, v.z)
      const band = t + .065 * web + .018 * panel
      const color = teal.clone().lerp(amber, Math.max(0, 1 - Math.abs(band - .68) * 4)).lerp(ink, Math.min(1, .21 + .63 * t ** 5 + .42 * (1 - web) ** 4))
      colors.push(color.r, color.g, color.b)
      if (i && j) {
        const d = base + j * (bands + 1) + i, a = d - bands - 2
        // At the shared wrist the inner edge collapses to a point.
        if (i > 1) indices.push(a, a + 1, d - 1)
        indices.push(a + 1, d, d - 1)
      }
    }
  }
  if (side < 0) indices.reverse()
  surface(hinge, membrane, vertices, indices, colors)
  carve(hinge, cover, [[0, 0, 0, .21, .18], [side * .35, .13, .14, .166, .131], [side * .62, .18, .37, .115, .098], [wrist.x, wrist.y, wrist.z, .113, .109]], 14)
  for (const [i, ray] of rays.slice(0, -1).entries()) {
    const center = wrist.clone().lerp(ray, .48)
    const w = i === 0 ? .119 : .055
    carve(hinge, cover, [[wrist.x, wrist.y, wrist.z, w, w], [center.x, center.y + .018, center.z, w * .64, w * .61], [ray.x, ray.y, ray.z, .012, .012]], 10)
  }
  carve(hinge, cover, [[wrist.x, wrist.y, wrist.z, .085, .087], [side * 1.08, .41, .73, .058, .06], [side * 1.06, .46, .84, .012, .012]], 10)
  return hinge
}

function makeGale() {
  const root = new THREE.Group()
  const body = joint(root, 0, 1.55, 0)
  const blue = finish(0x3d6571)
  const jade = finish(0x688d79)
  const cream = finish(0xd0c497)
  const deep = finish(0x263d44)
  for (const scale of [blue, jade, deep]) scale.userData.grain = 'hide'
  const pink = finish(0xffffff, .9)
  pink.side = THREE.DoubleSide
  const eye = finish(0xffe19a, .5)
  eye.emissive.setHex(0x84801b)
  eye.emissiveIntensity = .5
  carve(body, jade, [[0, -.06, -1.31, .17, .23], [0, 0, -1.04, .39, .39], [0, .015, -.70, .535, .48], [0, .045, -.30, .56, .51], [0, .05, .10, .625, .625], [0, .13, .44, .62, .638], [0, .17, .75, .51, .50], [0, .25, 1.04, .36, .365], [0, .33, 1.27, .28, .29]], 26,
    (i, a) => .73 + .25 * Math.sin(a) + .14 * Math.cos(i * 1.5 + 2 * a))
  carve(body, cream, [[0, -.29, -.74, .185, .14], [0, -.32, -.36, .339, .18], [0, -.35, .09, .42, .206], [0, -.28, .55, .406, .22], [0, -.09, .89, .29, .19], [0, .11, 1.13, .22, .13]], 18)
  for (let i = 0; i < 7; i++) {
    const z = -.98 + i * .31, y = .40 + .285 * Math.cos((z - .38) * 1.53)
    carve(body, blue, [[0, y, z + .09, .093, .104], [0, y + .142, z, .102, .105], [0, y + .28, z - .1, .071, .061], [0, y + .38, z - .25, .008, .01]], 10)
  }
  const head = joint(body, 0, .31, 1.00)
  carve(head, jade, [[0, .035, -.30, .235, .28], [0, .105, -.08, .334, .327], [0, .13, .14, .409, .364], [0, .095, .36, .413, .287], [0, .062, .57, .293, .207], [0, .016, .75, .186, .136]], 22)
  carve(head, cream, [[0, .035, .54, .241, .147], [0, .041, .73, .235, .152], [0, .018, .93, .186, .116], [0, -.025, 1.09, .114, .082], [0, -.092, 1.20, .049, .054], [0, -.155, 1.22, .009, .017]], 16)
  const jaw = joint(head, 0, -.14, .32)
  carve(jaw, deep, [[0, .00, 0, .265, .137], [0, -.017, .24, .239, .117], [0, -.027, .51, .163, .077], [0, .003, .72, .067, .041], [0, .016, .77, .013, .02]], 14)
  for (const side of [-1, 1]) {
    shape(head, 'round', deep, [side * .34, .16, .415], [.095, .092, .14])
    shape(head, 'round', eye, [side * .389, .171, .435], [.068, .054, .094])
    shape(head, 'round', deep, [side * .441, .172, .453], [.022, .037, .022])
    for (let i = 0; i < 3; i++) {
      const x = .27 + i * .055, y = .30 - i * .114, z = .38 - i * .11
      carve(head, i === 0 ? cream : blue, [[side * x, y, z, .083, .082], [side * (x + .09), y + .074, z - .15, .108, .101], [side * (x + .17), y + .181, z - .36, .088, .065], [side * (x + .23), y + .29, z - .54, .045, .033], [side * (x + .25), y + .36, z - .72, .008, .008]], 10)
    }
  }
  const wings = [-1, 1].map((side) => wingPanel(body, side, blue, pink))
  const legs = [-1, 1].map((side) => {
    const limb = joint(body, side * .38, -.4, -.33)
    carve(limb, blue, [[0, .13, .02, .188, .193], [side * .04, -.10, .105, .184, .212], [side * .07, -.32, .175, .131, .136], [side * .065, -.44, .108, .091, .093], [side * .05, -.65, -.13, .079, .075], [side * .05, -.72, -.174, .069, .069]], 14)
    carve(limb, cream, [[side * .05, -.67, -.15, .077, .08], [side * .054, -.77, -.112, .061, .069], [side * .058, -.93, .08, .064, .071], [side * .058, -1.01, .158, .098, .06]], 12)
    for (let n = -1; n < 2; n++) carve(limb, deep, [[side * .055, -1, .13, .051, .05], [side * .055 + n * .085, -1.021, .25, .049, .042], [side * .055 + n * .15, -1.034, .4, .028, .03], [side * .055 + n * .153, -1.095, .475, .005, .009]], 9)
    return limb
  })
  const tail = joint(body, 0, -.05, -.96)
  carve(tail, jade, [[0, 0, .14, .326, .32], [0, -.07, -.32, .28, .253], [0, -.19, -.67, .202, .184], [0, -.24, -1.04, .134, .142], [0, -.23, -1.44, .091, .096]], 16)
  const tip = joint(tail, 0, -.23, -1.39)
  carve(tip, blue, [[0, 0, .075, .109, .107], [0, .043, -.26, .098, .096], [0, .12, -.56, .072, .083], [0, .24, -.97, .044, .054], [0, .34, -1.26, .01, .019]], 14)
  for (const side of [-1, 1]) carve(tip, jade, [[side * .019, .12, -.43, .054, .065], [side * .11, .14, -.60, .121, .061], [side * .18, .18, -.81, .122, .047], [side * .20, .23, -1.02, .065, .029], [side * .17, .29, -1.21, .008, .008]], 10)
  return { root, body, head, jaw, legs, tail, tip, wings }
}

export function makeMonster(id: HuntId) {
  const model = id === 'cinder' ? makeCinder() : makeGale()
  batchRig(model.root)
  return model
}

export function poseHunter(model: ReturnType<typeof makeHunter>, battle: Battle, gait: number, motion: number) {
  const { body, legs, arms, blade } = model
  const running = Math.min(1, motion)
  model.kerchief.rotation.set(.06 + running * .40, .13 * Math.sin(battle.elapsed * 4 + gait), running * .13 * Math.sin(gait))
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
  tail.rotation.y = Math.sin(time * 4) * .23
  model.tip.rotation.y = Math.sin(time * 4 - .78) * .32
  model.tip.rotation.x = .10 * Math.sin(time * 3 - .55) + windup * .23
  head.rotation.z = Math.sin(time * 2.1) * .038 * (1 - strike)
  legs.forEach((leg, i) => { leg.rotation.x = Math.sin(time * 10 + (gale ? i : [0, 1, 1, 0][i]) * Math.PI) * (walking * .34 + strike * .51) })
  wings.forEach((wing, i) => {
    const side = i === 0 ? -1 : 1
    wing.rotation.z = side * (.16 + .075 * Math.sin(time * 3) + windup * .64 + strike * Math.sin(time * 22) * .59 + recovery * -.26)
    wing.rotation.y = side * (-.21 + recovery * -.41)
  })
}
