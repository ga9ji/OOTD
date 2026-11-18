// Grand Theft Outfit: 撮影用デモの型（demo.ts の表と demoInput が使う）。
// 入口: DemoSegment / DemoPress / DemoStage / DemoScenario / DemoView（demo.ts からも再 export される）
import type { InputFrame, PlayMode } from './types'

/** t0〜t1 秒のあいだ、この入力を重ねる */
export interface DemoSegment {
  t0: number
  t1: number
  input: Partial<Omit<InputFrame, 'enter' | 'steal'>>
  /** true なら、進行中のミッションの目的地（無ければ開始地点）へ向かうようカメラを回す */
  seekGoal?: boolean
  /** true なら、車でいまいる車道に沿ってハンドルを切る（左側通行。input.moveX は上書きされる） */
  followRoad?: boolean
  /** [traffic-peds] true なら、前の車との間が詰まるとブレーキを踏む（追突せずに流れに乗る。input.moveY は上書きされる） */
  keepGap?: boolean
  /** [traffic-peds] true なら、followRoad で車線の真ん中を走る（view.lane を使う。無ければ中心線の少し左のまま） */
  inLane?: boolean
  /** [traffic-peds] この速さ m/s を超えたらアクセルを戻す（街なかの流れの速さで走り続ける。keepGap と一緒に使う） */
  cruise?: number
}

/** at 秒に1回だけボタンを押す */
export interface DemoPress {
  at: number
  press: 'enter' | 'steal'
}

/** 始める前の段取り。sim.ts の createGtoState がこの通りに世界を用意する */
export interface DemoStage {
  /** 主人公の目の前に通行人を1人立たせる */
  pedAhead?: boolean
  /** 主人公のすぐ前に車を1台停めておく */
  parkedAhead?: boolean
  /** parkedAhead の車に運転手を乗せておく（車を奪う動きの撮影用） */
  occupiedAhead?: boolean
  /** 最初から手配度を付ける */
  wanted?: number
  /** 最初からミッションを始めておく */
  mission?: string
  /** ミッションを途中の手順から始める（0 が最初） */
  missionStep?: number
  /** 始める場所と向きを座標で決める（URL の gtoShot と spot が優先） */
  at?: { x: number; z: number; heading: number }
  /** [vehicle] 主人公の前に、全車種を1台ずつ斜めに並べて停めておく（車体の見比べ用） */
  lineup?: boolean
  /** [vehicle] 主人公の車の行く手（この距離 m 先）に、横を向いた車を1台停めておく（車どうしの衝突の撮影用） */
  ramAhead?: number
  /** [outfit] 最初からワードローブに持たせておく服の数（着替え画面の撮影用） */
  wardrobe?: number
}

export interface DemoScenario {
  label: string
  mode: PlayMode
  /** 始める場所（地図の主要スポットのキー）。URL の gtoShot が優先 */
  spot?: string
  stage?: DemoStage
  segments: DemoSegment[]
  presses?: DemoPress[]
  /** この秒数で頭から繰り返す */
  loop: number
}

/** デモが目的地へ向かうために見る、いまの様子 */
export interface DemoView {
  x: number
  z: number
  camYaw: number
  goal: { x: number; z: number } | null
  /** 主人公（車）の向き。followRoad で使う */
  heading?: number
  /** いちばん近い車道の上の点と、その道の向き。followRoad で使う */
  road?: { x: number; z: number; heading: number } | null
  /** [traffic-peds] 自分の進路の上の、いちばん近い前の車までの間 m（いなければ Infinity）と、自分の速さ m/s。keepGap で使う */
  gap?: number
  speed?: number
  /** [traffic-peds] いまの道で自分の走る車線の中心が、道の中心線から左へ何 m か。inLane で使う */
  lane?: number | null
  /** [traffic-peds] 自分の向きに合う車道の上の点と向き。inLane のとき road の代わりに使う（交差点の中で、交わる道に釣られない） */
  laneRoad?: { x: number; z: number; heading: number } | null
}
