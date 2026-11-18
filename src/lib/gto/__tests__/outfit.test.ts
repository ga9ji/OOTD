import { describe, expect, it } from 'vitest'
import {
  createOutfit,
  detectSwap,
  findStealTarget,
  moveCursor,
  outfitNotice,
  OUTFIT_TUNING,
  STEAL_BEAT,
  stealBeat,
  stealOutfit,
  wardrobeModel,
  WEAR_BEAT,
  wearBeat,
  wearFromWardrobe,
} from '../outfit'
import type { PedState, PlayerState } from '../types'
import { cfg, DT, input, run, start, world } from './helpers'
import { stepGto } from '../sim'

const p: PlayerState = { x: 0, y: 0, z: 0, heading: 0, speed: 0, running: false, stride: 0, vehicleId: null, busy: 0 }
const ped = (over: Partial<PedState> = {}): PedState => ({
  id: 9, x: 0, y: 0, z: -1.5, heading: 0, speed: 1, outfitKey: 'b', mood: 'walk', timer: 0, route: null, stride: 0, ...over,
})

describe('gto outfit: 狙い', () => {
  it('警官の服は奪えない。いちばん近い相手を選ぶ', () => {
    expect(findStealTarget(p, [ped({ cop: true })], 'a')).toBeNull()
    expect(findStealTarget(p, [ped({ mood: 'stunned', timer: 1 })], 'a')).toBeNull() // 奪った直後の相手を続けて狙わない
    const near = ped({ id: 2, z: -1 })
    expect(findStealTarget(p, [ped({ id: 1, z: -2 }), near], 'a')).toBe(near)
  })

  it('最初から持っている服を足して始められる（重複と着ている服は足さない）', () => {
    const o = createOutfit('a', ['b', 'a', 'c', 'b'])
    expect(o.wearing).toBe('a')
    expect(o.wardrobe).toEqual(['a', 'b', 'c'])
    expect(createOutfit('a').wardrobe).toEqual(['a'])
  })
})

describe('gto outfit: 奪う演出の時間割', () => {
  it('掴む → 服が飛んでくる → 着地の瞬間に姿が替わる → 決めの弾み、の順に進む', () => {
    const grab = stealBeat(0.06)
    expect(grab.lunge).toBeGreaterThan(0.3)
    expect(grab.swapped).toBe(false)
    expect(grab.flying).toBe(false)

    const fly = stealBeat((STEAL_BEAT.flyStart + STEAL_BEAT.land) / 2)
    expect(fly.flying).toBe(true)
    expect(fly.fly).toBeGreaterThan(0.3)
    expect(fly.fly).toBeLessThan(0.7)
    expect(fly.swapped).toBe(false)
    expect(fly.flash).toBe(0)

    const land = stealBeat(STEAL_BEAT.land + 0.001)
    expect(land.swapped).toBe(true)
    expect(land.flying).toBe(false)
    expect(land.flash).toBeGreaterThan(0.9)
    expect(land.pop).toBeGreaterThan(0.9)
    expect(land.lunge).toBeLessThan(0.05)

    const after = stealBeat(STEAL_BEAT.land + 0.5)
    expect(after.flash).toBe(0)
    expect(Math.abs(after.pop)).toBeLessThan(0.05)
    expect(after.shock).toBe(1)
    expect(after.done).toBe(false)
    expect(stealBeat(STEAL_BEAT.total + 0.01).done).toBe(true)
  })

  it('始まる前と終わった後は何も動かさない', () => {
    for (const tau of [-1, STEAL_BEAT.total + 1]) {
      const b = stealBeat(tau)
      expect(b.done).toBe(true)
      expect(b.lunge).toBe(0)
      expect(b.flash).toBe(0)
      expect(b.pop).toBe(0)
      expect(b.hop).toBe(0)
      expect(b.spin).toBe(0)
    }
  })

  it('値は 0..1 に収まり、相手は服が飛ぶあいだに1回転する', () => {
    let maxSpin = 0
    for (let tau = 0; tau < STEAL_BEAT.total; tau += 0.01) {
      const b = stealBeat(tau)
      for (const v of [b.lunge, b.fly, b.flash, b.shock, b.hop, b.spin, b.tug, b.shiver]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      maxSpin = Math.max(maxSpin, b.spin)
    }
    expect(maxSpin).toBeGreaterThan(0.9)
  })

  it('動けない時間は、姿が替わって決めの弾みが収まるまで', () => {
    expect(OUTFIT_TUNING.busy).toBeGreaterThan(STEAL_BEAT.land)
    expect(OUTFIT_TUNING.busy).toBeLessThanOrEqual(STEAL_BEAT.total)
    // 相手は演出が終わるまで立ちすくむ
    expect(OUTFIT_TUNING.stun).toBeGreaterThanOrEqual(STEAL_BEAT.total)
  })
})

describe('gto outfit: 着替えの演出の時間割', () => {
  it('くるりと回って、真横を向いた瞬間に姿が替わる', () => {
    expect(wearBeat(0).turn).toBeCloseTo(1)
    expect(wearBeat(WEAR_BEAT.swap - 0.001).swapped).toBe(false)
    expect(Math.abs(wearBeat(WEAR_BEAT.swap).turn)).toBeLessThan(0.05)
    expect(wearBeat(WEAR_BEAT.swap + 0.001).swapped).toBe(true)
    expect(wearBeat(WEAR_BEAT.swap + 0.001).flash).toBeGreaterThan(0.9)
    expect(wearBeat(WEAR_BEAT.swap * 2).turn).toBeCloseTo(1)
    expect(wearBeat(WEAR_BEAT.total + 0.01).done).toBe(true)
    expect(wearBeat(-1).done).toBe(true)
  })
})

describe('gto outfit: 何が起きたかの見分け', () => {
  it('奪ったときは、相手と、取った服・渡した服が分かる', () => {
    const before = createOutfit('a')
    const r = stealOutfit(before, ped(), 3)
    const swap = detectSwap(before, r.outfit, p, [ped({ id: 4, x: 30 }), r.ped])
    expect(swap).toEqual({ kind: 'steal', victimId: 9, taken: 'b', given: 'a', at: 3 })
  })

  it('ワードローブからの着替えは、近くに同じ服の人がいても着替えと見分ける', () => {
    const before = { wearing: 'a', wardrobe: ['b', 'a'], changedAt: 1 }
    const after = wearFromWardrobe(before, 'b', 5)
    expect(detectSwap(before, after, p, [ped({ outfitKey: 'a' })])).toEqual({ kind: 'wear', from: 'a', to: 'b', at: 5 })
  })

  it('変わっていなければ何も返さない', () => {
    const o = createOutfit('a')
    expect(detectSwap(o, o, p, [])).toBeNull()
    expect(detectSwap(o, { ...o }, p, [])).toBeNull()
  })

  it('お知らせ: 初めての服は NEW、持っていた服は NEW にしない', () => {
    const before = createOutfit('a')
    const got = stealOutfit(before, ped(), 3).outfit
    expect(outfitNotice(before, got)).toEqual({ kind: 'steal', key: 'b', isNew: true, count: 2, at: 3 })
    const again = stealOutfit({ ...got, wearing: 'a' }, ped(), 6).outfit
    expect(outfitNotice({ ...got, wearing: 'a' }, again)).toMatchObject({ kind: 'steal', isNew: false, count: 2 })
    expect(outfitNotice(got, wearFromWardrobe(got, 'a', 9))).toMatchObject({ kind: 'wear', key: 'a' })
    expect(outfitNotice(got, got)).toBeNull()
  })
})

describe('gto outfit: ワードローブの画面', () => {
  it('手持ちを新しい順に並べ、着ている服と選んでいる服に印を付ける', () => {
    const m = wardrobeModel({ wearing: 'b', wardrobe: ['c', 'b', 'a'], changedAt: 0 }, 2)
    expect(m.items.map((i) => i.key)).toEqual(['c', 'b', 'a'])
    expect(m.items.map((i) => i.wearing)).toEqual([false, true, false])
    expect(m.items.map((i) => i.selected)).toEqual([false, false, true])
    expect(m.selected).toBe('a')
    expect(m.canWear).toBe(true)
    expect(m.count).toBe(3)
    expect(m.max).toBe(OUTFIT_TUNING.wardrobeMax)
    // 着ている服を選んでいるあいだは「着る」を押せない
    expect(wardrobeModel({ wearing: 'b', wardrobe: ['c', 'b', 'a'], changedAt: 0 }, 1).canWear).toBe(false)
    // 範囲の外の番号は丸める
    expect(wardrobeModel({ wearing: 'b', wardrobe: ['c', 'b'], changedAt: 0 }, 9).selected).toBe('b')
  })

  it('選ぶ位置は端で止まり、上下は段を移る', () => {
    expect(moveCursor(0, -1, 0, 5, 4)).toBe(0)
    expect(moveCursor(4, 1, 0, 5, 4)).toBe(4)
    expect(moveCursor(1, 1, 0, 5, 4)).toBe(2)
    expect(moveCursor(0, 0, 1, 5, 4)).toBe(4)
    expect(moveCursor(1, 0, 1, 5, 4)).toBe(1) // 下の段に相手がいない
    expect(moveCursor(4, 0, -1, 5, 4)).toBe(0)
    expect(moveCursor(0, 1, 0, 0, 4)).toBe(0)
  })
})

describe('gto outfit: sim との繋ぎ', () => {
  it('奪うと決めの弾みが収まるまで動けず、相手は立ちすくんでから逃げる', () => {
    let s = start({ seed: 2, stage: { pedAhead: true }, starterCar: false }, { ...cfg, maxVehicles: 0, maxPeds: 0 })
    const victimId = s.peds[s.peds.length - 1].id
    s = run(s, 0.6, { moveY: 1 }) // 手が届く所まで近づく
    s = stepGto(s, input({ steal: true }), world, cfg, DT)
    expect(s.events.some((e) => e.type === 'steal')).toBe(true)
    expect(s.player.busy).toBeCloseTo(OUTFIT_TUNING.busy, 1)
    const x0 = s.player.x
    s = run(s, 0.3, { moveY: 1 })
    expect(s.player.x).toBeCloseTo(x0, 3)
    expect(s.peds.find((q) => q.id === victimId)?.mood).toBe('stunned')
    s = run(s, OUTFIT_TUNING.stun, { moveY: 1 })
    expect(s.peds.find((q) => q.id === victimId)?.mood).toBe('flee')
  })

  it('ワードローブから着替えると姿が替わり、見られていなければ手配が冷める', () => {
    const base = start({ seed: 2, stage: { wardrobe: 3, wanted: 2 }, starterCar: false }, { ...cfg, maxVehicles: 0, maxPeds: 0 })
    expect(base.outfit.wardrobe.length).toBe(3)
    const other = base.outfit.wardrobe.find((k) => k !== base.outfit.wearing) as string
    const plain = stepGto(base, input(), world, cfg, DT)
    const changed = stepGto(base, input({ wear: other }), world, cfg, DT)
    expect(changed.outfit.wearing).toBe(other)
    expect(changed.outfit.changedAt).toBeCloseTo(DT)
    expect(changed.wanted.heat).toBeLessThan(plain.wanted.heat)
    // 持っていない服は着られない
    expect(stepGto(base, input({ wear: 'zzz' }), world, cfg, DT).outfit.wearing).toBe(base.outfit.wearing)
  })
})
