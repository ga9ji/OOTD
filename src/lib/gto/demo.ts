// Grand Theft Outfit: 撮影用のデモ（決まった入力列の自動再生）。
// 入口: DEMOS / demoInput(scenario, t, dt, view)
// 契約: シナリオは表（DEMOS）に足すだけで増やせる。各部品の担当は、自分の部品を見せる
//       シナリオをここに追加してよい（ほかの行は触らない）。URL の &demo=<名前> で再生する。
import { NO_INPUT } from './input'
import { angleDiff, clamp, headingOf } from './math'
import type { DemoScenario, DemoView } from './demoTypes'
import type { InputFrame } from './types'

export type { DemoPress, DemoScenario, DemoSegment, DemoStage, DemoView } from './demoTypes'

export const DEMOS: Record<string, DemoScenario> = {
  // [traffic-peds] スクランブルの角に立って信号の1周を眺める（t=6 で車が全部赤、t=8〜28 が歩行者の時間）
  'tp-scramble': {
    label: '交通と歩行者: スクランブルの信号1周を角から眺める',
    mode: 'foot',
    stage: { at: { x: 24, z: 17, heading: -0.96 } },
    segments: [],
    loop: 64,
  },
  // [traffic-peds] 道玄坂の上から流れに乗って下る。信号は青の波で繋がり、対向車がすれ違い、前の車が曲がって消え、青のスクランブルを抜けて宮益坂へ
  'tp-drive': {
    label: '交通と歩行者: 道玄坂を流れに乗って下る → 青のスクランブルを抜ける → 宮益坂',
    mode: 'drive',
    stage: { at: { x: -322, z: 116, heading: 0.72 } },
    segments: [{ t0: 0.5, t1: 64, input: { moveY: 0.7 }, followRoad: true, inLane: true, keepGap: true, cruise: 10.5 }],
    loop: 64,
  },
  // [traffic-peds] 道玄坂を飛ばして、スクランブルの赤で待つ列の最後尾に追突する（t=12.9。弾かれた車が道筋を外れて横断中の人波へ滑り、運転手が降りて逃げ、周りの人も逃げる）
  'tp-bump': {
    label: '交通と歩行者: 前の車に追突する（弾かれる・運転手が逃げる）',
    mode: 'drive',
    stage: { at: { x: -200.5, z: 29.5, heading: 1.25 } },
    segments: [
      { t0: 0.5, t1: 13, input: { moveY: 1 }, followRoad: true, inLane: true, cruise: 14 },
      { t0: 13, t1: 30, input: { handbrake: true } },
    ],
    loop: 30,
  },
  // [traffic-peds] 道玄坂の歩道に立って、両方向に流れる車と、行き交う人を眺める
  'tp-street': {
    label: '交通と歩行者: 道玄坂の歩道から車の流れを眺める',
    mode: 'foot',
    stage: { at: { x: -162.3, z: 10.9, heading: 1.62 } },
    segments: [],
    loop: 64,
  },
  // [traffic-peds] 歩行者の時間の横断歩道へ車で突っ込む（飛びのく・はねられて倒れる・周りが逃げる）
  'tp-panic': {
    label: '交通と歩行者: 人波へ車で突っ込む',
    mode: 'drive',
    // 東側の停止線の少し手前（前に車のいない車線）で赤を待ち、歩行者の時間（t=8〜28）に発進する
    stage: { at: { x: 38, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 0, t1: 11.5, input: { handbrake: true } },
      { t0: 11.5, t1: 13.6, input: { moveY: 1 } },
      { t0: 14.2, t1: 19, input: { handbrake: true } },
    ],
    loop: 64,
  },
  // [traffic-peds] 宮益坂を街なかの速さで道なりに流す（同じ車線の前の車、対向車、横断する人が次々に見える）
  'tp-flow': {
    label: '交通と歩行者: 宮益坂を流して走る（前の車・対向車・横断）',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 60, input: { moveY: 0.7 }, followRoad: true, inLane: true, keepGap: true, cruise: 11 },
    ],
    loop: 60,
  },
  'foot-turn': {
    label: '徒歩で歩く・走る・旋回する',
    mode: 'foot',
    segments: [
      // [onfoot] 歩き出し（〜2s）→ 走る → 2.6s から 2.5 秒周期で「右へ 90° 切り返す → 走る → もう一度右へ → 走る → 急に止まる（0.25s）→ 走り出す」を繰り返す
      //          （広場の中を四角く回るので人波や壁に当たらない）。録画の始まりは 0.5〜1.3 秒ばらつくが、どこから 0.5 秒刻みで 8 コマ取っても
      //          背後の走り・横向き（カメラが回り込むまで）・切り返しの倒れ込み・停止と走り出し が入る
      { t0: 0.5, t1: 2, input: { moveY: 1 } },
      { t0: 2, t1: 2.6, input: { moveY: 1, run: true } },
      { t0: 2.6, t1: 3.3, input: { moveX: 1, run: true } },
      { t0: 3.3, t1: 3.85, input: { moveY: 1, run: true } },
      { t0: 3.85, t1: 4.55, input: { moveX: 1, run: true } },
      { t0: 4.55, t1: 4.85, input: { moveY: 1, run: true } },
      { t0: 5.1, t1: 5.8, input: { moveX: 1, run: true } },
      { t0: 5.8, t1: 6.35, input: { moveY: 1, run: true } },
      { t0: 6.35, t1: 7.05, input: { moveX: 1, run: true } },
      { t0: 7.05, t1: 7.35, input: { moveY: 1, run: true } },
      { t0: 7.6, t1: 8.3, input: { moveX: 1, run: true } },
      { t0: 8.3, t1: 9, input: { moveY: 1, run: true } },
      { t0: 9, t1: 11, input: { lookX: 0.03 } },
      { t0: 11, t1: 12.5, input: { moveY: -1 } },
    ],
    loop: 14,
  },
  'drive-brake': {
    label: '車で加速 → カーブ → 急ブレーキ',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 4.5, input: { moveY: 1 } },
      { t0: 4.5, t1: 5, input: { moveY: 0.6, moveX: 0.5 } },
      { t0: 5, t1: 5.9, input: { moveY: 0.6, moveX: -0.5 } },
      { t0: 5.9, t1: 6.4, input: { moveY: 0.6, moveX: 0.5 } },
      { t0: 6.4, t1: 8, input: { moveY: 1 } },
      { t0: 8, t1: 8.7, input: { moveX: 1, handbrake: true } },
      { t0: 8.7, t1: 11, input: { moveY: -1 } },
    ],
    loop: 14,
  },
  // [vehicle] 全開で最高速まで → 急ブレーキで停止（加速の頭打ちと、沈み込み・ブレーキ灯を見る）
  'drive-accel': {
    label: '車: 全開加速 → 急ブレーキ',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 6.5, input: { moveY: 1 } },
      { t0: 6.5, t1: 9.5, input: { moveY: -1 } },
    ],
    loop: 11,
  },
  // [vehicle] 交差点を右へ曲がる（旋回・横滑りの姿勢の移り変わり）: 南からスクランブル交差点へ入り、いったん左へ振って（2.5 秒）
  // 右へ切り込み（3.0 秒）、サイドブレーキで尻を流し（3.5 秒）、逆へ切って立て直し（3.7〜4.6 秒）、東へ抜けて急ブレーキ（5.7 秒〜）。
  // 8 コマ/秒の f_020 から 3 コマおきの 8 コマ（2.5〜5.125 秒）が 進入 → 逆振り → 切り込み → 滑り出し → 最大 → カウンター → 揺れ戻し → 収束 に当たる
  'drive-turn': {
    label: '車: 交差点を右へ（逆へ振る → 切り込む → 尻が流れる → カウンター → 収束）',
    mode: 'drive',
    stage: { at: { x: -1.5, z: 53, heading: 0 } },
    segments: [
      { t0: 0.9, t1: 2.5, input: { moveY: 1 } },
      { t0: 2.5, t1: 3.0, input: { moveY: 0.3, moveX: -0.7 } },
      { t0: 3.0, t1: 3.5, input: { moveY: 0.8, moveX: 1 } },
      { t0: 3.5, t1: 3.7, input: { moveX: 1, handbrake: true } },
      { t0: 3.7, t1: 4.2, input: { moveY: 1, moveX: -1 } },
      { t0: 4.2, t1: 4.6, input: { moveY: 0.6, moveX: -0.2 } },
      { t0: 4.6, t1: 5.7, input: { moveY: 0.6 }, followRoad: true },
      { t0: 5.7, t1: 6.75, input: { moveY: -1 }, followRoad: true },
    ],
    loop: 9.5,
  },
  // [vehicle] ドリフトの振り出しから収束まで: スクランブル交差点へまっすぐ入り（3.1 秒まで）、サイドブレーキで尻を右へ振り出し（3.14 秒）、
  // 踏んだまま滑らせ（〜3.76 秒）、逆へ切って振り返し（4.27 秒に真後ろを通る）、反対側へ流してから（4.4〜5.1 秒）立て直す（5.4 秒）。急ブレーキは 6.1 秒〜。
  // 8 コマ/秒の f_024 から 3 コマおきの 8 コマ（3.0〜5.625 秒）が 進入 → 振り出し → 最大 → 切り返し → 反対側の最大 → 戻り → 揺れ戻し → 収束 に当たる
  'drive-drift': {
    label: '車: ドリフト（進入 → 振り出し → 振り返し → カウンター → 収束）→ 急ブレーキ',
    mode: 'drive',
    stage: { at: { x: 36, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 1.5, t1: 3.14, input: { moveY: 1 } },
      { t0: 3.14, t1: 3.31, input: { moveX: -1, handbrake: true } },
      { t0: 3.31, t1: 3.76, input: { moveY: 1, moveX: -0.8 } },
      { t0: 3.76, t1: 4.24, input: { moveY: 0.8, moveX: 1 } },
      { t0: 4.24, t1: 4.37, input: { moveX: 1, handbrake: true } },
      { t0: 4.37, t1: 4.64, input: { moveY: 0.8, moveX: 0.6 } },
      { t0: 4.64, t1: 5.08, input: { moveY: 0.9, moveX: -0.45 } },
      { t0: 5.08, t1: 5.42, input: { moveY: 0.7, moveX: -0.2 } },
      { t0: 5.42, t1: 6.1, input: { moveY: 0.7 } },
      { t0: 6.1, t1: 7.05, input: { moveY: -1 } },
    ],
    loop: 10,
  },
  // [vehicle] 尻を左右へ振る: スクランブル交差点で尻を右へ出し（2.0 秒）、逆へ切って振り返し（2.75 秒に真後ろを通る）、
  // 反対側へ流してから（2.9〜3.5 秒）立て直して（3.75 秒）急ブレーキ（4.0 秒〜）。
  // 車体のロールが左右へ入れ替わり、尻が沈み、最後に鼻が沈むのが、2.1〜3.9 秒の連続コマに入る
  'drive-swing': {
    label: '車: 尻を左右へ振る（振り返し）→ 立て直して急ブレーキ',
    mode: 'drive',
    stage: { at: { x: 40, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 0.2, t1: 2, input: { moveY: 1 } },
      { t0: 2, t1: 2.18, input: { moveX: -1, handbrake: true } },
      { t0: 2.18, t1: 2.7, input: { moveY: 1, moveX: 1 } },
      { t0: 2.7, t1: 2.82, input: { moveX: 1, handbrake: true } },
      { t0: 2.82, t1: 3.4, input: { moveY: 1, moveX: -1 } },
      { t0: 3.4, t1: 3.6, input: { moveX: -1, handbrake: true } },
      { t0: 3.6, t1: 3.75, input: { moveY: 1, moveX: 1 } },
      { t0: 3.75, t1: 4, input: { moveY: 0.6 } },
      { t0: 4, t1: 4.85, input: { moveY: -1 } },
    ],
    loop: 7,
  },
  // [vehicle] サイドブレーキを引いたまま切って真横まで回し、アクセルで立て直す（その場で向きを変える U ターン）
  'drive-uturn': {
    label: '車: サイドブレーキで U ターン → 走り去る',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.2, input: { moveY: 1 } },
      { t0: 2.2, t1: 3.12, input: { moveX: 1, handbrake: true } },
      { t0: 3.12, t1: 3.5, input: { moveY: 1, moveX: 1 } },
      { t0: 3.5, t1: 5.6, input: { moveY: 1 } },
      { t0: 5.6, t1: 6.52, input: { moveX: -1, handbrake: true } },
      { t0: 6.52, t1: 6.9, input: { moveY: 1, moveX: -1 } },
      { t0: 6.9, t1: 8.5, input: { moveY: 1 } },
      { t0: 8.5, t1: 10, input: { moveY: -1 } },
    ],
    loop: 11,
  },
  // [vehicle] まっすぐ走りながら尻を外へ振り、逆へ切って立て直す（2.6〜4.6 秒。四輪は路面に付いたまま、車体だけが外へ流れて戻る）
  'drive-slide': {
    label: '車: 横滑り → 立て直す',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.6, input: { moveY: 1 } },
      { t0: 2.6, t1: 2.78, input: { moveX: -1, handbrake: true } },
      { t0: 2.78, t1: 3.6, input: { moveY: 1, moveX: 1 } },
      { t0: 3.6, t1: 6, input: { moveY: 0.5 }, followRoad: true, keepGap: true, cruise: 11 },
      { t0: 6, t1: 7.5, input: { moveY: -1 } },
    ],
    loop: 8.5,
  },
  // [vehicle] 車体の姿勢と路面の痕を 1 秒刻みのコマで見せる: スクランブル交差点で尻を右へ流して立て直し（2.6〜3.5 秒。
  // 3 秒のコマが滑りの最中）、道玄坂の入口へまっすぐ加速してから急ブレーキ（4.3〜5.7 秒。5 秒のコマで鼻が沈み、尾灯が光り、
  // 四輪が黒い痕を引く）。車は画面の真ん中に留まり、後ろの路面に黒い痕が弧を描いて残る（止まったあとの 6〜8 秒のコマにも写る）
  'drive-skid': {
    label: '車: 横滑りで黒い痕を残す → 加速 → 急ブレーキ',
    mode: 'drive',
    stage: { at: { x: 40, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 0.3, t1: 2.6, input: { moveY: 1 } },
      { t0: 2.6, t1: 2.78, input: { moveX: -1, handbrake: true } },
      { t0: 2.78, t1: 3.6, input: { moveY: 1, moveX: 1 } },
      { t0: 3.6, t1: 4.3, input: { moveY: 1 } },
      { t0: 4.3, t1: 5.72, input: { moveY: -1 } },
    ],
    loop: 9,
  },
  // [vehicle] 車体のロールを背後から見せる: スクランブル交差点の中を街なかの速さ（30km/h）で 8 の字に回る
  // （左 1.2〜2.3 秒 → 右 2.3〜5.0 秒 → 左 5.0〜7.3 秒）。滑らせないので車は画面の真ん中に留まり、
  // 背後のカメラから 15〜35° 斜めに見える（2〜7 秒の 1 秒刻みのコマすべて）。四輪は路面に付いたまま、
  // 車体だけが外側の輪へ沈み込む。最後は急ブレーキで鼻が沈む（7.3 秒〜）
  'drive-lean': {
    label: '車: 8 の字に回る（車体が外側の輪へ沈むロール）→ 急ブレーキ',
    mode: 'drive',
    stage: { at: { x: 18, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 0.3, t1: 1.2, input: { moveY: 1 } },
      { t0: 1.2, t1: 2.3, input: { moveY: 0.5, moveX: -0.7 }, cruise: 8.5 },
      { t0: 2.3, t1: 5.0, input: { moveY: 0.5, moveX: 0.7 }, cruise: 8.5 },
      { t0: 5.0, t1: 7.3, input: { moveY: 0.5, moveX: -0.7 }, cruise: 8.5 },
      { t0: 7.3, t1: 7.8, input: { moveY: -1 } },
    ],
    loop: 10,
  },
  // [vehicle] 主人公の車を前斜めから見せる: 後ろを見るボタンを押したまま（カメラが車の前へ回る）、スクランブル交差点をゆるく左右へ切って走る。
  // 前照灯・グリル・バンパー・サイドミラーと、前から見た車体の傾き（外側が沈む）が 2〜5 秒のコマに入る
  'drive-front': {
    label: '車: 前斜めから見る（後ろを見るボタンを押したまま、ゆるく左右へ切る）',
    mode: 'drive',
    stage: { at: { x: 40, z: 2.4, heading: -1.49 } },
    segments: [
      { t0: 0, t1: 6.5, input: { lookBack: true } },
      { t0: 0.3, t1: 1.6, input: { moveY: 1 } },
      { t0: 1.6, t1: 2.5, input: { moveY: 0.5, moveX: 0.45 }, cruise: 9 },
      { t0: 2.5, t1: 4.1, input: { moveY: 0.5, moveX: -0.5 }, cruise: 9 },
      { t0: 4.1, t1: 5, input: { moveY: 0.5, moveX: 0.5 }, cruise: 9 },
      { t0: 5, t1: 5.8, input: { moveY: -1 } },
    ],
    loop: 8,
  },
  // [vehicle] 車どうしの衝突: スクランブル交差点の真ん中に横を向いて停まっている青い車の尻寄りへ 70km/h で突っ込む（2.6 秒）。
  // 火花が放射状に散り、バンパーと破片が路面に転がり、相手は押し出されて回り、自分は弾かれて輪が浮き、横を向いて止まる。
  // 当たったあとはアクセルを離す（3.4 秒からサイドブレーキ）。止まったあとも落ちた部品と痕が路面に残る
  'drive-ram': {
    label: '車: 停まっている車に突っ込む（火花・部品の脱落・相手が押し出される・輪が浮く）',
    mode: 'drive',
    stage: { at: { x: 40, z: 2.4, heading: -1.49 }, ramAhead: 30 },
    segments: [
      { t0: 0.3, t1: 2.55, input: { moveY: 1 } },
      { t0: 2.55, t1: 3.2, input: { moveX: 1, handbrake: true } },
      { t0: 3.2, t1: 6, input: { handbrake: true } },
    ],
    loop: 9,
  },
  // [vehicle] 加速してから右へ切って建物へ突っ込む（壁への衝突、煙、止まり方を見る）
  'drive-crash': {
    label: '車: 壁に衝突',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.6, input: { moveY: 1 } },
      { t0: 2.6, t1: 3.3, input: { moveY: 1, moveX: 1 } },
      // 当たったらアクセルを離す（弾き返されて、壁から離れて止まる）
      { t0: 3.3, t1: 3.45, input: { moveY: 1 } },
      { t0: 6, t1: 8, input: { moveY: -1 } },
    ],
    loop: 9,
  },
  // [vehicle] 建物の壁に 80km/h で突っ込み（3.3 秒）、下がってもう一度当てる（8.6 秒）。鼻の全幅が潰れてボンネットが跳ね上がる
  'drive-wall': {
    label: '車: 建物の壁に正面衝突 → 下がって当て直す',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.1, input: { moveY: 1 } },
      { t0: 2.1, t1: 2.8, input: { moveY: 1, moveX: -1 } },
      // 当たったらアクセルを離す（弾き返されて尻が跳ね、壁から 1m ほど離れて止まる）
      { t0: 2.8, t1: 3.3, input: { moveY: 1 } },
      { t0: 6, t1: 7.2, input: { moveY: -1 } },
      { t0: 7.2, t1: 9, input: { moveY: 1 } },
    ],
    loop: 10,
  },
  // [vehicle] 街灯の柱に突っ込み、下がっては当て直す。鼻が潰れ、白煙（3.4 秒）→ 黒煙（11.4 秒）→ 炎（19.3 秒）と進む
  'drive-wreck': {
    label: '車: 柱にぶつけ続けて壊す（凹み → 白煙 → 黒煙 → 炎）',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.6, input: { moveY: 1 } },
      { t0: 2.6, t1: 3.3, input: { moveY: 1, moveX: 1 } },
      { t0: 3.3, t1: 3.9, input: { moveY: 1 } },
      { t0: 3.9, t1: 5.0, input: { moveY: -1 } },
      { t0: 5.0, t1: 6.5, input: { moveY: 1 } },
      { t0: 6.5, t1: 7.6, input: { moveY: -1 } },
      { t0: 7.6, t1: 9.1, input: { moveY: 1 } },
      { t0: 9.1, t1: 10.2, input: { moveY: -1 } },
      { t0: 10.2, t1: 11.7, input: { moveY: 1 } },
      { t0: 11.7, t1: 12.8, input: { moveY: -1 } },
      { t0: 12.8, t1: 14.3, input: { moveY: 1 } },
      { t0: 14.3, t1: 15.4, input: { moveY: -1 } },
      { t0: 15.4, t1: 16.9, input: { moveY: 1 } },
      { t0: 16.9, t1: 18.0, input: { moveY: -1 } },
      { t0: 18.0, t1: 19.5, input: { moveY: 1 } },
    ],
    loop: 24,
  },
  // [vehicle] 全車種を並べて、カメラをゆっくり左右に振る（車体の形と灯火を見比べる。&time=night で灯火）
  'car-lineup': {
    label: '車: 全車種の見比べ',
    mode: 'foot',
    spot: 'scramble',
    stage: { lineup: true },
    segments: [
      { t0: 1, t1: 3, input: { lookX: 0.006 } },
      { t0: 3, t1: 7, input: { lookX: -0.006 } },
      { t0: 7, t1: 9, input: { lookX: 0.006 } },
    ],
    loop: 10,
  },
  'enter-exit': {
    label: '車に乗る → 走る → 降りる',
    mode: 'foot',
    stage: { parkedAhead: true },
    // 歩く → 乗る（ドアへ走る・開ける・座る・閉める）→ 走って停まる → 降りる → 走り出す
    segments: [
      { t0: 0.2, t1: 0.8, input: { moveY: 1 } },
      // [onfoot] 座ったら、ドアを引いて閉めながら発進する。降りたらドアを押して閉めてから走り出す
      { t0: 4.1, t1: 5.0, input: { moveY: 1 } },
      { t0: 5.0, t1: 5.7, input: { moveY: -1 } },
      { t0: 10.1, t1: 11.7, input: { moveY: 0.6, moveX: 0.8, run: true } },
    ],
    presses: [
      { at: 0.85, press: 'enter' },
      { at: 6.5, press: 'enter' },
    ],
    loop: 12,
  },
  // [onfoot] 降りるところだけを長く見る: 少し走って停まる → 降りる（3.0s）→ 立つ → 歩き出す
  'exit-walk': {
    label: '停まる → 降りる → 歩き出す',
    mode: 'drive',
    segments: [
      { t0: 0.3, t1: 1.6, input: { moveY: 0.7 } },
      { t0: 1.6, t1: 2.8, input: { handbrake: true } },
      { t0: 6.6, t1: 8.4, input: { moveY: 1 } },
    ],
    presses: [{ at: 3, press: 'enter' }],
    loop: 9,
  },
  // [onfoot] 乗る → 少しだけ動かして停める → 降りる → 歩き出す（交通に巻き込まれない短い往復）
  'board-park': {
    label: '乗る → 少し動かして停める → 降りる → 歩き出す',
    mode: 'foot',
    stage: { parkedAhead: true },
    segments: [
      { t0: 0.3, t1: 1.2, input: { moveY: 1 } },
      { t0: 3.6, t1: 4.3, input: { moveY: 0.45 } },
      { t0: 4.3, t1: 5.5, input: { handbrake: true } },
      { t0: 9.3, t1: 10.6, input: { moveY: 1, moveX: 0.5 } },
    ],
    presses: [
      { at: 1.4, press: 'enter' },
      { at: 5.7, press: 'enter' },
    ],
    loop: 11,
  },
  // [onfoot] 乗るところだけ（6.5秒。閉まったあと窓越しの座った姿を見せてから発進）。seq --seconds 6.5 --fps 8 で、ドアを開ける → 屈む → 滑り込む → 座る → 閉まる → 発進 が 1/8 秒刻みで写る
  'board-only': {
    label: 'ドアへ歩く → 開ける → 屈んで乗る → 閉まる → 発進',
    mode: 'foot',
    stage: { parkedAhead: true },
    segments: [
      { t0: 0.2, t1: 0.8, input: { moveY: 1 } },
      { t0: 4.7, t1: 5.8, input: { moveY: 0.4 } },
    ],
    presses: [{ at: 0.9, press: 'enter' }],
    loop: 6.5,
  },
  // [onfoot] 降りるところだけ（5.5秒）。停まった車から: 手で押してドアが開く → 屈んだ姿で出る → ドアの横で体を起こす → 手で押して閉める → 歩き出す
  'alight-only': {
    label: '停まった車から降りて歩き出す',
    mode: 'drive',
    segments: [{ t0: 4.1, t1: 5.3, input: { moveY: 0.48, moveX: 0.88 } }],
    presses: [{ at: 0.5, press: 'enter' }],
    loop: 5.5,
  },
  // [cheats] 裏コードで戦車を出して乗り、その場で回ってから前へ進む
  'cheat-tank': {
    label: '裏コード: 戦車を出して乗り、その場で回って進む',
    mode: 'foot',
    segments: [
      { t0: 2.2, t1: 3.6, input: { moveX: 1 } },
      { t0: 3.6, t1: 9, input: { moveY: 1 } },
    ],
    presses: [
      { at: 0.5, press: 'cheat', cheat: 'tank' },
      { at: 1.6, press: 'enter' },
    ],
    loop: 30,
  },
  // [cheats] 戦車に乗って、目の前の通りへ 3 発撃つ（砲口の閃光・着弾・車が突き飛ばされて煙を吐く・手配が付く）
  'cheat-cannon': {
    label: '裏コード: 戦車の砲を撃つ',
    mode: 'foot',
    segments: [
      { t0: 2.2, t1: 2.9, input: { moveX: -1 } },
      { t0: 3.2, t1: 3.3, input: { horn: true } },
      { t0: 5, t1: 5.1, input: { horn: true } },
      { t0: 7, t1: 7.1, input: { horn: true } },
    ],
    presses: [
      { at: 0.5, press: 'cheat', cheat: 'tank' },
      { at: 1.6, press: 'enter' },
    ],
    loop: 30,
  },
  // [cheats] 裏コードで飛行機を出して乗り、滑走して離陸し、旋回しながら上がる
  'cheat-plane': {
    label: '裏コード: 飛行機を出して乗り、離陸して旋回する',
    mode: 'foot',
    segments: [
      { t0: 2.2, t1: 40, input: { moveY: 1 } },
      { t0: 4.2, t1: 12, input: { handbrake: true } },
      { t0: 9, t1: 16, input: { moveX: 0.7 } },
    ],
    presses: [
      { at: 0.5, press: 'cheat', cheat: 'plane' },
      { at: 1.6, press: 'enter' },
    ],
    loop: 60,
  },
  // [cheats] 手配度 3 から、裏コードで 1 つずつ下げる
  'cheat-calm': {
    label: '裏コード: 手配度を 1 つずつ下げる',
    mode: 'foot',
    stage: { wanted: 3 },
    segments: [],
    presses: [
      { at: 2, press: 'cheat', cheat: 'calm' },
      { at: 5, press: 'cheat', cheat: 'calm' },
      { at: 8, press: 'cheat', cheat: 'calm' },
    ],
    loop: 30,
  },
  carjack: {
    label: '運転手のいる車を奪う',
    mode: 'foot',
    stage: { parkedAhead: true, occupiedAhead: true },
    segments: [
      { t0: 0.3, t1: 1.2, input: { moveY: 1 } },
      // 奪って座り、ドアが閉まってから、ゆっくり発進する（board-only と同じ出方。広場の木や車の流れへ突っ込まない）
      { t0: 5.9, t1: 7.2, input: { moveY: 0.4 } },
    ],
    presses: [{ at: 1.4, press: 'enter' }],
    loop: 10,
  },
  'foot-slope': {
    label: '坂を走って上り、振り返って下る',
    mode: 'foot',
    spot: 'dogenzaka-bottom',
    segments: [
      { t0: 0.5, t1: 2.5, input: { moveY: 1 } },
      { t0: 2.5, t1: 6, input: { moveY: 1, run: true } },
      { t0: 6.2, t1: 9.5, input: { moveY: -1, run: true } },
    ],
    loop: 11,
  },
  steal: {
    label: '通行人の服を奪って着替える',
    mode: 'foot',
    stage: { pedAhead: true },
    segments: [
      { t0: 0.4, t1: 1.1, input: { moveY: 1 } },
      { t0: 2.6, t1: 5, input: { moveY: 1, run: true } },
    ],
    presses: [{ at: 1.5, press: 'steal' }],
    loop: 8,
  },
  // [outfit] 近づく → カメラを横へ振って相手を見せる → 奪う（1.9s）→ 走り去る。狙いの印・奪う瞬間・相手の反応を見る
  'outfit-steal': {
    label: '服: 狙う → 奪う → 姿が替わる → 走り去る',
    mode: 'foot',
    stage: { pedAhead: true, wardrobe: 6 },
    segments: [
      { t0: 0.3, t1: 0.8, input: { moveY: 1 } },
      { t0: 0.9, t1: 1.5, input: { lookX: 0.036 } },
      { t0: 3.6, t1: 6, input: { moveY: 1, run: true } },
    ],
    presses: [{ at: 1.9, press: 'steal' }],
    loop: 8,
  },
  // [outfit] 手持ちを持って立っているだけ（&wardrobe=1,4 で 1 秒後に着替え画面を開き、4 秒後に着替えて閉じる）
  'outfit-wardrobe': {
    label: '服: ワードローブを開いて着替える',
    mode: 'foot',
    stage: { wardrobe: 9 },
    segments: [{ t0: 0.2, t1: 0.8, input: { lookX: 0.02 } }],
    loop: 30,
  },
  chase: {
    label: '手配されて追われる',
    mode: 'drive',
    spot: 'miyamasuzaka-top',
    stage: { wanted: 3 },
    segments: [
      { t0: 0.5, t1: 5, input: { moveY: 1 }, followRoad: true },
      { t0: 5, t1: 26, input: { moveY: 0.5 }, followRoad: true },
    ],
    loop: 28,
  },
  // [wanted] 最初から手配度5。右上の印が5つ点いたまま、行く手のパトカーと護送車に囲まれていく
  'chase-max': {
    label: '最大の手配で追われ続ける',
    mode: 'drive',
    spot: 'miyamasuzaka-top',
    stage: { wanted: 5 },
    segments: [
      { t0: 0.5, t1: 5, input: { moveY: 1 }, followRoad: true },
      { t0: 5, t1: 26, input: { moveY: 0.6 }, followRoad: true },
    ],
    loop: 28,
  },
  'wanted-foot': {
    label: '歩きで手配 → 徒歩の警官と警察車両に追われる → 立ち止まって逮捕',
    mode: 'foot',
    stage: { wanted: 3 },
    segments: [
      { t0: 1, t1: 10, input: { moveY: 1, run: true } },
      { t0: 10, t1: 12, input: { lookX: 0.026 } },
    ],
    loop: 40,
  },
  'wanted-stop': {
    label: '追われて車を止める → 警察に囲まれて逮捕',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    stage: { wanted: 3 },
    segments: [
      { t0: 0.5, t1: 4, input: { moveY: 0.8 }, followRoad: true },
      { t0: 4, t1: 6, input: { moveY: -1 } },
      { t0: 7, t1: 9, input: { lookX: 0.026 } },
    ],
    loop: 40,
  },
  // [missions] 1本を通しで見せる: 奪う（1.5 秒）→ 目標が「車をつかまえる」に替わり、停まっている車へ乗る → 目標が届け先に替わり、
  // 残り時間が付いて旧大山街道を東へ走る → 宮益坂下で達成の札と次の依頼の知らせ → 降りて、次の依頼人のほうへ歩く
  mission: {
    label: 'ミッション: 奪う → 車に乗る → 時間内に届ける → 達成 → 次の依頼が開く',
    mode: 'foot',
    stage: { pedAhead: true, parkedAhead: true, mission: 'first-fit', at: { x: 36, z: 15, heading: 0 } },
    segments: [
      { t0: 0.4, t1: 1.1, input: { moveY: 1 } },
      { t0: 4.8, t1: 7.4, input: { moveY: 1 }, followRoad: true },
      { t0: 7.4, t1: 11.5, input: { moveY: 0.12 }, followRoad: true },
      { t0: 11.5, t1: 14, input: { handbrake: true }, followRoad: true },
      // 降りたら、まず車から離れ（カメラが車に押されて寄らないように）、それから次の依頼人のほうへ走る
      { t0: 15, t1: 15.8, input: { moveY: 1, run: true } },
      { t0: 15.8, t1: 20.5, input: { moveY: 1, run: true }, seekGoal: true },
    ],
    presses: [
      { at: 1.5, press: 'steal' },
      { at: 2.7, press: 'enter' },
      { at: 13.8, press: 'enter' },
    ],
    loop: 45,
  },
  // [missions] 依頼人の所へ歩いて行き、導入が出る
  'mission-intro': {
    label: 'ミッション: 依頼人の所へ歩いて行き、導入が出る',
    mode: 'foot',
    stage: { at: { x: 23, z: 38, heading: 0.46 } },
    segments: [{ t0: 1.5, t1: 9, input: { moveY: 1 }, seekGoal: true }],
    loop: 16,
  },
  // [missions] 見回りの輪に入ったまま立ち止まり、見抜かれて失敗する
  'mission-caught': {
    label: 'ミッション: 見回りの輪に入って失敗',
    mode: 'foot',
    stage: { mission: 'tail-the-reseller', missionStep: 1, at: { x: -163.5, z: -238.6, heading: 1.57 } },
    // 倉庫番の通り道に立ったまま動かない
    segments: [{ t0: 0.5, t1: 0.9, input: { lookX: 0.01 } }],
    loop: 16,
  },
  // [missions] 時間内に奪う（数と残り時間が出る）
  'mission-steal': {
    label: 'ミッション: 時間内に奪う',
    mode: 'foot',
    stage: { pedAhead: true, mission: 'center-gai-sweep', at: { x: -146, z: -88, heading: -1.06 } },
    segments: [
      { t0: 0.4, t1: 1.1, input: { moveY: 1 } },
      { t0: 3, t1: 12, input: { moveY: 1 } },
    ],
    presses: [{ at: 1.5, press: 'steal' }],
    loop: 14,
  },
  // [missions] 時間内に車で届け、目標が「降りて手渡す」に替わり、降りて達成する（残り時間の上乗せつき）
  'mission-timed': {
    label: 'ミッション: 時間内に車で届け、降りて手渡して達成',
    mode: 'drive',
    stage: { mission: 'slope-delivery', missionStep: 2, at: { x: -118, z: 256, heading: -0.39 } },
    segments: [
      { t0: 0.6, t1: 4.7, input: { moveY: 0.8 } },
      // 店の前で止まり切るよう、ブレーキとサイドブレーキを一緒に踏む（サイドブレーキだけでは通り過ぎる）
      { t0: 4.7, t1: 5.8, input: { moveY: -1, handbrake: true } },
      { t0: 5.8, t1: 8, input: { handbrake: true } },
    ],
    presses: [{ at: 7.6, press: 'enter' }],
    loop: 20,
  },
  // [missions] しわを付けずに運ぶ（宮益坂）
  'mission-carry': {
    label: 'ミッション: しわを付けずに運ぶ',
    mode: 'drive',
    stage: { mission: 'miyamasu-laundry', missionStep: 2, at: { x: 330, z: -45, heading: 1.373 } },
    segments: [
      { t0: 0.6, t1: 7, input: { moveY: 0.8 } },
      { t0: 7, t1: 22, input: { moveY: -1 } },
    ],
    loop: 22,
  },
  // [missions] 転売屋を尾ける（最後まで付いていく）
  'mission-tail': {
    label: 'ミッション: 転売屋を尾ける',
    mode: 'foot',
    stage: { mission: 'tail-the-reseller', at: { x: -24.5, z: -196, heading: -0.807 } },
    // 4秒歩いて1秒止まる、を繰り返して間合いを保つ
    segments: [
      ...Array.from({ length: 14 }, (_, i) => ({ t0: 2 + i * 5, t1: 6 + i * 5, input: { moveY: 1 }, seekGoal: true })),
      { t0: 72, t1: 95, input: { moveY: 1, run: true }, seekGoal: true },
    ],
    loop: 100,
  },
  // [missions] 尾行で近づきすぎて失敗する
  'mission-fail': {
    label: 'ミッション: 尾行で近づきすぎて失敗',
    mode: 'foot',
    stage: { mission: 'tail-the-reseller', at: { x: -24.5, z: -196, heading: -0.807 } },
    segments: [{ t0: 1.5, t1: 4, input: { moveY: 1, run: true }, seekGoal: true }],
    loop: 16,
  },
  // [camera] 広場を歩き出し、走りながら真横へ 90° 向きを変えるのを 4 回（右・左・左・右）。向きだけ遅れて追う様子を見る。
  // 1 秒刻みで見ると、2・4・5・7 秒が向きを変えた 0.4 秒後（主人公が斜めに映り、画面の中央から外れている）、
  // 3・6 秒が背後に付いたあと。1 秒は歩き（走りより少し寄る）
  'cam-foot': {
    label: 'カメラ: 徒歩で直進 → 真横へ 90° を 4 回',
    mode: 'foot',
    segments: [
      { t0: 0.3, t1: 1.6, input: { moveY: 1 } },
      // 真横へ押しっぱなし: 主人公はまっすぐ走り、カメラが 1 秒ほどで背後へ回り込む
      { t0: 1.6, t1: 3.58, input: { moveX: 1, run: true } },
      // 押す向きを変えると、いまの画面を基準にもう一度 90° 曲がる
      { t0: 3.6, t1: 4.58, input: { moveX: -1, run: true } },
      // いちど離して押し直しても同じ
      { t0: 4.6, t1: 6.58, input: { moveX: -1, run: true } },
      { t0: 6.6, t1: 8.6, input: { moveX: 1, run: true } },
      { t0: 8.6, t1: 9.5, input: { moveY: 1 } },
    ],
    loop: 10,
  },
  // [camera] スクランブルの角で歩行者の青を待ち（t=8〜）、人波の中を歩いて渡る（カメラの近くの通行人が大きく映り込まないかを見る）
  'cam-crowd': {
    label: 'カメラ: 人波の中を歩いて渡る',
    mode: 'foot',
    stage: { at: { x: 24, z: 17, heading: -0.96 } },
    segments: [{ t0: 9, t1: 24, input: { moveY: 1 } }],
    loop: 64,
  },
  // [camera] 壁へ寄ってからカメラを一周させる（壁際の詰め方と、建物へのめり込みを見る）
  'cam-wall': {
    label: 'カメラ: 壁際でカメラを一周',
    mode: 'foot',
    spot: 'center-gai-bottom',
    segments: [
      { t0: 0.3, t1: 2.3, input: { moveX: 1 } },
      { t0: 2.5, t1: 8.5, input: { lookX: 0.0175 } },
      { t0: 8.5, t1: 11, input: { moveY: 1, run: true } },
    ],
    loop: 12,
  },
  // [camera] 広い通りを流れの速さで車線 1 本ぶん切り返し（右 → 左）、全開で加速して急ブレーキ、もう一度切り返す。
  // 1 秒刻みで見ると、2・3・6・7 秒が切っている最中（車体の側面が見え、画面の中央から外へずれている）、
  // 4 秒が直進へ戻って加速している所（カメラが遅れて背後へ回り込み、車が先へ出る）、5 秒が急ブレーキで詰めた所
  'cam-drive': {
    label: 'カメラ: 車で切り返す → 加速 → 急ブレーキ → 切り返す',
    mode: 'drive',
    spot: 'miyamasuzaka-bottom',
    segments: [
      // 流れの速さ（前の車に追い付かない）で切り返す
      { t0: 0.4, t1: 1.5, input: { moveY: 0.8 } },
      { t0: 1.5, t1: 2.0, input: { moveY: 0.25, moveX: 0.6 } },
      { t0: 2.0, t1: 3.0, input: { moveY: 0.25, moveX: -0.6 } },
      { t0: 3.0, t1: 3.45, input: { moveY: 0.25, moveX: 0.6 } },
      { t0: 3.45, t1: 3.6, input: { moveY: 1, moveX: -0.3 } },
      { t0: 3.6, t1: 4.6, input: { moveY: 1 } },
      { t0: 4.6, t1: 5.15, input: { moveY: -1 } },
      { t0: 5.15, t1: 5.5, input: { moveY: 0.25 } },
      { t0: 5.5, t1: 6.0, input: { moveY: 0.25, moveX: 0.6 } },
      { t0: 6.0, t1: 7.0, input: { moveY: 0.25, moveX: -0.6 } },
      { t0: 7.0, t1: 7.45, input: { moveY: 0.25, moveX: 0.6 } },
      { t0: 7.45, t1: 7.6, input: { moveY: 0.5, moveX: -0.3 } },
      { t0: 7.6, t1: 8.6, input: { moveY: -1 } },
    ],
    loop: 9,
  },
  // [mobile] 通行人と停めた車の両方が手の届く所にある（タッチの行動ボタン 走る・乗る・奪う・着替え が全部出る）
  'mobile-foot': {
    label: 'スマホ操作: 徒歩の行動ボタンが全部出る場面',
    mode: 'foot',
    stage: { pedAhead: true, parkedAhead: true, wardrobe: 4 },
    segments: [{ t0: 0.3, t1: 0.7, input: { moveY: 1 } }],
    loop: 30,
  },
  // [signs] 細い通りを歩く（time=night で、暗い壁を背にした管の文字と、壁際から落ちる路面の色を見る）
  'signs-walk': {
    label: '看板: センター街を歩く',
    mode: 'foot',
    spot: 'center-gai-top',
    segments: [{ t0: 0.5, t1: 11, input: { moveY: 1 } }],
    loop: 12,
  },
  // [signs] 店の並ぶ坂をゆっくり走る（time=night で、軒の管と、車体に乗る看板の色を見る）
  'signs-drive': {
    label: '看板: 道玄坂をゆっくり走る',
    mode: 'drive',
    spot: 'dogenzaka-bottom',
    // 踏んでは離すを繰り返して、歩くより少し速いくらいで流す
    segments: Array.from({ length: 6 }, (_, i) => ({ t0: 0.5 + i * 2, t1: 1.4 + i * 2, input: { moveY: 1 } })),
    loop: 12,
  },
}


/** 時刻 t（秒）の入力を作る。dt は1歩の長さ（ボタンを1回だけ押すために使う） */
export function demoInput(scenario: DemoScenario, t: number, dt: number, view: DemoView): InputFrame {
  const local = t % scenario.loop
  let input: InputFrame = { ...NO_INPUT }
  for (const seg of scenario.segments) {
    if (local < seg.t0 || local >= seg.t1) continue
    input = { ...input, ...seg.input }
    if (seg.seekGoal && view.goal) {
      const bearing = headingOf(view.goal.x - view.x, view.goal.z - view.z)
      input = { ...input, lookX: clamp(angleDiff(view.camYaw, bearing) * 0.2, -0.08, 0.08) }
    }
    // [traffic-peds] inLane では、自分の向きに合う車道（laneRoad）を道とみなす
    const road = seg.inLane && view.laneRoad ? view.laneRoad : view.road
    if (seg.followRoad && road && view.heading != null) {
      // 道の向き（自分の進む側）に合わせ、中心線の少し左の、12m 先を狙う。交差する道には釣られない
      const flip = Math.abs(angleDiff(view.heading, road.heading)) > Math.PI / 2
      const along = road.heading + (flip ? Math.PI : 0)
      if (Math.abs(angleDiff(view.heading, along)) < 0.8) {
        const fx = Math.sin(along)
        const fz = -Math.cos(along)
        const left = seg.inLane && view.lane != null ? view.lane : 1.6
        const aim = headingOf(road.x + fx * 12 + fz * left - view.x, road.z + fz * 12 - fx * left - view.z)
        input = { ...input, moveX: clamp(angleDiff(view.heading, aim) * 2.2, -1, 1) }
      }
    }
    if (seg.cruise != null && view.speed != null && view.speed > seg.cruise) {
      input = { ...input, moveY: view.speed > seg.cruise + 2 ? -0.3 : 0 }
    }
    if (seg.keepGap && view.gap != null && view.speed != null && view.gap < 4 + view.speed * 0.85) {
      // 間が詰まったら、近いほど強くブレーキ。止まったら踏むのをやめる（後退しない）
      input = { ...input, moveY: view.speed < 1 ? 0 : view.gap < 2.5 + view.speed * 0.5 ? -1 : -0.35 }
    }
  }
  for (const p of scenario.presses ?? []) {
    if (local >= p.at && local - dt < p.at) input = p.press === 'cheat' ? { ...input, cheat: p.cheat } : { ...input, [p.press]: true }
  }
  return input
}
