// Grand Theft Outfit [部品: missions] ミッション。登場人物も筋書きもすべてオリジナル。
// 入口: MISSIONS（渋谷）・ALL_MISSIONS・missionsOf(area) / createMissions(area) / startMission / stepMissions / missionMarkers / missionText
//       / missionCueModel（導入・達成・失敗の演出。達成の札には、次に開いた依頼の知らせが付く）
//       / missionGauge（数・警戒・しわ）/ tailPoint（尾行の相手の位置）/ isOpen・unlockedBy（依頼が開く順）
// 契約: 主人公の様子（MissionView）とその1歩で起きたこと（GtoEvent）だけを読み、
//       進み具合と賞金と起きたことを返す。中身は missionData.ts の表に足すだけで増やせる。
//       [areas] 依頼人が立つ・踏んで始まるのは、いまいるエリア（MissionState.area。無ければ渋谷）の依頼だけ。
//       達成の記録（done）は全エリアで 1 本。id から中身を引くときは全エリアの表を見る。
import { cumulative, dist2, pointAlong } from './math'
import { ALL_MISSIONS, MISSIONS, missionsOf, type Guard, type MissionDef, type MissionStep } from './missionData'
import type { AreaId, GtoEvent, Marker, MissionCue, MissionProgress, MissionState } from './types'

export { ALL_MISSIONS, MISSIONS, missionsOf, type Guard, type MissionDef, type MissionStep }

export const MISSION_TUNING = {
  startRadius: 3,
  /** 題名の札を出しておく秒 */
  bannerSeconds: 4.5,
  /** 演出を出しておく秒 */
  cueSeconds: { intro: 6.5, step: 5.5, passed: 5, failed: 4.5 } as Record<MissionCue['kind'], number>,
  /** 失敗してから、同じ場所で始め直せるようになるまでの秒 */
  retryDelay: 5,
  /** 尾行: 近すぎる状態がこの秒数続くと気づかれる（車だと目立つので速い） */
  spotSeconds: 3.2,
  spotSecondsInVehicle: 1.4,
  /** 尾行: 離れると警戒がこの秒数で解ける */
  calmSeconds: 9,
  /** 尾行: 離れすぎたまま、この秒数で見失う */
  lostSeconds: 6,
  /** 尾行: 相手が着いたあと、この距離まで寄れば追いついたことにする */
  arriveRange: 40,
  /** 見回り: 輪の中にこの秒数いると見抜かれる。輪を出ると、この秒数かけて疑いが解ける（ゆっくり） */
  guardSeconds: 3,
  guardCalmSeconds: 20,
  /** 受け渡し: 手配が付いたまま、この秒数で話が流れる。手配が消えると、この秒数で落ち着く */
  heatSeconds: 6,
  heatCalmSeconds: 8,
  /** 達成の札が消えたあとも、次の依頼の知らせを出しておく秒 */
  nextJobSeconds: 7,
  /** 「車をつかまえる」で目印を付ける車を探す範囲 m。走っている車は、停まっている車よりこの倍率ぶん遠い扱いにする */
  carRange: 90,
  movingCarPenalty: 1.6,
}

/** area は、いまいるエリア（省くと渋谷。渋谷のときは欄を置かない＝これまでの状態と同じ形） */
export const createMissions = (area: AreaId = 'shibuya'): MissionState => ({ ...(area !== 'shibuya' ? { area } : {}), active: null, done: [], banner: null, cue: null })

const defOf = (id: string) => ALL_MISSIONS.find((m) => m.id === id)

/** その依頼がいま受けられるか（まだ達成しておらず、前提の依頼を達成している） */
export const isOpen = (m: MissionState, d: MissionDef): boolean => !m.done.includes(d.id) && (d.after == null || m.done.includes(d.after))

/** id を達成すると新しく開く依頼 */
export const unlockedBy = (id: string): MissionDef[] => ALL_MISSIONS.filter((d) => d.after === id)

/** 目印を決めるために見る、主人公のまわりの様子（無くてもよい。あれば「車をつかまえる」で近くの車に印を付ける） */
export interface MissionScene {
  x: number
  z: number
  vehicles: readonly { x: number; z: number; driver: string }[]
}

/** 「車をつかまえる」で狙う車（近い順。停まっている車を優先し、警察と自分の車は除く） */
function carToTake(scene: MissionScene): { x: number; z: number } | null {
  const T = MISSION_TUNING
  let best: { x: number; z: number } | null = null
  let bestScore = T.carRange
  for (const v of scene.vehicles) {
    if (v.driver === 'player' || v.driver === 'police') continue
    const score = Math.sqrt(dist2(scene.x, scene.z, v.x, v.z)) * (v.driver === 'none' ? 1 : T.movingCarPenalty)
    if (score < bestScore) {
      bestScore = score
      best = { x: v.x, z: v.z }
    }
  }
  return best
}

/** 手順に入ったときの残り時間（制限を置き直す・足す・無し） */
const timerFor = (step: MissionStep | undefined, carried: number | null): number | null => {
  if (step?.timeLimit != null) return step.timeLimit
  if (step?.addTime != null) return (carried ?? 0) + step.addTime
  return null
}

const enter = (def: MissionDef, index: number, carried: number | null): MissionProgress => ({
  id: def.id,
  step: index,
  stepTime: 0,
  count: 0,
  timeLeft: timerFor(def.steps[index], carried),
  meter: 0,
})

/** ミッションを始めた状態を作る（開始地点を踏んだとき、撮影用の段取り、どちらもここを通る）。step で途中から始められる */
export function startMission(m: MissionState, id: string, t: number, step = 0): MissionState {
  const def = defOf(id)
  if (!def) return m
  const index = Math.max(0, Math.min(def.steps.length - 1, Math.floor(step)))
  return {
    ...m,
    active: enter(def, index, null),
    banner: { text: `${def.title} — ${def.giver}`, until: t + MISSION_TUNING.bannerSeconds },
    cue: { kind: 'intro', at: t, missionId: id, step: index },
  }
}

export interface MissionView {
  t: number
  x: number
  z: number
  inVehicle: boolean
  wantedLevel: number
}

// ---- 尾行の相手 ----

type TailStep = Extract<MissionStep, { kind: 'tail' }>
const cumCache = new WeakMap<TailStep, number[]>()
const cumOf = (step: TailStep) => {
  const cached = cumCache.get(step)
  if (cached) return cached
  const cum = cumulative(step.path)
  cumCache.set(step, cum)
  return cum
}

/** 尾行の相手が、手順に入ってから stepTime 秒後にいる場所。s は歩いた距離、done は道筋の終わりに着いたか */
export function tailPoint(step: TailStep, stepTime: number): { x: number; z: number; heading: number; s: number; done: boolean } {
  const cum = cumOf(step)
  const total = cum[cum.length - 1]
  const s = Math.max(0, Math.min(total, (stepTime - step.delay) * step.speed))
  return { ...pointAlong(step.path, cum, s), s, done: s >= total }
}

// ---- 見回り ----

const guardCum = new WeakMap<Guard, number[]>()

/** 見回りが、手順に入ってから stepTime 秒後にいる場所（道筋を行ったり来たり。1点なら立ち止まり） */
export function guardPoint(guard: Guard, stepTime: number): { x: number; z: number; heading: number; moving: boolean } {
  if (guard.path.length < 4 || guard.speed <= 0) return { x: guard.path[0], z: guard.path[1], heading: 0, moving: false }
  const cum = guardCum.get(guard) ?? cumulative(guard.path)
  guardCum.set(guard, cum)
  const total = cum[cum.length - 1]
  const lap = (Math.max(0, stepTime) * guard.speed) % (total * 2)
  const back = lap > total
  const p = pointAlong(guard.path, cum, back ? total * 2 - lap : lap)
  return { x: p.x, z: p.z, heading: back ? p.heading + Math.PI : p.heading, moving: true }
}

/** いま、どれかの見回りの輪の中にいるか */
const watched = (guards: Guard[] | undefined, stepTime: number, x: number, z: number) =>
  (guards ?? []).some((g) => {
    const p = guardPoint(g, stepTime)
    return dist2(x, z, p.x, p.z) < g.radius * g.radius
  })

// ---- 画面に出すもの ----

/** いま出すべき目印（進行中なら目的地か尾行の相手、そうでなければ未達成のミッションの開始地点） */
export function missionMarkers(m: MissionState, scene?: MissionScene): Marker[] {
  if (m.active) {
    const step = defOf(m.active.id)?.steps[m.active.step]
    if (step?.kind === 'goto') {
      const id = m.active.id
      const t = m.active.stepTime
      // 目的地を先頭に。見回りは「近づいてはいけない人」として後ろに並べる
      const guards = (step.guards ?? []).map((g, i): Marker => {
        const p = guardPoint(g, t)
        return { x: p.x, z: p.z, kind: 'start', radius: g.radius, ref: `${id}#guard${i}`, look: 'person', heading: p.heading, moving: p.moving, threat: true }
      })
      // 降りて手渡す段は、受け取る人をそこに立たせる
      const goal: Marker = step.onFoot
        ? { x: step.x, z: step.z, kind: 'goal', radius: step.radius, ref: `${id}#to`, look: 'person' }
        : { x: step.x, z: step.z, kind: 'goal', radius: step.radius, ref: id }
      return [goal, ...guards]
    }
    if (step?.kind === 'tail') {
      const p = tailPoint(step, m.active.stepTime)
      return [{ x: p.x, z: p.z, kind: 'goal', radius: 1.2, ref: m.active.id, look: 'person', heading: p.heading, moving: !p.done && p.s > 0 }]
    }
    if (step?.kind === 'vehicle' && scene) {
      // 乗る段: いちばん手近な車に印を付ける（目標の中身が「場所」から「車」へ変わったことを街の中で見せる）
      const car = carToTake(scene)
      return car ? [{ x: car.x, z: car.z, kind: 'goal', radius: 2.8, ref: `${m.active.id}#car` }] : []
    }
    return []
  }
  const starts = missionsOf(m.area).filter((d) => isOpen(m, d)).map(
    (d): Marker => ({ x: d.start.x, z: d.start.z, kind: 'start', radius: MISSION_TUNING.startRadius, ref: d.id, look: 'person' }),
  )
  // 主人公の場所が分かるときは、近い依頼人を先頭にする（案内とデモは先頭を目指す）
  return scene ? [...starts].sort((a, b) => dist2(scene.x, scene.z, a.x, a.z) - dist2(scene.x, scene.z, b.x, b.z)) : starts
}

/** HUD に出す題名・いまの目的・残り時間 */
export function missionText(m: MissionState, t: number): { title: string; objective: string; timeLeft: number | null; banner: string } {
  const banner = m.banner && m.banner.until > t ? m.banner.text : ''
  if (!m.active) return { title: '', objective: '', timeLeft: null, banner }
  const def = defOf(m.active.id)
  const step = def?.steps[m.active.step]
  return { title: def?.title ?? '', objective: step?.text ?? '', timeLeft: m.active.timeLeft, banner }
}

/** 次の依頼の知らせに付ける見出し */
export const NEXT_JOB_LABEL = '新しい依頼'

export interface CueModel {
  kind: MissionCue['kind']
  /** 出してからの秒と、出しておく秒 */
  age: number
  life: number
  title: string
  /** 話している人と台詞（無ければ空） */
  speaker: string
  line: string
  /** 目的の文と、その中で色を変える言葉 */
  objective: string
  accent: string
  /** 失敗の理由 */
  detail: string
  reward: number
  bonus: number
}

/** いま出す演出（導入・手順の切り替わり・達成・失敗）。出す時間を過ぎたら null */
export function missionCueModel(m: MissionState, t: number): CueModel | null {
  const cue = m.cue
  if (!cue) return null
  const life = MISSION_TUNING.cueSeconds[cue.kind]
  const age = t - cue.at
  if (age < 0 || age >= life) return null
  const def = defOf(cue.missionId)
  if (!def) return null
  const step = def.steps[cue.step]
  const talking = cue.kind === 'intro' || cue.kind === 'step'
  // 達成の札には、これで開いた次の依頼の知らせを添える
  const next = cue.kind === 'passed' ? unlockedBy(def.id)[0] : undefined
  const line = next ? next.hook : !talking ? '' : cue.kind === 'intro' && cue.step === 0 ? def.brief : (step?.say ?? '')
  return {
    kind: cue.kind,
    age,
    life,
    title: def.title,
    speaker: next ? NEXT_JOB_LABEL : line ? def.giver : '',
    line,
    objective: talking ? (step?.text ?? '') : '',
    accent: talking ? (step?.accent ?? '') : '',
    detail: cue.detail ?? '',
    reward: cue.reward ?? 0,
    bonus: cue.bonus ?? 0,
  }
}

export interface MissionGauge {
  kind: 'count' | 'alert' | 'wrinkle'
  label: string
  /** 0..1 */
  value: number
  /** 数で見せるとき（「1/3」） */
  text: string
  /** 注意を促す一言（無ければ空） */
  hint: string
}

/** 進行中の手順のゲージ（奪った数、尾行の警戒、運ぶ服のしわ）。無い手順は null */
export function missionGauge(m: MissionState): MissionGauge | null {
  const a = m.active
  const step = a ? defOf(a.id)?.steps[a.step] : undefined
  if (!a || !step) return null
  if (step.kind === 'steal') {
    return { kind: 'count', label: 'いただいた服', value: Math.min(1, a.count / step.count), text: `${Math.min(a.count, step.count)}/${step.count}`, hint: '' }
  }
  if (step.kind === 'tail') {
    const meter = a.meter ?? 0
    const hint = a.count > 0.4 ? '離れすぎ。見失う' : meter > 0.25 ? '近すぎる。気づかれる' : ''
    return { kind: 'alert', label: '相手の警戒', value: Math.min(1, meter), text: '', hint }
  }
  if (step.kind === 'goto' && step.guards) {
    // count は「いま輪の中にいるか」
    return { kind: 'alert', label: '見回りの疑い', value: Math.min(1, a.meter ?? 0), text: '', hint: a.count > 0 ? '見られている。赤い輪から出ろ' : '' }
  }
  if (step.kind === 'goto' && step.noHeat) {
    return { kind: 'alert', label: '警察の目', value: Math.min(1, a.meter ?? 0), text: '', hint: a.count > 0 ? '手配を消せ。話が流れる' : '' }
  }
  if (step.kind === 'goto' && step.fragile) {
    const meter = a.meter ?? 0
    return { kind: 'wrinkle', label: '服のしわ', value: Math.min(1, meter), text: '', hint: meter >= 1 - 1 / step.fragile - 1e-6 ? 'あと1回ぶつけると台無し' : '' }
  }
  return null
}

// ---- 1歩 ----

type GotoStep = Extract<MissionStep, { kind: 'goto' }>

/** 目的地に着いたか（vehicle は車に乗ったまま、onFoot は車を降りて） */
const arrived = (step: GotoStep, view: MissionView) =>
  dist2(view.x, view.z, step.x, step.z) < step.radius * step.radius && (!step.vehicle || view.inVehicle) && (!step.onFoot || !view.inVehicle)

interface StepResult {
  count: number
  meter: number
  done: boolean
  /** 失敗の理由（失敗でなければ空） */
  failed: string
}

function advance(step: MissionStep, a: MissionProgress, view: MissionView, events: GtoEvent[], dt: number): StepResult {
  const meter = a.meter ?? 0
  switch (step.kind) {
    case 'goto': {
      if (step.guards || step.noHeat) {
        // やってはいけないこと: 見回りの輪に入る／手配を付けたまま来る。続けるとゲージが満ちて失敗
        const T = MISSION_TUNING
        const seen = watched(step.guards, a.stepTime, view.x, view.z)
        const hot = step.noHeat === true && view.wantedLevel > 0
        const up = seen ? dt / T.guardSeconds : hot ? dt / T.heatSeconds : 0
        const down = dt / (step.guards ? T.guardCalmSeconds : T.heatCalmSeconds)
        const level = up > 0 ? meter + up : Math.max(0, meter - down)
        if (level >= 1) return { count: 1, meter: 1, done: false, failed: seen ? '見回りに見抜かれた' : '警察を連れてきてしまった' }
        const there = arrived(step, view)
        return { count: up > 0 ? 1 : 0, meter: level, done: there, failed: '' }
      }
      const bumps = step.fragile ? events.filter((e) => e.type === 'crash').length : 0
      const wrinkles = step.fragile ? meter + bumps / step.fragile : 0
      if (wrinkles >= 1 - 1e-6) return { count: a.count, meter: 1, done: false, failed: '服がしわだらけになった' }
      const there = arrived(step, view)
      return { count: a.count + bumps, meter: wrinkles, done: there, failed: '' }
    }
    case 'steal': {
      const count = a.count + events.filter((e) => e.type === 'steal').length
      return { count, meter, done: count >= step.count, failed: '' }
    }
    case 'vehicle':
      return { count: a.count, meter, done: view.inVehicle, failed: '' }
    case 'escape':
      // 着いた瞬間に終わらないよう、手配が無くても少し待つ
      return { count: a.count, meter, done: view.wantedLevel === 0 && a.stepTime > 1, failed: '' }
    case 'tail': {
      const T = MISSION_TUNING
      const p = tailPoint(step, a.stepTime)
      const d = Math.sqrt(dist2(view.x, view.z, p.x, p.z))
      const alert =
        d < step.near ? meter + dt / (view.inVehicle ? T.spotSecondsInVehicle : T.spotSeconds) : Math.max(0, meter - dt / T.calmSeconds)
      // count は「離れすぎている秒」に使う
      const away = d > step.far ? a.count + dt : 0
      if (alert >= 1) return { count: away, meter: 1, done: false, failed: '気づかれた' }
      if (away >= T.lostSeconds) return { count: away, meter: alert, done: false, failed: '見失った' }
      return { count: away, meter: alert, done: p.done && d < T.arriveRange, failed: '' }
    }
  }
}

export function stepMissions(
  m: MissionState,
  view: MissionView,
  events: GtoEvent[],
  dt: number,
): { mission: MissionState; events: GtoEvent[]; reward: number } {
  const out: GtoEvent[] = []
  if (!m.active) {
    const cooling = m.cue?.kind === 'failed' && view.t - m.cue.at < MISSION_TUNING.retryDelay
    const r2 = MISSION_TUNING.startRadius * MISSION_TUNING.startRadius
    const hit = cooling || view.inVehicle ? undefined : missionsOf(m.area).find((d) => isOpen(m, d) && dist2(view.x, view.z, d.start.x, d.start.z) < r2)
    if (!hit) return { mission: m, events: out, reward: 0 }
    out.push({ type: 'missionStart', x: view.x, z: view.z, ref: hit.id })
    return { mission: startMission(m, hit.id, view.t), events: out, reward: 0 }
  }

  const def = defOf(m.active.id)
  if (!def) return { mission: { ...m, active: null }, events: out, reward: 0 }
  const index = m.active.step
  const fail = (detail: string) => {
    out.push({ type: 'missionFail', x: view.x, z: view.z, ref: def.id })
    const cue: MissionCue = { kind: 'failed', at: view.t, missionId: def.id, step: index, detail }
    return { mission: { ...m, active: null, banner: null, cue }, events: out, reward: 0 }
  }
  if (events.some((e) => e.type === 'busted')) return fail('捕まった')
  const timeLeft = m.active.timeLeft == null ? null : m.active.timeLeft - dt
  if (timeLeft != null && timeLeft <= 0) return fail('時間切れ')

  const step = def.steps[index]
  const moved = advance(step, m.active, view, events, dt)
  if (moved.failed) return fail(moved.failed)
  const active: MissionProgress = { ...m.active, stepTime: m.active.stepTime + dt, count: moved.count, meter: moved.meter, timeLeft }
  if (!moved.done) return { mission: { ...m, active }, events: out, reward: 0 }

  const nextIndex = index + 1
  if (nextIndex >= def.steps.length) {
    const quick = def.timeBonus && timeLeft != null ? Math.floor(timeLeft) * def.timeBonus : 0
    const clean = def.cleanBonus && step.kind === 'goto' && step.fragile && moved.meter <= 0 ? def.cleanBonus : 0
    const bonus = quick + clean
    out.push({ type: 'missionDone', x: view.x, z: view.z, ref: def.id, value: def.reward + bonus })
    // 札が消えたあとも、次の依頼の知らせをしばらく出しておく
    const next = unlockedBy(def.id)[0]
    const T = MISSION_TUNING
    return {
      mission: {
        active: null,
        done: [...m.done, def.id],
        banner: next ? { text: next.hook, until: view.t + T.cueSeconds.passed + T.nextJobSeconds } : null,
        cue: { kind: 'passed', at: view.t, missionId: def.id, step: index, reward: def.reward, bonus },
      },
      events: out,
      reward: def.reward + bonus,
    }
  }
  out.push({ type: 'missionStep', x: view.x, z: view.z, ref: def.id, value: nextIndex })
  return {
    mission: { ...m, active: enter(def, nextIndex, timeLeft), cue: { kind: 'step', at: view.t, missionId: def.id, step: nextIndex } },
    events: out,
    reward: 0,
  }
}
