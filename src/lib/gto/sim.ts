// Grand Theft Outfit: 全部品を1歩進める統合。部品どうしを繋ぐのはこのファイルだけ。
// 入口: createGtoState(world, cfg, opts) / stepGto(state, input, world, cfg, dt) / viewOf(state, world)
//
// 1歩の順番:
//   乗り降り（onFoot）→ 服の強奪（outfit）→ 主人公の移動（onFoot / vehicle）→ 警察と乗り捨て車（wanted / vehicle）
//   → 交通（traffic）→ 車どうしの衝突（vehicle）→ 歩行者（pedestrians）→ 手配（wanted）→ ミッション（missions）
//   → カメラ（camera）
// 部品を直すときは、その部品のファイルだけを直せば済むようにしてある（ここは呼び出しの順番と受け渡しだけ）。
import { createCamera, moveFrame, stepCamera, vehicleCrowd, type CameraTarget } from './camera'
import type { DemoStage } from './demo'
import { angleDiff, dirOf, rng } from './math'
import { createMissions, missionMarkers, missionText, startMission, stepMissions } from './missions'
import { cameraSubject, canDrive, createPlayer, crowdExempt, findEnterable, FOOT_TUNING, stepBoarding, stepOnFoot, type Blocker } from './onFoot'
import { createOutfit, findStealTarget, OUTFIT_TUNING, stealOutfit, wearFromWardrobe } from './outfit'
import { bailOut, needsPedRespawn, spawnPed, stepPed, type PedThreat } from './pedestrians'
import { needsRespawn, spawnTraffic, stepTraffic, type Hazard } from './traffic'
import type {
  GtoEvent,
  GtoState,
  GtoWorld,
  InputFrame,
  Marker,
  PedState,
  PlayMode,
  SimConfig,
  VehicleState,
} from './types'
import { collideVehicles, controlFromInput, createVehicle, idleControl, stepVehicle, VEHICLE_SPECS } from './vehicle'
import {
  createWanted,
  officerDone,
  officersWanted,
  planPursuit,
  policeControl,
  policeSees,
  policeWanted,
  spawnOfficer,
  spawnPolice,
  stepOfficer,
  stepWanted,
  wantedBanner,
  WANTED_TUNING,
} from './wanted'

/** 既定の出発点（駅前の広場。交差点のほうを向いて立つ） */
export const SPAWN = { x: 26, z: 32, heading: -0.75 }
/** 捕まったときの罰金 */
const BUST_FINE = 2000
const START_CASH = 1000
const PLAYER_CAR_COLOR = 0xe2562b

export interface StartOptions {
  seed?: number
  mode?: PlayMode
  start?: { x: number; z: number; heading: number } | null
  stage?: DemoStage
  /** 歩きで始めるとき、近くに車を1台停めておくか（固定カメラの撮影では邪魔なので置かない） */
  starterCar?: boolean
}

const targetOf = (state: Pick<GtoState, 'player' | 'mode'>): CameraTarget => ({
  x: state.player.x,
  y: state.player.y,
  z: state.player.z,
  heading: state.player.heading,
  speed: state.player.speed,
  mode: state.mode,
})

/** 車で始めるときは、いちばん近い車道の上へ寄せて、道の向きに合わせる */
function onRoad(world: GtoWorld, x: number, z: number, heading: number) {
  const road = world.nearestRoad(x, z, true, 80)
  if (!road) return { x, z, heading }
  const along = Math.abs(angleDiff(road.heading, heading)) < Math.PI / 2 ? road.heading : road.heading + Math.PI
  // 左側通行なので、中心線から少し左へ寄せる
  const f = dirOf(along)
  return { x: road.x + f.z * 1.6, z: road.z - f.x * 1.6, heading: along }
}

export function createGtoState(world: GtoWorld, cfg: SimConfig, opts: StartOptions = {}): GtoState {
  const R = rng((opts.seed ?? 1) * 7919 + 13)
  const mode = opts.mode ?? 'foot'
  const want = opts.start ?? opts.stage?.at ?? SPAWN
  const at = mode === 'drive' ? onRoad(world, want.x, want.z, want.heading) : { ...want, ...pick(world.resolveCircle(want.x, want.z, FOOT_TUNING.radius)) }
  let nextId = 1
  const vehicles: VehicleState[] = []
  let player = createPlayer(at.x, at.z, at.heading, world)

  if (mode === 'drive') {
    const car = { ...createVehicle(nextId++, 'sedan', at.x, at.z, at.heading, world, PLAYER_CAR_COLOR), driver: 'player' as const }
    vehicles.push(car)
    player = { ...player, vehicleId: car.id }
  } else if (opts.starterCar !== false) {
    // 歩きで始めるときは、すぐ車を試せるよう近くの道に1台停めておく
    const f = dirOf(at.heading)
    const near = opts.stage?.parkedAhead
      ? { x: at.x + f.x * 4.6, z: at.z + f.z * 4.6, heading: at.heading + Math.PI / 2 }
      : onRoad(world, at.x, at.z, at.heading)
    const parked = createVehicle(nextId++, 'kei', near.x, near.z, near.heading, world, 0xf2c14e)
    // 撮影用: 運転手が乗ったまま停まっている車（手配が無いあいだ警察の車は動かないので、その扱いを借りる）
    vehicles.push(opts.stage?.occupiedAhead ? { ...parked, driver: 'police' } : parked)
  }
  if (opts.stage?.lineup) {
    // [vehicle] 撮影用: 全車種を主人公の前に斜めに並べる
    const f = dirOf(at.heading)
    const kinds = Object.keys(VEHICLE_SPECS) as (keyof typeof VEHICLE_SPECS)[]
    const paints = [0xe2562b, 0xf2c14e, 0x1f6b4a, 0xf2f2ee, 0xf4f4f4]
    kinds.forEach((kind, i) => {
      const side = (i - (kinds.length - 1) / 2) * 3.6 + 1.8
      const x = at.x + f.x * 7.5 - f.z * side
      const z = at.z + f.z * 7.5 + f.x * side
      vehicles.push(createVehicle(nextId++, kind, x, z, at.heading + (i % 2 === 0 ? 2.45 : -0.7), world, paints[i % paints.length]))
    })
  }

  if (opts.stage?.ramAhead && mode === 'drive') {
    // [vehicle] 撮影用: 行く手に横を向いた車を停めておく（右へ 1.8m ずらしてあり、自分の鼻が相手の尻寄りに当たる。相手は前へ押し出されて回り、画面の中に残る）
    const f = dirOf(at.heading)
    const d = opts.stage.ramAhead
    vehicles.push(createVehicle(nextId++, 'sedan', at.x + f.x * d - f.z * 1.8, at.z + f.z * d + f.x * 1.8, at.heading + Math.PI / 2 + 0.2, world, 0x2f5fb0))
  }

  for (let i = 0; i < cfg.maxVehicles; i++) {
    const v = spawnTraffic(world, nextId, at, R.next, 22)
    if (v) {
      vehicles.push(v)
      nextId++
    }
  }
  const peds: PedState[] = []
  for (let i = 0; i < cfg.maxPeds; i++) {
    const p = spawnPed(world, nextId, at, cfg.outfitKeys, R.next, 5)
    if (p) {
      peds.push(p)
      nextId++
    }
  }
  const wearing = cfg.outfitKeys[Math.floor(R.next() * cfg.outfitKeys.length)] ?? ''
  if (opts.stage?.pedAhead && cfg.outfitKeys.length > 0) {
    const f = dirOf(at.heading)
    const x = at.x + f.x * 2.6
    const z = at.z + f.z * 2.6
    const other = cfg.outfitKeys.find((k) => k !== wearing) ?? wearing
    peds.push({ id: nextId++, x, y: world.groundY(x, z), z, heading: at.heading + Math.PI, speed: 0, outfitKey: other, mood: 'walk', timer: 0, route: null, stride: 0 })
  }

  const level = Math.max(0, Math.min(5, opts.stage?.wanted ?? 0))
  const wanted = level > 0 ? { ...createWanted(), heat: WANTED_TUNING.levels[level - 1] + 8, level } : createWanted()
  const mission = opts.stage?.mission ? startMission(createMissions(), opts.stage.mission, 0, opts.stage.missionStep ?? 0) : createMissions()

  return {
    t: 0,
    frame: 0,
    seed: R.seed(),
    mode,
    player,
    vehicles,
    peds,
    camera: createCamera(targetOf({ player, mode })),
    wanted,
    mission,
    outfit: createOutfit(wearing, cfg.outfitKeys.slice(0, opts.stage?.wardrobe ?? 0)),
    cash: START_CASH,
    events: [],
    nextId,
  }
}

const pick = (p: { x: number; z: number }) => ({ x: p.x, z: p.z })

const replaceById = <T extends { id: number }>(list: T[], item: T) => list.map((o) => (o.id === item.id ? item : o))

export function stepGto(state: GtoState, input: InputFrame, world: GtoWorld, cfg: SimConfig, dt: number): GtoState {
  const R = rng(state.seed)
  const t = state.t + dt
  const frame = state.frame + 1
  const events: GtoEvent[] = []
  let { player, vehicles, peds, outfit, mode, nextId, cash } = state

  // ---- 乗り降り ----
  // ドアへ走る → 開ける →（奪うなら運転手を降ろす）→ 座る → 閉める、の段階を onFoot が1歩ずつ進める
  {
    const board = stepBoarding(player, mode, vehicles, (v) => VEHICLE_SPECS[v.kind], input, world, dt)
    player = board.player
    vehicles = board.vehicles
    mode = board.mode
    events.push(...board.events)
    const out = board.ejected
    if (out && cfg.outfitKeys.length > 0) {
      // 運転していた人は車から放り出されて逃げる
      peds = [
        ...peds,
        {
          id: nextId++,
          x: out.x,
          y: world.groundY(out.x, out.z),
          z: out.z,
          heading: out.heading,
          speed: 4.6,
          outfitKey: cfg.outfitKeys[Math.floor(R.next() * cfg.outfitKeys.length)],
          mood: 'flee',
          timer: 6,
          route: null,
          stride: 0,
        },
      ]
    }
  }

  // ---- 服の強奪 ----
  let changedOutfit = false
  if (input.steal && mode === 'foot' && player.busy <= 0) {
    const target = findStealTarget(player, peds, outfit.wearing)
    if (target) {
      const swapped = stealOutfit(outfit, target, t)
      outfit = swapped.outfit
      peds = replaceById(peds, swapped.ped)
      player = { ...player, busy: OUTFIT_TUNING.busy, speed: 0 }
      changedOutfit = true
      events.push({ type: 'steal', x: target.x, z: target.z, ref: swapped.outfit.wearing })
    }
  }
  // [outfit] ワードローブからの着替え（手持ちの服だけ。変装として手配にも伝える）
  if (input.wear) {
    const worn = wearFromWardrobe(outfit, input.wear, t)
    changedOutfit = changedOutfit || worn !== outfit
    outfit = worn
  }

  // ---- 主人公の移動 ----
  if (mode === 'foot') {
    const blockers: Blocker[] = vehicles.map((v) => ({
      x: v.x,
      z: v.z,
      r: VEHICLE_SPECS[v.kind].width * 0.62,
      box: { heading: v.heading, halfLength: VEHICLE_SPECS[v.kind].length / 2, halfWidth: VEHICLE_SPECS[v.kind].width / 2 },
    }))
    // [camera] 押しっぱなしの向きは世界に固定する（カメラが背後へ回り込んでも、主人公は円を描かない）
    player = stepOnFoot(player, input, moveFrame(state.camera, input), world, blockers, dt)
  } else {
    const mine = vehicles.find((v) => v.id === player.vehicleId)
    if (mine) {
      // 乗り降りの途中（ドアが閉まるまで・降りるために停めるあいだ）はアクセルを受け付けない
      const moved = stepVehicle(mine, canDrive(player) ? controlFromInput(input) : idleControl(), world, dt)
      vehicles = replaceById(vehicles, moved.vehicle)
      events.push(...moved.events)
      const v = moved.vehicle
      player = { ...player, x: v.x, y: v.y, z: v.z, heading: v.heading, speed: v.speed }
      if (input.horn && frame % 24 === 0) events.push({ type: 'horn', x: v.x, z: v.z })
    }
  }

  // ---- 警察と、乗り捨てられた車 ----
  vehicles = vehicles.map((v) => {
    if (v.driver === 'police') {
      const control = state.wanted.level > 0 ? policeControl(v, player, world, state.wanted) : { throttle: 0, brake: v.speed > 0.5 ? 1 : 0, steer: 0, handbrake: true } // 停まったあとも踏み続けると後退するので、止まったらサイドブレーキだけ
      return stepVehicle(v, control, world, dt).vehicle
    }
    if (v.driver === 'none' && (Math.abs(v.speed) > 0.01 || Math.abs(v.slip) > 0.01)) return stepVehicle(v, idleControl(), world, dt).vehicle
    return v
  })

  // ---- 交通 ----
  const hazards: Hazard[] = [
    ...vehicles.map((v) => ({ x: v.x, z: v.z, r: VEHICLE_SPECS[v.kind].length * 0.45, id: v.id, heading: v.heading, speed: v.speed, edge: v.driver === 'traffic' ? v.route?.edge : undefined, parked: v.driver === 'none' })),
    ...peds.map((p) => ({ x: p.x, z: p.z, r: 0.4, id: -1 })),
  ]
  if (mode === 'foot') hazards.push({ x: player.x, z: player.z, r: 0.5, id: -1 })
  vehicles = vehicles.map((v) => (v.driver === 'traffic' ? stepTraffic(v, world, hazards, R.next, dt, t) : v))

  // ---- 車どうしの衝突（主人公の車と警察が、ほかの車を押す） ----
  for (const pusher of vehicles.filter((v) => v.driver === 'player' || v.driver === 'police')) {
    let a = vehicles.find((v) => v.id === pusher.id) ?? pusher
    for (const other of vehicles) {
      if (other.id === a.id) continue
      const hit = collideVehicles(a, other)
      if (!hit) continue
      a = hit.a
      // 強く当てられた交通の車は、道筋を外れて惰性で動く
      const knocked = other.driver === 'traffic' && hit.impact > 1.5
      vehicles = replaceById(vehicles, knocked ? { ...hit.b, driver: 'none', route: null } : other.driver === 'traffic' ? other : hit.b)
      // [traffic-peds] 弾かれた車の運転手は、降りて逃げる
      if (knocked && cfg.outfitKeys.length > 0) peds = [...peds, bailOut(world, hit.b, nextId++, cfg.outfitKeys[Math.floor(R.next() * cfg.outfitKeys.length)], a)]
      if (hit.impact > 2 && (a.driver === 'player' || other.driver === 'player')) {
        events.push({ type: 'crash', x: a.x, z: a.z, value: hit.impact, ref: String(other.id) })
      }
    }
    vehicles = replaceById(vehicles, a)
  }
  if (mode === 'drive') {
    const mine = vehicles.find((v) => v.id === player.vehicleId)
    if (mine) player = { ...player, x: mine.x, z: mine.z, speed: mine.speed }
  }

  // ---- 交通の出し直しと補充 ----
  vehicles = vehicles
    .filter((v) => !(v.driver === 'none' && Math.hypot(v.x - player.x, v.z - player.z) > 260))
    .map((v) => (needsRespawn(v, player) ? (spawnTraffic(world, v.id, player, R.next) ?? v) : v))
  if (frame % 20 === 0 && vehicles.filter((v) => v.driver === 'traffic').length < cfg.maxVehicles) {
    const v = spawnTraffic(world, nextId, player, R.next, 70)
    if (v) {
      vehicles = [...vehicles, v]
      nextId++
    }
  }

  // ---- 歩行者 ----
  const threats: PedThreat[] = vehicles
    .filter((v) => v.driver !== 'traffic' && Math.abs(v.speed) > 1)
    .map((v) => ({ x: v.x, z: v.z, r: VEHICLE_SPECS[v.kind].width * 0.6 + 0.3, speed: Math.abs(v.speed), heading: v.speed >= 0 ? v.heading : v.heading + Math.PI }))
  const heard = [...state.events, ...events]
  const copThreats = mode === 'drive' ? threats.filter((th) => Math.hypot(th.x - player.x, th.z - player.z) < 0.5) : []
  const copTarget = state.wanted.level === 0 ? null : state.wanted.unseen > 1 && state.wanted.lastSeen ? state.wanted.lastSeen : player
  peds = peds.map((p) => {
    // 徒歩の警官は通行人の動きを通さず、主人公（見失っていれば最後に見た場所）へ走らせる
    const stepped = p.cop ? stepOfficer(p, copTarget, world, copThreats, dt) : stepPed(p, world, threats, heard, R.next, dt, t)
    events.push(...stepped.events)
    return stepped.ped
  })
  peds = peds
    .filter((p) => p.route != null || !needsPedRespawn(p, player))
    .map((p) => (needsPedRespawn(p, player, world) ? (spawnPed(world, p.id, player, cfg.outfitKeys, R.next, 30) ?? p) : p))
  if (frame % 10 === 0 && peds.length < cfg.maxPeds) {
    const p = spawnPed(world, nextId, player, cfg.outfitKeys, R.next, 35)
    if (p) {
      peds = [...peds, p]
      nextId++
    }
  }

  // ---- 手配 ----
  const police = vehicles.filter((v) => v.driver === 'police')
  const officers = peds.filter((p) => p.cop)
  const sight = policeSees(world, police, player.x, player.z, officers)
  const judged = stepWanted(
    state.wanted,
    events,
    {
      policeDist: sight.dist,
      seen: sight.seen,
      playerSpeed: Math.abs(player.speed),
      x: player.x,
      z: player.z,
      changedOutfit,
      officerDist: sight.officerDist,
      policeIds: police.map((v) => v.id),
      driving: mode === 'drive',
    },
    dt,
  )
  // 警察車両ごとの役割と行き先（道沿いに追う・回り込む・道を塞ぐ・見失ったら捜す）
  let wanted = planPursuit(judged.wanted, police, player, sight.seen, world, dt)
  events.push(...judged.events)
  if (frame % 75 === 0 && police.length < policeWanted(wanted.level)) {
    const v = spawnPolice(world, nextId, player, R.next, { heading: player.heading, speed: player.speed, level: wanted.level, index: police.length })
    if (v) {
      vehicles = [...vehicles, v]
      nextId++
    }
  }
  // 徒歩の警官: 歩きの主人公を追い、止まった車を囲みに降りてくる
  if (frame % 50 === 25 && officers.length < officersWanted(wanted.level, mode, player.speed)) {
    const p = spawnOfficer(world, nextId, player, police, cfg.outfitKeys, R.next, mode)
    if (p) {
      peds = [...peds, p]
      nextId++
    }
  }
  peds = peds.filter((p) => !p.cop || !officerDone(p, player, wanted.level))
  if (wanted.level === 0) {
    // 手配が消えたら、遠くの警察車両は引き上げる
    vehicles = vehicles.filter((v) => v.driver !== 'police' || Math.hypot(v.x - player.x, v.z - player.z) < 70)
  }
  if (events.some((e) => e.type === 'busted')) {
    // 捕まったら、罰金を払って駅前から歩いてやり直す
    const home = world.resolveCircle(SPAWN.x, SPAWN.z, FOOT_TUNING.radius)
    vehicles = vehicles.filter((v) => v.driver !== 'police').map((v) => (v.driver === 'player' ? { ...v, driver: 'none' as const, speed: 0 } : v))
    player = { ...createPlayer(home.x, home.z, SPAWN.heading, world) }
    mode = 'foot'
    cash = Math.max(0, cash - BUST_FINE)
    wanted = createWanted()
    peds = peds.filter((p) => !p.cop)
  }

  // ---- ミッション ----
  const told = stepMissions(
    state.mission,
    { t, x: player.x, z: player.z, inVehicle: mode === 'drive', wantedLevel: wanted.level },
    events,
    dt,
  )
  events.push(...told.events)
  cash += told.reward
  // 逮捕・逃げ切りの決着の一言（ミッションの一言が出ていなければ）
  const verdict = wantedBanner(events, t)
  const mission = verdict && !(told.mission.banner && told.mission.banner.until > t) ? { ...told.mission, banner: verdict } : told.mission

  // ---- カメラ ----
  const camera =
    mode !== state.mode && events.some((e) => e.type === 'busted')
      ? createCamera(targetOf({ player, mode }))
      : // [onfoot] 降りてドアが閉まるまでは車を追わせる（引きの画のまま、立ってから背後へ寄る）
        stepCamera(state.camera, cameraSubject(player, mode, vehicles), input, world, dt, [
          ...peds,
          ...vehicles
            // [onfoot] 降りた直後（ドアが閉まるまで）も、いま降りた車はよけない（軸が車内から出る途中で急に寄らないように）
            .filter((v) => v.id !== player.vehicleId && v.id !== crowdExempt(player))
            .flatMap((v) => vehicleCrowd(v, VEHICLE_SPECS[v.kind].length, VEHICLE_SPECS[v.kind].width)),
        ])

  return {
    t,
    frame,
    seed: R.seed(),
    mode,
    player,
    vehicles,
    peds,
    camera,
    wanted,
    mission,
    outfit,
    cash,
    events,
    nextId,
  }
}

/** 描画と HUD が読む、部品をまたいだ導出（操作の案内、目印、ミッションの文言） */
export interface GtoView {
  canEnter: boolean
  canSteal: boolean
  markers: Marker[]
  missionTitle: string
  objective: string
  timeLeft: number | null
  banner: string
}

export function viewOf(state: GtoState): GtoView {
  const text = missionText(state.mission, state.t)
  return {
    canEnter: state.mode === 'foot' && findEnterable(state.player, state.vehicles) != null,
    canSteal: state.mode === 'foot' && findStealTarget(state.player, state.peds, state.outfit.wearing) != null,
    // [missions] まわりの車も渡す（「車をつかまえる」段で、手近な車に印を付けるため）
    markers: missionMarkers(state.mission, { x: state.player.x, z: state.player.z, vehicles: state.vehicles }),
    missionTitle: text.title,
    objective: text.objective,
    timeLeft: text.timeLeft,
    banner: text.banner,
  }
}
