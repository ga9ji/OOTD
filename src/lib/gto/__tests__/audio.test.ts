// 音（部品: audio）の、鳴らす前の計算（回転数・場面・WAV）を確かめる。WebAudio には触らない。
import { describe, expect, it } from 'vitest'
import { createAudioMemo, deriveAudio, ENGINE_TUNING, idleEngine, sirenHz, stepEngine, type EngineSim } from '../gtoAudioModel'
import { AUDIO_SCENES, buildScene } from '../gtoAudioScenes'
import { audioStats, encodeWav, toBase64 } from '../gtoAudioWav'
import { VEHICLE_SPECS } from '../vehicle'
import { DT, run, start, world } from './helpers'

const spec = VEHICLE_SPECS.sedan

/** 同じ踏み方で seconds 秒ぶん回転数の模型を進め、途中経過も返す */
function rev(from: EngineSim, seconds: number, throttle: number, speed0: number) {
  let e = from
  let speed = speed0
  const trace: EngineSim[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const accel = throttle > 0 ? spec.accel * throttle * (1 - (speed / spec.maxSpeed) ** 2) : -1.2
    speed = Math.max(0, speed + accel * DT)
    e = stepEngine(e, { speed, accel, maxSpeed: spec.maxSpeed, maxAccel: spec.accel }, DT)
    trace.push(e)
  }
  return { e, speed, trace }
}

describe('エンジンの回転数', () => {
  it('止まっていればアイドル回転に落ち着く', () => {
    const { e } = rev(idleEngine(), 2, 0, 0)
    expect(e.rpm).toBeGreaterThan(ENGINE_TUNING.idle - 80)
    expect(e.rpm).toBeLessThan(ENGINE_TUNING.idle + 80)
    expect(e.load).toBeLessThan(0.1)
    expect(e.gear).toBe(0)
  })

  it('踏み続けると回転が上がり、変速のたびに落ちる', () => {
    const { trace, e } = rev(idleEngine(), 9, 1, 0)
    const shifts = trace.filter((s, i) => i > 0 && s.gear > trace[i - 1].gear)
    expect(shifts.length).toBeGreaterThanOrEqual(3)
    expect(e.gear).toBeGreaterThanOrEqual(3)
    // 変速の直前より、変速した直後（0.3 秒のあいだ）の回転が低い
    const at = trace.findIndex((s, i) => i > 0 && s.gear > trace[i - 1].gear)
    const after = Math.min(...trace.slice(at, at + 18).map((s) => s.rpm))
    expect(after).toBeLessThan(trace[at - 1].rpm - 600)
    expect(Math.max(...trace.map((s) => s.rpm))).toBeLessThanOrEqual(ENGINE_TUNING.redline)
  })

  it('踏んでいる間は負荷が高く、離すと負荷が抜ける', () => {
    const on = rev(idleEngine(), 2.6, 1, 0)
    expect(on.e.load).toBeGreaterThan(0.7)
    const off = rev(on.e, 1, 0, on.speed)
    expect(off.e.load).toBeLessThan(0.15)
  })

  it('回転は1歩で飛ばない（音程が跳ねない）', () => {
    const { trace } = rev(idleEngine(), 9, 1, 0)
    for (let i = 1; i < trace.length; i++) expect(Math.abs(trace[i].rpm - trace[i - 1].rpm)).toBeLessThan(260)
  })

  it('速度が落ちるとシフトダウンする', () => {
    const fast = rev(idleEngine(), 9, 1, 0)
    const slow = rev(fast.e, 20, 0, fast.speed)
    expect(slow.e.gear).toBeLessThan(fast.e.gear)
  })
})

describe('サイレン', () => {
  it('上がって下がる一続きの音程で、周期で元へ戻る', () => {
    const hz = Array.from({ length: 120 }, (_, i) => sirenHz(i * 0.05, 0))
    expect(Math.min(...hz)).toBeGreaterThan(380)
    expect(Math.max(...hz)).toBeLessThan(900)
    expect(Math.max(...hz) - Math.min(...hz)).toBeGreaterThan(300)
    for (let i = 1; i < hz.length; i++) expect(Math.abs(hz[i] - hz[i - 1])).toBeLessThan(40)
    expect(sirenHz(0, 0)).toBeCloseTo(sirenHz(6, 0), 3)
  })
})

describe('ゲームの状態から音の様子を作る', () => {
  it('徒歩で歩くと足音の合図が出て、エンジンは鳴らない', () => {
    let s = start({ mode: 'foot' })
    let memo = createAudioMemo()
    let steps = 0
    for (let i = 0; i < 180; i++) {
      s = run(s, DT, { moveY: 1 })
      const out = deriveAudio(s, world, memo, { time: 'day', phase: 'play', dt: DT })
      memo = out.memo
      steps += out.cues.filter((c) => c.type === 'step').length
      expect(out.frame.engine.on).toBeLessThan(0.01)
    }
    expect(steps).toBeGreaterThanOrEqual(3)
    expect(steps).toBeLessThanOrEqual(12)
  })

  it('車で踏むと回転と負荷が上がり、sim の出来事は合図としてそのまま渡る', () => {
    let s = start({ mode: 'drive' })
    let memo = createAudioMemo()
    let maxRpm = 0
    let maxLoad = 0
    for (let i = 0; i < 240; i++) {
      s = run(s, DT, { moveY: 1 })
      const out = deriveAudio(s, world, memo, { time: 'day', phase: 'play', dt: DT })
      memo = out.memo
      maxRpm = Math.max(maxRpm, out.frame.engine.rpm)
      maxLoad = Math.max(maxLoad, out.frame.engine.load)
      for (const e of s.events) if (e.type !== 'crash') expect(out.cues.some((c) => c.type === e.type)).toBe(true)
    }
    expect(maxRpm).toBeGreaterThan(3000)
    expect(maxLoad).toBeGreaterThan(0.7)
  })

  it('壁をこすり続けても、衝突の音は間を空けて鳴る', () => {
    const base = start({ mode: 'drive' })
    let memo = createAudioMemo()
    let crashes = 0
    for (let i = 0; i < 60; i++) {
      const s = { ...base, t: i * DT, events: [{ type: 'crash' as const, x: base.player.x, z: base.player.z, value: 5 }, { type: 'crash' as const, x: base.player.x, z: base.player.z, value: 9 }] }
      const out = deriveAudio(s, world, memo, { time: 'day', phase: 'play', dt: DT })
      memo = out.memo
      const hits = out.cues.filter((c) => c.type === 'crash')
      crashes += hits.length
      // 重なったときは強いほうを鳴らす
      for (const h of hits) expect(h.value).toBe(9)
    }
    expect(crashes).toBeGreaterThanOrEqual(3)
    expect(crashes).toBeLessThanOrEqual(6)
  })

  it('元の状態と覚え書きを書き換えない', () => {
    const s = run(start({ mode: 'drive' }), 0.5, { moveY: 1 })
    const memo = createAudioMemo()
    const before = JSON.stringify(memo)
    const frozen = JSON.stringify(s)
    deriveAudio(s, world, memo, { time: 'night', phase: 'play', dt: DT })
    expect(JSON.stringify(memo)).toBe(before)
    expect(JSON.stringify(s)).toBe(frozen)
  })

  it('題名の画面では手配のサイレンを鳴らさない', () => {
    const s = start({ mode: 'drive', stage: { wanted: 3 } })
    const out = deriveAudio(s, world, createAudioMemo(), { time: 'day', phase: 'title', dt: DT })
    expect(out.frame.sirens.every((x) => x.gain === 0)).toBe(true)
  })

  it('音量や定位は 0..1 / −1..1 に収まる', () => {
    let s = start({ mode: 'drive', stage: { wanted: 3 } })
    let memo = createAudioMemo()
    for (let i = 0; i < 300; i++) {
      s = run(s, DT, { moveY: 1, moveX: i > 200 ? 1 : 0, handbrake: i > 220 })
      const out = deriveAudio(s, world, memo, { time: 'dusk', phase: 'play', dt: DT })
      memo = out.memo
      const f = out.frame
      for (const v of [f.crowd, f.traffic, f.train, f.signal, f.skid, f.engine.on, f.engine.load, ...f.sirens.map((x) => x.gain)]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      for (const v of [f.crowdPan, f.trafficPan, f.trainPan, ...f.sirens.map((x) => x.pan)]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('書き出し用の場面', () => {
  it('3つの決まった場面（運転・街歩き・追跡）と合図の一覧がある', () => {
    expect(Object.keys(AUDIO_SCENES)).toEqual(expect.arrayContaining(['drive', 'walk', 'chase', 'cues']))
  })

  it('同じ場面は何度作っても同じ', () => {
    for (const name of Object.keys(AUDIO_SCENES)) {
      expect(JSON.stringify(buildScene(name))).toBe(JSON.stringify(buildScene(name)))
    }
  })

  it('運転の場面はアイドル→加速（変速あり）→ブレーキ（タイヤが鳴く）→アイドル', () => {
    const scene = buildScene('drive')
    const at = (t: number) => scene.steps[Math.round(t * 60)].frame
    expect(at(1).engine.rpm).toBeLessThan(1100)
    expect(Math.max(...scene.steps.map((s) => s.frame.engine.rpm))).toBeGreaterThan(5000)
    expect(scene.steps.some((s) => s.cues.some((c) => c.type === 'shift'))).toBe(true)
    expect(Math.max(...scene.steps.map((s) => s.frame.skid))).toBeGreaterThan(0.4)
    expect(at(scene.seconds - 0.5).engine.rpm).toBeLessThan(1100)
    expect(at(scene.seconds - 0.5).speed).toBeLessThan(0.5)
  })

  it('街歩きには足音・雑踏・信号・電車が入る', () => {
    const scene = buildScene('walk')
    const frames = scene.steps.map((s) => s.frame)
    expect(scene.steps.flatMap((s) => s.cues).filter((c) => c.type === 'step').length).toBeGreaterThan(12)
    expect(Math.max(...frames.map((f) => f.crowd))).toBeGreaterThan(0.6)
    expect(Math.max(...frames.map((f) => f.signal))).toBeGreaterThan(0.5)
    expect(Math.max(...frames.map((f) => f.train))).toBeGreaterThan(0.5)
    expect(frames.every((f) => f.engine.on === 0)).toBe(true)
  })

  it('追跡にはサイレン・手配の合図・衝突が入る', () => {
    const scene = buildScene('chase')
    const cues = scene.steps.flatMap((s) => s.cues).map((c) => c.type)
    expect(cues).toEqual(expect.arrayContaining(['wantedUp', 'crash']))
    expect(Math.max(...scene.steps.map((s) => s.frame.sirens[0].gain))).toBeGreaterThan(0.5)
  })

  it('合図の一覧には sim の出来事が全種類入っている', () => {
    const cues = new Set(buildScene('cues').steps.flatMap((s) => s.cues).map((c) => c.type))
    for (const type of ['enter', 'exit', 'carjack', 'steal', 'crash', 'horn', 'hitPed', 'wantedUp', 'wantedClear', 'busted', 'missionStart', 'missionStep', 'missionDone', 'missionFail']) {
      expect(cues.has(type as never)).toBe(true)
    }
  })
})

describe('WAV', () => {
  it('16bit PCM のヘッダと長さが合う', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1, -1, 2])
    const right = new Float32Array(6)
    const wav = encodeWav([left, right], 44100)
    const view = new DataView(wav.buffer)
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(36)).toBe('data')
    expect(wav.length).toBe(44 + 6 * 2 * 2)
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getInt16(44 + 4, true)).toBe(16384)
    expect(view.getInt16(44 + 12, true)).toBe(32767)
    // 範囲の外は切り詰める
    expect(view.getInt16(44 + 20, true)).toBe(32767)
  })

  it('音量の要約（最大・実効値・音割れの割合）を出す', () => {
    const tone = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((i / 44100) * Math.PI * 2 * 440) * 0.5)
    const stats = audioStats([tone], 44100)
    expect(stats.peak).toBeCloseTo(0.5, 2)
    expect(stats.rms).toBeCloseTo(0.3536, 2)
    expect(stats.clipped).toBe(0)
    expect(stats.windows.length).toBe(2)
    expect(audioStats([Float32Array.from([1.2, 0, 0, 0])], 4).clipped).toBeCloseTo(0.25, 5)
  })

  it('base64 にして戻すと同じバイト列になる', () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 37) & 255)
    const back = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0))
    expect(back.length).toBe(bytes.length)
    expect(back[69999]).toBe(bytes[69999])
  })
})
