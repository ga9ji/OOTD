// [部品: vehicle] 車体の姿勢（ロール・ピッチ）と、タイヤの痕・煙の出方のテスト。
// バーの実物（旋回中も四輪は路面に付いたまま、外側のばねが縮んで車体が外へ 4〜9° 傾き、鼻が沈み、後輪から煙が流れて路面に痕が残る）を数値で確かめる。
import { describe, expect, it } from 'vitest'
import { createVehicle, VEHICLE_SPECS } from '../vehicle'
import { attitudeTarget, bodyPose, frontWheelAngle, restWheelLook, stepWheelLook, restAttitude, rollShift, slideShake, stepAttitude, VEHICLE_ATTITUDE, wheelTrails } from '../vehicleAttitude'
import type { GtoWorld, VehicleState } from '../types'

const DT = 1 / 60
const DEG = Math.PI / 180
const flat = { groundY: () => 0 } as unknown as GtoWorld
const car = (over: Partial<VehicleState> = {}): VehicleState => ({ ...createVehicle(1, 'sedan', 0, 0, 0, flat), driver: 'player', ...over })

/** 同じ車の状態のまま seconds 秒ばねを進める */
const settle = (v: VehicleState, seconds: number) => {
  let a = restAttitude()
  let peakRoll = 0
  let peakPitch = 0
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    a = stepAttitude(a, attitudeTarget(v), DT)
    peakRoll = Math.max(peakRoll, Math.abs(a.roll))
    peakPitch = Math.max(peakPitch, Math.abs(a.pitch))
  }
  return { a, peakRoll, peakPitch }
}

describe('gto vehicleAttitude: ロール', () => {
  it('まっすぐ一定の速さで走っていれば傾かない', () => {
    const { a } = settle(car({ speed: 20 }), 1)
    expect(Math.abs(a.roll)).toBeLessThan(0.001)
    expect(Math.abs(a.pitch)).toBeLessThan(0.001)
  })

  it('右へ曲がると左（外側）へ、左へ曲がると右へ傾く', () => {
    expect(attitudeTarget(car({ speed: 12, yawRate: 0.8 })).roll).toBeGreaterThan(2 * DEG)
    expect(attitudeTarget(car({ speed: 12, yawRate: -0.8 })).roll).toBeLessThan(-2 * DEG)
  })

  it('街なかの切り返しで 3〜5.5°、ドリフト中は 11.5° 以上傾き、行き過ぎても 14.5° は超えない（背後の小さなコマで屋根とバンパーの線が斜めに読める角度）', () => {
    const turn = settle(car({ speed: 12, yawRate: 0.45 }), 1).a.roll
    expect(turn).toBeGreaterThan(3 * DEG)
    expect(turn).toBeLessThan(5.5 * DEG)
    const drift = settle(car({ speed: 9, yawRate: 2, slip: -8 }), 1)
    expect(drift.a.roll).toBeGreaterThan(11.5 * DEG)
    expect(drift.peakRoll).toBeLessThanOrEqual(14.5 * DEG)
  })

  it('四輪は接地したまま車体が外へ倒れ込む: どの旋回・横滑りでも、内側の裾の浮きは 21cm 以下、外側の沈みは 17cm 以下（裾が路面を擦らない）', () => {
    const cases = [car({ speed: 12, yawRate: 0.45 }), car({ speed: 16, yawRate: 1.2 }), car({ speed: 9, yawRate: 2, slip: -8 }), car({ speed: 6, slip: 9 }), car({ speed: 20, yawRate: -1.6, slip: 12 })]
    for (const v of cases) {
      let a = restAttitude()
      for (let i = 0; i < 120; i++) {
        a = stepAttitude(a, attitudeTarget(v), DT)
        const pose = bodyPose({ ...a, pitch: 0 }, 0.79, 1.35)
        const side = Math.tan(Math.abs(pose.roll)) * 0.79
        const outer = side - pose.heave
        const inner = side + pose.heave
        expect(inner).toBeLessThanOrEqual(0.21)
        expect(outer).toBeLessThanOrEqual(0.17)
      }
    }
  })

  it('背後のカメラに見えるのは旋回の内側: ドリフト中は内側の裾が 15cm 以上持ち上がって車体の底が見え、外側は 10cm 以上沈む（タイヤが下がるのではなく車体が倒れる）', () => {
    const pose = bodyPose({ ...settle(car({ speed: 9, yawRate: 2, slip: -8 }), 1.5).a, pitch: 0 }, 0.79, 1.35)
    const side = Math.tan(Math.abs(pose.roll)) * 0.79
    expect(side + pose.heave).toBeGreaterThan(0.15)
    expect(side - pose.heave).toBeGreaterThan(0.1)
  })

  it('上限で頭打ちにならず、旋回がきついほど・滑りが大きいほど深く傾く（進入 → 最大 → 戻りで量が変わる）', () => {
    const turn = (lat: number) => attitudeTarget(car({ speed: 15, yawRate: lat / 15 })).roll / DEG
    expect(turn(16) - turn(8)).toBeGreaterThan(0.4)
    expect(turn(8) - turn(4)).toBeGreaterThan(0.8)
    const slide = (slip: number) => attitudeTarget(car({ speed: 10, yawRate: 0.8, slip: -slip })).roll / DEG
    expect(slide(9) - slide(4)).toBeGreaterThan(0.12)
    expect(slide(9)).toBeLessThanOrEqual(14.5)
  })

  it('横滑りだけでも滑っていく側へ傾く（向きが回り終わっても、流れているあいだは傾いたまま）', () => {
    // 右が＋。左へ流れている＝外側は左
    expect(attitudeTarget(car({ speed: 6, slip: -7 })).roll).toBeGreaterThan(2 * DEG)
    expect(attitudeTarget(car({ speed: 6, slip: 7 })).roll).toBeLessThan(-2 * DEG)
  })

  it('ロールは遅れて付く: 0.25 秒ではまだ目標の 3〜6.5 割（切り始めのコマは浅い）、0.7 秒以内に目標へ届き、少し行き過ぎる', () => {
    const v = car({ speed: 12, yawRate: 0.6 })
    const target = attitudeTarget(v).roll
    expect(settle(v, 0.05).a.roll).toBeLessThan(target * 0.5)
    expect(settle(v, 0.25).a.roll).toBeGreaterThan(target * 0.3)
    expect(settle(v, 0.25).a.roll).toBeLessThan(target * 0.65)
    const half = settle(v, 0.7)
    expect(half.peakRoll).toBeGreaterThan(target)
    expect(half.peakRoll).toBeLessThan(target * 1.4)
    expect(Math.abs(settle(v, 2.5).a.roll - target)).toBeLessThan(0.004)
  })
})

describe('gto vehicleAttitude: ピッチ', () => {
  it('加速で尻が沈み（＋）、ブレーキで鼻が沈む（−）。全開の発進は 3° 以上、急ブレーキは 5° 以上', () => {
    expect(attitudeTarget(car({ speed: 5, accel: 10 })).pitch).toBeGreaterThan(3 * DEG)
    expect(attitudeTarget(car({ speed: 20, accel: -17 })).pitch).toBeLessThan(-5 * DEG)
  })

  it('横滑り中は鼻がわずかに沈む（バーの実測: 真横のコマで裾の線が路面に対して前下がり 1.3〜2.6°。小さなコマでも屋根線が水平に見えないよう上の端へ寄せる）', () => {
    for (const slip of [7, -7]) {
      const pitch = attitudeTarget(car({ speed: 8, slip })).pitch
      expect(pitch).toBeLessThan(-2.2 * DEG)
      expect(pitch).toBeGreaterThan(-3.2 * DEG)
    }
    expect(Math.abs(attitudeTarget(car({ speed: 8, slip: 2 })).pitch)).toBeLessThan(0.5 * DEG)
  })

  it('上限を超えない', () => {
    const { peakPitch } = settle(car({ speed: 20, accel: -60, slip: 12 }), 1)
    expect(peakPitch).toBeLessThanOrEqual(VEHICLE_ATTITUDE.pitchMax * 1.3)
  })

  it('急ブレーキでは車体の真ん中が 1.5cm 以上下がる。旋回とドリフトでは内側が大きく浮くぶん真ん中は少し上がるが 4cm まで（車ごと浮いて見えない）', () => {
    const pose = (v: VehicleState) => bodyPose(settle(v, 1.5).a, 0.79, 1.35)
    expect(pose(car({ speed: 20, accel: -17 })).heave).toBeLessThan(-0.015)
    expect(pose(car({ speed: 20, accel: -17 })).heave).toBeGreaterThan(-0.2)
    for (const v of [car({ speed: 9, yawRate: 2, slip: -8 }), car({ speed: 16, yawRate: 1.2 })]) {
      expect(pose(v).heave).toBeLessThan(0.04)
      expect(pose(v).heave).toBeGreaterThan(-0.1)
    }
    expect(bodyPose(restAttitude(), 0.79, 1.35).heave).toBeCloseTo(0, 9)
  })

  it('きつい旋回では外側の裾が 10cm 以上沈み（ロール 9〜13.5°。外側のタイヤがフェンダーに潜る）、内側の裾は 12〜21cm 上がる', () => {
    const pose = bodyPose(settle(car({ speed: 16, yawRate: 1.2 }), 1.5).a, 0.79, 1.35)
    const side = Math.tan(Math.abs(pose.roll)) * 0.79
    expect(Math.abs(pose.roll)).toBeGreaterThan(9 * DEG)
    expect(Math.abs(pose.roll)).toBeLessThan(13.5 * DEG)
    expect(side - pose.heave).toBeGreaterThan(0.1)
    expect(side - pose.heave).toBeLessThanOrEqual(VEHICLE_ATTITUDE.rollSink + VEHICLE_ATTITUDE.loadDrop + 1e-9)
    expect(side + pose.heave).toBeGreaterThan(0.12)
    expect(side + pose.heave).toBeLessThanOrEqual(0.21)
  })

  it('街なかの切り返し（横向き 5m/s²）でも外側が 4cm 以上沈み、内側は 3〜9cm 上がる', () => {
    const pose = bodyPose(settle(car({ speed: 8.5, yawRate: 0.6 }), 1.5).a, 0.79, 1.35)
    const side = Math.tan(Math.abs(pose.roll)) * 0.79
    expect(side - pose.heave).toBeGreaterThan(0.04)
    expect(side + pose.heave).toBeGreaterThan(0.03)
    expect(side + pose.heave).toBeLessThan(0.09)
  })

  it('急ブレーキでは鼻が 15cm 以上沈み、尻は 5cm までしか浮かない', () => {
    const pose = bodyPose(settle(car({ speed: 20, accel: -17 }), 1.5).a, 0.79, 1.35)
    const end = Math.tan(Math.abs(pose.pitch)) * 1.35
    expect(end - pose.heave).toBeGreaterThan(0.15)
    expect(end + pose.heave).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  it('ドリフト中は前の外側の隅がいちばん沈み（15cm 以上）、後ろの内側の隅がいちばん高く残る（後ろのタイヤハウスが開く）', () => {
    const pose = bodyPose(settle(car({ speed: 9, yawRate: 2, slip: -8 }), 1.5).a, 0.79, 1.35)
    const side = Math.tan(Math.abs(pose.roll)) * 0.79
    const end = Math.tan(-pose.pitch) * 1.35
    expect(end).toBeGreaterThan(0.01)
    expect(side + end - pose.heave).toBeGreaterThan(0.15)
    expect(pose.heave + side + end).toBeLessThanOrEqual(VEHICLE_ATTITUDE.liftMax + 1e-9)
  })

  it('車輪の上に載せる傾き: 旋回とドリフトは 9〜13.5°、急ブレーキ 4.5° 以上、発進 3° 以上', () => {
    const pose = (v: VehicleState) => bodyPose(settle(v, 1.5).a, 0.79, 1.35)
    for (const v of [car({ speed: 16, yawRate: 1.2 }), car({ speed: 9, yawRate: 2, slip: -8 })]) {
      expect(pose(v).roll).toBeGreaterThan(9 * DEG)
      expect(pose(v).roll).toBeLessThan(13.5 * DEG)
    }
    expect(pose(car({ speed: 20, accel: -17 })).pitch).toBeLessThan(-4.5 * DEG)
    expect(pose(car({ speed: 4, accel: 11 })).pitch).toBeGreaterThan(3 * DEG)
  })

  it('旋回と急ブレーキが重なっても、四隅は sinkMax より沈まず（裾が路面を擦らない）、liftMax より浮かない（車輪は路面、車体だけが動く）', () => {
    const HALF_TRACK = 0.79
    const HALF_BASE = 1.35
    const cases = [car({ speed: 9, yawRate: 2.4, slip: -9 }), car({ speed: 20, accel: -40 }), car({ speed: 14, yawRate: -1.6, slip: 8, accel: -30 }), car({ speed: 3, accel: 11 })]
    for (const v of cases) {
      let a = restAttitude()
      let lift = 0
      let sink = 0
      for (let i = 0; i < 90; i++) {
        a = stepAttitude(a, attitudeTarget(v), DT)
        const pose = bodyPose(a, HALF_TRACK, HALF_BASE)
        const side = Math.tan(Math.abs(pose.roll)) * HALF_TRACK
        const end = Math.tan(Math.abs(pose.pitch)) * HALF_BASE
        lift = Math.max(lift, pose.heave + side + end)
        sink = Math.max(sink, side + end - pose.heave)
      }
      expect(lift).toBeLessThanOrEqual(VEHICLE_ATTITUDE.liftMax + 1e-9)
      expect(sink).toBeLessThanOrEqual(VEHICLE_ATTITUDE.sinkMax + 1e-9)
      // どの場合も 10cm 以上は沈む（画面で読める量）
      expect(sink).toBeGreaterThan(0.1)
    }
  })

  it('ロールの軸は接地面: 左へ傾けば（＋）車体は左（−x）へずれ、9° で車軸の高さ 0.34m なら 5cm 前後', () => {
    expect(rollShift(0, 0.34)).toBeCloseTo(0, 9)
    expect(rollShift(9 * DEG, 0.34)).toBeLessThan(-0.045)
    expect(rollShift(9 * DEG, 0.34)).toBeGreaterThan(-0.06)
    expect(rollShift(-9 * DEG, 0.34)).toBeCloseTo(-rollShift(9 * DEG, 0.34), 9)
  })
})

describe('gto vehicleAttitude: 滑っているあいだの揺れ', () => {
  it('滑っていなければ揺れない', () => {
    for (const t of [0, 0.3, 1.7]) expect(slideShake(car({ speed: 14 }), t)).toEqual({ pitch: 0, roll: 0, heave: 0 })
    expect(slideShake(car({ speed: 0, slip: 3 }), 0.4)).toEqual({ pitch: 0, roll: 0, heave: 0 })
  })

  it('大きく滑っているあいだは、ロールが 1 秒のうちに 0.3° 以上行き来し、8fps の隣り合うコマでも 0.08° 以上違う（板のように止まって見えない）', () => {
    const v = car({ speed: 9, slip: -7, yawRate: 1.2 })
    const rolls = Array.from({ length: 9 }, (_, i) => slideShake(v, 3 + i / 8).roll)
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(0.3 * DEG)
    const steps = rolls.slice(1).map((r, i) => Math.abs(r - rolls[i]))
    expect(steps.filter((d) => d > 0.08 * DEG).length).toBeGreaterThanOrEqual(5)
  })

  it('揺れは小さい（ロール 0.6° 以内、ピッチ 0.5° 以内、上下 1.2cm 以内。車体が箱ごと揺すられて見えない）。滑りが大きいほど大きい', () => {
    const big = car({ speed: 9, slip: 9 })
    const small = car({ speed: 9, slip: 3.2 })
    let peakBig = 0
    let peakSmall = 0
    for (let i = 0; i < 600; i++) {
      const s = slideShake(big, i / 60)
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(0.6 * DEG)
      expect(Math.abs(s.pitch)).toBeLessThanOrEqual(0.5 * DEG)
      expect(Math.abs(s.heave)).toBeLessThanOrEqual(0.012)
      peakBig = Math.max(peakBig, Math.abs(s.roll))
      peakSmall = Math.max(peakSmall, Math.abs(slideShake(small, i / 60).roll))
    }
    expect(peakBig).toBeGreaterThan(peakSmall * 1.5)
  })

  it('車ごとに揺れの拍がずれる', () => {
    const a = slideShake(car({ id: 1, speed: 9, slip: 7 }), 2)
    const b = slideShake(car({ id: 2, speed: 9, slip: 7 }), 2)
    expect(a.roll).not.toBeCloseTo(b.roll, 4)
  })
})

describe('gto vehicleAttitude: 純粋さ', () => {
  it('渡した姿勢を書き換えない', () => {
    const a = restAttitude()
    const copy = { ...a }
    stepAttitude(a, { pitch: 0.05, roll: 0.1 }, DT)
    expect(a).toEqual(copy)
  })
})

describe('gto vehicleAttitude: タイヤの痕と煙', () => {
  const spec = VEHICLE_SPECS.sedan

  it('ふつうに走る・曲がるだけなら何も出ない', () => {
    for (const v of [car({ speed: 14 }), car({ speed: 12, yawRate: 0.6, slip: -0.8 }), car({ speed: 20, accel: -6 })]) {
      const t = wheelTrails(v, spec)
      expect(t.rear || t.front).toBe(false)
      expect(t.smoke).toBe(0)
    }
  })

  it('後ろが流れ始めたら後輪に痕と煙、大きく滑ったら四輪とも痕が付く', () => {
    const small = wheelTrails(car({ speed: 12, slip: -3.2 }), spec)
    expect(small.rear).toBe(true)
    expect(small.front).toBe(false)
    expect(small.smoke).toBeGreaterThan(10)
    const big = wheelTrails(car({ speed: 6, slip: -9 }), spec)
    expect(big.rear && big.front).toBe(true)
    expect(big.smoke).toBeGreaterThan(small.smoke)
    expect(big.smoke).toBeLessThanOrEqual(VEHICLE_ATTITUDE.smokeMax)
  })

  it('急ブレーキで四輪が鳴き、全開の発進で後輪が空転する（交通の車は空転しない）', () => {
    const lock = wheelTrails(car({ speed: 18, accel: -15 }), spec)
    expect(lock.rear && lock.front).toBe(true)
    const spin = wheelTrails(car({ speed: 3, accel: 10 }), spec)
    expect(spin.rear).toBe(true)
    expect(spin.front).toBe(false)
    expect(spin.smoke).toBeGreaterThan(0)
    expect(wheelTrails(car({ speed: 3, accel: 10, driver: 'traffic' }), spec).rear).toBe(false)
  })

  it('滑っていなくても、きつい旋回（横向き 10m/s² 以上）では後輪が鳴いて薄い痕と薄い煙を出す。交通の車は出さない', () => {
    const squeal = wheelTrails(car({ speed: 8.5, yawRate: 1.4 }), spec)
    expect(squeal.cause).toBe('corner')
    expect(squeal.rear).toBe(true)
    expect(squeal.front).toBe(false)
    expect(squeal.smoke).toBeGreaterThan(4)
    expect(squeal.smoke).toBeLessThan(VEHICLE_ATTITUDE.smokeBase)
    expect(squeal.strength).toBeLessThan(0.6)
    expect(wheelTrails(car({ speed: 8.5, yawRate: 1.4, driver: 'traffic' }), spec).rear).toBe(false)
    expect(wheelTrails(car({ speed: 8.5, yawRate: 1.0 }), spec).rear).toBe(false)
  })

  it('止まっていれば、横滑りの値が残っていても出ない', () => {
    expect(wheelTrails(car({ speed: 0.5, slip: 2.5 }), spec).rear).toBe(false)
  })

  it('滑りが大きいほど濃い（0..1）', () => {
    const a = wheelTrails(car({ speed: 10, slip: 3 }), spec).strength
    const b = wheelTrails(car({ speed: 10, slip: 8 }), spec).strength
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThanOrEqual(1)
  })
})

describe('gto vehicleAttitude: 前輪の見た目の切れ角', () => {
  const MAX = VEHICLE_ATTITUDE.steerLook
  it('滑っていなければ舵のとおりに切れる（右いっぱいで ＋steerLook、左で −）', () => {
    expect(frontWheelAngle(car({ speed: 12, steer: 1 }))).toBeCloseTo(MAX, 6)
    expect(frontWheelAngle(car({ speed: 12, steer: -0.5 }))).toBeCloseTo(-MAX * 0.5, 6)
    expect(frontWheelAngle(car({ speed: 0, steer: 0 }))).toBe(0)
  })

  it('ドリフト中は進んでいく側へ向く（車体が右を向いて左へ流れていれば、舵が右のままでも前輪は左＝逆に切れる）。進む向きの 6 割まで（背後のカメラに、見えている側のホイールの面が残る）', () => {
    // 右旋回で尻が流れた: 車体に対して左（slip −）へ 8m/s、前へ 9m/s
    const angle = frontWheelAngle(car({ speed: 9, slip: -8, steer: 0.6, yawRate: 1.5 }))
    expect(angle).toBeLessThan(-20 * DEG)
    expect(angle).toBeGreaterThanOrEqual(-VEHICLE_ATTITUDE.steerLookMax - 1e-9)
    // 進む向き（41.6°）より 12° 以上浅い: 車体の見えている側面と前輪の面が同じ側を向いたまま、角度だけが違って見える
    expect(Math.abs(angle)).toBeLessThan(Math.atan2(8, 9) - 12 * DEG)
    // 左右対称
    expect(frontWheelAngle(car({ speed: 9, slip: 8, steer: -0.6, yawRate: -1.5 }))).toBeCloseTo(-angle, 6)
  })

  it('滑り始めの手前では舵のまま。滑りが深まるにつれて連続して逆へ移る（途中で跳ばない）', () => {
    const from = VEHICLE_ATTITUDE.slideStart
    expect(frontWheelAngle(car({ speed: 12, slip: -from * 0.9, steer: 1 }))).toBeCloseTo(MAX, 6)
    let prev = frontWheelAngle(car({ speed: 12, slip: -from, steer: 1 }))
    for (let slip = from; slip <= 10; slip += 0.25) {
      const now = frontWheelAngle(car({ speed: 12, slip: -slip, steer: 1 }))
      expect(Math.abs(now - prev)).toBeLessThan(6 * DEG)
      expect(now).toBeLessThanOrEqual(prev + 1e-9)
      prev = now
    }
    expect(prev).toBeLessThan(-15 * DEG)
  })

  it('止まりかけ（速さ 4m/s 未満）では逆へ切らない', () => {
    expect(frontWheelAngle(car({ speed: 1, slip: -3, steer: 1 }))).toBeCloseTo(MAX, 6)
  })
})

describe('gto vehicleAttitude: 前輪の切れ角の追従（立て直しのあいだ逆に切れたまま残る）', () => {
  const run = (from: ReturnType<typeof restWheelLook>, v: VehicleState, seconds: number) => {
    let look = from
    for (let i = 0; i < Math.round(seconds / DT); i++) look = stepWheelLook(look, v, DT)
    return look
  }
  it('切り込みには 0.15 秒で付いていく', () => {
    const look = run(restWheelLook(), car({ speed: 12, steer: 1 }), 0.15)
    expect(look.angle).toBeGreaterThan(VEHICLE_ATTITUDE.steerLook * 0.85)
  })
  it('滑っていなかった車は、舵を戻せば 0.15 秒で前輪も戻る', () => {
    const turned = run(restWheelLook(), car({ speed: 12, steer: 1 }), 0.5)
    expect(Math.abs(run(turned, car({ speed: 12, steer: 0 }), 0.15).angle)).toBeLessThan(5 * DEG)
  })
  it('ドリフトから立て直すあいだは、滑りが収まって 0.3 秒たっても前輪が 8° 以上逆に切れたまま残り、1.5 秒後には戻っている', () => {
    const sliding = run(restWheelLook(), car({ speed: 9, slip: -8, steer: 0.6 }), 0.5)
    expect(sliding.angle).toBeLessThan(-20 * DEG)
    const straight = car({ speed: 11, slip: -0.5, steer: 0 })
    expect(run(sliding, straight, 0.3).angle).toBeLessThan(-8 * DEG)
    expect(Math.abs(run(sliding, straight, 1.5).angle)).toBeLessThan(2 * DEG)
  })
  it('反対側へ振り返すときは待たずに付いていく（残るのは戻りだけ）', () => {
    const sliding = run(restWheelLook(), car({ speed: 9, slip: -8, steer: 0.6 }), 0.5)
    expect(run(sliding, car({ speed: 9, slip: 8, steer: -0.6 }), 0.15).angle).toBeGreaterThan(10 * DEG)
  })
  it('渡した状態を書き換えない', () => {
    const look = restWheelLook()
    stepWheelLook(look, car({ speed: 9, slip: -8, steer: 0.6 }), DT)
    expect(look).toEqual(restWheelLook())
  })
})
