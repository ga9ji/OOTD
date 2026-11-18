import { describe, expect, it } from 'vitest'
import { act, createBattle, direction, HUNTS, tickBattle, type Battle } from '../kokiHunt'
import { decodeHash, encodeHash } from '../router'

const STILL = { x: 0, y: 0 }

function advance(battle: Battle, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i += 1) battle = tickBattle(battle, STILL, 1 / 60)
  return battle
}

describe('退勤ハント', () => {
  it('ゲームの直接リンクを復元できる', () => {
    expect(encodeHash(decodeHash('#/koki-hunt'))).toBe('/koki-hunt')
  })

  it('間合いの外では斬撃が届かず、攻撃にはスタミナを使う', () => {
    const battle = createBattle(HUNTS[0])
    const swing = act(battle, 'slash', STILL)
    expect(swing.stamina).toBeLessThan(battle.stamina)
    expect(advance(swing, .25).monsterHp).toBe(battle.monsterHp)
    expect(act({ ...battle, stamina: 0 }, 'heavy', STILL).attack).toBeNull()
  })

  it('煤角獣が突進の予兆に入ると、kokiが動いても向きを固定する', () => {
    const battle = createBattle(HUNTS[0])
    const near = { ...battle, player: { x: 380, y: 200 } }
    const warning = advance(near, .7)
    expect(warning.phase).toBe('windup')
    const sidestep = tickBattle(warning, { x: 0, y: 1 }, .04)
    expect(sidestep.aim).toEqual(warning.aim)
    expect(sidestep.player.y).toBeGreaterThan(warning.player.y)
  })

  it.each(HUNTS)('$nameは攻撃が一度だけ当たり、回避中のkokiはダメージを受けない', (hunt) => {
    const battle = createBattle(hunt)
    const threat: Battle = {
      ...battle, monster: { x: 250, y: 210 }, player: { x: 280, y: 210 },
      aim: { x: 1, y: 0 }, phase: 'strike', phaseTimer: .22,
    }
    expect(advance(threat, .25).hp).toBe(100 - hunt.damage)
    expect(advance(act(threat, 'dodge', { x: 0, y: 1 }), .25).hp).toBe(100)
  })

  it.each(HUNTS)('$nameの回復中は強撃の威力が上がり、HPが尽きるとクエストが終了する', (hunt) => {
    const battle = createBattle(hunt)
    const close: Battle = { ...battle, player: { x: 530, y: 280 }, phase: 'recover', phaseTimer: 1.3, monsterHp: 35 }
    expect(advance(act(close, 'heavy', STILL), .6).result).toBe('won')
    const danger: Battle = { ...close, monster: { ...close.player }, hp: 10, phase: 'strike', phaseTimer: .2 }
    expect(advance(danger, .25).result).toBe('lost')
  })

  it('モンスターから離れる方向を求める', () => {
    expect(direction({ x: 1, y: 1 }, { x: 4, y: 5 })).toEqual({ x: .6, y: .8 })
  })
})
