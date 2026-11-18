// [部品: vehicle] 撮影用デモの中身を数値で確かめる。録画役は 1 秒あたり 8 コマで撮るので、
// 「進む向きに対して斜めを向いたまま滑るコマが続く」「途中でぶつからない」を同じ刻みで数える。
import { describe, expect, it } from 'vitest'
import { DEMOS, demoInput } from '../demo'
import { angleDiff, DEG, headingOf } from '../math'
import { parseLaunch } from '../shot'
import { createGtoState, stepGto, viewOf } from '../sim'
import { cfg, DT, world } from './helpers'

interface Frame {
  t: number
  /** 進む向きに対する車体の斜め（度） */
  drift: number
  /** 路面の上を動いている速さ m/s */
  pace: number
  /** カメラから見た車体の向き（度。0 が真後ろ） */
  view: number
  /** カメラから見た車体の向き（度。符号つき） */
  side: number
  /** 横滑りの速さ m/s（右が＋） */
  slip: number
  /** この刻みのあいだに起きた、いちばん強い衝突 m/s */
  crash: number
  /** 前後の速さ m/s と加速度 m/s² */
  speed: number
  accel: number
  /** カメラの視線から車までの横のずれ（度。0 が画面の真ん中） */
  off: number
}

/** デモを再生して、1/8 秒ごとの主人公の車を返す */
function record(name: string, seconds: number): Frame[] {
  const demo = DEMOS[name]
  const launch = parseLaunch(new URLSearchParams(`demo=${name}`), world)
  let s = createGtoState(world, cfg, { seed: launch.seed, mode: launch.mode, start: launch.start, stage: demo.stage, starterCar: true })
  const out: Frame[] = []
  let crash = 0
  const steps = Math.round(seconds / DT)
  for (let i = 1; i <= steps; i++) {
    const goal = viewOf(s).markers[0] ?? null
    const near = world.nearestRoad(s.player.x, s.player.z, true, 30)
    const road = near ? { x: near.x, z: near.z, heading: near.heading } : null
    const view = { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal, heading: s.player.heading, road, speed: s.player.speed }
    s = stepGto(s, demoInput(demo, s.t, DT, view), world, cfg, DT)
    const v = s.vehicles.find((c) => c.driver === 'player')
    if (!v) continue
    for (const e of s.events) if (e.type === 'crash' && e.ref === String(v.id)) crash = Math.max(crash, e.value ?? 0)
    // 1/8 秒の境目を越えた歩だけを残す
    if (Math.floor(i * DT * 8 + 1e-9) === Math.floor((i - 1) * DT * 8 + 1e-9)) continue
    const c = s.camera
    out.push({
      t: s.t,
      drift: Math.atan2(Math.abs(v.slip), Math.abs(v.speed)) / DEG,
      pace: Math.hypot(v.speed, v.slip),
      view: Math.abs(angleDiff(headingOf(v.x - c.x, v.z - c.z), v.heading)) / DEG,
      side: angleDiff(headingOf(v.x - c.x, v.z - c.z), v.heading) / DEG,
      slip: v.slip,
      crash,
      speed: v.speed,
      accel: v.accel,
      off: angleDiff(headingOf(c.tx - c.x, c.tz - c.z), headingOf(v.x - c.x, v.z - c.z)) / DEG,
    })
    crash = 0
  }
  return out
}

describe('gto vehicle のデモ: drive-drift（進入 → 振り出し → 振り返し → 収束）', () => {
  const frames = record('drive-drift', 7.6)
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.02)
  // 録画役が並べる 8 コマ（8 コマ/秒の f_024 から 3 コマおき = 3.0 秒から 0.375 秒刻み）
  const cells = [3, 3.375, 3.75, 4.125, 4.5, 4.875, 5.25, 5.625].map((t) => at(t))

  it('8 コマのうち、1 コマ目は真後ろ（進入）、2 コマ目は片側へ 15° 以上（振り出し）、3 コマ目は 30° 以上（最大）、5 コマ目は反対側へ 22° 以上（振り返し）、6 コマ目は 35° 以上（反対側の最大）、8 コマ目は 8° 以内（収束）', () => {
    expect(cells.every((f) => f)).toBe(true)
    const side = cells.map((f) => f?.side ?? 0)
    expect(Math.abs(side[0])).toBeLessThan(3)
    expect(side[1]).toBeLessThan(-15)
    expect(side[2]).toBeLessThan(-30)
    expect(side[4]).toBeGreaterThan(22)
    expect(side[5]).toBeGreaterThan(35)
    expect(Math.abs(side[7])).toBeLessThan(8)
  })

  it('隣り合うコマで車体の見える向きが同じにならない（8 コマのどの隣どうしも 6° 以上違い、うち 5 か所は 12° 以上違う。一定の角度で固まらない）', () => {
    const side = cells.map((f) => f?.side ?? 0)
    const steps = side.slice(1).map((v, i) => Math.abs(v - side[i]))
    expect(Math.min(...steps)).toBeGreaterThan(6)
    expect(steps.filter((d) => d >= 12).length).toBeGreaterThanOrEqual(5)
  })

  it('滑る向きが途中で入れ替わり（3.75 秒は右へ、4.875 秒は左へ 6m/s 以上）、最後は滑りが収まる', () => {
    expect(at(3.75)?.slip ?? 0).toBeGreaterThan(6)
    expect(at(4.875)?.slip ?? 0).toBeLessThan(-6)
    expect(Math.abs(at(5.625)?.slip ?? 9)).toBeLessThan(0.5)
  })

  it('前後の荷重も動く: 振り出しの最中（3.25 秒）は減速、立ち上がりのコマ（4.125 秒）は加速', () => {
    expect(at(3.25)?.accel ?? 0).toBeLessThan(-4)
    expect(at(4.125)?.accel ?? 0).toBeGreaterThan(3)
  })

  it('車は画面の中に留まり（視線から 17° 以内）、何にもぶつからず、最後は急ブレーキで止まる', () => {
    expect(Math.max(...frames.map((f) => Math.abs(f.off)))).toBeLessThan(17)
    expect(Math.max(...frames.map((f) => f.crash))).toBe(0)
    expect(frames[frames.length - 1].pace).toBeLessThan(1)
  })
})

describe('gto vehicle のデモ: drive-swing（尻を左右へ振る）', () => {
  const frames = record('drive-swing', 6.4)
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.02)

  it('2.1〜3.0 秒の 8 コマのあいだに、車体が片側へ 20° 以上斜めに見えてから、反対側へ 25° 以上斜めに見えるところまで振り返す', () => {
    const window = frames.filter((f) => f.t > 2.1 && f.t < 3.05)
    expect(window.length).toBe(8)
    expect(Math.min(...window.map((f) => f.side))).toBeLessThan(-20)
    expect(Math.max(...window.map((f) => f.side))).toBeGreaterThan(25)
  })

  it('振り返しの途中（2.75 秒）は車体がほぼ真後ろから見え、その前後で滑る向きが入れ替わる', () => {
    expect(Math.abs(at(2.75)?.side ?? 99)).toBeLessThan(8)
    expect((at(2.375)?.slip ?? 0) * (at(3.125)?.slip ?? 0)).toBeLessThan(0)
    expect(Math.abs(at(2.375)?.slip ?? 0)).toBeGreaterThan(4)
    expect(Math.abs(at(3.125)?.slip ?? 0)).toBeGreaterThan(7)
    // 滑りは 10 m/s を超えない（カメラの軸が横滑りに遅れて、車が画面の端へ出てしまわない量）
    expect(Math.max(...frames.map((f) => Math.abs(f.slip)))).toBeLessThan(10)
  })

  it('何にもぶつからず、最後は急ブレーキで止まる', () => {
    expect(Math.max(...frames.map((f) => f.crash))).toBe(0)
    expect(frames[frames.length - 1].pace).toBeLessThan(3)
  })
})

describe('gto vehicle のデモ: drive-turn（交差点を右へ曲がる: 逆へ振る → 切り込む → 尻が流れる → 逆へ切って立て直す）', () => {
  const frames = record('drive-turn', 7.4)
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.02)
  // 録画役が並べる 8 コマ（8 コマ/秒の f_020 から 3 コマおき = 2.5 秒から 0.375 秒刻み）
  const cells = [2.5, 2.875, 3.25, 3.625, 4, 4.375, 4.75, 5.125].map((t) => at(t))

  it('8 コマのうち、1 コマ目は真後ろ、2 コマ目は左へ 10° 以上、4 コマ目は右へ 18° 以上、5 コマ目が最大（38° 以上）、6 コマ目は戻り途中（15〜34°）、8 コマ目は 8° 以内', () => {
    expect(cells.every((f) => f)).toBe(true)
    const side = cells.map((f) => f?.side ?? 0)
    expect(Math.abs(side[0])).toBeLessThan(3)
    expect(side[1]).toBeLessThan(-10)
    expect(side[3]).toBeGreaterThan(18)
    expect(side[4]).toBeGreaterThan(38)
    expect(side[5]).toBeGreaterThan(15)
    expect(side[5]).toBeLessThan(34)
    expect(Math.abs(side[7])).toBeLessThan(8)
  })

  it('滑りは 4 コマ目で始まり、5 コマ目で最大（9m/s 以上）、7 コマ目で 4m/s 未満まで収まる', () => {
    const slip = cells.map((f) => Math.abs(f?.slip ?? 0))
    expect(slip[2]).toBeLessThan(1)
    expect(slip[3]).toBeGreaterThan(3)
    expect(slip[4]).toBeGreaterThan(9)
    expect(slip[6]).toBeLessThan(4)
  })

  it('向きを 70° 以上変えて交差点を抜け、何にもぶつからず、車は画面の中に留まり（視線から 17° 以内）、最後は止まる', () => {
    const demo = DEMOS['drive-turn']
    expect(demo.stage?.at).toBeDefined()
    expect(Math.max(...frames.map((f) => f.crash))).toBe(0)
    expect(Math.max(...frames.map((f) => Math.abs(f.off)))).toBeLessThan(17)
    expect(frames[frames.length - 1].pace).toBeLessThan(1)
  })
})

describe('gto vehicle のデモ: drive-skid（横滑りで黒い痕を残し、急ブレーキで止まる）', () => {
  const frames = record('drive-skid', 8)
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.02)

  it('1 秒刻みの 3 秒のコマが横滑りの最中に当たる（車体が 15〜55° 斜めに見える）', () => {
    expect(Math.abs(at(3)?.slip ?? 0)).toBeGreaterThan(5)
    expect(at(3)?.view ?? 0).toBeGreaterThanOrEqual(15)
    expect(at(3)?.view ?? 99).toBeLessThanOrEqual(55)
  })

  it('5 秒のコマは急ブレーキの最中（まだ 8m/s 以上で走っていて、12.5m/s² を超えて減速している: 四輪が痕を引く）', () => {
    expect(at(5)?.speed ?? 0).toBeGreaterThan(8)
    expect(at(5)?.accel ?? 0).toBeLessThan(-12.5)
  })

  it('車はいつも画面の真ん中あたりに写る（視線から 11° 以内。4:3 に切り出しても車体が端で切れない）', () => {
    expect(Math.max(...frames.map((f) => Math.abs(f.off)))).toBeLessThan(11)
  })

  it('何にもぶつからず（速さが急に落ちない）、最後は止まったまま（後退しない）', () => {
    expect(Math.max(...frames.map((f) => f.crash))).toBe(0)
    for (let i = 1; i < frames.length; i++) expect(frames[i - 1].pace - frames[i].pace).toBeLessThan(3.2)
    expect(Math.abs(frames[frames.length - 1].speed)).toBeLessThan(1)
  })
})

describe('gto vehicle のデモ: drive-lean（8 の字に回って車体のロールを見せる）', () => {
  const frames = record('drive-lean', 9)
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.02)

  it('1 秒刻みの 2〜7 秒のコマすべてで、車体が背後のカメラから 12〜36° 斜めに見え、8m/s 以上で回っている', () => {
    for (const t of [2, 3, 4, 5, 6, 7]) {
      const f = at(t)
      expect(f?.view ?? 0).toBeGreaterThanOrEqual(12)
      expect(f?.view ?? 99).toBeLessThanOrEqual(36)
      expect(f?.speed ?? 0).toBeGreaterThan(8)
    }
  })

  it('左 → 右 → 左と向きが入れ替わる（2 秒と 4 秒、4 秒と 6 秒のコマで車体が逆向きに斜め）', () => {
    expect((at(2)?.side ?? 0) * (at(4)?.side ?? 0)).toBeLessThan(0)
    expect((at(4)?.side ?? 0) * (at(6)?.side ?? 0)).toBeLessThan(0)
  })

  it('滑らせない（横滑り 2m/s 未満）ので、車はいつも画面の真ん中に写る（視線から 5° 以内）', () => {
    expect(Math.max(...frames.map((f) => Math.abs(f.slip)))).toBeLessThan(2)
    expect(Math.max(...frames.map((f) => Math.abs(f.off)))).toBeLessThan(5)
  })

  it('何にもぶつからず、最後は急ブレーキで止まる（後退しない）', () => {
    expect(Math.max(...frames.map((f) => f.crash))).toBe(0)
    for (let i = 1; i < frames.length; i++) expect(frames[i - 1].pace - frames[i].pace).toBeLessThan(3.2)
    expect(Math.abs(frames[frames.length - 1].speed)).toBeLessThan(1)
  })
})

describe('gto vehicle のデモ: drive-ram（停まっている車に突っ込む）', () => {
  const demo = DEMOS['drive-ram']
  const launch = parseLaunch(new URLSearchParams('demo=drive-ram'), world)
  let s = createGtoState(world, cfg, { seed: launch.seed, mode: launch.mode, start: launch.start, stage: demo.stage, starterCar: true })
  const target0 = s.vehicles.find((v) => v.driver === 'none' && v.color === 0x2f5fb0)
  const start = s.vehicles.find((v) => v.driver === 'player')
  let hitAt = Infinity
  let impact = 0
  let pushed = 0
  let swing = 0
  for (let i = 1; i <= Math.round(6 / DT); i++) {
    const view = { x: s.player.x, z: s.player.z, camYaw: s.camera.yaw, goal: null, heading: s.player.heading, road: null, speed: s.player.speed }
    s = stepGto(s, demoInput(demo, s.t, DT, view), world, cfg, DT)
    for (const e of s.events) {
      if (e.type !== 'crash' || e.ref !== String(target0?.id)) continue
      hitAt = Math.min(hitAt, s.t)
      impact = Math.max(impact, e.value ?? 0)
    }
    const t = s.vehicles.find((v) => v.id === target0?.id)
    const me = s.vehicles.find((v) => v.driver === 'player')
    if (t) pushed = Math.max(pushed, Math.hypot(t.speed, t.slip))
    if (me && start) swing = Math.max(swing, Math.abs(angleDiff(start.heading, me.heading)) / DEG)
  }
  const target = s.vehicles.find((v) => v.id === target0?.id)
  const me = s.vehicles.find((v) => v.driver === 'player')

  it('2.3〜2.9 秒に、相手の車に強く当たる（面に向かう速さ 10m/s 以上）', () => {
    expect(target0).toBeDefined()
    expect(hitAt).toBeGreaterThan(2.3)
    expect(hitAt).toBeLessThan(2.9)
    expect(impact).toBeGreaterThan(10)
  })

  it('相手は押し出されて 3m 以上動き、向きを 15° 以上振られ、尻か側面が凹む', () => {
    expect(pushed).toBeGreaterThan(5)
    expect(Math.hypot((target?.x ?? 0) - (target0?.x ?? 0), (target?.z ?? 0) - (target0?.z ?? 0))).toBeGreaterThan(3)
    expect(Math.abs(angleDiff(target0?.heading ?? 0, target?.heading ?? 0)) / DEG).toBeGreaterThan(15)
    expect(Math.max(...(target?.dents ?? [0]))).toBeGreaterThan(0.4)
  })

  it('自分は弾かれて 45° 以上横を向き、鼻が凹んで、6 秒までに止まる', () => {
    expect(swing).toBeGreaterThan(45)
    expect(Math.max(...(me?.dents ?? [0]).slice(0, 3))).toBeGreaterThan(0.5)
    expect(Math.hypot(me?.speed ?? 9, me?.slip ?? 9)).toBeLessThan(1)
  })
})
