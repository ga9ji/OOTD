import { RIVAL_LOOKS } from './kokiHuntLooks'

export const HUNT_TITLE = '退勤ハント'
export const HUNT_LEAD = '出勤服を選んで、服好きのkokiたちと退勤後のファッションバトル。'

export const FIELD = { width: 760, height: 444 }
export const HUNTS = [
  { id: 'cinder', name: RIVAL_LOOKS.cinder.label, place: '夕暮れの採石場', telegraph: '50年代のジャケットを集める古着好き。木製ハンガーを引いたら、横へ回避。', hp: 185, speed: 60, damage: 23, windup: 1.05, recovery: 1.48 },
  { id: 'gale', name: RIVAL_LOOKS.gale.label, place: '風鳴りの高台', telegraph: '赤いコートにストールを合わせる重ね着好き。布を広げたら、円の外へ。', hp: 230, speed: 78, damage: 28, windup: 0.88, recovery: 1.38 },
] as const

export type HuntId = (typeof HUNTS)[number]['id']
export type Hunt = (typeof HUNTS)[number]
export type Point = { x: number; y: number }
export type Field = { width: number; height: number }
export type Action = 'slash' | 'heavy' | 'dodge'
export type Signal = 'slash' | 'heavy' | 'miss' | 'dodge' | 'hurt' | 'tired'
type Phase = 'prowl' | 'windup' | 'strike' | 'recover'

export type Battle = {
  hunt: Hunt
  field: Field
  player: Point
  monster: Point
  aim: Point
  dodgeDir: Point
  hp: number
  monsterHp: number
  stamina: number
  attack: 'slash' | 'heavy' | null
  combo: number
  comboTimer: number
  queuedSlash: boolean
  playerTimer: number
  dodgeTimer: number
  phase: Phase
  phaseTimer: number
  pattern: 'charge' | 'sweep'
  attacksMade: number
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
const step = (field: Field, p: Point, toward: Point, amount: number, margin: number): Point => ({
  x: Math.max(margin, Math.min(field.width - margin, p.x + toward.x * amount)),
  y: Math.max(margin, Math.min(field.height - margin, p.y + toward.y * amount)),
})

export function joystickVector(offset: Point, radius: number): Point {
  const distance = Math.hypot(offset.x, offset.y)
  const deadZone = radius * .16
  if (distance <= deadZone) return { x: 0, y: 0 }
  const speed = Math.min(1, (distance - deadZone) / (radius - deadZone))
  return { x: (offset.x / distance) * speed, y: (offset.y / distance) * speed }
}

export function cameraRelativeMove(move: Point, yaw: number): Point {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return { x: -move.x * cos - move.y * sin, y: move.x * sin - move.y * cos }
}

export const ATTACKS = {
  slash: { range: 103, cost: 9, damage: 13, time: 0.28 },
  heavy: { range: 123, cost: 25, damage: 29, time: 0.57 },
}
const DODGE = { cost: 19, time: 0.31, speed: 475 }
export const SWEEP_RADIUS = 128
export const CHARGE_WIDTH = 116
export const CHARGE_SPEED = 555
export const CHARGE_TIME = .43

export function createBattle(hunt: Hunt): Battle {
  return {
    hunt, field: FIELD,
    player: { x: 200, y: 285 },
    monster: { x: 535, y: 200 },
    aim: { x: -1, y: 0 }, dodgeDir: { x: 1, y: 0 },
    hp: 100, monsterHp: hunt.hp, stamina: 100, attack: null, combo: 0, comboTimer: 0, queuedSlash: false,
    playerTimer: 0, dodgeTimer: 0,
    phase: 'prowl', phaseTimer: 0.65, pattern: hunt.id === 'cinder' ? 'charge' : 'sweep', attacksMade: 0,
    elapsed: 0, impact: 0, impactedMonster: false, signal: null, signalTimer: 0, struck: false, result: null,
  }
}

export function act(battle: Battle, action: Action, move: Point): Battle {
  if (!battle.result && action === 'slash' && battle.attack === 'slash' && battle.playerTimer < .16) {
    return { ...battle, queuedSlash: true }
  }
  if (battle.result || battle.attack || battle.dodgeTimer > 0) return battle
  const cost = action === 'dodge' ? DODGE.cost : ATTACKS[action].cost
  if (battle.stamina < cost) return { ...battle, signal: 'tired', signalTimer: .9 }
  const next = { ...battle, stamina: battle.stamina - cost }
  if (action === 'dodge') {
    next.combo = 0
    next.comboTimer = 0
    next.dodgeTimer = DODGE.time
    next.dodgeDir = move.x || move.y ? direction({ x: 0, y: 0 }, move) : direction(battle.monster, battle.player)
    next.signal = 'dodge'
    next.signalTimer = .65
  } else {
    next.attack = action
    next.combo = action === 'slash' ? (battle.comboTimer > 0 ? (battle.combo % 3) + 1 : 1) : 0
    next.comboTimer = 0
    next.playerTimer = ATTACKS[action].time
  }
  return next
}

function damagePlayer(battle: Battle) {
  if (battle.struck || battle.dodgeTimer > 0) return
  battle.hp = Math.max(0, battle.hp - battle.hunt.damage)
  battle.struck = true
  battle.attack = null
  battle.combo = 0
  battle.comboTimer = 0
  battle.queuedSlash = false
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
  const { hunt, field } = next
  next.elapsed += dt
  next.impact = Math.max(0, next.impact - dt)
  next.comboTimer = Math.max(0, next.comboTimer - dt)
  next.signalTimer = Math.max(0, next.signalTimer - dt)
  if (next.signalTimer === 0) next.signal = null
  if (next.dodgeTimer > 0) {
    next.player = step(field, next.player, next.dodgeDir, DODGE.speed * Math.min(dt, next.dodgeTimer), 20)
    next.dodgeTimer = Math.max(0, next.dodgeTimer - dt)
  } else if (next.attack) {
    next.playerTimer -= dt
    if (next.playerTimer <= 0) {
      const attack = ATTACKS[next.attack]
      if (dist(next.player, next.monster) <= attack.range) {
        // 回復中の隙を突くと、強撃の威力が上がる。
        const damage = next.attack === 'heavy' && next.phase === 'recover' ? 41 : attack.damage + (next.combo === 3 ? 10 : 0)
        next.monsterHp = Math.max(0, next.monsterHp - damage)
        next.impact = 0.24
        next.impactedMonster = true
        next.signal = next.attack
        next.signalTimer = .65
        next.comboTimer = next.attack === 'slash' ? .62 : 0
        if (next.monsterHp === 0) {
          next.result = 'won'
          return next
        }
      } else {
        next.signal = 'miss'
        next.signalTimer = .65
      }
      next.attack = null
      if (next.queuedSlash) {
        next.queuedSlash = false
        Object.assign(next, act(next, 'slash', movement))
      }
    }
  } else {
    next.stamina = Math.min(100, next.stamina + 25 * dt)
    if (movement.x || movement.y) {
      const magnitude = Math.max(1, Math.hypot(movement.x, movement.y))
      next.player = step(field, next.player, movement, 208 * dt / magnitude, 20)
    }
  }

  next.phaseTimer -= dt
  if (next.phase === 'prowl') {
    const distance = dist(next.monster, next.player)
    next.aim = direction(next.monster, next.player)
    if (distance > 74) next.monster = step(field, next.monster, next.aim, hunt.speed * dt, 47)
    const alternate = next.attacksMade % 3 === 2 && next.monsterHp <= hunt.hp * .65
    const pattern = (hunt.id === 'cinder') !== alternate ? 'charge' : 'sweep'
    if (next.phaseTimer <= 0 && distance < (pattern === 'charge' ? 248 : 152)) {
      next.phase = 'windup'
      next.pattern = pattern
      next.attacksMade += 1
      next.phaseTimer = hunt.windup * (next.monsterHp <= hunt.hp * .35 ? .8 : 1)
      next.struck = false
    }
  } else if (next.phase === 'windup' && next.phaseTimer <= 0) {
    next.phase = 'strike'
    next.phaseTimer = next.pattern === 'charge' ? CHARGE_TIME : .26
  } else if (next.phase === 'strike') {
    if (next.pattern === 'charge') next.monster = step(field, next.monster, next.aim, CHARGE_SPEED * Math.min(dt, next.phaseTimer + dt), 47)
    const radius = next.pattern === 'charge' ? CHARGE_WIDTH / 2 : SWEEP_RADIUS
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
