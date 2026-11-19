import * as THREE from 'three'
import { FIELD, type Field, type HuntId } from '../lib/kokiHunt'

export const GROUND_SCALE = .046
const WIDTH = FIELD.width * GROUND_SCALE
const DEPTH = FIELD.height * GROUND_SCALE

const PALETTES = {
  cinder: {
    sky: 0x71909b, haze: 0xe8b078, earth: 0x8c7350, moss: 0x4c5536,
    cliff: 0x705446, strata: 0x9b7558, vegetation: 0x6e7946, sun: 0xffd39a,
  },
  gale: {
    sky: 0x365b79, haze: 0x9cbab7, earth: 0x688164, moss: 0x374e42,
    cliff: 0x495e61, strata: 0x718284, vegetation: 0x557663, sun: 0xffe7b1,
  },
}

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

// 低い起伏は歩行・予兆表示でもこの高さを共有する。
export function groundHeight(x: number, z: number) {
  return .19 * Math.sin(x * .28) * Math.cos(z * .38) + .07 * Math.sin(z * .82 + x * .37)
}

export function groundPosition(point: { x: number; y: number }, field: Field) {
  return { x: (point.x - field.width / 2) * GROUND_SCALE, z: (point.y - field.height / 2) * GROUND_SCALE }
}

function meshInstances(geometry: THREE.BufferGeometry, count: number, material: THREE.MeshStandardMaterial,
  place: (transform: THREE.Object3D, index: number) => THREE.Color) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  const transform = new THREE.Object3D()
  for (let i = 0; i < count; i += 1) {
    const color = place(transform, i)
    transform.updateMatrix()
    mesh.setMatrixAt(i, transform.matrix)
    mesh.setColorAt(i, color)
  }
  mesh.receiveShadow = true
  return mesh
}

function makeSky(id: HuntId) {
  const { sky, haze, sun } = PALETTES[id]
  return new THREE.Mesh(
    new THREE.SphereGeometry(140, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        sky: { value: new THREE.Color(sky) },
        haze: { value: new THREE.Color(haze) },
        sun: { value: new THREE.Color(sun) },
        sunDir: { value: new THREE.Vector3(-.52, .26, -.82).normalize() },
      },
      vertexShader: `
        varying vec3 dir;
        void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform vec3 sky, haze, sun, sunDir;
        varying vec3 dir;
        void main() {
          vec3 n = normalize(dir);
          float up = pow(max(0.0,n.y),0.55);
          vec3 color = mix(haze, sky, up);
          float facing = max(dot(n,sunDir), 0.0);
          color += sun * (pow(facing, 17.0)*0.16 + smoothstep(.996,.998,facing)*.9);
          float streak = sin(n.x * 38.0 + n.z * 18.0 + sin(n.x * 13.0) * 2.0 + n.y * 82.0);
          float band = smoothstep(.03,.24,n.y) * (1.0-smoothstep(.27,.57,n.y));
          color = mix(color,haze * 1.22, smoothstep(.53,.98,streak) * band * .32);
          gl_FragColor = vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  )
}

export function makeWorld(scene: THREE.Scene, id: HuntId, mobile: boolean) {
  const p = PALETTES[id]
  const random = seeded(id === 'cinder' ? 118512 : 78115)
  scene.fog = new THREE.Fog(p.haze, 25, 84)
  scene.add(makeSky(id))
  scene.add(new THREE.HemisphereLight(0xe8edf7, id === 'cinder' ? 0x615041 : 0x455650, 2.15))
  const sun = new THREE.DirectionalLight(p.sun, 2.55)
  sun.position.set(-17, 23, -17)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 1536)
  Object.assign(sun.shadow.camera, { left: -23, right: 23, top: 20, bottom: -20, near: 2, far: 64 })
  sun.shadow.normalBias = .055
  sun.shadow.bias = -.0002
  scene.add(sun)
  const rim = new THREE.DirectionalLight(0x9eb7d2, .68)
  rim.position.set(8, 9, 15)
  scene.add(rim)

  const earth = new THREE.Color(p.earth)
  const moss = new THREE.Color(p.moss)
  const ground = new THREE.PlaneGeometry(174, 174, 110, 110)
  ground.rotateX(-Math.PI / 2)
  const vertices = ground.getAttribute('position')
  const colors = new Float32Array(vertices.count * 3)
  for (let i = 0; i < vertices.count; i += 1) {
    const x = vertices.getX(i)
    const z = vertices.getZ(i)
    const outside = Math.max(0, Math.abs(x) - WIDTH * .61, Math.abs(z) - DEPTH * .64)
    const ridge = Math.min(12, outside * .17) * (.38 + .62 * Math.sin(x * .12 + z * .078) ** 2)
    vertices.setY(i, groundHeight(x, z) + ridge)
    const color = earth.clone().lerp(moss, .43 * Math.sin(x * .37 + z * .59) ** 2 + random() * .19)
    color.multiplyScalar(.84 + .30 * random()).toArray(colors, i * 3)
  }
  ground.computeVertexNormals()
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const floor = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96 }))
  floor.receiveShadow = true
  scene.add(floor)

  const rock = new THREE.DodecahedronGeometry(1, 1)
  const rockPosition = rock.getAttribute('position')
  for (let i = 0; i < rockPosition.count; i += 1) {
    const x = rockPosition.getX(i), y = rockPosition.getY(i), z = rockPosition.getZ(i)
    const deformation = 1 + .12 * Math.sin(x * 29 + y * 13 + z * 37)
    rockPosition.setXYZ(i, x * deformation, y * deformation, z * deformation)
  }
  rock.computeVertexNormals()
  const stoneMaterial = new THREE.MeshStandardMaterial({ roughness: .97, flatShading: true })
  const rockColor = new THREE.Color(p.cliff)
  const strata = new THREE.Color(p.strata)
  const cliffs = meshInstances(rock, 109, stoneMaterial, (o, i) => {
    const far = i >= 68
    const a = (i % 68) / 68 * Math.PI * 2 + (random() - .5) * .12
    const distance = far ? 1.65 + random() * 1.25 : 1.07 + random() * .42
    const x = Math.cos(a) * WIDTH * .7 * distance
    const z = Math.sin(a) * DEPTH * .85 * distance
    const height = far ? 3 + random() * 9 : .7 + random() * 4.7
    o.position.set(x, height * .41 - .17, z)
    o.scale.set(1.45 + random() * (far ? 6 : 2.5), height, 1.2 + random() * 3.4)
    o.rotation.set(random() * .38, random() * Math.PI, (random() - .5) * .64)
    return rockColor.clone().lerp(strata, random() * .66)
  })
  scene.add(cliffs)
  const gravel = meshInstances(rock.clone(), mobile ? 115 : 180,
    new THREE.MeshStandardMaterial({ roughness: .98, flatShading: true }), (o) => {
      const x = (random() - .5) * WIDTH * 1.52
      const z = (random() - .5) * DEPTH * 1.56
      const size = .06 + random() ** 3 * .39
      o.position.set(x, groundHeight(x, z) - .015, z)
      o.scale.set(size, size * .38, size * .75)
      o.rotation.set(0, random() * 6.28, .06)
      return strata.clone().lerp(rockColor, random() * .8)
    })
  scene.add(gravel)

  const grass = new THREE.BufferGeometry()
  grass.setAttribute('position', new THREE.Float32BufferAttribute([
    -.08, 0, 0, .08, 0, 0, .19, .54, .08,
    -.09, 0, .04, .06, 0, .04, -.18, .36, .19,
    0, 0, -.07, 0, 0, .07, .02, .78, -.15,
  ], 3))
  grass.computeVertexNormals()
  const grassColor = new THREE.Color(p.vegetation)
  scene.add(meshInstances(grass, mobile ? 900 : 1800,
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 }), (o, i) => {
      const edge = i % 3 !== 0
      const a = random() * 6.2832
      const range = edge ? .48 + random() * .5 : random() * .7
      const x = Math.cos(a) * range * WIDTH
      const z = Math.sin(a) * range * DEPTH
      const scale = .27 + random() * (edge ? .95 : .35)
      o.position.set(x, groundHeight(x, z) - .02, z)
      o.scale.setScalar(scale)
      o.rotation.set(0, a, (random() - .5) * .35)
      return grassColor.clone().multiplyScalar(.54 + random() * .97)
    }))

  // 風切り跡として、採石場には崩れた石柱、高台には針葉樹を置く。
  const trees = id === 'gale'
  const vertical = trees ? new THREE.ConeGeometry(1, 2, 7) : new THREE.CylinderGeometry(.72, 1, 2, 5)
  scene.add(meshInstances(vertical, 30,
    new THREE.MeshStandardMaterial({ roughness: .96, flatShading: true }), (o, i) => {
      const a = i / 30 * Math.PI * 2 + .15 * random()
      const x = Math.cos(a) * WIDTH * (.74 + random() * .36)
      const z = Math.sin(a) * DEPTH * (.84 + random() * .49)
      const h = (trees ? 2.5 : 1.55) + random() * (trees ? 5.5 : 3.45)
      o.position.set(x, h * .65, z)
      o.scale.set(.39 + random() * (trees ? 1.12 : .71), h * .67, .41 + random() * .63)
      o.rotation.set(.12 * random(), random() * 6.28, (random() - .5) * .39)
      return (trees ? grassColor : rockColor).clone().multiplyScalar(.67 + random() * .42)
    }))

  const dust = new THREE.BufferGeometry()
  const flecks = new Float32Array(90 * 3)
  for (let i = 0; i < flecks.length; i += 3) {
    flecks[i] = (random() - .5) * 49
    flecks[i + 1] = .36 + random() * 7
    flecks[i + 2] = (random() - .5) * 37
  }
  dust.setAttribute('position', new THREE.BufferAttribute(flecks, 3))
  const haze = new THREE.Points(dust, new THREE.PointsMaterial({
    color: p.sun, size: .052, transparent: true, opacity: .37, depthWrite: false,
  }))
  scene.add(haze)
  return haze
}
