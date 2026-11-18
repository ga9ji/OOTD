// Grand Theft Outfit [部品: traffic-peds] 交通の車の、車線と道筋の形（数字と幾何だけ）。
// 入口: TRAFFIC_TUNING / laneOffset / routePoint / cruiseOf / rankOf
// 契約: 左側通行。対面通行の道は中心線の左、一方通行は幅の中で車線を割り振る。角は曲線で繋ぐ。
import { angleDiff, dirOf, hash, headingOf, pointAlong } from './math'
import type { GraphEdge, RoadGraph, RoadKind, TrafficRoute } from './types'

/** 手触りを決める数字 */
export const TRAFFIC_TUNING = {
  /** 出す範囲と、消して出し直す距離 m */
  spawnMin: 45,
  spawnMax: 160,
  despawn: 205,
  /** 道なり（主人公のいる道の先）に置いておきたい台数と、出す車のうちそこへ回す割合 */
  corridorWant: 8,
  corridorShare: 0.8,
  /** 道なりに出す車のうち、対向車線へ回す割合 */
  oncomingShare: 0.45,
  /** 自分の進む側の前に、切らさずにいてほしい台数（全体の台数が少ない設定では aheadWantFew） */
  aheadWant: 3,
  aheadWantFew: 2,
  /** 道なりの先から向かってくる対向車を、切らさずにいてほしい台数（全体の台数が少ない設定では oncomingWantFew） */
  oncomingWant: 3,
  oncomingWantFew: 1,
  /** 始めの配置の車列（隣の車線）: 先頭までの距離 m、車の間隔 m、台数 */
  platoonFirst: 13,
  platoonGap: 12,
  platoonBeside: 2,
  /** 隣の車線の車列の巡航の上限 m/s（主人公が追い付いて横に並び、追い越していく）と、後ろの車ほど遅くする幅 m/s */
  platoonPace: 7.5,
  platoonLag: 0.5,
  /** 自分の車線の前に置く車の巡航の上限 m/s（流して走れば追い付いて、後ろに付ける） */
  platoonPaceLane: 8.6,
  /** 前へ補充する車は、主人公の速さのこの割合より速くは走らせない（追い付いて、後ろに付ける）。下限 m/s */
  aheadPace: 0.62,
  aheadPaceMin: 4.5,
  /** 前へ補充する車を出す距離の幅 m（popIn からこの幅の中。遠すぎると追い付く前に見えない） */
  aheadSpan: 45,
  /** 始めの配置で、同じ向きの車を主人公の前にこれより近くは置かない m（発進してすぐ追突しない） */
  freshAhead: 30,
  /** 始めの配置で、道なり以外の車を主人公からこれより近くは置かない m */
  freshSide: 48,
  /** 遊んでいる最中は、見通せる所ではこれより近くに出さない m（目の前に湧かせない） */
  popIn: 90,
  /** 出す場所は、ほかの車からこれだけ離す m */
  spawnClear: 11,
  /** 補充の車は、交差点の節の手前これだけには出さない m */
  spawnNodeClear: 14,
  /** 運転中: 後ろへこれだけ離れた車と、視界の外でこれより遠い車は出し直す m */
  behindDrop: 55,
  sideDrop: 115,
  /** 徒歩: これより遠い車は出し直す m */
  footDrop: 150,
  /** 徒歩: 道なりから外れて建物の陰にいる車は、これより遠ければ少しずつ出し直す m */
  hiddenDrop: 55,
  /** 運転中とみなす主人公の速さ m/s */
  drivingSpeed: 4,
  accel: 2.6,
  /** 強く踏むブレーキ m/s² と、ふだんの減速 m/s² */
  brake: 7,
  comfort: 2.8,
  /** 前を見る距離 = base + 速さ × perSpeed */
  lookBase: 9,
  lookPerSpeed: 1.6,
  /** 止まったときに空ける距離（自分の中心から、前の物の表面まで）m */
  standGap: 3.7,
  /** 停まったままの車の手前では、よける余地を残して止まる m */
  parkedGap: 6.5,
  /** 主人公や警察の車の後ろに付いて止まるときに空ける距離 m（背後のカメラより後ろで止まる） */
  playerGap: 9,
  /** 直角に曲がるときの速さ m/s と、角を丸める半径 m */
  cornerSpeed: 4.2,
  cornerRadius: 7,
  /** 停止線から車の中心までの距離（車の鼻先のぶん）m */
  nose: 2.3,
  /** 赤の停止線が この距離より近ければ、信号待ちの列の中とみなす m（人をよけて横へ出ない、しびれを切らさない） */
  redQueue: 45,
  /** 黄で止まれると判断する減速 m/s² */
  yellowBrake: 4.5,
  /** 譲るかどうかを見る、交差点までの距離 m と相手の到着までの秒 */
  yieldDist: 20,
  yieldEta: 4.5,
  /** 譲る相手を見る距離 m（交差点の節から）。速い相手は、到着までの秒で yieldRangeMax まで伸ばす */
  yieldRange: 28,
  yieldRangeMax: 60,
  /** これより短い辺は、交差点の中の繋ぎとみなす m（入る前に、その先の交差点でも譲るかを見る。中では止まらない） */
  shortEdge: 14,
  /** 譲って止まる位置（交差点の節の手前）m */
  yieldBack: 5.5,
  /** これだけ待たされたら、割り込んで進む（秒） */
  patience: 5,
  /** 停まった車をよけ始めるまでの秒と、よける幅 m */
  swerveAfter: 1.5,
  /** 道に立ったままの人をよけ始めるまでの秒（渡っている人は、その前に通り過ぎる） */
  swerveAfterPed: 4,
  swerveWidth: 3,
  /** 次に曲がる交差点の節まで これより近い所では、よけ始めない m */
  swerveNode: 12,
  /** 先に行かせる: 後ろを見る距離 m、追い付かれるまでの秒、空ける横の間隔 m、寄る速さ m/s */
  giveWayRange: 34,
  giveWayEta: 3.2,
  giveWayClear: 2.5,
  giveWayRate: 2.6,
  /** 後ろから迫られたときに速さを上げる: 後ろを見る距離 m と、上げる速さの上限 m/s */
  pushRange: 24,
  pushMax: 17,
  /** 後ろの車がこれだけ速く（m/s）、この秒数のうちに追い付くなら、曲がるのをやめて道なりに進む */
  rushClosing: 8,
  rushEta: 3.5,
}

const CRUISE: Partial<Record<RoadKind, number>> = {
  trunk: 14,
  primary: 13.5,
  secondary: 12,
  tertiary: 11,
  unclassified: 7,
  residential: 5.5,
  service: 4,
}

/** 道の格（大きいほど優先） */
const RANK: Partial<Record<RoadKind, number>> = {
  trunk: 6,
  trunk_link: 6,
  primary: 5,
  secondary: 4,
  secondary_link: 4,
  tertiary: 3,
  tertiary_link: 3,
  unclassified: 2,
  residential: 1,
  service: 0,
}
export const rankOf = (e: GraphEdge) => RANK[e.kind] ?? 1

/** 対面通行の細い道で、中心線から左へ寄る最小の幅 m */
const T_MIN_LEFT = 1

/**
 * 片側（一方通行なら全幅）の車線の数。路面に描かれる車線の線（renderCityRoads.ts）と合わせる:
 * 対面通行で幅 11m 以上の道は片側2車線、一方通行で幅 8.5m 以上の道は2車線以上。
 */
export function laneCount(edge: GraphEdge): number {
  if (edge.rev >= 0) return Math.max(edge.width >= 11 ? 2 : 1, Math.floor(edge.lanes / 2))
  return Math.max(edge.width >= 8.5 ? 2 : 1, edge.lanes)
}

/** 対面通行なら左側の車線、一方通行なら幅の中で車線を割り振る。戻り値は進行方向の右が＋ */
export function laneOffset(edge: GraphEdge, id: number): number {
  const count = laneCount(edge)
  if (edge.rev >= 0) {
    const laneWidth = edge.width / 2 / count
    // 細い道でも、対向車とすれ違えるだけ左へ寄る
    return -Math.max(((id % count) + 0.5) * laneWidth, T_MIN_LEFT)
  }
  return ((id % count) + 0.5) * (edge.width / count) - edge.width / 2
}

export interface PathPoint {
  x: number
  z: number
  heading: number
}

/** 辺の s の位置の、自分の車線の上の点 */
export function lanePoint(edge: GraphEdge, s: number, id: number): PathPoint {
  const p = pointAlong(edge.pts, edge.cum, s)
  const f = dirOf(p.heading)
  const off = laneOffset(edge, id)
  return { x: p.x - f.z * off, z: p.z + f.x * off, heading: p.heading }
}

/** 角を丸める長さ（短い辺では、辺の半分弱まで） */
export const cornerLen = (edge: GraphEdge) => Math.min(TRAFFIC_TUNING.cornerRadius, edge.length * 0.45)

/**
 * 辺 a の終わりから辺 b の始まりへ、車線どうしを繋ぐ曲線（3次ベジェ）の上の点。u は 0..1。
 * 両端で車線の向きに接するので、直角の角も、車線の幅が変わる所も、行き止まりの折り返しも滑らかに繋がる。
 */
function cornerPoint(a: GraphEdge, b: GraphEdge, id: number, u: number): PathPoint {
  const p0 = lanePoint(a, a.length - cornerLen(a), id)
  const p3 = lanePoint(b, cornerLen(b), id)
  const d0 = dirOf(p0.heading)
  const d3 = dirOf(p3.heading)
  // 折り返しは前へふくらんで回る
  const uTurn = d0.x * d3.x + d0.z * d3.z < -0.5
  const k = uTurn ? 5 : Math.hypot(p3.x - p0.x, p3.z - p0.z) * 0.4
  const p1x = p0.x + d0.x * k
  const p1z = p0.z + d0.z * k
  const p2x = p3.x - d3.x * k
  const p2z = p3.z - d3.z * k
  const w = 1 - u
  const tx = 3 * w * w * (p1x - p0.x) + 6 * w * u * (p2x - p1x) + 3 * u * u * (p3.x - p2x)
  const tz = 3 * w * w * (p1z - p0.z) + 6 * w * u * (p2z - p1z) + 3 * u * u * (p3.z - p2z)
  return {
    x: w * w * w * p0.x + 3 * w * w * u * p1x + 3 * w * u * u * p2x + u * u * u * p3.x,
    z: w * w * w * p0.z + 3 * w * w * u * p1z + 3 * w * u * u * p2z + u * u * u * p3.z,
    heading: Math.hypot(tx, tz) > 1e-6 ? headingOf(tx, tz) : p3.heading,
  }
}

/** 道筋の上の、いまの位置と向き（車線の上。角では曲線の上） */
export function routePoint(graph: RoadGraph, route: TrafficRoute, carId: number): PathPoint {
  const id = route.lane ?? carId
  const edge = graph.edges[route.edge]
  const r = cornerLen(edge)
  const nextE = route.next != null && route.next >= 0 ? graph.edges[route.next] : null
  if (nextE && route.s > edge.length - r) return cornerPoint(edge, nextE, id, (0.5 * (route.s - (edge.length - r))) / r)
  const prevE = route.prev != null && route.prev >= 0 ? graph.edges[route.prev] : null
  if (prevE && route.s < r) return cornerPoint(prevE, edge, id, 0.5 + (0.5 * route.s) / r)
  return lanePoint(edge, route.s, id)
}

/** 辺の終わりと、次の辺の始まりの向きの差（右へ曲がるのが＋） */
export const turnBetween = (a: GraphEdge, b: GraphEdge) =>
  angleDiff(pointAlong(a.pts, a.cum, a.length).heading, pointAlong(b.pts, b.cum, 0).heading)

/** 巡航の速さ。車ごとに速い・遅いの癖がある（遅い車に後ろが詰まり、主人公も追い付く） */
export const cruiseOf = (edge: GraphEdge, id: number, next: () => number) => (CRUISE[edge.kind] ?? 6) * (0.7 + hash(id, 3) * 0.26 + next() * 0.14)

/** 円で近似した、道の上の邪魔なもの（ほかの車、主人公、通行人） */
export interface Hazard {
  x: number
  z: number
  r: number
  /** 自分自身を除くための id（車以外は −1） */
  id: number
  /** 以下は車だけ: 向き、速さ、走っている辺（交通の車）、誰も乗っていない車か */
  heading?: number
  speed?: number
  edge?: number
  parked?: boolean
}
