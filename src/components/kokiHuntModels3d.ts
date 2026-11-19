import * as THREE from 'three'
import { ATTACKS, type Battle } from '../lib/kokiHunt'
import type { HuntLook } from '../lib/kokiHuntLooks'
import { batchRig, carve, surface } from './kokiHuntSculpt'

function finish(color: number, roughness = .85, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

export function makeBlade() {
  const blade = new THREE.Group()
  const leather = finish(0x221f22), binding = finish(0x956238)
  const steel = finish(0xc9dbe2, .38, .54), spine = finish(0x506b79, .55, .45)
  const brass = finish(0xb68d55, .58, .35)
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
  batchRig(blade)
  return blade
}

// A curved wooden clothes hanger, with a wire hook and a crossbar.
export function makeHanger() {
  const prop = new THREE.Group()
  const wood = finish(0xbd7241, .55), brass = finish(0xe6ce95, .31, .65)
  carve(prop, wood, [[-.79,-.23,0,.05,.044],[-.72,-.17,0,.078,.075],[-.14,.10,0,.085,.074],[0,.15,0,.095,.086],[.14,.1,0,.085,.074],[.72,-.17,0,.078,.075],[.79,-.23,0,.05,.044]], 12)
  carve(prop, wood, [[-.74,-.22,0,.035,.037],[.74,-.22,0,.035,.037]], 12)
  carve(prop, brass, [[0,.16,0,.023,.023],[0,.29,0,.023,.023],[.072,.35,0,.023,.023],[.08,.43,0,.023,.023],[.023,.48,0,.023,.023],[-.052,.47,0,.023,.023],[-.091,.405,0,.02,.02]], 10)
  batchRig(prop)
  return prop
}

export function makeScarf() {
  const prop = new THREE.Group()
  const silk = finish(0xb82837, .68), stripe = finish(0xf5ce8d, .66)
  silk.side = stripe.side = THREE.DoubleSide
  const positions: number[] = [], indices: number[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, h = .11 + .08 * Math.sin(Math.PI * t)
    const y = .19 * Math.sin(t * 7) - .22 * t, z = .28 * Math.sin(t * 5)
    positions.push(t * 2.02, y - h, z, t * 2.02, y + h, z + .055)
    const k = i * 2
    if (i) indices.push(k - 2, k, k - 1, k, k + 1, k - 1)
  }
  const jacquard: number[] = [], cloth: number[] = []
  for (let i = 0; i < 24; i++) (i % 7 === 4 || i === 22 ? jacquard : cloth).push(...indices.slice(i * 6, i * 6 + 6))
  surface(prop, silk, positions, cloth)
  surface(prop, stripe, positions, jacquard)
  batchRig(prop)
  return prop
}

export function photoActor(look: HuntLook, image: HTMLImageElement, height: number, prop: THREE.Group) {
  const [left, top, width, cropHeight] = look.crop
  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.offset.set(left / image.naturalWidth, 1 - (top + cropHeight) / image.naturalHeight)
  texture.repeat.set(width / image.naturalWidth, cropHeight / image.naturalHeight)
  texture.needsUpdate = true
  const unit = height / cropHeight
  const root = new THREE.Group(), pose = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: .35, side: THREE.DoubleSide, toneMapped: false })
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(width * unit, height), material)
  photo.position.y = height / 2
  photo.castShadow = true
  prop.position.set((look.hand[0] - left - width / 2) * unit, (cropHeight - look.hand[1] + top) * unit, .038)
  root.add(pose)
  pose.add(photo,prop)
  return { root, pose, prop, photo }
}

type Actor = ReturnType<typeof photoActor>

export function posePlayer(actor: Actor, battle: Battle, gait: number, speed: number) {
  const {pose, prop} = actor
  const hand = Math.sign(prop.position.x) || 1
  const step = Math.sin(gait) * speed
  const roll = battle.dodgeTimer > 0 ? 1 - battle.dodgeTimer / .31 : 0
  pose.position.y = Math.abs(step) * .085 + Math.sin(roll * Math.PI) * .24
  pose.rotation.z = step * .045 - Math.sin(roll * Math.PI) * .65
  pose.scale.y = 1 - Math.sin(roll * Math.PI) * .34
  prop.rotation.set(-.28, .30, -hand * (.62 + step * .07), 'YXZ')
  if (!battle.attack) return
  const t = Math.min(1, Math.max(0, 1 - battle.playerTimer / ATTACKS[battle.attack].time))
  const swing = THREE.MathUtils.smoothstep(t, .30, .85)
  const dir = battle.combo === 2 ? -hand : hand
  pose.rotation.z += dir * (.11 - .25 * swing)
  prop.rotation.set(-.34 - .90 * Math.sin(swing * Math.PI), dir * (1.08 - 2.13 * swing), dir * (1.15 - 2.76 * swing), 'YXZ')
}

export function poseRival(actor: Actor, battle: Battle) {
  const {pose, prop} = actor
  const windup = battle.phase === 'windup', strike = battle.phase === 'strike'
  const walk = battle.phase === 'prowl' ? Math.sin(battle.elapsed * 9) : 0
  const hit = battle.impactedMonster ? battle.impact : 0
  pose.position.y = Math.abs(walk) * .08
  pose.scale.y = windup ? .94 : 1
  pose.rotation.z = .032 * walk + (windup ? .13 : strike ? -.18 : 0) + hit * .22
  const sweep = battle.pattern === 'sweep'
  const t = strike ? THREE.MathUtils.clamp(1 - battle.phaseTimer / (sweep ? .26 : .43), 0, 1) : 0
  prop.rotation.set(windup ? -.6 : strike ? -.35 : -.05, strike && sweep ? t * Math.PI * 2 : .12, windup ? .93 : strike ? -.42 : -.21 + walk * .06, 'YXZ')
}
