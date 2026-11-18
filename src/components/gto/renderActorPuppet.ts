// Grand Theft Outfit [部品: onfoot の見た目] くり抜き写真を部位に切り分けて、関節でつないだ体。
// 入口: createPuppetKit(mobile) → kit.make(look, castShadow) → puppet.apply(pose) / puppet.setLook(look)
// 契約: 部位（頭・首・胴・腰・上腕/前腕/手・腿/すね/足）は厚みのある筒で、写真から作った1枚の絵
//       （lib/gto/spritePuppet.ts の升目）を前と後ろから貼る。関節の角度は lib/gto/onFootRig.ts の RigPose。
//       体の座標は「+z が前・+x が左・+y が上」、長さは人の身長を 1 とする（root の拡大率が身長 m）。
//       陰影は頂点の色に焼いてあり（輪郭へ向かって暗い）、光の計算はしない。
import * as THREE from 'three'
import { armTurn, HUNCH_SET, RIG_DIM, type ArmPose, type LegPose, type RigPose } from '../../lib/gto/onFootRig'
import { SHOULDER_SET } from '../../lib/gto/onFootRigView'
import { PUPPET_ATLAS, PUPPET_CELLS, type PuppetCell, type PuppetDims } from '../../lib/gto/spritePuppet'

/** 見た目を決める数字（身長に対する割合） */
export const PUPPET_STYLE = {
  /** 筒の角の数 [PC, スマホ] */
  sides: [10, 6],
  /** 輪郭へ向かって暗くする割合と、下面の暗さ */
  rim: 0.34,
  under: 0.6,
  /** 胴の厚み（前後の半分） */
  chestDeep: 0.078,
  waistDeep: 0.068,
  /** 腕の太さ（肩・肘・手首・指先） */
  arm: [0.048, 0.044, 0.037, 0.034],
  /** 肩の付け根を肩の端から内へ寄せる量と、肩から下げる量（lib の rearView と同じ値） */
  shoulderIn: SHOULDER_SET.in,
  shoulderDown: SHOULDER_SET.down,
  /** 脚の前後の厚み（付け根・膝・足首） */
  legDeep: [0.058, 0.046, 0.036],
  /** 足の長さ（かかとの後ろ・つま先の前） */
  heel: 0.03,
  toe: 0.08,
  headWide: 0.058,
  headDeep: 0.068,
  neck: 0.027,
}

export interface PuppetLook {
  material: THREE.MeshBasicMaterial
  /** 頭の切り抜きの板に貼る絵（後ろ姿と正面の写真） */
  headBack: THREE.MeshBasicMaterial
  headFront: THREE.MeshBasicMaterial
  dims: PuppetDims
}

interface Ring {
  y: number
  rx: number
  rz: number
  /** 前後の中心のずれ */
  cz?: number
}

/** 升目の中の位置 → UV。u は体の左→右、v は上→下（0..1） */
function cellUv(cell: PuppetCell, u: number, v: number): [number, number] {
  const [x, y, w, h] = PUPPET_CELLS[cell]
  const px = x + 0.5 + Math.min(1, Math.max(0, u)) * (w - 1)
  const py = y + 0.5 + Math.min(1, Math.max(0, v)) * (h - 1)
  return [px / PUPPET_ATLAS, 1 - py / PUPPET_ATLAS]
}

/**
 * 輪切りを積んだ筒。前半分には front、後ろ半分には back の升目を、前後から投影して貼る。
 * v0..v1 は升目の中で使う縦の範囲（上が v0）。
 */
function tube(rings: Ring[], sides: number, front: PuppetCell, back: PuppetCell, v0 = 0, v1 = 1): THREE.BufferGeometry {
  const S = PUPPET_STYLE
  const pos: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const yTop = rings[0].y
  const yBot = rings[rings.length - 1].y
  const point = (r: Ring, i: number) => {
    const a = (i / sides) * Math.PI * 2
    return { x: Math.cos(a) * r.rx, y: r.y, z: (r.cz ?? 0) + Math.sin(a) * r.rz, nz: Math.sin(a) }
  }
  const push = (p: { x: number; y: number; z: number; nz: number }, r: Ring, cell: PuppetCell, shade: number) => {
    pos.push(p.x, p.y, p.z)
    const t = yTop === yBot ? 0 : (yTop - p.y) / (yTop - yBot)
    uv.push(...cellUv(cell, 0.5 - p.x / (2 * Math.max(1e-4, r.rx)), v0 + (v1 - v0) * t))
    const k = shade * (1 - S.rim * (1 - Math.abs(p.nz)) ** 1.5)
    col.push(k, k, k)
  }
  for (let j = 0; j < rings.length - 1; j++) {
    const a = rings[j]
    const b = rings[j + 1]
    for (let i = 0; i < sides; i++) {
      const cell = Math.sin(((i + 0.5) / sides) * Math.PI * 2) >= 0 ? front : back
      const p00 = point(a, i)
      const p01 = point(a, i + 1)
      const p10 = point(b, i)
      const p11 = point(b, i + 1)
      // 外から見て反時計回り
      push(p00, a, cell, 1)
      push(p01, a, cell, 1)
      push(p10, b, cell, 1)
      push(p01, a, cell, 1)
      push(p11, b, cell, 1)
      push(p10, b, cell, 1)
    }
  }
  // ふた（上は明るく、下は暗く）
  const cap = (r: Ring, up: boolean) => {
    const c = { x: 0, y: r.y, z: r.cz ?? 0, nz: 1 }
    for (let i = 0; i < sides; i++) {
      const cell = Math.sin(((i + 0.5) / sides) * Math.PI * 2) >= 0 ? front : back
      const p = point(r, i)
      const q = point(r, i + 1)
      const shade = up ? 1 : S.under
      const tri = up ? [c, q, p] : [c, p, q]
      for (const v of tri) push({ ...v, nz: 1 }, r, cell, shade)
    }
  }
  cap(rings[0], true)
  cap(rings[rings.length - 1], false)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

/** 全員で使い回す部位の形。横幅が 1 のものは、置くときに肩幅・脚の太さを掛ける */
function makeShapes(mobile: boolean) {
  const S = PUPPET_STYLE
  const D = RIG_DIM
  const n = S.sides[mobile ? 1 : 0]
  const head: Ring[] = []
  const bands = mobile ? 4 : 6
  for (let i = 0; i <= bands; i++) {
    const a = (i / bands) * Math.PI
    const r = Math.max(0.12, Math.sin(a))
    head.push({ y: (D.head / 2) * Math.cos(a), rx: S.headWide * r, rz: S.headDeep * r })
  }
  const limb = (len: number, r0: number, r1: number, cell: PuppetCell, v0: number, v1: number) =>
    tube(
      [
        { y: 0.004, rx: r0, rz: r0 },
        { y: -len, rx: r1, rz: r1 },
      ],
      n,
      cell,
      cell,
      v0,
      v1,
    )
  const leg = (len: number, w0: number, w1: number, d0: number, d1: number, cell: PuppetCell) =>
    tube(
      [
        { y: 0.006, rx: w0, rz: d0 },
        { y: -len, rx: w1, rz: d1 },
      ],
      n,
      cell,
      cell,
    )
  return {
    // 胴: 腰 → 胴まわり → 胸 → 肩 → 首の付け根（横幅は肩の半幅を 1 とする）
    torso: tube(
      [
        { y: D.torso + 0.012, rx: 0.42, rz: 0.04 },
        { y: D.torso - 0.012, rx: 0.97, rz: S.chestDeep * 0.82 },
        { y: D.torso * 0.72, rx: 1, rz: S.chestDeep },
        { y: D.torso * 0.3, rx: 0.9, rz: S.waistDeep },
        { y: -0.01, rx: 0.9, rz: S.waistDeep },
      ],
      n,
      'torsoFront',
      'torsoBack',
    ),
    // 腰: 胴の裾と脚の付け根のすきまを埋める（横幅は肩の半幅が 1、高さ 1 が腿の長さ）
    hip: tube(
      [
        { y: 0, rx: 0.9, rz: S.waistDeep },
        { y: -1, rx: 0.86, rz: S.waistDeep * 0.9 },
      ],
      n,
      'hip',
      'hip',
    ),
    head: tube(head, n, 'headFront', 'headBack'),
    neck: limb(D.neck + 0.03, S.neck, S.neck, 'skin', 0, 1),
    upperArm: limb(D.upperArm, S.arm[0], S.arm[1], 'arm', 0, 0.45),
    foreArm: limb(D.foreArm, S.arm[1], S.arm[2], 'arm', 0.45, 0.84),
    hand: limb(D.hand, S.arm[2], S.arm[3], 'arm', 0.88, 1),
    // 脚（横幅は腿の半幅を 1 とする）
    thighL: leg(D.thigh, 1.02, 0.9, S.legDeep[0], S.legDeep[1], 'thighL'),
    thighR: leg(D.thigh, 1.02, 0.9, S.legDeep[0], S.legDeep[1], 'thighR'),
    shinL: leg(D.shin, 0.9, 0.82, S.legDeep[1], S.legDeep[2], 'shinL'),
    shinR: leg(D.shin, 0.9, 0.82, S.legDeep[1], S.legDeep[2], 'shinR'),
    foot: tube(
      [
        { y: 0.004, rx: 0.72, rz: (S.heel + S.toe) / 2 - 0.012, cz: (S.toe - S.heel) / 2 - 0.008 },
        { y: -D.ankle, rx: 0.8, rz: (S.heel + S.toe) / 2, cz: (S.toe - S.heel) / 2 },
      ],
      n,
      'shoe',
      'shoe',
    ),
  }
}

interface ArmNodes {
  shoulder: THREE.Group
  elbow: THREE.Group
}

interface LegNodes {
  hip: THREE.Group
  knee: THREE.Group
  ankle: THREE.Group
  wide: THREE.Mesh[]
}

export interface Puppet {
  root: THREE.Group
  setLook: (look: PuppetLook) => void
  /** 姿勢を入れる。height は人の身長 m、squash は座席へ沈む度合い 0..1 */
  apply: (pose: RigPose) => void
  /**
   * 頭の切り抜きの板を、首の上でカメラへ向ける（apply と root の位置決めのあとで呼ぶ）。
   * @param face カメラのある向き（板の向き、ラジアン） @param front 正面の写真を見せるか
   */
  faceHead: (face: number, front: boolean) => void
  dispose: () => void
}

export interface PuppetKit {
  make: (look: PuppetLook, castShadow: boolean) => Puppet
  dispose: () => void
}

export function createPuppetKit(mobile: boolean): PuppetKit {
  const shapes = makeShapes(mobile)
  // 影だけを落とす部位用（色も奥行きも書かない）
  const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  const parentQuat = new THREE.Quaternion()
  const faceQuat = new THREE.Quaternion()
  const UP = new THREE.Vector3(0, 1, 0)
  const S = PUPPET_STYLE
  const D = RIG_DIM

  const make = (first: PuppetLook, castShadow: boolean): Puppet => {
    const meshes: THREE.Mesh[] = []
    const mesh = (g: THREE.BufferGeometry, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(g, first.material)
      m.castShadow = castShadow
      meshes.push(m)
      parent.add(m)
      return m
    }
    const root = new THREE.Group()
    const pelvis = new THREE.Group()
    root.add(pelvis)
    const hipMesh = mesh(shapes.hip, pelvis)
    const torso = new THREE.Group()
    torso.rotation.order = 'YXZ'
    pelvis.add(torso)
    const torsoMesh = mesh(shapes.torso, torso)
    const neck = new THREE.Group()
    neck.position.y = D.torso
    neck.rotation.order = 'YXZ'
    torso.add(neck)
    mesh(shapes.neck, neck).position.y = D.neck
    // 頭の筒は影を落とすだけ。見えるのは、写真から切り抜いた板（髪や帽子の形が残る）
    const skull = mesh(shapes.head, neck)
    skull.position.y = D.neck + D.head / 2 - 0.012
    skull.material = hidden
    meshes.pop()
    const headGeo = { back: new THREE.PlaneGeometry(1, 1), front: new THREE.PlaneGeometry(1, 1) }
    const headMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(headGeo.back, first.headBack)
    neck.add(headMesh)
    let current = first
    let hunchNow = 0

    const arm = (): ArmNodes => {
      const shoulder = new THREE.Group()
      shoulder.rotation.order = 'ZXY'
      torso.add(shoulder)
      mesh(shapes.upperArm, shoulder)
      const elbow = new THREE.Group()
      elbow.position.y = -D.upperArm
      shoulder.add(elbow)
      mesh(shapes.foreArm, elbow)
      mesh(shapes.hand, elbow).position.y = -D.foreArm
      return { shoulder, elbow }
    }
    const leg = (thigh: THREE.BufferGeometry, shin: THREE.BufferGeometry): LegNodes => {
      const hip = new THREE.Group()
      pelvis.add(hip)
      const knee = new THREE.Group()
      knee.position.y = -D.thigh
      hip.add(knee)
      const ankle = new THREE.Group()
      ankle.position.y = -D.shin
      knee.add(ankle)
      return { hip, knee, ankle, wide: [mesh(thigh, hip), mesh(shin, knee), mesh(shapes.foot, ankle)] }
    }
    const armL = arm()
    const armR = arm()
    const legL = leg(shapes.thighL, shapes.shinL)
    const legR = leg(shapes.thighR, shapes.shinR)

    const setLook = (look: PuppetLook) => {
      current = look
      for (const m of meshes) m.material = look.material
      const hd = look.dims.head
      const setUv = (g: THREE.PlaneGeometry, left: number, right: number) => {
        const uv = g.attributes.uv as THREE.BufferAttribute
        uv.setXY(0, left, 1 - hd.v0)
        uv.setXY(1, right, 1 - hd.v0)
        uv.setXY(2, left, 1 - hd.v1)
        uv.setXY(3, right, 1 - hd.v1)
        uv.needsUpdate = true
      }
      // 後ろ姿の絵は写真を左右に裏返したもの。正面は写真のまま
      setUv(headGeo.back, hd.u0, hd.u1)
      setUv(headGeo.front, 1 - hd.u1, 1 - hd.u0)
      headMesh.scale.set(hd.wide, hd.high, 1)
      headMesh.position.y = hd.lift + hd.high / 2
      const sh = look.dims.shoulderHalf
      const lg = look.dims.legHalf
      torsoMesh.scale.x = sh
      // 裾の広い服は、腰の筒を少し長くして裾にする
      hipMesh.scale.set(Math.max(sh, (lg * 2.1) / 0.9), look.dims.skirt ? 0.11 : 0.07, 1.18)
      const sx = sh - S.shoulderIn
      armL.shoulder.position.set(sx, D.torso - S.shoulderDown + hunchNow * HUNCH_SET.shoulderUp, 0)
      armR.shoulder.position.set(-sx, D.torso - S.shoulderDown + hunchNow * HUNCH_SET.shoulderUp, 0)
      legL.hip.position.x = lg * 0.98
      legR.hip.position.x = -lg * 0.98
      for (const m of [...legL.wide, ...legR.wide]) m.scale.x = lg
    }
    setLook(first)

    const setArm = (n: ArmNodes, p: ArmPose, side: 1 | -1) => {
      n.shoulder.rotation.set(-p.swing, -side * armTurn(p), side * p.splay)
      n.elbow.rotation.x = -p.bend
    }
    const setLeg = (n: LegNodes, p: LegPose, side: 1 | -1) => {
      n.hip.rotation.x = -p.swing
      n.hip.rotation.z = side * p.splay
      n.knee.rotation.x = p.bend
      // 足裏は地面と平行に保ち、蹴り上げのときだけつま先を下げる
      n.ankle.rotation.x = p.swing - p.bend + p.foot
    }
    const apply = (pose: RigPose) => {
      pelvis.position.y = pose.hip
      // 腰は肩と逆へ少し回る
      pelvis.rotation.y = -pose.twist * 0.35
      hipMesh.rotation.z = pose.hipTilt ?? 0
      // 背中を丸める: 首が縮んで前へ出て（頭が肩の線へ沈む）、肩がすくんで上がる
      hunchNow = pose.hunch ?? 0
      neck.position.set(0, D.torso - hunchNow * HUNCH_SET.neckDrop, hunchNow * HUNCH_SET.neckFwd)
      const shoulderY = D.torso - S.shoulderDown + hunchNow * HUNCH_SET.shoulderUp
      armL.shoulder.position.y = shoulderY
      armR.shoulder.position.y = shoulderY
      torso.rotation.set(pose.lean, pose.twist * 1.35, pose.bank)
      neck.rotation.set(pose.headPitch, pose.headYaw, -pose.bank * 0.5)
      setArm(armL, pose.armL, 1)
      setArm(armR, pose.armR, -1)
      setLeg(legL, pose.legL, 1)
      setLeg(legR, pose.legR, -1)
    }
    apply({ hip: D.hip, lean: 0, bank: 0, twist: 0, headPitch: 0, headYaw: 0, armL: { swing: 0, splay: 0.07, bend: 0.1 }, armR: { swing: 0, splay: 0.07, bend: 0.1 }, legL: { swing: 0, bend: 0, foot: 0, splay: 0 }, legR: { swing: 0, bend: 0, foot: 0, splay: 0 } })
    const faceHead = (face: number, front: boolean) => {
      headMesh.geometry = front ? headGeo.front : headGeo.back
      headMesh.material = front ? current.headFront : current.headBack
      // 首の向き（前傾・傾き）は位置にだけ効かせ、板そのものはカメラへ向ける
      neck.updateWorldMatrix(true, false)
      neck.getWorldQuaternion(parentQuat)
      headMesh.quaternion.copy(parentQuat.invert()).multiply(faceQuat.setFromAxisAngle(UP, face))
    }
    const dispose = () => {
      headGeo.back.dispose()
      headGeo.front.dispose()
    }
    return { root, setLook, apply, faceHead, dispose }
  }

  return {
    make,
    dispose: () => {
      for (const g of Object.values(shapes)) g.dispose()
      hidden.dispose()
    },
  }
}
