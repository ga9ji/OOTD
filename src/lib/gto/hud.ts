// Grand Theft Outfit [部品: hud-minimap] HUD に出す値の導出。
// 入口: hudModel(state, world, extra) / metersText(m)
// 契約: 状態から「画面に出す文字と数」を作るだけ。見た目（GtoHud.tsx）はこの HudModel を並べる。
import { angleDiff, headingOf } from './math'
import type { GtoState, GtoWorld, Marker } from './types'

export interface HudExtra {
  /** 目の前に乗れる車があるか・奪える相手がいるか（sim.ts が各部品から集める） */
  canEnter: boolean
  canSteal: boolean
  missionTitle: string
  objective: string
  timeLeft: number | null
  banner: string
  clock: string
  /** ミッションの目印（開始地点か目的地）。無ければ向きの案内を出さない */
  markers?: Marker[]
  /** ミッションの演出（missions.ts の missionCueModel の形） */
  cue?: HudCueInput | null
  /** 進行中の手順のゲージ（missions.ts の missionGauge の形） */
  gauge?: HudGauge | null
}

/** ミッションの演出の入力。missions.ts の CueModel と同じ形（部品どうしは import しないので、形だけ合わせる） */
export interface HudCueInput {
  kind: 'intro' | 'step' | 'passed' | 'failed'
  age: number
  life: number
  title: string
  speaker: string
  line: string
  objective: string
  accent: string
  detail: string
  reward: number
  bonus: number
}

export interface HudGauge {
  kind: string
  label: string
  /** 0..1 */
  value: number
  text: string
  hint: string
}

/** 画面に出す演出。導入・手順は台詞、達成・失敗は結果の札 */
export interface HudCue {
  kind: HudCueInput['kind']
  title: string
  speaker: string
  line: string
  /** 目的の文の中で色を変える言葉 */
  accent: string
  /** 達成なら報酬（「+¥3,000」）、失敗なら理由 */
  result: string
  /** 報酬への上乗せ（無ければ空） */
  extra: string
  /** 消える直前か（消える動きを付ける） */
  leaving: boolean
}

const CUE_LEAVE_SECONDS = 0.45
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`

export function hudCue(cue: HudCueInput | null | undefined): HudCue | null {
  if (!cue) return null
  const result = cue.kind === 'passed' ? `+${yen(cue.reward)}` : cue.kind === 'failed' ? cue.detail : ''
  return {
    kind: cue.kind,
    title: cue.title,
    speaker: cue.speaker,
    line: cue.line,
    accent: cue.accent,
    result,
    extra: cue.kind === 'passed' && cue.bonus > 0 ? `+${yen(cue.bonus)}` : '',
    leaving: cue.life - cue.age < CUE_LEAVE_SECONDS,
  }
}

/** 目的の文を [前, 要の言葉, 後] に分ける。見つからなければ全文を前に入れる */
export function splitAccent(text: string, accent: string): [string, string, string] {
  const at = accent ? text.indexOf(accent) : -1
  if (at < 0) return [text, '', '']
  return [text.slice(0, at), accent, text.slice(at + accent.length)]
}

/** いま向かう先（目的地、無ければいちばん近い開始地点） */
export interface HudTarget {
  kind: Marker['kind']
  /** 「120m」「1.2km」 */
  dist: string
  /** カメラの向きから見た向き（ラジアン、右が＋）。矢印を回すのに使う */
  turn: number
}

export interface HudModel {
  cash: string
  /** 手配度 0..5 */
  wanted: number
  /** 追っ手に見失われていて、手配が冷めていく途中か */
  cooling: boolean
  /** 捕まりかけ（0..1） */
  bust: number
  /** 車に乗っているときだけ */
  speedKmh: number | null
  /** いまいる通りの実名（無ければ空） */
  street: string
  /** 通りの英語名（地図データにあるときだけ） */
  streetEn: string
  clock: string
  outfitKey: string
  wardrobeCount: number
  missionTitle: string
  objective: string
  timeLeft: string
  /** 残り時間がわずか（色を変える） */
  hurry: boolean
  banner: string
  target: HudTarget | null
  cue: HudCue | null
  gauge: HudGauge | null
  /** 「F 乗る」などの操作の案内 */
  prompts: { key: string; label: string }[]
}

const BUST_SECONDS = 2.2
const HURRY_SECONDS = 15
/** これより遅いときだけ「降りる」の案内を出す m/s */
const EXIT_PROMPT_SPEED = 4

const mmss = (s: number) => {
  const whole = Math.max(0, Math.ceil(s))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** 距離の文字。近くは 5m 刻み、1km からは小数1桁 */
export function metersText(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`
  const step = m < 100 ? 5 : 10
  return `${Math.max(step, Math.round(m / step) * step)}m`
}

function targetOf(state: GtoState, markers: Marker[]): HudTarget | null {
  // 見回り（threat）は向かう先にしない
  const open = markers.filter((m) => !m.threat)
  const pool = open.some((m) => m.kind === 'goal') ? open.filter((m) => m.kind === 'goal') : open
  let best: Marker | null = null
  let bestD = Infinity
  for (const m of pool) {
    const d = Math.hypot(m.x - state.player.x, m.z - state.player.z)
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  if (!best) return null
  const toward = headingOf(best.x - state.player.x, best.z - state.player.z)
  return { kind: best.kind, dist: metersText(bestD), turn: angleDiff(state.camera.yaw, toward) }
}

/** 通り・坂・橋などの名の終わり方。建物や施設の名が付いた通路（地図データ由来）は HUD に出さない */
const STREET_NAME = /(通り|坂|街道|ストリート|ロード|横丁|センター街|アベニュー|小路|橋|線|入口|出口)$/

/** HUD に出す通りの名。かっこ書きの注記を落とし、通りの名でなければ空にする */
export function streetLabel(name: string | null | undefined): string {
  const plain = (name ?? '').replace(/[(（].*$/, '').trim()
  return STREET_NAME.test(plain) ? plain : ''
}

export function hudModel(state: GtoState, world: GtoWorld, extra: HudExtra): HudModel {
  const road = world.nearestRoad(state.player.x, state.player.z, false, 30)
  const street = streetLabel(road?.name)
  const prompts: HudModel['prompts'] = []
  // 走っているあいだは「降りる」を出さない（常時表示を減らす）。止まりかけたら出す
  if (state.mode === 'drive') {
    if (Math.abs(state.player.speed) < EXIT_PROMPT_SPEED) prompts.push({ key: 'F', label: '降りる' })
  } else {
    if (extra.canEnter) prompts.push({ key: 'F', label: '乗る' })
    if (extra.canSteal) prompts.push({ key: 'E', label: '服をいただく' })
  }
  const cue = hudCue(extra.cue)
  return {
    cash: yen(state.cash),
    wanted: state.wanted.level,
    cooling: state.wanted.level > 0 && state.wanted.unseen > 0.5,
    bust: Math.min(1, state.wanted.bust / BUST_SECONDS),
    speedKmh: state.mode === 'drive' ? Math.round(Math.abs(state.player.speed) * 3.6) : null,
    street,
    streetEn: (street && road && world.map.roads[road.road]?.nameEn) || '',
    clock: extra.clock,
    outfitKey: state.outfit.wearing,
    wardrobeCount: state.outfit.wardrobe.length,
    missionTitle: extra.missionTitle,
    objective: extra.objective,
    timeLeft: extra.timeLeft == null ? '' : mmss(extra.timeLeft),
    hurry: extra.timeLeft != null && extra.timeLeft <= HURRY_SECONDS,
    // 演出が出ているあいだは、同じ内容の一言を重ねない
    banner: cue ? '' : extra.banner,
    target: targetOf(state, extra.markers ?? []),
    cue,
    gauge: extra.gauge ?? null,
    prompts,
  }
}
