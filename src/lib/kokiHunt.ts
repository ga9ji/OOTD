export const HUNT_TITLE = '退勤ハント'
export const HUNT_LEAD = '出勤服のkokiで、退勤後の狩猟へ。大型獣の予兆を読んで回避し、反撃の一撃を叩き込もう。'

export const FIELD = { width: 760, height: 444 }
export const HUNTS = [
  { id: 'cinder', name: '煤角獣', place: '夕暮れの採石場', telegraph: '直線に突進する。横へ避けてから近づこう。', hp: 110, speed: 51, damage: 23, windup: 1.05, recovery: 1.48 },
  { id: 'gale', name: '薄明翼', place: '風鳴りの高台', telegraph: '翼の周囲を薙ぎ払う。円の外へ回避しよう。', hp: 155, speed: 78, damage: 28, windup: 0.88, recovery: 1.38 },
] as const

export type HuntId = (typeof HUNTS)[number]['id']
export type Hunt = (typeof HUNTS)[number]
export type Point = { x: number; y: number }
export type Action = 'slash' | 'heavy' | 'dodge'
export type Signal = 'slash' | 'heavy' | 'miss' | 'dodge' | 'hurt' | 'tired'
type Phase = 'prowl' | 'windup' | 'strike' | 'recover'

export type Battle = {
  hunt: Hunt
  player: Point
  monster: Point
  aim: Point
  dodgeDir: Point
  hp: number
  monsterHp: number
  stamina: number
  attack: 'slash' | 'heavy' | null
  playerTimer: number
  dodgeTimer: number
  phase: Phase
  phaseTimer: number
  elapsed: number
  impact: number
  impactedMonster: boolean
  signal: Signal | null
  signalTimer: number
  struck: boolean
  result: 'won' | 'lost' | null
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const direction = (from: Point, to: Point): Point => {
  const distance = dist(from, to)
  return distance === 0 ? { x: 1, y: 0 } : { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance }
}
const step = (p: Point, toward: Point, amount: number, margin: number): Point => ({
  x: Math.max(margin, Math.min(FIELD.width - margin, p.x + toward.x * amount)),
  y: Math.max(margin, Math.min(FIELD.height - margin, p.y + toward.y * amount)),
})

export const ATTACKS = {
  slash: { range: 103, cost: 9, damage: 13, time: 0.19 },
  heavy: { range: 123, cost: 25, damage: 29, time: 0.57 },
}
const DODGE = { cost: 19, time: 0.31, speed: 475 }
export const SWEEP_RADIUS = 128
export const CHARGE_WIDTH = 116
export const CHARGE_SPEED = 555
export const CHARGE_TIME = .43

export function createBattle(hunt: Hunt): Battle {
  return {
    hunt, player: { x: 200, y: 285 }, monster: { x: 535, y: 200 },
    aim: { x: -1, y: 0 }, dodgeDir: { x: 1, y: 0 },
    hp: 100, monsterHp: hunt.hp, stamina: 100, attack: null, playerTimer: 0, dodgeTimer: 0,
    phase: 'prowl', phaseTimer: 0.65, elapsed: 0, impact: 0, impactedMonster: false, signal: null, signalTimer: 0, struck: false, result: null,
  }
}

export function act(battle: Battle, action: Action, move: Point): Battle {
  if (battle.result || battle.attack || battle.dodgeTimer > 0) return battle
  const cost = action === 'dodge' ? DODGE.cost : ATTACKS[action].cost
  if (battle.stamina < cost) return { ...battle, signal: 'tired', signalTimer: .9 }
  const next = { ...battle, stamina: battle.stamina - cost }
  if (action === 'dodge') {
    next.dodgeTimer = DODGE.time
    next.dodgeDir = move.x || move.y ? direction({ x: 0, y: 0 }, move) : direction(battle.monster, battle.player)
    next.signal = 'dodge'
    next.signalTimer = .65
  } else {
    next.attack = action
    next.playerTimer = ATTACKS[action].time
  }
  return next
}

function damagePlayer(battle: Battle) {
  if (battle.struck || battle.dodgeTimer > 0) return
  battle.hp = Math.max(0, battle.hp - battle.hunt.damage)
  battle.struck = true
  battle.attack = null
  battle.playerTimer = 0
  battle.impact = 0.2
  battle.impactedMonster = false
  battle.signal = 'hurt'
  battle.signalTimer = .9
  if (battle.hp === 0) battle.result = 'lost'
}

export function tickBattle(battle: Battle, movement: Point, dt: number): Battle {
  if (battle.result) return battle
  const next = { ...battle }
  const { hunt } = next
  next.elapsed += dt
  next.impact = Math.max(0, next.impact - dt)
  next.signalTimer = Math.max(0, next.signalTimer - dt)
  if (next.signalTimer === 0) next.signal = null
  if (next.dodgeTimer > 0) {
    next.player = step(next.player, next.dodgeDir, DODGE.speed * Math.min(dt, next.dodgeTimer), 20)
    next.dodgeTimer = Math.max(0, next.dodgeTimer - dt)
  } else if (next.attack) {
    next.playerTimer -= dt
    if (next.playerTimer <= 0) {
      const attack = ATTACKS[next.attack]
      if (dist(next.player, next.monster) <= attack.range) {
        // 回復中の隙を突くと、強撃の威力が上がる。
        const damage = next.attack === 'heavy' && next.phase === 'recover' ? 41 : attack.damage
        next.monsterHp = Math.max(0, next.monsterHp - damage)
        next.impact = 0.24
        next.impactedMonster = true
        next.signal = next.attack
        next.signalTimer = .65
        if (next.monsterHp === 0) {
          next.result = 'won'
          return next
        }
      } else {
        next.signal = 'miss'
        next.signalTimer = .65
      }
      next.attack = null
    }
  } else {
    next.stamina = Math.min(100, next.stamina + 25 * dt)
    if (movement.x || movement.y) {
      next.player = step(next.player, direction({ x: 0, y: 0 }, movement), 208 * dt, 20)
    }
  }

  next.phaseTimer -= dt
  if (next.phase === 'prowl') {
    const distance = dist(next.monster, next.player)
    next.aim = direction(next.monster, next.player)
    if (distance > 74) next.monster = step(next.monster, next.aim, hunt.speed * dt, 47)
    if (next.phaseTimer <= 0 && distance < (hunt.id === 'cinder' ? 248 : 152)) {
      next.phase = 'windup'
      next.phaseTimer = hunt.windup * (next.monsterHp <= hunt.hp * .35 ? .8 : 1)
      next.struck = false
    }
  } else if (next.phase === 'windup' && next.phaseTimer <= 0) {
    next.phase = 'strike'
    next.phaseTimer = hunt.id === 'cinder' ? CHARGE_TIME : .26
  } else if (next.phase === 'strike') {
    if (hunt.id === 'cinder') next.monster = step(next.monster, next.aim, CHARGE_SPEED * Math.min(dt, next.phaseTimer + dt), 47)
    const radius = hunt.id === 'cinder' ? CHARGE_WIDTH / 2 : SWEEP_RADIUS
    if (dist(next.monster, next.player) <= radius) damagePlayer(next)
    if (next.phaseTimer <= 0) {
      next.phase = 'recover'
      next.phaseTimer = hunt.recovery
    }
  } else if (next.phase === 'recover' && next.phaseTimer <= 0) {
    next.phase = 'prowl'
    next.phaseTimer = .55
  }
  return next
}

export type Records = Partial<Record<HuntId, number>>
const STORAGE_KEY = 'ootd-koki-hunt-records'

export function loadRecords(): Records {
  try {
    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    return Object.fromEntries(HUNTS.flatMap(({ id }) => {
      const time = data?.[id]
      return typeof time === 'number' && Number.isFinite(time) && time > 0 ? [[id, time]] : []
    }))
  } catch {
    return {}
  }
}

export function saveRecord(records: Records, id: HuntId, elapsed: number): Records {
  const saved = loadRecords()
  const next: Records = {}
  for (const hunt of HUNTS) {
    const time = Math.min(records[hunt.id] ?? Infinity, saved[hunt.id] ?? Infinity, hunt.id === id ? elapsed : Infinity)
    if (Number.isFinite(time)) next[hunt.id] = time
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ゲーム画面を開いている間は、保存が無効でも記録を表示できる。
  }
  return next
}
