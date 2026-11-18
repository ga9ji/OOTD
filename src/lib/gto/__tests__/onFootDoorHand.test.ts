// [onfoot] 第15ラウンド: 手とドアが一緒に動く（開ける・座って閉める・降りて押して閉める）。
import { describe, expect, it } from 'vitest'
import { dirOf } from '../math'
import { BOARD_TUNING, DOOR_BEATS, boardingPose, createPlayer, doorPoint, stepBoarding, stepOnFoot, type BoardingPose, type CarSize } from '../onFoot'
import { boardingAct } from '../onFootPose'
import { REST_RIG, rigBoarding, rigSeat, SEAT_RIG } from '../onFootRig'
import { createVehicle, VEHICLE_SPECS } from '../vehicle'
import type { BoardingPhase, InputFrame, PlayMode, PlayerState, VehicleState } from '../types'
import { DT, input, world } from './helpers'

const sizeOf = (v: VehicleState): CarSize => VEHICLE_SPECS[v.kind]
const ROAD = (() => {
  const road = world.nearestRoad(200, 150, true, 80)
  if (!road) throw new Error('road')
  return road
})()

interface Tick {
  t: number
  phase: BoardingPhase | null
  mode: PlayMode
  pose: BoardingPose | null
  p: PlayerState
  car: VehicleState
}

/** 乗る → 降りる を通しで回し、1歩ごとの姿を返す。stickFrom 秒目からスティックを倒す */
function record(seconds: number, presses: number[], stick: (t: number, phase: BoardingPhase | null) => Partial<InputFrame> = () => ({})): Tick[] {
  const f = dirOf(ROAD.heading)
  let p = createPlayer(ROAD.x - f.z * 3 - f.x * 0.5, ROAD.z + f.x * 3 - f.z * 0.5, ROAD.heading, world)
  let mode: PlayMode = 'foot'
  let vehicles: VehicleState[] = [createVehicle(1, 'sedan', ROAD.x, ROAD.z, ROAD.heading, world)]
  const out: Tick[] = []
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    const t = i * DT
    const inp = input({ ...stick(t, p.boarding?.phase ?? null), enter: presses.some((at) => Math.abs(at - t) < DT / 2) })
    const b = stepBoarding(p, mode, vehicles, sizeOf, inp, world, DT)
    p = b.mode === 'foot' ? stepOnFoot(b.player, inp, 0, world, [], DT) : b.player
    mode = b.mode
    vehicles = b.vehicles
    out.push({ t, phase: p.boarding?.phase ?? null, mode, pose: boardingPose(p, vehicles[0], sizeOf(vehicles[0])), p, car: vehicles[0] })
  }
  return out
}

const of = (ticks: Tick[], phase: BoardingPhase) => ticks.filter((k) => k.phase === phase)
const span = (ticks: Tick[]) => ticks.length * DT

describe('gto onFoot: 手がドアに届いてから、ドアが動く', () => {
  const ticks = record(12, [0, 6])

  it('開ける: 手を伸ばすあいだドアは閉じたまま。そのあと手の引きと同じ区間で開く。0.5 秒刻みのコマに開きかけが残る', () => {
    const open = of(ticks, 'open')
    expect(span(open)).toBeGreaterThanOrEqual(0.6)
    const reach = open.filter((k) => k.p.boarding!.t / BOARD_TUNING.open < DOOR_BEATS.openFrom - 0.02)
    expect(reach.length).toBeGreaterThan(8)
    for (const k of reach) expect(k.pose!.door).toBe(0)
    expect(open[open.length - 1].pose!.door).toBeGreaterThan(0.9)
    // 手を伸ばしきったとき（ドアが動き出す瞬間）、車の側の腕（右のドアでは左腕）は前へ上がり、輪郭の外へ開いている（斜め後ろから見える）
    const rig = rigBoarding('open', DOOR_BEATS.openFrom, 1)
    expect(rig.armL.swing).toBeGreaterThan(0.6)
    expect(rig.armL.splay).toBeGreaterThan(0.8)
    // 引くあいだに、開いてくるドアの縁を外の手が受ける
    expect(rigBoarding('open', 0.7, 1).armR.splay).toBeGreaterThan(0.4)
  })

  it('開けた手は、踏み込むあいだも開いたドアの縁に掛けたまま（腕を一度下ろさない）', () => {
    const end = rigBoarding('open', 1, 1)
    const stepIn = rigSeat(0, true)
    // 車の右のドア: 外の手は右手
    // 開いたドアの縁は体の斜め外。腕は外へ開いて輪郭の外に出ている
    expect(end.armR.splay).toBeGreaterThan(0.8)
    expect(stepIn.armR.splay).toBeGreaterThan(0.8)
    expect(Math.abs(end.armR.swing - stepIn.armR.swing)).toBeLessThan(0.3)
    expect(rigSeat(0.2, true).armR.splay).toBeGreaterThan(0.7)
  })

  it('座って閉める: 手を伸ばしてからドアが閉まり、半開き（0.15〜0.85）が 0.3 秒以上続く', () => {
    const shut = of(ticks, 'shut').filter((k) => k.p.boarding!.t <= BOARD_TUNING.shut)
    const before = shut.filter((k) => k.p.boarding!.t / BOARD_TUNING.shut < DOOR_BEATS.shutFrom - 0.02)
    expect(before.length).toBeGreaterThan(8)
    for (const k of before) expect(k.pose!.door).toBe(1)
    expect(span(shut.filter((k) => k.pose!.door > 0.15 && k.pose!.door < 0.85))).toBeGreaterThan(0.28)
    // 手を伸ばしきった瞬間は、外の腕が外へ開いている。閉まりきったら手元へ
    const reach = rigBoarding('shut', DOOR_BEATS.shutFrom, 1)
    const done = rigBoarding('shut', 1, 1)
    expect(reach.armR.splay).toBeGreaterThan(done.armR.splay + 0.4)
  })

  it('降りる: 座ったまま手で押してドアが開く（押す手が伸びるのと一緒に開く）', () => {
    const un = of(ticks, 'unlatch')
    expect(span(un)).toBeGreaterThanOrEqual(0.4)
    expect(un[0].pose!.door).toBe(0)
    expect(un[un.length - 1].pose!.door).toBeGreaterThan(0.45)
    const pushed = rigBoarding('unlatch', 1, 1)
    const idle = rigBoarding('unlatch', 0, 1)
    expect(pushed.armR.splay).toBeGreaterThan(idle.armR.splay + 0.4)
  })
})

describe('gto onFoot: 降りたらドアの横に立ち、手で押して閉める', () => {
  const ticks = record(12, [0, 6])
  const out = of(ticks, 'out')
  const push = out.filter((k) => k.p.boarding!.t > BOARD_TUNING.out)

  it('外へ出きってから、押して閉める間（0.6 秒以上）がある。そのあいだ体はドアの外に立ったまま動かない', () => {
    expect(span(push)).toBeGreaterThanOrEqual(0.6)
    const d = doorPoint(push[0].car, sizeOf(push[0].car), 1)
    for (const k of push) {
      expect(Math.hypot(k.pose!.x - d.x, k.pose!.z - d.z)).toBeLessThan(0.02)
      expect(k.pose!.sink).toBe(0)
      expect(k.mode).toBe('drive')
    }
  })

  it('押す手を掛けてからドアが閉まり、半開き（0.15〜0.85）が 0.3 秒以上続く。歩けるようになったときは閉まっている', () => {
    const early = push.filter((k) => (k.p.boarding!.t - BOARD_TUNING.out) / BOARD_TUNING.push < DOOR_BEATS.pushFrom - 0.02)
    expect(early.length).toBeGreaterThan(5)
    for (const k of early) expect(k.pose!.door).toBe(1)
    expect(span(push.filter((k) => k.pose!.door > 0.15 && k.pose!.door < 0.85))).toBeGreaterThan(0.3)
    const after = ticks[ticks.indexOf(out[out.length - 1]) + 1]
    expect(after.mode).toBe('foot')
    expect(after.pose?.door ?? 0).toBeLessThan(0.05)
  })

  it('姿勢は「押して閉める」を読む: 押している最中は外の腕が前へ伸びている。押し終えたら下ろす', () => {
    const mid = push[Math.floor(push.length * 0.55)]
    const act = boardingAct(mid.p.boarding!)
    expect(act.phase).toBe('leave')
    expect(act.k).toBeGreaterThan(0.4)
    expect(act.k).toBeLessThan(0.7)
    const rig = rigBoarding(act.phase, act.k, 1)
    // 肩の高さまでは上げない（R17: 腕を水平に突き出したまま固まって見えた）
    expect(rig.armR.swing).toBeGreaterThan(0.75)
    expect(rig.armR.swing).toBeLessThan(1.1)
    const done = rigBoarding('leave', 1, 1)
    expect(done.armR.swing).toBeLessThan(0.3)
    // 歩ける段階（leave）は、腕を下ろした姿
    expect(boardingAct({ phase: 'leave', vehicleId: 1, side: 1, t: 0.1, jack: false }).k).toBe(1)
  })

  it('押している途中でスティックを倒せば、すぐ歩き出せる。ドアはその開き具合から続けて閉まる（跳ばない）', () => {
    const skipped = record(12, [0, 6], (_t, phase) => (phase === 'out' || phase === 'leave' ? { moveY: 1 } : {}))
    const sOut = of(skipped, 'out')
    const sPush = sOut.filter((k) => k.p.boarding!.t > BOARD_TUNING.out)
    // 体が出きる前は、スティックでは抜けない
    expect(span(sOut)).toBeGreaterThanOrEqual(BOARD_TUNING.out - DT)
    expect(span(sPush)).toBeLessThan(0.1)
    const i = skipped.indexOf(sOut[sOut.length - 1])
    expect(skipped[i + 1].phase).toBe('leave')
    let prev = skipped[i].pose!.door
    for (let j = i + 1; skipped[j].phase === 'leave'; j++) {
      const door = skipped[j].pose!.door
      expect(door).toBeLessThanOrEqual(prev + 1e-6)
      expect(prev - door).toBeLessThan(0.2)
      prev = door
    }
    expect(prev).toBeLessThan(0.1)
  })
})

describe('gto onFoot: 開口を通るあいだは屈んでいる（直立のまま車体や敷居に重ならない）', () => {
  const ticks = record(12, [0, 6])

  it('降りるとき: 車体の外へ出た体が開口の前（ドアの外に立つ位置より車体寄り）にいるあいだ、上体は倒れている', () => {
    const out = of(ticks, 'out').filter((k) => k.p.boarding!.t <= BOARD_TUNING.out)
    const car = out[0].car
    const d = doorPoint(car, sizeOf(car), 1)
    const near = out.filter((k) => k.pose!.inside < 0.5 && Math.hypot(k.pose!.x - d.x, k.pose!.z - d.z) > 0.25)
    expect(near.length).toBeGreaterThan(5)
    for (const k of near) {
      const act = boardingAct(k.p.boarding!)
      const rig = rigBoarding(act.phase, act.k, 1)
      expect(rig.lean).toBeGreaterThan(SEAT_RIG.lean * 0.45)
      expect(rig.hip).toBeLessThan(REST_RIG.hip - 0.03)
    }
  })
})
