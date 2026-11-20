// Grand Theft Outfit: 全部品が共有する型（ここだけが部品どうしの契約）。
//
// ・ロジック（src/lib/gto/*.ts）は three にも DOM にも依存しない純粋な関数で、
//   状態を書き換えずに新しい値を返す。
// ・部品どうしは互いのファイルを import しない。この types.ts と math.ts だけを見る。
//   部品を1歩ずつ呼び出して繋ぐのは sim.ts の仕事。
// ・座標系は地図データと同じ: x=東が＋、z=南が＋（北は −z）、y=上、単位 m。
// ・向き heading はラジアン。北が 0、時計回りが＋。進行方向は (x, z) = (sin h, −cos h)。

// ----------------------------------------------------------------------------
// 地図データ（shibuyaMap.json の形。scripts/gto-bake-map.mjs が出力する）
// ----------------------------------------------------------------------------

/** [x0, z0, x1, z1, ...] の平坦な配列 */
export type Flat = number[]

export type RoadKind =
  | 'motorway'
  | 'motorway_link'
  | 'trunk'
  | 'trunk_link'
  | 'primary'
  | 'secondary'
  | 'secondary_link'
  | 'tertiary'
  | 'tertiary_link'
  | 'unclassified'
  | 'residential'
  | 'service'
  | 'pedestrian'
  | 'footway'
  | 'path'
  | 'steps'

export interface MapSpot {
  key: string
  x: number
  z: number
  y: number
  h?: number
  /** 北 0° 時計回りの「度」（地図データだけ度。ゲーム内はラジアン） */
  heading?: number
}

export interface MapRoad {
  id: number
  seg?: number
  kind: RoadKind
  /** 通りの実名。画面に出してよい */
  name?: string
  nameEn?: string
  width: number
  lanes?: number
  drive?: 1
  oneway?: 1 | -1
  crossing?: 1
  sidewalk?: 1
  bridge?: 1
  /** 高架の床の高さ（地表から、推定値） */
  deck?: number
  tunnel?: 1
  layer?: number
  pts: Flat
}

export interface MapRail {
  id: number
  seg?: number
  kind: 'rail' | 'subway'
  name?: string
  line: 'jr' | 'ginza' | 'inokashira'
  bridge?: 1
  layer?: number
  elevated: 0 | 1
  pts: Flat
  /** 頂点ごとの線路面の高さ（原点地表からの差） */
  y: number[]
}

export interface MapBuilding {
  id: number
  /** 実在の名称。内部参照専用で、画面・看板・ミニマップには出さない */
  name?: string
  use?: string
  h: number
  minH?: number
  est?: 1
  part?: 1
  roof?: 1
  hasParts?: 1
  y: number
  pts: Flat
}

export interface ShibuyaMap {
  meta: {
    title: string
    attribution: string
    osmTimestamp: string | null
    origin: { lat: number; lon: number; elevation: number }
    mPerDegLat: number
    mPerDegLon: number
    axes: string
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  }
  spots: MapSpot[]
  elevation: { x0: number; z0: number; step: number; cols: number; rows: number; data: number[] }
  roads: MapRoad[]
  rails: MapRail[]
  railTunnels: unknown[]
  buildings: MapBuilding[]
  crossings: [x: number, z: number, signal: 0 | 1, scramble: 0 | 1][]
  signals: [x: number, z: number][]
}

// ----------------------------------------------------------------------------
// 世界（map.ts が地図から組み立てる、動かない側の問い合わせ口）
// ----------------------------------------------------------------------------

export interface GraphNode {
  x: number
  z: number
  /** この交差点から出る辺の番号 */
  out: number[]
}

/** 道路グラフの辺。向きを持つ（対面通行の道は順・逆の2本になる） */
export interface GraphEdge {
  id: number
  from: number
  to: number
  /** map.roads の添字 */
  road: number
  /** 進む向きに並べた中心線 */
  pts: Flat
  /** 各頂点までの累積の長さ。cum[0] = 0 */
  cum: number[]
  length: number
  width: number
  lanes: number
  kind: RoadKind
  name?: string
  /** 逆向きの辺（一方通行なら −1） */
  rev: number
}

export interface RoadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface CircleHit {
  x: number
  z: number
  hit: boolean
  /** 押し戻した向き（当たっていなければ 0,0） */
  nx: number
  nz: number
}

export interface NearestRoad {
  road: number
  x: number
  z: number
  dist: number
  /** その地点の道の向き（ラジアン） */
  heading: number
  name?: string
  drive: boolean
}

export interface GtoWorld {
  map: ShibuyaMap
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** 地表の高さ（標高格子の双一次補間） */
  groundY: (x: number, z: number) => number
  /** map.buildings と同じ並び。地上の車道が下をくぐる建物（駅のガードなど）は true。描画は足元を浮かせる */
  passUnder: boolean[]
  /** 点が建物（歩いて入れない塊）の中か */
  insideBuilding: (x: number, z: number) => boolean
  /** 円を建物と範囲の外枠から押し出す */
  resolveCircle: (x: number, z: number, r: number) => CircleHit
  /** [cheats] その点にある建物の屋根の高さ（重なっていればいちばん高い屋根）。建物の外なら -Infinity。飛行機が上を越えられるかを見る */
  roofY: (x: number, z: number) => number
  /** a→b の線分が最初に建物へ入る位置（0..1）。遮られなければ 1 */
  segmentClear: (ax: number, az: number, bx: number, bz: number) => number
  /** いちばん近い道。driveOnly なら車道だけ */
  nearestRoad: (x: number, z: number, driveOnly?: boolean, maxDist?: number) => NearestRoad | null
  /** 車が走る道のグラフ（地上の車道。高架の自動車道とトンネルは含めない） */
  driveGraph: RoadGraph
  /** 人が歩く道のグラフ */
  walkGraph: RoadGraph
  spot: (key: string) => MapSpot | undefined
}

// ----------------------------------------------------------------------------
// 設定
// ----------------------------------------------------------------------------

export type TimeOfDay = 'day' | 'dusk' | 'night'
export type QualityId = 'high' | 'mobile'
export type PlayMode = 'foot' | 'drive'

/** 1歩ぶんの入力。キーボード・ゲームパッド・タッチ・デモ再生はすべてこの形にそろえる */
export interface InputFrame {
  /** 右が＋（−1..1）。徒歩は横移動、車はハンドル */
  moveX: number
  /** 前が＋（−1..1）。徒歩は前進、車はアクセル（＋）とブレーキ・後退（−） */
  moveY: number
  /** この1歩でカメラを回す量（ラジアン、右が＋） */
  lookX: number
  /** この1歩でカメラを上下に振る量（ラジアン、上が＋） */
  lookY: number
  run: boolean
  handbrake: boolean
  horn: boolean
  lookBack: boolean
  /** 乗る／降りる（押した瞬間の1歩だけ true） */
  enter: boolean
  /** 服を奪う（押した瞬間の1歩だけ true） */
  steal: boolean
  /** [outfit] ワードローブから着替える服のキー（決めた1歩だけ入る。無ければ着替えない） */
  wear?: string
  /** [cheats] スマホで打った裏コード（通じた1歩だけ入る。無ければ何もしない） */
  cheat?: CheatId
}

/** [cheats] 裏コードの種類（lib/gto/cheats.ts）。calm=手配度を1つ下げる、plane=飛行機を出す、tank=戦車を出す */
export type CheatId = 'calm' | 'plane' | 'tank'

// ----------------------------------------------------------------------------
// 動くもの
// ----------------------------------------------------------------------------

export interface PlayerState {
  x: number
  y: number
  z: number
  heading: number
  /** 水平の速さ m/s */
  speed: number
  running: boolean
  /** 歩行の位相（歩いた距離に比例して進む。描画の足踏みと足音に使う） */
  stride: number
  /** 乗っている車の id（徒歩なら null） */
  vehicleId: number | null
  /** 動けない残り秒（服を奪う動作など） */
  busy: number
  /** 乗り降りの途中の様子（onFoot.ts だけが読み書きする。途中でなければ null か無し） */
  boarding?: Boarding | null
  /** [onfoot] 降りたばかりの車と、カメラが落ち着くまでの残り秒（onFoot.ts だけが読み書きする） */
  leftCar?: { vehicleId: number; t: number; side?: 1 | -1 | 0 } | null
}

/**
 * 乗り降りの段階。
 * 乗る: approach（ドアへ走る）→ open（ドアを開ける）→ pull（奪うときだけ: 運転手を降ろす）→ sit（座る）→ shut（ドアを閉める）
 * 降りる: unlatch（停めてドアを開ける）→ out（外へ出る）→ leave（ドアが閉まる。もう歩ける）
 */
export type BoardingPhase = 'approach' | 'open' | 'pull' | 'sit' | 'shut' | 'unlatch' | 'out' | 'leave'

export interface Boarding {
  phase: BoardingPhase
  vehicleId: number
  /** 使うドアの側。1=右（運転席）、−1=左、0=後ろ（左右とも塞がっているとき） */
  side: 1 | -1 | 0
  /** この段階に入ってからの秒 */
  t: number
  /** 運転手のいる車を奪っている */
  jack: boolean
  /** [onfoot] 直前の1歩の秒（カメラの相手の点が動いた速さを伝えるのに使う） */
  dt?: number
}

/** ふつうの車（ドア・車室・サスペンションのある形で描く） */
export type CarKind = 'sedan' | 'kei' | 'taxi' | 'van' | 'police'
/** [cheats] 裏コードで出す乗り物。専用の形で描き、ドアの演技なしで乗り降りする（lib/gto/special.ts） */
export type SpecialKind = 'tank' | 'plane'
export type VehicleKind = CarKind | SpecialKind
export type Driver = 'none' | 'player' | 'traffic' | 'police'

/** 交通の車が辿っている道（traffic.ts だけが読み書きする） */
export interface TrafficRoute {
  edge: number
  /** 辺の始点からの距離 */
  s: number
  /** 巡航したい速さ m/s */
  cruise: number
  /** 次に進むと決めた辺（まだ決めていなければ無し、行き止まりは −1） */
  next?: number
  /** 直前に走っていた辺（角を丸く曲がるために覚える） */
  prev?: number
  /** 譲るため・塞がれて止まっている秒 */
  wait?: number
  /** 停まっている車をよけるための横ずれ m（右が＋） */
  swerve?: number
  /** [traffic-peds] 走る車線の番号（無ければ車の id から決める） */
  lane?: number
  /** [traffic-peds] 巡航の上限 m/s（主人公の前を走る車列を、追い付ける速さに抑える。無ければ抑えない） */
  pace?: number
  /** [traffic-peds] next のさらに次に進むと決めた辺（短い辺が続く交差点で、入る前から曲がる先を見て譲る・減速する） */
  next2?: number
}

export interface VehicleState {
  id: number
  kind: VehicleKind
  /** 塗装色 0xRRGGBB */
  color: number
  x: number
  y: number
  z: number
  heading: number
  /** 前向きの速さ m/s（後退は負） */
  speed: number
  /** 横滑りの速さ m/s（右が＋） */
  slip: number
  /** 実際の舵角（−1..1、右が＋） */
  steer: number
  /** 旋回の角速度 rad/s */
  yawRate: number
  driver: Driver
  route: TrafficRoute | null
  /** 直前の1歩の前後加速度 m/s²（描画のピッチと音に使う） */
  accel: number
  /** [cheats] 飛行機だけ: 車輪が地面から浮いている高さ m（0 か無ければ接地）と、上下の速さ m/s（上が＋）。飛んでいるあいだ y は「地面＋alt」 */
  alt?: number
  climb?: number
  /** [vehicle] 壊れ具合 0..1（vehicleDamage.ts の段階で白煙→黒煙→炎）。無ければ無傷 */
  damage?: number
  /** [vehicle] 車体の凹み 0..1。並びは vehicleDamage.ts の DENT（前の左・中・右、後ろの左・中・右、左側面、右側面）。無ければ無傷 */
  dents?: readonly number[]
}

/** 車への操作（プレイヤーの入力、交通AI、警察AIのどれもこの形で車に渡す） */
export interface VehicleControl {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
  /** [cheats] 飛行機だけ: 上昇（＋1）・下降（−1）。無ければ 0 */
  lift?: number
}

export type PedMood = 'walk' | 'flee' | 'stunned'

export interface PedRoute {
  edge: number
  s: number
  /** 中心線から横へずらす量 m */
  side: number
  /** 次に進むと決めた辺（信号待ちのあいだ覚えておく） */
  next?: number
  /** ふだん歩く速さ m/s（信号待ちで止まっても忘れないように） */
  pace?: number
}

export interface PedState {
  id: number
  x: number
  y: number
  z: number
  heading: number
  speed: number
  /** 着ている出勤服（くり抜きスプライトのキー） */
  outfitKey: string
  mood: PedMood
  /** mood の残り秒 */
  timer: number
  route: PedRoute | null
  stride: number
  /** 徒歩の警官（wanted.ts が出して動かす。描画は制服の色や帽子で見分けを付けてよい） */
  cop?: true
}

export interface CameraState {
  x: number
  y: number
  z: number
  /** 注視点 */
  tx: number
  ty: number
  tz: number
  /** 見ている向き（heading と同じ取り方） */
  yaw: number
  /** 見下ろす角（ラジアン、下向きが＋） */
  pitch: number
  /** 注視点からの距離 */
  dist: number
  /** 縦の画角（度） */
  fov: number
  /** 最後にカメラを手で動かしてからの秒 */
  idle: number
  /** カメラが回る軸（相手の足元をなめらかに追った位置）。camera.ts が持ち回る */
  px?: number
  py?: number
  pz?: number
  /** 視線の先読み（ラジアン）。位置は yaw の真後ろのまま、視線だけ進む先へ振った分。camera.ts が持ち回る */
  lead?: number
  /** [camera] 徒歩のスティックを世界の向きへ直すときの基準（ラジアン）。押しっぱなしのあいだは、カメラが自動で回り込んでも動かない。camera.ts が持ち回る */
  moveYaw?: number
  /** [camera] 基準を決めたときのスティックの向き（ラジアン、前が 0・右が＋）。中立なら無し */
  stick?: number
  /** [camera] 壁や車で詰まって上へ逃げている度合い（0..1）。camera.ts が持ち回る */
  rise?: number
  /** [camera] 速さに応じて後ろへ引いている分 m（発進で相手が先へ出て、急停止で詰める）。camera.ts が持ち回る */
  trail?: number
  /** [onfoot] 乗り降りの段で、壁に詰まって縮めている水平距離 m。camera.ts が持ち回る */
  stageFlat?: number
}

export interface WantedState {
  /** 悪さの蓄積 */
  heat: number
  /** 手配度 0..5 */
  level: number
  /** 警察に見失われてからの秒 */
  unseen: number
  /** 捕まるまでの溜め（秒） */
  bust: number
  /** 警察が最後に主人公を見た場所（見失ったあとはここを捜す。手配が無ければ null） */
  lastSeen?: { x: number; z: number } | null
  /** 警察車両ごとの役割と、いま向かっている先（wanted.ts だけが読み書きする） */
  units?: PoliceUnit[]
}

/** 追う＝後ろから道沿いに追う / 回り込む＝行く手へ先回りする / 塞ぐ＝道を横向きに塞いで待つ */
export type PoliceRole = 'chase' | 'flank' | 'block'

export interface PoliceUnit {
  /** 車両の id */
  id: number
  role: PoliceRole
  /** いま向かっている地点 */
  wx: number
  wz: number
  /** 主人公が直接見えていて、道筋ではなく本人へ向かっているか */
  direct: boolean
  /** 向かっている地点の先で道が大きく曲がるか（手前で減速する） */
  corner: boolean
  /** 次に道筋を引き直すまでの秒 */
  replan: number
  /** 動けずにいる秒と、切り返しで下がる残り秒 */
  stuck: number
  reverse: number
  /** 出てからの秒 */
  age: number
}

export interface MissionProgress {
  id: string
  step: number
  /** この手順に入ってからの秒 */
  stepTime: number
  /** この手順で数えた数（奪った服の数など） */
  count: number
  /** 残り時間（制限のない手順は null） */
  timeLeft: number | null
  /** この手順のゲージ 0..1（尾行の警戒、運ぶ服のしわ）。使わない手順には無い */
  meter?: number
}

/** ミッションの演出（導入・手順の切り替わり・達成・失敗）。missions.ts が書き、画面はこれを読んで出す */
export interface MissionCue {
  kind: 'intro' | 'step' | 'passed' | 'failed'
  /** 出した時刻（sim の秒） */
  at: number
  missionId: string
  /** 何番目の手順の話か */
  step: number
  /** 失敗の理由 */
  detail?: string
  reward?: number
  /** 報酬への上乗せ（早く着いた、きれいに運んだ） */
  bonus?: number
}

export interface MissionState {
  active: MissionProgress | null
  /** 達成したミッションの id */
  done: string[]
  /** 画面に出す一言と、消える時刻（sim の秒） */
  banner: { text: string; until: number } | null
  /** いま出している演出（無ければ未定義か null） */
  cue?: MissionCue | null
}

export interface OutfitState {
  /** いま着ている出勤服 */
  wearing: string
  /** これまでに手に入れた出勤服（新しい順） */
  wardrobe: string[]
  /** 最後に着替えた時刻（sim の秒） */
  changedAt: number
}

export type GtoEventType =
  | 'enter'
  | 'exit'
  | 'carjack'
  | 'steal'
  | 'crash'
  | 'horn'
  | 'hitPed'
  | 'wantedUp'
  | 'wantedClear'
  | 'busted'
  | 'missionStart'
  | 'missionStep'
  | 'missionDone'
  | 'missionFail'
  | 'cheat'

/** その1歩で起きたこと。音・HUD・手配・ミッションはこれを読む */
export interface GtoEvent {
  type: GtoEventType
  x: number
  z: number
  /** 強さや数（衝突の速さ、新しい手配度など） */
  value?: number
  /** 関係する物の id やキー */
  ref?: string
}

export interface GtoState {
  /** 経過秒 */
  t: number
  frame: number
  /** 乱数の種（1歩ごとに進む） */
  seed: number
  mode: PlayMode
  player: PlayerState
  vehicles: VehicleState[]
  peds: PedState[]
  camera: CameraState
  wanted: WantedState
  mission: MissionState
  outfit: OutfitState
  cash: number
  /** 直前の1歩で起きたこと */
  events: GtoEvent[]
  /** 次に振る id */
  nextId: number
}

/** 地図上の目印（ミッションの開始地点と目的地）。ミニマップと街の中の両方に出す */
export interface Marker {
  x: number
  z: number
  kind: 'start' | 'goal'
  /** 目印の半径 m */
  radius: number
  ref: string
  /** 'person' なら、その場所に人（依頼人・尾行の相手）を立たせる */
  look?: 'person'
  /** 人の向き（ラジアン）と、歩いているか */
  heading?: number
  moving?: boolean
  /** [missions] true なら、近づいてはいけない相手（見回り）。radius が「入ってはいけない輪」の半径 */
  threat?: boolean
}

/** sim が毎歩読む設定（画質プリセットと手持ちのスプライトから決まる） */
export interface SimConfig {
  maxVehicles: number
  maxPeds: number
  /** 住人と主人公に使える出勤服のキー */
  outfitKeys: string[]
}
