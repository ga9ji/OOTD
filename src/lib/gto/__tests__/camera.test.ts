import { describe, expect, it } from 'vitest'
import { CAMERA_TUNING, createCamera, moveFrame, stepCamera, vehicleCrowd, viewFov, type CameraTarget } from '../camera'
import { angleDiff, DEG, dirOf } from '../math'
import type { CameraState, GtoWorld } from '../types'
import { DT, input, run, start, world } from './helpers'

/** 建物も坂も無い、まっ平らな世界（画面内の位置だけを確かめる） */
const flat: GtoWorld = {
  ...world,
  groundY: () => 0,
  insideBuilding: () => false,
  segmentClear: () => 1,
  resolveCircle: (x, z) => ({ x, z, hit: false, nx: 0, nz: 0 }),
}

/** x < wallX が全部建物の世界（壁際の詰め方を確かめる） */
const walled = (wallX: number): GtoWorld => {
  const inside = (x: number) => x < wallX
  return {
    ...flat,
    insideBuilding: (x) => inside(x),
    segmentClear: (ax, az, bx, bz) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5))
      for (let s = 1; s <= steps; s++) if (inside(ax + ((bx - ax) * s) / steps)) return (s - 1) / steps
      return 1
    },
  }
}

const foot: CameraTarget = { x: 0, y: 0, z: 0, heading: 0, speed: 0, mode: 'foot' }
const car: CameraTarget = { ...foot, mode: 'drive' }

/** 世界の点が画面のどこに映るか（左上が 0,0、右下が 1,1）。aspect は横/縦 */
function project(cam: CameraState, px: number, py: number, pz: number, aspect = 16 / 9) {
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2])
    return v.map((c) => c / l)
  }
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const f = norm([cam.tx - cam.x, cam.ty - cam.y, cam.tz - cam.z])
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  const d = [px - cam.x, py - cam.y, pz - cam.z]
  const depth = dot(d, f)
  const t = Math.tan((cam.fov * DEG) / 2)
  return { x: 0.5 + dot(d, r) / depth / (2 * t * aspect), y: 0.5 - dot(d, u) / depth / (2 * t), depth }
}

/** 地平線（はるか前方の地面）の画面内の高さ */
const horizonY = (cam: CameraState) => {
  const d = dirOf(cam.yaw)
  return project(cam, cam.x + d.x * 1e5, 0, cam.z + d.z * 1e5).y
}

const settle = (t: CameraTarget, w: GtoWorld, seconds = 3, from = createCamera(t)) => {
  let cam = from
  for (let i = 0; i < seconds / DT; i++) cam = stepCamera(cam, t, input(), w, DT)
  return cam
}

describe('gto camera: 画面内の占有率（バーの実測）', () => {
  // バーは 4:3。16:9 では占有率を画面の高さに対して合わせ、足の下と車の下に路面を残す（全身・全周が見える）
  it('徒歩: 頭より上から見下ろし、くり抜きの絵（板 1.74m の中の 0.14〜1.67m）が画面高の 33〜39%、頭 42〜48%・足 78〜84%・地平線 38〜44%', () => {
    const cam = settle(foot, flat)
    const head = project(cam, 0, 1.67, 0).y
    const feet = project(cam, 0, 0.14, 0).y
    expect(feet - head).toBeGreaterThan(0.33)
    expect(feet - head).toBeLessThan(0.39)
    expect(head).toBeGreaterThan(0.42)
    expect(head).toBeLessThan(0.48)
    // 足の下に路面が 16% 以上残る（比較用に上下 8% を切り落としても足が切れない）
    expect(feet).toBeGreaterThan(0.78)
    expect(feet).toBeLessThan(0.84)
    expect(horizonY(cam)).toBeGreaterThan(0.38)
    expect(horizonY(cam)).toBeLessThan(0.44)
    // カメラは頭（1.67m）より上、距離は 3.8m 以上
    expect(cam.y).toBeGreaterThan(1.75)
    expect(Math.hypot(cam.x, cam.z)).toBeGreaterThan(3.8)
    // 主人公の 3m 先の路面が、頭のすぐ上ではなく肩より下に見える（体の左右から進む先の足元が読める）
    expect(project(cam, 0.8, 0, -3).y).toBeGreaterThan(head + 0.1)
  })

  it('運転: 車幅 1.8m が画面高の 33〜38%（16:9 の幅の 19〜21%）、後端の真下の地面が 80〜88%、地平線 45〜49%', () => {
    const cam = settle(car, flat)
    // セダン（長さ 4.6m・幅 1.8m）の後端。前は −z
    const left = project(cam, -0.9, 0, 2.3)
    const right = project(cam, 0.9, 0, 2.3)
    expect(right.x - left.x).toBeGreaterThan(0.185)
    expect(right.x - left.x).toBeLessThan(0.215)
    // 後端の真下の地面の下に、まだ路面が 1 割強見える（リアバンパーが画面の下端に付かない）
    expect(left.y).toBeGreaterThan(0.8)
    expect(left.y).toBeLessThan(0.88)
    expect(horizonY(cam)).toBeGreaterThan(0.45)
    expect(horizonY(cam)).toBeLessThan(0.49)
    // 屋根（高さ 1.45m、車の中ほど）は地平線より下に見える
    expect(project(cam, 0, 1.45, 0).y).toBeGreaterThan(horizonY(cam) + 0.04)
  })

  /** 相手を速さ speed でまっすぐ seconds 秒走らせ、そのあいだのカメラを返す */
  const cruise = (from: CameraState, t0: CameraTarget, speed: number, seconds: number) => {
    let cam = from
    let t = { ...t0, speed }
    const cams: CameraState[] = []
    for (let i = 0; i < seconds / DT; i++) {
      t = { ...t, z: t.z - t.speed * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
      cams.push(cam)
    }
    return { cam, t, cams }
  }
  const rangeOf = (cam: CameraState, t: CameraTarget) => Math.hypot(cam.x - t.x, cam.z - t.z)

  it('速度で画角は変えない。距離は速いほど少しだけ伸びる（街なかの速さで 0.4〜0.8m、全開でも 1.3m まで）', () => {
    const slow = settle({ ...car, speed: 0 }, flat)
    const base = rangeOf(slow, car)
    const city = cruise(slow, car, 14, 3)
    expect(city.cam.fov).toBeCloseTo(slow.fov, 3)
    expect(rangeOf(city.cam, city.t) - base).toBeGreaterThan(0.4)
    expect(rangeOf(city.cam, city.t) - base).toBeLessThan(0.8)
    const fast = cruise(slow, car, 40, 3)
    expect(rangeOf(fast.cam, fast.t) - base).toBeGreaterThan(1)
    expect(rangeOf(fast.cam, fast.t) - base).toBeLessThan(1.31)
  })

  it('運転: 発進すると車が先へ出て（1 秒かけて離れる）、衝突で急に止まるとカメラが 0.3〜0.8 秒かけて詰める（1コマで飛ばない）', () => {
    const slow = settle({ ...car, speed: 0 }, flat)
    const base = rangeOf(slow, car)
    const go = cruise(slow, car, 25, 3)
    // 走り出して 0.2 秒ではまだほとんど離れていない
    expect(rangeOf(go.cams[12], { ...car, z: -25 * DT * 13 }) - base).toBeLessThan(0.5)
    const far = rangeOf(go.cam, go.t) - base
    expect(far).toBeGreaterThan(0.9)
    // 急停止（壁に当たった）
    const stopped = { ...go.t, speed: 0 }
    let cam = go.cam
    let back = Infinity
    for (let i = 1; i < 180; i++) {
      const next = stepCamera(cam, stopped, input(), flat, DT)
      expect(Math.abs(rangeOf(next, stopped) - rangeOf(cam, stopped))).toBeLessThan(0.12)
      cam = next
      if (back === Infinity && rangeOf(cam, stopped) - base < far * 0.2) back = i * DT
    }
    expect(back).toBeGreaterThan(0.3)
    expect(back).toBeLessThan(0.8)
    expect(rangeOf(cam, stopped)).toBeCloseTo(base, 1)
  })

  it('徒歩: 走ると歩きより少しだけ離れる（0.1〜0.4m）', () => {
    const still = settle(foot, flat)
    const walk = cruise(still, foot, 3, 3)
    const sprint = cruise(still, foot, 6.6, 3)
    const d = rangeOf(sprint.cam, sprint.t) - rangeOf(walk.cam, walk.t)
    expect(d).toBeGreaterThan(0.1)
    expect(d).toBeLessThan(0.4)
  })

  it('縦長の画面では、横の画角が狭くなりすぎないよう縦の画角を広げる', () => {
    expect(viewFov(55, 16 / 9)).toBe(55)
    const tall = viewFov(55, 390 / 844)
    expect(tall).toBeGreaterThan(75)
    expect(tall).toBeLessThan(100)
  })
})

describe('gto camera: 向きだけ遅れて追う', () => {
  /** 相手が 90° 向きを変えてから、残りの角度が deg 度を切るまでの秒 */
  const timeTo = (t: CameraTarget, deg: number) => {
    let cam = settle({ ...t, heading: 0 }, flat)
    for (let i = 1; i < 600; i++) {
      cam = stepCamera(cam, t, input(), flat, DT)
      if (Math.abs(angleDiff(cam.yaw, t.heading)) < deg * DEG) return i * DT
    }
    return Infinity
  }

  it('徒歩: 90° 横へ走ると 0.5〜0.7 秒で斜め後ろ、1.0〜1.3 秒でほぼ真後ろ', () => {
    const t = { ...foot, heading: Math.PI / 2, speed: 5 }
    expect(timeTo(t, 45)).toBeGreaterThan(0.45)
    expect(timeTo(t, 45)).toBeLessThan(0.7)
    expect(timeTo(t, 10)).toBeGreaterThan(0.95)
    expect(timeTo(t, 10)).toBeLessThan(1.3)
  })

  it('徒歩: カメラへ向かって走るあいだは回り込まない', () => {
    const t = { ...foot, heading: Math.PI, speed: 5 }
    const cam = settle(t, flat, 2, settle(foot, flat))
    expect(Math.abs(cam.yaw)).toBeLessThan(0.05)
  })

  it('運転: 1秒で 90° 曲がるあいだ車体は 30〜40° 斜めに見え、直進に戻って 0.6〜0.8 秒で背後へ戻る', () => {
    let t = { ...car, speed: 12 }
    let cam = settle(t, flat)
    for (let i = 0; i < 60; i++) {
      t = { ...t, heading: t.heading + (Math.PI / 2) * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
    }
    const lag = Math.abs(angleDiff(cam.yaw, t.heading)) / DEG
    expect(lag).toBeGreaterThan(28)
    expect(lag).toBeLessThan(40)
    let back = Infinity
    for (let i = 1; i < 300; i++) {
      cam = stepCamera(cam, t, input(), flat, DT)
      if (Math.abs(angleDiff(cam.yaw, t.heading)) < 5 * DEG) {
        back = i * DT
        break
      }
    }
    expect(back).toBeGreaterThan(0.55)
    expect(back).toBeLessThan(0.85)
  })

  it('運転: ゆるいカーブ（毎秒 25°）でも車体が 10° 以上斜めに見える', () => {
    let t = { ...car, speed: 25 }
    let cam = settle(t, flat)
    for (let i = 0; i < 120; i++) {
      t = { ...t, heading: t.heading + 25 * DEG * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
    }
    expect(Math.abs(angleDiff(cam.yaw, t.heading)) / DEG).toBeGreaterThan(10)
  })

  it('運転: 右へ曲がっているあいだ、車は画面の中央から左へ 3% 以上ずれ、直進に戻ると中央へ戻る', () => {
    let t = { ...car, speed: 12 }
    let cam = settle(t, flat)
    const move = (turn: number) => {
      const d = dirOf(t.heading)
      t = { ...t, heading: t.heading + turn * DT, x: t.x + d.x * t.speed * DT, z: t.z + d.z * t.speed * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
    }
    for (let i = 0; i < 60; i++) move(Math.PI / 2)
    expect(project(cam, t.x, 0.7, t.z).x).toBeLessThan(0.47)
    for (let i = 0; i < 120; i++) move(0)
    expect(project(cam, t.x, 0.7, t.z).x).toBeCloseTo(0.5, 1)
  })

  it('徒歩: 真横へ走り出すと、主人公は画面の 35〜46% へずれる（進む先が広く見える）', () => {
    let t = { ...foot, heading: Math.PI / 2, speed: 5 }
    let cam = settle(foot, flat)
    let far = 0.5
    for (let i = 0; i < 40; i++) {
      t = { ...t, x: t.x + t.speed * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
      far = Math.min(far, project(cam, t.x, 0.9, t.z).x)
    }
    expect(far).toBeLessThan(0.46)
    expect(far).toBeGreaterThan(0.35)
  })

  it('向きの先読みは一気に入らない（1コマで視線が 1.5° 以上飛ばない）', () => {
    const t = { ...foot, heading: Math.PI / 2, speed: 5 }
    let cam = settle(foot, flat)
    for (let i = 0; i < 90; i++) {
      const next = stepCamera(cam, t, input(), flat, DT)
      const a = Math.atan2(cam.tx - cam.x, -(cam.tz - cam.z))
      const b = Math.atan2(next.tx - next.x, -(next.tz - next.z))
      expect(Math.abs(angleDiff(a, b)) / DEG).toBeLessThan(1.5 + CAMERA_TUNING.foot.maxTurn * DT / DEG)
      cam = next
    }
  })

  it('旋回中も相手は画面の中央付近（42〜60%）に留まる', () => {
    let t = { ...car, speed: 12 }
    let cam = settle(t, flat)
    for (let i = 0; i < 60; i++) {
      const d = dirOf(t.heading)
      t = { ...t, heading: t.heading + (Math.PI / 2) * DT, x: t.x + d.x * t.speed * DT, z: t.z + d.z * t.speed * DT }
      cam = stepCamera(cam, t, input(), flat, DT)
      const sx = project(cam, t.x, 0.7, t.z).x
      expect(sx).toBeGreaterThan(0.42)
      expect(sx).toBeLessThan(0.6)
    }
  })
})

describe('gto camera: 乗り降り・壁・人ごみ', () => {
  it('徒歩から運転へは 0.6〜0.8 秒で引く（瞬間移動しない）', () => {
    const from = settle(foot, flat)
    // 車は 2m 横に停まっている
    const t = { ...car, x: 2 }
    let cam = from
    let prev = from
    let done = Infinity
    for (let i = 1; i < 240; i++) {
      cam = stepCamera(cam, t, input(), flat, DT)
      expect(Math.hypot(cam.x - prev.x, cam.y - prev.y, cam.z - prev.z)).toBeLessThan(0.35)
      prev = cam
      if (done === Infinity && cam.dist > CAMERA_TUNING.foot.dist + (CAMERA_TUNING.drive.dist - CAMERA_TUNING.foot.dist) * 0.9) done = i * DT
    }
    expect(done).toBeGreaterThan(0.5)
    expect(done).toBeLessThan(0.85)
    expect(cam.dist).toBeCloseTo(CAMERA_TUNING.drive.dist, 1)
  })

  it('真後ろが壁なら手前まで寄り、壁から離して置く', () => {
    // 北向きに立つ → カメラは +z 側。壁を作るため東向きに立たせ、西（−x）を壁にする
    const t = { ...foot, heading: Math.PI / 2 }
    const w = walled(-1.5)
    const cam = settle(t, w, 1)
    expect(cam.x).toBeGreaterThan(-1.5 + 0.3)
    expect(cam.dist).toBeLessThan(1.6)
    expect(w.insideBuilding(cam.x, cam.z)).toBe(false)
  })

  it('徒歩: 真後ろの壁で詰まったら、主人公に貼り付かずに上へ逃げて見下ろす（絵は画面高の 80% まで、足が切れない）', () => {
    const t = { ...foot, heading: Math.PI / 2 }
    const w = walled(-1.2)
    const cam = settle(t, w, 1)
    expect(w.insideBuilding(cam.x, cam.z)).toBe(false)
    expect(cam.x).toBeGreaterThan(-1.2 + 0.3)
    // 軸からの実際の距離は near より縮まない
    expect(Math.hypot(cam.x, cam.y - CAMERA_TUNING.height, cam.z)).toBeGreaterThan(CAMERA_TUNING.foot.near - 0.05)
    expect(cam.y).toBeGreaterThan(2)
    const head = project(cam, 0, 1.67, 0).y
    const feet = project(cam, 0, 0.14, 0).y
    expect(feet - head).toBeLessThan(0.8)
    expect(feet).toBeLessThan(1)
    expect(head).toBeGreaterThan(0)
  })

  it('運転: 真後ろの壁で詰まったら、車体の中へ入らず屋根より 1m 以上高い所から見下ろす', () => {
    // 東向きの車（後端は x=-2.3）のすぐ後ろ x=-2.6 が壁
    const t = { ...car, heading: Math.PI / 2 }
    const w = walled(-2.6)
    const cam = settle(t, w, 1)
    expect(w.insideBuilding(cam.x, cam.z)).toBe(false)
    expect(cam.y).toBeGreaterThan(1.45 + 1)
    // 車の中心が画面に入っている
    const c = project(cam, 0, 0.7, 0)
    expect(c.y).toBeGreaterThan(0.3)
    expect(c.y).toBeLessThan(0.9)
  })

  it('詰まっていないときの置き方は変わらない（上へ逃げるのは near より近づくときだけ）', () => {
    const open = settle(foot, flat)
    const side = settle(foot, walled(-0.35), 2)
    expect(side.y).toBeLessThan(open.y + 0.01)
  })

  it('壁に沿って歩くと少しだけ寄る（狭い路地で 1〜2 割）', () => {
    // 北向き、すぐ西 0.5m が壁
    const cam = settle(foot, walled(-0.5), 2)
    expect(cam.dist).toBeLessThan(CAMERA_TUNING.foot.dist * 0.95)
    expect(cam.dist).toBeGreaterThan(CAMERA_TUNING.foot.dist * 0.6)
    expect(cam.x).toBeGreaterThan(-0.2)
  })

  it('向きを変えている途中も、1歩たりとも建物の中に入らず、壁から 0.2m 以上離れている（壁の内側が透けない）', () => {
    const w = walled(-2)
    let cam = settle(foot, w, 1)
    for (let i = 0; i < 400; i++) {
      cam = stepCamera(cam, foot, input({ lookX: 0.02 }), w, DT)
      expect(cam.x).toBeGreaterThan(-2 + 0.2)
    }
  })

  it('壁に体を付けて沿って歩いても寄りすぎない（主人公は画面高の 46% まで。足が下端で切れない）', () => {
    // 北向き、すぐ西 0.35m（体の半径）が壁
    const cam = settle(foot, walled(-0.35), 2)
    expect(cam.dist).toBeGreaterThan(CAMERA_TUNING.foot.dist * 0.8)
    expect(cam.dist).toBeLessThan(CAMERA_TUNING.foot.dist * 0.95)
    const tall = project(cam, 0, 0.14, 0).y - project(cam, 0, 1.67, 0).y
    expect(tall).toBeGreaterThan(0.37)
    expect(tall).toBeLessThan(0.46)
    // 足が画面の下端で切れない（上下 8% を切り落としても）
    expect(project(cam, 0, 0.14, 0).y).toBeLessThan(0.88)
  })

  it('路地の寄り・戻りはなめらか（壁が横に現れても 1コマで 0.15m 以上は詰めない）', () => {
    // z < -3 だけ西 0.6m に壁がある。そこへ歩いて入る
    const w: GtoWorld = { ...flat, insideBuilding: (x, z) => x < -0.6 && z < -3 }
    let t = { ...foot, speed: 3 }
    let cam = settle(foot, w, 1)
    for (let i = 0; i < 240; i++) {
      t = { ...t, z: t.z - t.speed * DT }
      const next = stepCamera(cam, t, input(), w, DT)
      expect(cam.dist - next.dist).toBeLessThan(0.15)
      cam = next
    }
    expect(cam.dist).toBeLessThan(CAMERA_TUNING.foot.dist * 0.95)
  })

  it('カメラと主人公のあいだ、カメラのすぐ前にいる通行人は、手前へ寄ってよける', () => {
    const base = settle(foot, flat)
    let cam = base
    const crowd = [{ x: 0.1, z: base.z - 0.8 }]
    for (let i = 0; i < 120; i++) cam = stepCamera(cam, foot, input(), flat, DT, crowd)
    // 通行人はカメラの後ろへ回る
    expect(cam.z).toBeLessThan(crowd[0].z)
    expect(cam.dist).toBeGreaterThan(CAMERA_TUNING.foot.dist * 0.45)
    // 主人公のすぐ近くの人までは追わない
    let near = base
    for (let i = 0; i < 120; i++) near = stepCamera(near, foot, input(), flat, DT, [{ x: 0.2, z: 0.8 }])
    expect(near.dist).toBeCloseTo(base.dist, 2)
  })

  it('主人公のほうから歩いてくる通行人は、カメラに届く前からよけ始め、すれ違うまで 1 コマもレンズのすぐ前に映らない', () => {
    const base = settle(foot, flat)
    let cam = base
    // 主人公の横から、秒速 4.4m（すれ違いの相対速度）でカメラのほうへ歩く
    let worst = 1
    for (let i = 0; i < 90; i++) {
      const pz = 4.4 * DT * i
      cam = stepCamera(cam, foot, input(), flat, DT, [{ x: 0.2, z: pz }])
      // カメラの前 1m 以内（大きく映る距離）にいるあいだ、その人の頭は画面の下のほうにしか映らない（上から見下ろしている）
      const ahead = cam.z - pz
      if (ahead > 0.05 && ahead < 1) worst = Math.min(worst, project(cam, 0.2, 1.7, pz).y)
    }
    expect(worst).toBeGreaterThan(0.7)
    // 通り過ぎたら元の距離へ戻る
    for (let i = 0; i < 180; i++) cam = stepCamera(cam, foot, input(), flat, DT, [{ x: 0.2, z: 9 }])
    expect(cam.dist).toBeCloseTo(base.dist, 1)
    expect(cam.y).toBeCloseTo(base.y, 1)
  })

  it('カメラのすぐ前の斜め横に立つ通行人（画面の端に大きく映る位置）も、手前へ寄ってよける', () => {
    const base = settle(foot, flat)
    // カメラの 0.8m 前、横へ 0.9m
    const crowd = [{ x: 0.9, z: base.z - 0.8 }]
    let cam = base
    for (let i = 0; i < 120; i++) cam = stepCamera(cam, foot, input(), flat, DT, crowd)
    expect(cam.z).toBeLessThan(crowd[0].z)
    // 視野の外（真横より後ろ、または遠い横）の人はよけない
    let out = base
    for (let i = 0; i < 120; i++) out = stepCamera(out, foot, input(), flat, DT, [{ x: 2.2, z: base.z - 0.8 }, { x: 0.9, z: base.z + 0.6 }])
    expect(out.dist).toBeCloseTo(base.dist, 2)
  })

  it('後ろに停まっている車の中へは入らず、車体の手前まで寄る', () => {
    const base = settle(foot, flat)
    // 主人公の 3m 後ろに、横向きに停まった車
    const parked = vehicleCrowd({ x: 0, z: 3, heading: Math.PI / 2 }, 4.6, 1.8)
    expect(parked).toHaveLength(3)
    let cam = base
    for (let i = 0; i < 120; i++) cam = stepCamera(cam, foot, input(), flat, DT, parked)
    expect(cam.z).toBeLessThan(3 - 0.9)
    expect(cam.z).toBeGreaterThan(0.6)
    // 横を通るだけの車（軸から 2.5m 離れている）はよけない
    let side = base
    for (let i = 0; i < 120; i++) side = stepCamera(side, foot, input(), flat, DT, vehicleCrowd({ x: 2.5, z: 2, heading: 0 }, 4.6, 1.8))
    expect(side.dist).toBeCloseTo(base.dist, 2)
  })
})

describe('gto camera: 押しっぱなしの向きは世界に固定する（主人公の背中が見える追い方）', () => {
  /** 徒歩の主人公をまねる: スティックの向きを moveFrame の基準で世界の向きへ直し、すぐその向きへ走る */
  const walk = (seconds: number, over: Parameters<typeof input>[0], from?: { cam: CameraState; t: CameraTarget }) => {
    let t = from?.t ?? foot
    let cam = from?.cam ?? settle(foot, flat)
    let side = 0
    for (let i = 0; i < seconds / DT; i++) {
      const inp = input(over)
      const mag = Math.hypot(inp.moveX, inp.moveY)
      const heading = mag > 0.05 ? moveFrame(cam, inp) + Math.atan2(inp.moveX, inp.moveY) : t.heading
      const d = dirOf(heading)
      const speed = mag > 0.05 ? 5 : 0
      t = { ...t, heading, speed, x: t.x + d.x * speed * DT, z: t.z + d.z * speed * DT }
      cam = stepCamera(cam, t, inp, flat, DT)
      if (Math.abs(angleDiff(cam.yaw, t.heading)) > 45 * DEG) side += DT
    }
    return { cam, t, side }
  }

  it('スティックが中立なら、基準はカメラの向きそのもの', () => {
    const cam = settle(foot, flat)
    expect(moveFrame(cam, input())).toBe(cam.yaw)
    expect(moveFrame(cam, input({ moveX: 1 }))).toBe(cam.yaw)
  })

  it('真横へ押しっぱなし: 主人公は円を描かずまっすぐ走り、カメラは 1.3 秒で背後に付く', () => {
    const r = walk(2, { moveX: 1 })
    expect(angleDiff(r.t.heading, Math.PI / 2)).toBeCloseTo(0, 2)
    expect(Math.abs(angleDiff(r.cam.yaw, r.t.heading))).toBeLessThan(5 * DEG)
    // 真横（板が細く潰れて見える角度）に見えている時間は 0.7 秒まで
    expect(r.side).toBeLessThan(0.7)
    // まっすぐ +x へ進んでいる
    expect(Math.abs(r.t.z)).toBeLessThan(0.05)
    expect(r.t.x).toBeGreaterThan(9)
  })

  it('押す向きを変えたら、その時点の画面を基準にやり直す（画面の上＝奥へ進む）', () => {
    const side = walk(2, { moveX: 1 })
    const r = walk(0.5, { moveY: 1 }, side)
    // 背後に付いたカメラから見て前（+x）へそのまま進む。元の基準（−z）へは戻らない
    expect(Math.abs(angleDiff(r.t.heading, side.cam.yaw))).toBeLessThan(6 * DEG)
  })

  it('スティックを少し傾け直す（40° 未満）だけなら基準は変わらず、その分だけ曲がる', () => {
    const side = walk(2, { moveX: 1 })
    const a = 70 * DEG
    const r = walk(0.05, { moveX: Math.sin(a), moveY: Math.cos(a) }, side)
    expect(angleDiff(r.t.heading, 70 * DEG)).toBeCloseTo(0, 2)
  })

  it('スティックを離して押し直すと、いまの画面が基準になる', () => {
    const side = walk(2, { moveX: 1 })
    const rest = walk(0.1, {}, side)
    const r = walk(0.05, { moveX: 1 }, rest)
    expect(Math.abs(angleDiff(r.t.heading, rest.cam.yaw + Math.PI / 2))).toBeLessThan(2 * DEG)
  })

  it('手でカメラを回した分は、押しっぱなしの基準にも効く（マウスで舵を取れる）', () => {
    const side = walk(2, { moveX: 1 })
    const r = walk(0.5, { moveX: 1, lookX: 0.01 }, side)
    expect(angleDiff(side.t.heading, r.t.heading)).toBeCloseTo(0.3, 1)
  })

  it('sim: 真横へ押しっぱなしで走っても、2 秒後にはカメラが主人公の背後 15° 以内にいる', () => {
    const s = run(start({ starterCar: false }), 2.5, { moveX: 1, run: true })
    expect(Math.abs(angleDiff(s.camera.yaw, s.player.heading))).toBeLessThan(15 * DEG)
  })
})
