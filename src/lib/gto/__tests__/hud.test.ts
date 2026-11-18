// HUD に出す値の導出（lib/gto/hud.ts）のテスト。
import { describe, expect, it } from 'vitest'
import { hudCue, hudModel, metersText, splitAccent, streetLabel, type HudCueInput, type HudExtra } from '../hud'
import { dirOf } from '../math'
import type { Marker } from '../types'
import { start, world } from './helpers'

const extra = (over: Partial<HudExtra> = {}): HudExtra => ({
  canEnter: false,
  canSteal: false,
  missionTitle: '',
  objective: '',
  timeLeft: null,
  banner: '',
  clock: '13:20',
  ...over,
})
const marker = (x: number, z: number, kind: Marker['kind']): Marker => ({ x, z, kind, radius: 6, ref: 'm' })

describe('metersText', () => {
  it('近くは 5m 刻み、遠くは km', () => {
    expect(metersText(3)).toBe('5m')
    expect(metersText(42)).toBe('40m')
    expect(metersText(318)).toBe('320m')
    expect(metersText(1240)).toBe('1.2km')
  })
})

describe('hudModel', () => {
  const state = start()

  it('所持金・時計・手配度を文字にする', () => {
    const hud = hudModel({ ...state, cash: 12345.4 }, world, extra())
    expect(hud.cash).toBe('¥12,345')
    expect(hud.clock).toBe('13:20')
    expect(hud.wanted).toBe(0)
    expect(hud.cooling).toBe(false)
    expect(hud.speedKmh).toBeNull()
    expect(hud.target).toBeNull()
  })

  it('車では速度を出す。「降りる」の案内は、止まりかけのときだけ', () => {
    const hud = hudModel({ ...state, mode: 'drive', player: { ...state.player, speed: 10 } }, world, extra())
    expect(hud.speedKmh).toBe(36)
    expect(hud.prompts).toEqual([])
    const slow = hudModel({ ...state, mode: 'drive', player: { ...state.player, speed: -1.5 } }, world, extra())
    expect(slow.prompts).toEqual([{ key: 'F', label: '降りる' }])
  })

  it('見失われているあいだは「冷めていく」印を立てる', () => {
    const hud = hudModel({ ...state, wanted: { heat: 3, level: 2, unseen: 4, bust: 1.1 } }, world, extra())
    expect(hud.wanted).toBe(2)
    expect(hud.cooling).toBe(true)
    expect(hud.bust).toBeCloseTo(0.5)
  })

  it('目的地があれば、その距離とカメラから見た向きを出す', () => {
    const f = dirOf(state.camera.yaw)
    const right = marker(state.player.x - f.z * 100, state.player.z + f.x * 100, 'goal')
    const hud = hudModel(state, world, extra({ markers: [marker(state.player.x + 900, state.player.z, 'start'), right] }))
    expect(hud.target?.kind).toBe('goal')
    expect(hud.target?.dist).toBe('100m')
    expect(hud.target?.turn).toBeCloseTo(Math.PI / 2)
  })

  it('目的地が無ければ、いちばん近い開始地点を指す', () => {
    const near = marker(state.player.x + 50, state.player.z, 'start')
    const far = marker(state.player.x + 400, state.player.z, 'start')
    const hud = hudModel(state, world, extra({ markers: [far, near] }))
    expect(hud.target).toMatchObject({ kind: 'start', dist: '50m' })
  })

  it('見回り（threat）は向かう先にしない', () => {
    const guard = { ...marker(state.player.x + 10, state.player.z, 'start'), threat: true }
    const begin = marker(state.player.x + 50, state.player.z, 'start')
    expect(hudModel(state, world, extra({ markers: [guard, begin] })).target).toMatchObject({ kind: 'start', dist: '50m' })
    expect(hudModel(state, world, extra({ markers: [guard] })).target).toBeNull()
  })

  it('通りの実名は英語名も添える', () => {
    const road = world.map.roads.find((r) => r.name === '道玄坂' && r.nameEn)!
    const hud = hudModel({ ...state, player: { ...state.player, x: road.pts[0], z: road.pts[1] } }, world, extra())
    expect(hud.street).not.toBe('')
    if (hud.street === '道玄坂') expect(hud.streetEn).toBe(road.nameEn)
  })
})

describe('splitAccent', () => {
  it('目的の文の中の要の言葉を切り出す', () => {
    expect(splitAccent('センター街の入口まで歩く', 'センター街の入口')).toEqual(['', 'センター街の入口', 'まで歩く'])
    expect(splitAccent('通行人の服を1着いただく', '服を1着')).toEqual(['通行人の', '服を1着', 'いただく'])
  })
  it('見つからなければ全文をそのまま', () => {
    expect(splitAccent('Walk there', '入口')).toEqual(['Walk there', '', ''])
    expect(splitAccent('Walk there', '')).toEqual(['Walk there', '', ''])
  })
})

describe('hudCue', () => {
  const base: HudCueInput = {
    kind: 'intro',
    age: 1,
    life: 6,
    title: 'はじめての一着',
    speaker: '仕立て屋のツムギ',
    line: '「まずは一着」',
    objective: '通行人の服を1着いただく',
    accent: '服を1着',
    detail: '',
    reward: 0,
    bonus: 0,
  }

  it('導入と手順の切り替わりは、話し手と台詞を出す', () => {
    expect(hudCue(base)).toMatchObject({ kind: 'intro', speaker: '仕立て屋のツムギ', line: '「まずは一着」', accent: '服を1着', result: '', leaving: false })
    expect(hudCue({ ...base, kind: 'step', age: 5.8 })?.leaving).toBe(true)
  })

  it('達成は報酬と上乗せを、失敗は理由を出す', () => {
    const passed = hudCue({ ...base, kind: 'passed', speaker: '', line: '', reward: 3000, bonus: 450 })
    expect(passed).toMatchObject({ kind: 'passed', result: '+¥3,000', extra: '+¥450' })
    expect(hudCue({ ...base, kind: 'passed', reward: 3000 })?.extra).toBe('')
    expect(hudCue({ ...base, kind: 'failed', detail: '時間切れ' })).toMatchObject({ kind: 'failed', result: '時間切れ' })
  })

  it('演出が無ければ null、HUD の値にもそのまま載る', () => {
    expect(hudCue(null)).toBeNull()
    const state = start()
    const gauge = { kind: 'count', label: 'いただいた服', value: 0.5, text: '1/2', hint: '' }
    const hud = hudModel(state, world, extra({ cue: base, gauge }))
    expect(hud.cue?.title).toBe('はじめての一着')
    expect(hud.gauge).toEqual(gauge)
    expect(hudModel(state, world, extra()).gauge).toBeNull()
  })

  it('結果の演出が出ているあいだは、同じ内容の一言を重ねない', () => {
    const hud = hudModel(start(), world, extra({ banner: 'はじめての一着 — 仕立て屋のツムギ', cue: base }))
    expect(hud.banner).toBe('')
  })
})

describe('streetLabel', () => {
  it('通りと坂の名はそのまま出す（かっこ書きの注記は落とす）', () => {
    expect(streetLabel('道玄坂')).toBe('道玄坂')
    expect(streetLabel('渋谷センター街')).toBe('渋谷センター街')
    expect(streetLabel('のんべい横丁')).toBe('のんべい横丁')
    expect(streetLabel('青山通り(金王坂)')).toBe('青山通り')
    expect(streetLabel('公園通り(勤労福祉会館前)')).toBe('公園通り')
  })

  it('建物や施設の名が付いた通路は出さない', () => {
    for (const name of ['渋谷ストリーム', '渋谷サクラステージ', 'BINGO モディ', 'Shibuya LOVEZ;1階', '渋⾕フクラス接続デッキ', '渋谷警察署', '渋谷駅東口地下自転車駐輪場', 'エレベーター32;2階']) {
      expect(streetLabel(name)).toBe('')
    }
    expect(streetLabel(undefined)).toBe('')
  })

  it('地図のどの道でも、出す名は通り・坂・橋などの名だけ', () => {
    const shown = new Set(world.map.roads.map((r) => streetLabel(r.name)).filter((n) => n !== ''))
    expect(shown.has('道玄坂')).toBe(true)
    for (const n of shown) expect(n).toMatch(/(通り|坂|街道|ストリート|ロード|横丁|センター街|アベニュー|小路|橋|線|入口|出口)$/)
  })
})
