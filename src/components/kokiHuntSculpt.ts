import * as THREE from 'three'

import { makeGrain, type Grain } from './kokiHuntGrain'
// A cross-section described by its center, half-width and half-depth.
type Section = [number, number, number, number, number]
type Surface = THREE.MeshStandardMaterial

export function surface(parent: THREE.Object3D, mat: Surface, positions: number[], indices: number[], colors?: number[]) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

// Keep cross-sections perpendicular to the spine even at bends in a horn or limb.
export function carve(parent: THREE.Object3D, mat: Surface, sections: Section[], sides = 14,
  tint?: (ring: number, angle: number) => number) {
  const vertices: number[] = [], colors: number[] = [], indices: number[] = []
  const uv: number[] = []
  const stride = sides + 1
  let distance = 0
  const circumference = Math.PI * Math.max(...sections.map(section => section[3] + section[4]))
  const centers = sections.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  let axis = new THREE.Vector3(1, 0, 0)
  sections.forEach(([, , , width, depth], i) => {
    if (i > 0) distance += centers[i].distanceTo(centers[i - 1])
    const tangent = centers[Math.min(i + 1, centers.length - 1)].clone().sub(centers[Math.max(0, i - 1)]).normalize()
    if (Math.abs(tangent.dot(axis)) > .96) axis.set(0, 0, 1)
    axis.addScaledVector(tangent, -axis.dot(tangent)).normalize()
    const second = new THREE.Vector3().crossVectors(tangent, axis)
    for (let j = 0; j <= sides; j++) {
      const a = j * 2 * Math.PI / sides
      const p = centers[i].clone().addScaledVector(axis, width * Math.cos(a)).addScaledVector(second, depth * Math.sin(a))
      vertices.push(p.x, p.y, p.z)
      uv.push(circumference * j / sides, distance)
      const value = tint?.(i, a) ?? 1
      colors.push(value, value, value)
      if (i > 0 && j < sides) {
        const prev = (i - 1) * stride + j, next = prev + 1
        indices.push(prev, next, prev + stride, next, next + stride, prev + stride)
      }
    }
  })
  const last = (sections.length - 1) * stride
  for (let j = 1; j < sides - 1; j++) indices.push(0, j + 1, j, last, last + j, last + j + 1)
  const mesh = surface(parent, mat, vertices, indices, colors)
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const normals = mesh.geometry.getAttribute('normal')
  const a = new THREE.Vector3(), b = new THREE.Vector3()
  for (let i = 0; i < sections.length; i++) {
    const first = i * stride, last = first + sides
    a.fromBufferAttribute(normals, first).add(b.fromBufferAttribute(normals, last)).normalize()
    normals.setXYZ(first, a.x, a.y, a.z)
    normals.setXYZ(last, a.x, a.y, a.z)
  }
  return mesh
}

// Collapse rigid details per joint. Vertex colors retain individual dyes and markings.
export function batchRig(root: THREE.Group) {
  const grains = new Map<Grain, THREE.DataTexture>()
  const palette = new Map<string, Surface>()
  const materials = new Set<Surface>()
  root.traverse(node => {
    if (!(node instanceof THREE.Group)) return
    const batches = new Map<Surface, { p: number[], n: number[], c: number[], uv: number[], ix: number[] }>()
    for (const mesh of [...node.children]) {
      if (!(mesh instanceof THREE.Mesh)) continue
      const src: Surface = mesh.material
      materials.add(src)
      const key = [src.roughness, src.metalness, src.side, src.emissive.getHex(), src.emissiveIntensity, src.userData.grain].join('/')
      let mat = palette.get(key)
      if (!mat) {
        mat = src.clone()
        mat.color.setHex(0xffffff)
        mat.vertexColors = true
        const grain: Grain | undefined = src.userData.grain
        if (grain) {
          const map = grains.get(grain) ?? makeGrain(grain)
          grains.set(grain, map)
          mat.map = mat.bumpMap = map
          mat.bumpScale = grain === 'hide' ? .023 : .008
        }
        palette.set(key, mat)
      }
      let b = batches.get(mat)
      if (!b) { b = { p: [], n: [], c: [], uv: [], ix: [] }; batches.set(mat, b) }
      mesh.updateMatrix()
      const g = mesh.geometry.applyMatrix4(mesh.matrix)
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color')
      const uv = g.getAttribute('uv')
      const offset = b.p.length / 3
      for (let i = 0; i < p.count; i++) {
        b.p.push(p.getX(i), p.getY(i), p.getZ(i))
        if (mat.map) b.uv.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0)
        b.n.push(n.getX(i), n.getY(i), n.getZ(i))
        b.c.push(src.color.r * (c?.getX(i) ?? 1), src.color.g * (c?.getY(i) ?? 1), src.color.b * (c?.getZ(i) ?? 1))
      }
      for (let i = 0; i < (g.index?.count ?? p.count); i++) b.ix.push(offset + (g.index?.getX(i) ?? i))
      node.remove(mesh)
      g.dispose()
    }
    for (const [mat, b] of batches) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3))
      if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      g.setIndex(b.ix)
      const mesh = new THREE.Mesh(g, mat)
      mesh.castShadow = mesh.receiveShadow = true
      node.add(mesh)
    }
  })
  materials.forEach(m => m.dispose())
}
