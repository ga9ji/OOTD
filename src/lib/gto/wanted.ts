// Grand Theft Outfit [部品: wanted] 手配と追跡。
// 入口: createWanted / stepWanted / policeSees / policeWanted / spawnPolice / wantedBanner
//       ＋ 追い方（wantedPursuit.ts: planPursuit / policeControl / shortestPath）
//       ＋ 徒歩の警官（wantedOfficers.ts: officersWanted / spawnOfficer / stepOfficer / officerDone）
// 契約: その1歩で起きたこと（GtoEvent）から悪さを数えて手配度を決め、警察車両の台数と出す場所、
//       追う車への操作（VehicleControl）を返す。車そのものの動きは vehicle.ts が計算する。
//       見られているあいだは冷めず、見失われると最後に見た場所を捜され、しばらくして冷める。
//       手配度（level）は冷めていく途中では下がらず、冷めきったときに一度に 0 へ戻る（印の数が揺れない）。
import { angleDiff, clamp, dirOf, headingOf } from './math'
import type { GtoEvent, GtoWorld, PedState, VehicleState, WantedState } from './types'

export { planPursuit, policeControl, PURSUIT_TUNING, shortestPath, type PursuitTarget } from './wantedPursuit'
export { officerDone, OFFICER_TUNING, officersWanted, spawnOfficer, stepOfficer, type OfficerThreat } from './wantedOfficers'

/** 手触りを決める数字 */
export const WANTED_TUNING = {
  /** 悪さごとの加点 */
  // [cheats] blast は戦車の砲の着弾（街なかで撃てば、1 発で手配度 2 まで上がる）
  heat: { carjack: 30, steal: 18, hitPed: 26, crash: 3, blast: 48 } as Partial<Record<GtoEvent['type'], number>>,
  /** 警察車両にぶつけた・警官をはねたときの加点 */
  ramPolice: 22,
  /** 自分がこの速さ以上で動いているときだけ「ぶつけた」と数える（警察に当てられたぶんは数えない） */
  ramSpeed: 5,
  hitOfficer: 45,
  /** 人をはねた場所が自分の車からこの距離の中なら、自分がはねたとみなす */
  hitRange: 5,
  /** 手配度 1〜5 になる閾値 */
  levels: [15, 45, 90, 150, 230],
  maxHeat: 280,
  /** 見られたままこの速さ以上で逃げ続けると、この速さ（点/秒）で上がる。上がるのは手配度4の手前まで */
  evadeSpeed: 8,
  evadeRate: 1.2,
  evadeCap: 145,
  /** 見失われてから冷め始めるまでの秒と、冷める速さ（点/秒） */
  coolDelay: 7,
  coolRate: 9,
  /** 警察車両・徒歩の警官がこの距離より近くて、間に建物が無いと「見られている」 */
  sightRange: 70,
  officerSight: 45,
  /** 着替えると、見られていなければ一気に冷める */
  disguiseFactor: 0.35,
  /** 捕まる条件: この距離の中で、この速さより遅いまま、この秒数 */
  bustRange: 5,
  bustSpeed: 1.5,
  bustTime: 2.2,
  /** 徒歩の警官にこの距離まで詰められると、走っていても捕まる（溜まる速さはこの倍） */
  grabRange: 1.35,
  grabBoost: 1.8,
  /** 手配度ごとの警察車両の数 */
  units: [0, 1, 2, 3, 4, 5],
  /** 警察車両を出す距離 m（走っている主人公の行く手 / 歩きの主人公の周り） */
  spawnMin: 70,
  spawnMax: 140,
  spawnMinFoot: 45,
  spawnMaxFoot: 100,
  /** 「行く手」とみなす、進行方向からの角度（ラジアン） */
  aheadCone: 0.6,
  /** この手配度から、3台に1台が道を塞ぐ護送車になる */
  blockLevel: 3,
  vanColor: 0x1c2a4a,
  /** 決着の一言を出しておく秒 */
  bannerSeconds: 4,
}

export const createWanted = (): WantedState => ({ heat: 0, level: 0, unseen: 0, bust: 0, lastSeen: null, units: [] })

const levelOf = (heat: number) => WANTED_TUNING.levels.filter((th) => heat >= th).length

export interface WantedView {
  /** いちばん近い警察車両までの距離（いなければ Infinity） */
  policeDist: number
  /** 警察から主人公が見えているか */
  seen: boolean
  playerSpeed: number
  x: number
  z: number
  /** この1歩で着替えたか */
  changedOutfit: boolean
  /** いちばん近い徒歩の警官までの距離 */
  officerDist?: number
  /** 警察車両の id（ぶつけた相手が警察かどうかを見分ける） */
  policeIds?: number[]
  /** 主人公が車に乗っているか。渡されたときは、人をはねた加点を「自分の車のそばで起きたもの」に限る */
  driving?: boolean
}

/** その1歩の出来事ぶんの加点 */
function heatOf(events: GtoEvent[], view: WantedView): number {
  const T = WANTED_TUNING
  let add = 0
  for (const e of events) {
    const base = T.heat[e.type]
    if (!base) continue
    // ぶつけただけでは、強く当てたときしか加点しない。警察車両に当てたら重い
    if (e.type === 'crash') {
      const police = e.ref != null && (view.policeIds ?? []).includes(Number(e.ref))
      if (police) add += (e.value ?? 0) >= 3 && view.playerSpeed >= T.ramSpeed ? T.ramPolice : 0
      else if ((e.value ?? 0) >= 6) add += base
      continue
    }
    if (e.type === 'hitPed') {
      // 警察車両や乗り捨てた車が人をはねたぶんは、主人公のせいにしない
      const mine = view.driving == null || (view.driving && Math.hypot(e.x - view.x, e.z - view.z) < T.hitRange)
      if (mine) add += e.ref === 'cop' ? T.hitOfficer : base
      continue
    }
    add += base
  }
  return add
}

export function stepWanted(
  w: WantedState,
  events: GtoEvent[],
  view: WantedView,
  dt: number,
): { wanted: WantedState; events: GtoEvent[] } {
  const T = WANTED_TUNING
  const out: GtoEvent[] = []
  const here = { x: view.x, z: view.z }
  const gained = heatOf(events, view)
  let heat = w.heat + gained
  // 見られたまま飛ばして逃げ続けると、応援が増える
  if (view.seen && w.level > 0 && view.playerSpeed >= T.evadeSpeed && heat < T.evadeCap) {
    heat = Math.min(T.evadeCap, heat + T.evadeRate * dt)
  }
  let unseen = view.seen ? 0 : w.unseen + dt
  if (gained > 0) unseen = view.seen ? 0 : Math.min(unseen, T.coolDelay * 0.5)
  if (view.changedOutfit && !view.seen && w.level > 0) heat *= T.disguiseFactor
  if (unseen > T.coolDelay) heat -= T.coolRate * dt
  heat = clamp(heat, 0, T.maxHeat)

  // 冷めていく途中で印が1つずつ減ると「いまどれだけ追われているか」が読めなくなる。
  // 段階は上がるだけにして、冷めきったとき（heat が 0）に一度に消す。着替えてごまかせたときだけ途中で下がる
  const rated = levelOf(heat)
  const disguised = view.changedOutfit && !view.seen
  const level = heat <= 0 ? 0 : disguised ? rated : Math.max(rated, w.level)
  if (level > w.level) out.push({ type: 'wantedUp', ...here, value: level })
  if (level === 0 && w.level > 0) out.push({ type: 'wantedClear', ...here })

  // 見られた場所と、悪さをした場所（通報された場所）を覚えておく
  const lastSeen = level === 0 ? null : view.seen || gained > 0 ? here : (w.lastSeen ?? null)

  const cornered = view.policeDist < T.bustRange && view.playerSpeed < T.bustSpeed
  const grabbed = (view.officerDist ?? Infinity) < T.grabRange
  let bust = level > 0 && (cornered || grabbed) ? w.bust + dt * (grabbed ? T.grabBoost : 1) : 0
  if (bust >= T.bustTime) {
    out.push({ type: 'busted', ...here })
    return { wanted: createWanted(), events: out }
  }
  if (level === 0) bust = 0
  return { wanted: { ...w, heat, level, unseen, bust, lastSeen }, events: out }
}

/** 警察（車両と、倒れていない徒歩の警官）に見えているか。近くて、間に建物が無いこと */
export function policeSees(
  world: GtoWorld,
  police: VehicleState[],
  x: number,
  z: number,
  officers: PedState[] = [],
): { seen: boolean; dist: number; officerDist: number } {
  const T = WANTED_TUNING
  let dist = Infinity
  let officerDist = Infinity
  let seen = false
  for (const v of police) {
    const d = Math.hypot(v.x - x, v.z - z)
    dist = Math.min(dist, d)
    if (!seen && d < T.sightRange && world.segmentClear(v.x, v.z, x, z) >= 1) seen = true
  }
  for (const p of officers) {
    if (p.mood === 'stunned') continue
    const d = Math.hypot(p.x - x, p.z - z)
    officerDist = Math.min(officerDist, d)
    if (!seen && d < T.officerSight && world.segmentClear(p.x, p.z, x, z) >= 1) seen = true
  }
  return { seen, dist, officerDist }
}

/** その手配度で出しておく警察車両の数 */
export const policeWanted = (level: number) => WANTED_TUNING.units[clamp(level, 0, 5)]

/** 出す場所を決めるための、主人公のいまと手配の様子 */
export interface SpawnContext {
  heading?: number
  speed?: number
  level?: number
  /** いま出ている警察車両の数（何台目か） */
  index?: number
}

/**
 * 主人公から少し離れた車道に、警察車両を1台出す。
 * 走っているときは行く手に出して、正面から来る・道を塞ぐ形にする（4台に1台だけ、どこからでも）。
 */
export function spawnPolice(
  world: GtoWorld,
  id: number,
  center: { x: number; z: number },
  next: () => number,
  ctx: SpawnContext = {},
): VehicleState | null {
  const T = WANTED_TUNING
  const index = ctx.index ?? 0
  const moving = Math.abs(ctx.speed ?? 0) > 3 && ctx.heading != null
  const travel = (ctx.heading ?? 0) + ((ctx.speed ?? 0) < 0 ? Math.PI : 0)
  const wantAhead = moving && index % 4 !== 3
  const wantBlock = moving && (ctx.level ?? 0) >= T.blockLevel && index % 3 === 2
  const minD = moving ? T.spawnMin : T.spawnMinFoot
  const maxD = moving ? T.spawnMax : T.spawnMaxFoot

  // 進行方向の扇（行く手）か、周り全部の中から、距離と向きを乱数で決めて、いちばん近い車道へ寄せる
  type Spot = { x: number; z: number; heading: number; ahead: boolean }
  let chosen: Spot | null = null
  let spare: Spot | null = null
  for (let i = 0; i < 24 && !chosen; i++) {
    const ahead = wantAhead && i < 16
    const bearing = ahead ? travel + (next() * 2 - 1) * T.aheadCone : next() * Math.PI * 2
    const reach = minD + next() * (maxD - minD)
    const d = dirOf(bearing)
    const road = world.nearestRoad(center.x + d.x * reach, center.z + d.z * reach, true, 40)
    if (!road || world.insideBuilding(road.x, road.z)) continue
    const dist = Math.hypot(road.x - center.x, road.z - center.z)
    if (dist < minD * 0.8 || dist > maxD * 1.2) continue
    const inCone = moving && Math.abs(angleDiff(travel, headingOf(road.x - center.x, road.z - center.z))) < T.aheadCone * 1.3
    const spot = { x: road.x, z: road.z, heading: road.heading, ahead: inCone }
    if (!wantAhead || inCone) chosen = spot
    else spare = spare ?? spot
  }
  const at = chosen ?? spare
  if (!at) return null

  // 主人公のほうを向けて出す
  const toward = headingOf(center.x - at.x, center.z - at.z)
  const facing = Math.abs(angleDiff(at.heading, toward)) < Math.PI / 2 ? at.heading : at.heading + Math.PI
  const block = wantBlock && at.ahead
  const base = { id, y: 0, slip: 0, steer: 0, yawRate: 0, driver: 'police' as const, route: null, accel: 0 }
  if (block) {
    // 護送車: 道の真ん中に横向きに止めて塞ぐ
    return { ...base, kind: 'van', color: T.vanColor, x: at.x, y: world.groundY(at.x, at.z), z: at.z, heading: at.heading + Math.PI / 2, speed: 0 }
  }
  // 左側通行なので、中心線から少し左へ寄せる
  const f = dirOf(facing)
  const x = at.x + f.z * 1.6
  const z = at.z - f.x * 1.6
  return { ...base, kind: 'police', color: 0xf4f4f4, x, y: world.groundY(x, z), z, heading: facing, speed: 10 }
}

/** 決着の一言（逮捕・逃げ切り）。その1歩の出来事に決着が無ければ null */
export function wantedBanner(events: GtoEvent[], t: number): { text: string; until: number } | null {
  const until = t + WANTED_TUNING.bannerSeconds
  if (events.some((e) => e.type === 'busted')) return { text: '逮捕　罰金を支払った', until }
  if (events.some((e) => e.type === 'wantedClear')) return { text: '逃げ切った', until }
  return null
}
