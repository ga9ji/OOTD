// Grand Theft Outfit [部品: hud-minimap] ミニマップ。lib/gto/minimap.ts の導出をキャンバスに描く。
// 形は太い縁取りの丸い文字盤。進む向き（カメラの向き）が上。
// 中は色面で描く: 街区の地・建物・道（幹線／細い道／歩く道）・高架・線路を別の色にして、道の形と街の詰まり具合を読ませる。
// 北の印と向かう先の札は縁取りの上に乗って回る。追っ手は数を絞った赤い点。主人公は中でいちばん大きい橙の矢じり。
// 動かない街の絵は最初に1枚の絵へ焼き、毎フレームはそれを回して貼るだけにする。
import { useEffect, useRef } from 'react'
import { clamp, damp } from '../../lib/gto/math'
import {
  MINIMAP_TUNING,
  minimapLayers,
  minimapModel,
  minimapRange,
  minimapRouteFor,
  minimapSize,
  minimapTarget,
  routeStale,
  type Blip,
  type MinimapLayers,
  type MinimapRoute,
} from '../../lib/gto/minimap'
import type { Flat, GtoWorld, Marker } from '../../lib/gto/types'
import type { GtoEngine } from './engine'
import { MENU_EVENT } from './GtoHud'

// 色面: 地（街区）は藍、建物はそれより明るい青、道は生成り。線路は濃い藍の帯、高架は黄土
const COLORS = {
  ink: '#12172b',
  void: '#232b4d',
  ground: '#2e3c72',
  block: '#5468a8',
  tower: '#7f93cf',
  walk: '#8f9bc4',
  minor: '#cbc3ad',
  major: '#f6eedb',
  deck: '#d9a45f',
  rail: '#161c36',
  cloth: '#f1e7d0',
  thread: '#ff6a2b',
  mint: '#2fd3a6',
  police: '#ff4b4b',
  flash: '#fff2c9',
}

/** 焼く絵の細かさ（1m あたりの px）と描く間隔（フレーム） */
const BAKE = { high: { ppm: 2, every: 2 }, touch: { ppm: 1.25, every: 3 } }
const RANGE_RATE = 2.2
/** 縁取りの太さ px（PC の 180px のとき） */
const RIM_W = 7

const trace = (g: CanvasRenderingContext2D, pts: Flat) => {
  g.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
}

/** 動かない街の絵を1枚に焼く（世界の座標 m を ppm 倍した px） */
function bakeCity(layers: MinimapLayers, ppm: number): HTMLCanvasElement {
  const { bounds } = layers
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) * ppm)
  canvas.height = Math.ceil((bounds.maxZ - bounds.minZ) * ppm)
  const g = canvas.getContext('2d')
  if (!g) return canvas
  g.fillStyle = COLORS.ground
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.scale(ppm, ppm)
  g.translate(-bounds.minX, -bounds.minZ)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // 建物の面（高い建物は明るく: 目印になる）
  for (const tall of [false, true]) {
    g.fillStyle = tall ? COLORS.tower : COLORS.block
    g.beginPath()
    for (const b of layers.buildings) {
      if (b.tall !== tall) continue
      trace(g, b.pts)
      g.closePath()
    }
    g.fill()
  }
  const stroke = (tier: string, color: string, min: number, grow = 0) => {
    g.strokeStyle = color
    for (const r of layers.roads) {
      if (r.tier !== tier) continue
      g.lineWidth = Math.max(r.width, min) + grow
      g.beginPath()
      trace(g, r.pts)
      g.stroke()
    }
  }
  // 下から: 歩く道 → 細い車道 → 幹線（縁を付けていちばん明るく太く）→ 線路（濃い藍の帯）→ 高架
  stroke('walk', COLORS.walk, 3)
  stroke('minor', COLORS.ground, 6, 2.5)
  stroke('minor', COLORS.minor, 6)
  stroke('major', COLORS.ground, 12, 4)
  stroke('major', COLORS.major, 12)
  g.strokeStyle = COLORS.rail
  g.lineWidth = 4
  g.beginPath()
  for (const pts of layers.rails) trace(g, pts)
  g.stroke()
  stroke('elevated', COLORS.ink, 9, 3)
  stroke('elevated', COLORS.deck, 9)
  return canvas
}

/** 主人公: 中でいちばん大きい橙の矢じり。生成りと藍の二重の縁で、道の上でも建物の上でも浮く */
function drawPlayer(g: CanvasRenderingContext2D, b: Blip, x: number, y: number, k: number) {
  g.save()
  g.translate(x, y)
  g.rotate(b.rot)
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(0, -14 * k)
  g.lineTo(10.5 * k, 10 * k)
  g.lineTo(0, 5 * k)
  g.lineTo(-10.5 * k, 10 * k)
  g.closePath()
  g.strokeStyle = COLORS.ink
  g.lineWidth = 8 * k
  g.stroke()
  g.strokeStyle = COLORS.cloth
  g.lineWidth = 4 * k
  g.stroke()
  g.fillStyle = COLORS.thread
  g.fill()
  g.restore()
}

/** 追っ手: 赤い点（円の外は縁のくさび）。数は minimapModel が絞っている */
function drawPolice(g: CanvasRenderingContext2D, b: Blip, x: number, y: number, k: number, t: number) {
  g.save()
  g.translate(x, y)
  g.fillStyle = Math.floor(t * 4) % 2 === 0 ? COLORS.flash : COLORS.police
  g.strokeStyle = COLORS.ink
  g.lineWidth = 2.5 * k
  g.lineJoin = 'round'
  g.beginPath()
  if (b.edge) {
    g.rotate(b.rot)
    g.moveTo(0, -7.5 * k)
    g.lineTo(6.5 * k, 4.5 * k)
    g.lineTo(-6.5 * k, 4.5 * k)
    g.closePath()
  } else g.arc(0, 0, 5.5 * k, 0, Math.PI * 2)
  g.stroke()
  g.fill()
  g.restore()
}

/** 向かう先: 縁取りの上に乗る大きな札（外を指す）。円の中に入ったら、その場所にも印を置く */
function drawTarget(g: CanvasRenderingContext2D, b: Blip, half: number, radius: number, k: number, t: number) {
  if (!b.pin) return
  const color = b.kind === 'goal' ? COLORS.mint : COLORS.thread
  // 主人公の印と重なるほど近いときは場所の印を出さない（札だけで足りる）
  if (!b.edge && Math.hypot(b.u, b.v - MINIMAP_TUNING.anchor) > MINIMAP_TUNING.spotMin) {
    const pulse = (t * 0.8) % 1
    const x = half + b.u * radius
    const y = half - b.v * radius
    g.strokeStyle = color
    g.lineWidth = 2.5 * k
    g.globalAlpha = 1 - pulse
    g.beginPath()
    g.arc(x, y, (8 + pulse * 8) * k, 0, Math.PI * 2)
    g.stroke()
    g.globalAlpha = 1
    g.fillStyle = color
    g.strokeStyle = COLORS.ink
    g.lineWidth = 3 * k
    g.beginPath()
    g.arc(x, y, 6.5 * k, 0, Math.PI * 2)
    g.stroke()
    g.fill()
  }
  g.save()
  g.translate(half + b.pin.u * radius, half - b.pin.v * radius)
  g.rotate(b.pin.rot)
  // 札: 外へ向いた五角形（値札の形）に、鳩目の穴
  g.lineJoin = 'round'
  g.strokeStyle = COLORS.ink
  g.lineWidth = 3.5 * k
  g.fillStyle = color
  g.beginPath()
  g.moveTo(0, -15 * k)
  g.lineTo(10.5 * k, -4 * k)
  g.lineTo(10.5 * k, 10 * k)
  g.lineTo(-10.5 * k, 10 * k)
  g.lineTo(-10.5 * k, -4 * k)
  g.closePath()
  g.stroke()
  g.fill()
  g.fillStyle = COLORS.ink
  g.beginPath()
  g.arc(0, -4.5 * k, 3 * k, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/** 北の印: 縁取りの上に乗る藍の丸に N */
function drawNorth(g: CanvasRenderingContext2D, x: number, y: number, k: number) {
  g.fillStyle = COLORS.ink
  g.strokeStyle = COLORS.cloth
  g.lineWidth = 2 * k
  g.beginPath()
  g.arc(x, y, 9.5 * k, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.font = `800 ${Math.round(12 * k)}px ui-monospace, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = COLORS.cloth
  g.fillText('N', x, y + 0.5)
}

/** 左上の隅（円の外）に置く、メニューの印（三本線） */
function drawMenuEye(g: CanvasRenderingContext2D, size: number) {
  const eye = size * 0.075
  g.fillStyle = COLORS.ink
  g.strokeStyle = 'rgba(241, 231, 208, 0.7)'
  g.lineWidth = 1.25
  g.beginPath()
  g.arc(eye, eye, eye * 0.86, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.lineCap = 'round'
  g.beginPath()
  for (const dy of [-0.3, 0, 0.3]) {
    g.moveTo(eye * 0.6, eye + eye * dy)
    g.lineTo(eye * 1.4, eye + eye * dy)
  }
  g.stroke()
}

/** 道筋は、動いたときと目的地が変わったときだけ引き直す */
function routeKeeper(world: GtoWorld) {
  let last: { ax: number; az: number; bx: number; bz: number } | null = null
  let route: MinimapRoute | null = null
  return (markers: Marker[], mode: 'foot' | 'drive', x: number, z: number): MinimapRoute | null => {
    const target = minimapTarget(markers, x, z)
    if (!target) {
      last = null
      route = null
      return null
    }
    if (routeStale(last, x, z, target.x, target.z)) {
      last = { ax: x, az: z, bx: target.x, bz: target.z }
      route = minimapRouteFor(world, mode, x, z, target.x, target.z)
    }
    return route
  }
}

export default function GtoMinimap({ engine, touch = false }: { engine: GtoEngine; touch?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const stage = canvas?.parentElement
    const g = canvas?.getContext('2d')
    if (!canvas || !stage || !g) return
    const bake = touch ? BAKE.touch : BAKE.high
    const layers = minimapLayers(engine.world)
    const city = bakeCity(layers, bake.ppm)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let size = 0
    const fit = () => {
      const next = minimapSize(stage.clientWidth, stage.clientHeight, touch)
      if (next === size) return
      size = next
      canvas.width = canvas.height = size * dpr
      canvas.style.width = canvas.style.height = `${size}px`
      // HUD（通りの名前など）がミニマップの大きさに合わせて並ぶ
      stage.style.setProperty('--gto-map', `${size}px`)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(stage)

    const routeFor = routeKeeper(engine.world)
    let count = 0
    let range = 0
    let lastT = 0
    const unsubscribe = engine.subscribe(({ state, view }) => {
      if (count++ % bake.every !== 0) return
      const wanted = minimapRange(state.mode, state.player.speed)
      range = range === 0 ? wanted : damp(range, wanted, RANGE_RATE, Math.min(0.2, Math.max(0, state.t - lastT)))
      lastT = state.t
      const m = minimapModel(state, view.markers, range)
      const route = routeFor(view.markers, state.mode, m.cx, m.cz)
      const half = size / 2
      // 縁取りの中心線の半径。その外側は、縁に乗る札がはみ出す分の余白
      const radius = half * MINIMAP_TUNING.dial
      const scale = radius / m.range
      // 印の大きさは、ミニマップの一辺に合わせる（PC の 180px を 1 とする）
      const k = clamp(size / 180, 0.72, 1.15)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, size, size)
      g.save()
      g.beginPath()
      g.arc(half, half, radius, 0, Math.PI * 2)
      g.clip()
      // 街の外は、地より暗い色で塗る（街の端が分かる）
      g.fillStyle = COLORS.void
      g.fillRect(0, 0, size, size)
      g.translate(half, half - m.anchor * radius)
      // カメラが見ている向きを上にする
      g.rotate(-m.yaw)
      g.scale(scale, scale)
      g.translate(-m.cx, -m.cz)
      g.imageSmoothingQuality = 'high'
      g.drawImage(city, layers.bounds.minX, layers.bounds.minZ, city.width / bake.ppm, city.height / bake.ppm)
      if (route) {
        // 目的地までの道筋は、幹線より細い1本の実線（点線にしない）
        g.lineJoin = 'round'
        g.lineCap = 'round'
        g.beginPath()
        trace(g, route.pts)
        g.strokeStyle = COLORS.ink
        g.lineWidth = (8 * k) / scale
        g.stroke()
        // 札と同じ色（目的地は緑、開始地点は橙）
        g.strokeStyle = m.blips.some((b) => b.kind === 'goal') ? COLORS.mint : COLORS.thread
        g.lineWidth = (4.5 * k) / scale
        g.stroke()
      }
      g.restore()

      // 追っ手の点は縁取りの下、主人公と札は上
      for (const b of m.blips) if (b.kind === 'police') drawPolice(g, b, half + b.u * radius, half - b.v * radius, k, state.t)
      for (const b of m.blips) if (b.kind === 'player') drawPlayer(g, b, half + b.u * radius, half - b.v * radius, k)

      // 太い縁取り: 藍の外枠の上に生成りの輪。追われているあいだは輪が赤く点滅する
      const hot = m.alert && Math.floor(state.t * 3) % 2 === 0
      const rimW = RIM_W * k
      g.beginPath()
      g.arc(half, half, radius, 0, Math.PI * 2)
      g.lineWidth = rimW + 4
      g.strokeStyle = COLORS.ink
      g.stroke()
      g.lineWidth = rimW
      g.strokeStyle = hot ? COLORS.police : COLORS.cloth
      g.stroke()

      // 縁取りの上に乗る印: 北 → 向かう先の札
      drawNorth(g, half + m.north.u * radius, half - m.north.v * radius, k)
      for (const b of m.blips) if (b.pin) drawTarget(g, b, half, radius, k, state.t)
      drawMenuEye(g, size)
    })
    return () => {
      unsubscribe()
      observer.disconnect()
      stage.style.removeProperty('--gto-map')
    }
  }, [engine, touch])

  // ミニマップを押すとメニュー（もどる・音・全画面）が開く。開け閉めは GtoHud が受ける
  const openMenu = () => ref.current?.parentElement?.dispatchEvent(new CustomEvent(MENU_EVENT))
  return <canvas ref={ref} className={touch ? 'gto-minimap is-touch' : 'gto-minimap'} onClick={openMenu} aria-hidden="true" />
}
