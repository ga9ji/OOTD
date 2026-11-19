import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useI18n } from '../lib/i18n'
import { HUNT_TITLE } from '../lib/kokiHunt'
import campLight from './kokiHuntCampLight.frag?raw'

export default function KokiHuntTitle({ onStart }: { onStart: () => void }) {
  const { t } = useI18n()
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: node, alpha: true, antialias: false, powerPreference: 'low-power' })
    } catch {
      return
    }
    const material = new THREE.ShaderMaterial({
      uniforms: { clock: { value: 0 }, aspect: { value: 1 } },
      vertexShader: 'varying vec2 coord; void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: campLight, depthTest: false, depthWrite: false,
    })
    const geometry = new THREE.PlaneGeometry(2, 2)
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(geometry, material))
    const camera = new THREE.Camera()
    let frame = 0, last = 0
    function paint(now: number) {
      if (!last || now - last >= 40) {
        material.uniforms.clock.value = reduced.matches ? 0 : now * .001
        renderer.render(scene, camera)
        last = now
      }
      if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(paint)
    }
    function refresh() {
      cancelAnimationFrame(frame)
      if (document.hidden || !node) return
      const width = node.clientWidth, height = node.clientHeight
      if (!height || !width) return
      const scale = Math.min(1, 820 / width, 650 / height)
      renderer.setSize(Math.round(width * scale), Math.round(height * scale), false)
      material.uniforms.aspect.value = width / height
      last = 0
      paint(performance.now())
    }
    const observer = new ResizeObserver(refresh)
    observer.observe(node)
    reduced.addEventListener('change', refresh)
    document.addEventListener('visibilitychange', refresh)
    refresh()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      reduced.removeEventListener('change', refresh)
      document.removeEventListener('visibilitychange', refresh)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (!node.isConnected) renderer.forceContextLoss()
    }
  }, [])
  return <section className="fm-title">
    <canvas className="fm-camp-light" ref={canvas} aria-hidden="true" />
    <div className="fm-cover-frame" aria-hidden="true" />
    <div className="fm-title-menu">
      <div className="fm-insignia" aria-hidden="true"><i /><i /></div>
      <h1 aria-label={HUNT_TITLE}>
        <span>Fashion</span>{' '}
        <strong>Monster</strong>{' '}
        <strong>Hunter</strong>
      </h1>
      <button type="button" className="fm-start" onClick={onStart}>{t('クエストを選ぶ')}</button>
    </div>
  </section>
}
