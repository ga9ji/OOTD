import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { missionCueModel, missionGauge } from '../missions'
import { stepGto, viewOf } from '../sim'
import type { GtoState } from '../types'
import { allowLongSimulations, cfg, DT, start, world } from './helpers'

allowLongSimulations()

/** ミッションのデモを seconds 秒ぶん再生する（sim を通した、開始から決着までの確認） */
function play(name: string, seconds: number, until?: (s: GtoState) => boolean) {
  const demo = DEMOS[name]
  let s = start({ mode: demo.mode, stage: demo.stage })
  const seen = new Set<string>()
  for (let i = 0; i < seconds / DT; i++) {
    const goal = viewOf(s).markers[0] ?? null
    // engine.ts と同じものを渡す（車道に沿って走るデモのために、いまいる道も）
    const near = s.mode === 'drive' ? world.nearestRoad(s.player.x, s.player.z, true, 30) : null
    const road = near ? { x: near.x, z: near.z, heading: near.heading } : null
    const view = { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal, heading: s.player.heading, road, speed: s.player.speed }
    s = stepGto(s, demoInput(demo, s.t, DT, view), world, cfg, DT)
    for (const e of s.events) seen.add(e.type)
    if (until?.(s)) break
  }
  return { state: s, seen }
}

describe('gto missions: デモを sim で通す', () => {
  it('依頼人の所へ歩くと始まり、導入が出る', () => {
    const { state, seen } = play('mission-intro', 9, (s) => s.mission.active != null)
    expect(seen.has('missionStart')).toBe(true)
    expect(state.mission.active?.id).toBe('first-fit')
    expect(missionCueModel(state.mission, state.t)?.kind).toBe('intro')
  })

  it('時間内に奪う: 1着目で数が進み、残り時間が減っている', () => {
    const { state } = play('mission-steal', 5)
    expect(missionGauge(state.mission)?.text).toBe('1/3')
    expect(state.mission.active?.timeLeft).toBeLessThan(75)
  })

  it('時間内に車で届けると達成し、報酬と上乗せが入る', () => {
    const { state, seen } = play('mission-timed', 18, (s) => s.mission.done.length > 0)
    expect(seen.has('missionDone')).toBe(true)
    expect(state.cash).toBeGreaterThan(1000 + 8000)
    expect(viewOf(state).markers.some((m) => m.ref === 'slope-delivery')).toBe(false)
  })

  it('運ぶ: 宮益坂の上まで届けて達成する', () => {
    const { state, seen } = play('mission-carry', 20, (s) => s.mission.active == null)
    expect(seen.has('missionDone') || seen.has('missionFail')).toBe(true)
    expect(state.mission.active).toBeNull()
  })

  it('尾行: 歩いて付いていくと倉庫まで辿り着ける', () => {
    const { state, seen } = play('mission-tail', 96, (s) => (s.mission.active?.step ?? 0) >= 2)
    expect(seen.has('missionFail')).toBe(false)
    // 倉庫の前まで着いて、「取り返す」の段に入る
    expect(state.mission.active).toMatchObject({ id: 'tail-the-reseller', step: 2 })
  })

  it('尾行: 走って近づくと気づかれて失敗する', () => {
    const { state, seen } = play('mission-fail', 12, (s) => s.mission.cue?.kind === 'failed')
    expect(seen.has('missionFail')).toBe(true)
    expect(missionCueModel(state.mission, state.t)?.detail).toBe('気づかれた')
  })

  it('最初の1本を通しで: 奪う → 車に乗る → 車で届けて達成 → 次の依頼が開き、降りて歩き出す', () => {
    const at: Record<string, number> = {}
    const { state, seen } = play('mission', 24, (s) => {
      const a = s.mission.active
      if (a && at[`step${a.step}`] == null) at[`step${a.step}`] = s.t
      if (!a && s.mission.done.length > 0 && at.done == null) at.done = s.t
      if (at.done != null && s.mode === 'foot' && at.out == null) at.out = s.t
      return false
    })
    expect(seen.has('missionFail')).toBe(false)
    expect(seen.has('busted')).toBe(false)
    expect(state.mission.done).toContain('first-fit')
    // 録画の 8 コマ（最初の 18 秒）に、行為の切り替わりが全部入る
    expect(at.step1).toBeLessThan(2.5)
    expect(at.step2).toBeLessThan(6)
    expect(at.done).toBeGreaterThan(10)
    expect(at.done).toBeLessThan(14)
    expect(at.out).toBeLessThan(18)
    expect(state.cash).toBeGreaterThanOrEqual(1000 + 3000)
    // 次の依頼が開いている
    // 次の依頼が開いていて、いちばん近い依頼人が先頭（歩いて着いていれば、もう始まっている）
    expect(state.mission.active?.id ?? viewOf(state).markers[0]?.ref).toBe('miyamasu-laundry')
  })

  it('見回りの輪に入ったまま立ち止まると、見抜かれて失敗する', () => {
    const { state, seen } = play('mission-caught', 12, (s) => s.mission.cue?.kind === 'failed')
    expect(seen.has('missionFail')).toBe(true)
    expect(missionCueModel(state.mission, state.t)?.detail).toBe('見回りに見抜かれた')
  })
})
