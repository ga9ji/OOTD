import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { angleDiff, DEG, headingOf } from '../math'
import { parseLaunch } from '../shot'
import { createGtoState, stepGto, viewOf } from '../sim'
import type { GtoState } from '../types'
import { cfg, DT, world } from './helpers'

/** 録画役と同じ見方: デモを再生し、every 秒ごとに「主体が画面のどこに・どの向きで・どの距離に映るか」を取る */
export interface DemoSample {
  t: number
  /** 画面の横位置（0 が左端、0.5 が中央。16:9） */
  sx: number
  /** 見かけの向き（度）。0 が真後ろ、＋は右の側面が見える */
  angle: number
  /** カメラから主体までの水平距離 m */
  range: number
  speed: number
  /** 主体の向き（度） */
  heading: number
}

const ASPECT = 16 / 9

function sampleOf(s: GtoState): DemoSample {
  const c = s.camera
  const view = headingOf(c.tx - c.x, c.tz - c.z)
  const bearing = headingOf(s.player.x - c.x, s.player.z - c.z)
  const off = angleDiff(view, bearing)
  const half = Math.atan(Math.tan((c.fov * DEG) / 2) * ASPECT)
  return {
    t: Math.round(s.t * 100) / 100,
    sx: 0.5 + Math.tan(off) / Math.tan(half) / 2,
    angle: angleDiff(bearing, s.player.heading) / DEG,
    range: Math.hypot(s.player.x - c.x, s.player.z - c.z),
    speed: s.player.speed,
    heading: s.player.heading / DEG,
  }
}

export function playDemo(name: string, seconds: number, every: number): DemoSample[] {
  const demo = DEMOS[name]
  const launch = parseLaunch(new URLSearchParams(`demo=${name}`), world)
  let s = createGtoState(world, cfg, { seed: launch.seed, mode: launch.mode, start: launch.start, stage: demo.stage, starterCar: true })
  const out: DemoSample[] = [sampleOf(s)]
  const per = Math.round(every / DT)
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const goal = viewOf(s).markers[0] ?? null
    const near = s.mode === 'drive' ? world.nearestRoad(s.player.x, s.player.z, true, 30) : null
    const road = near ? { x: near.x, z: near.z, heading: near.heading } : null
    const view = { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal, heading: s.player.heading, road, speed: s.player.speed }
    s = stepGto(s, demoInput(demo, s.t, DT, view), world, cfg, DT)
    if (i % per === 0) out.push(sampleOf(s))
  }
  return out
}

/** 録画役の 8 コマ（0〜7 秒、1 秒刻み）のうち、動き出したあとの 1〜7 秒 */
const frames = (name: string) => playDemo(name, 7, 1).slice(1)

describe('gto camera: 録画役と同じ 1 秒刻みのコマで、主体が貼り付いて見えない', () => {
  it('cam-drive: 7 コマのうち 4 コマ以上で車体が 15° 以上斜めに映り、画面の中央から 2% 以上ずれている（左右どちらも出る）', () => {
    const f = frames('cam-drive')
    const turned = f.filter((r) => Math.abs(r.angle) > 15 && Math.abs(r.sx - 0.5) > 0.02)
    expect(turned.length).toBeGreaterThanOrEqual(4)
    expect(turned.some((r) => r.sx < 0.5)).toBe(true)
    expect(turned.some((r) => r.sx > 0.5)).toBe(true)
    // 旋回中も画面の 42〜60% に留まる
    for (const r of f) {
      expect(r.sx).toBeGreaterThan(0.42)
      expect(r.sx).toBeLessThan(0.6)
    }
  })

  it('cam-drive: 加速と急ブレーキで車までの距離が 0.5m 以上変わる', () => {
    const ranges = playDemo('cam-drive', 7, 0.25).map((r) => r.range)
    expect(Math.max(...ranges) - Math.min(...ranges)).toBeGreaterThan(0.5)
    expect(Math.max(...ranges) - Math.min(...ranges)).toBeLessThan(1.4)
  })

  it('cam-foot: 7 コマのうち 4 コマで主人公が 40° 以上斜めに映り、画面の中央から 5% 以上ずれている（左右どちらも出る）', () => {
    const f = frames('cam-foot')
    const turned = f.filter((r) => Math.abs(r.angle) > 40 && Math.abs(r.sx - 0.5) > 0.05)
    expect(turned.length).toBeGreaterThanOrEqual(4)
    expect(turned.some((r) => r.sx < 0.5)).toBe(true)
    expect(turned.some((r) => r.sx > 0.5)).toBe(true)
    // 向きを変えて 1.4 秒後のコマでは背後に戻っている
    expect(f.some((r) => r.speed > 5 && Math.abs(r.angle) < 5)).toBe(true)
    for (const r of f) {
      expect(r.sx).toBeGreaterThan(0.35)
      expect(r.sx).toBeLessThan(0.65)
    }
  })
})
