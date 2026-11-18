// GTO のテストで使う共通の道具（テスト専用。アプリ本体には含めない）。
import { NO_INPUT } from '../input'
import { loadWorld } from '../map'
import { createGtoState, stepGto, type StartOptions } from '../sim'
import type { GtoState, InputFrame, SimConfig } from '../types'

export const world = loadWorld()
export const cfg: SimConfig = { maxVehicles: 8, maxPeds: 12, outfitKeys: ['a', 'b', 'c', 'd'] }
export const DT = 1 / 60
export const input = (over: Partial<InputFrame> = {}): InputFrame => ({ ...NO_INPUT, ...over })

export const start = (opts: StartOptions = {}, config = cfg) => createGtoState(world, config, opts)

/** 同じ入力で seconds 秒ぶん進める */
export function run(state: GtoState, seconds: number, over: Partial<InputFrame> = {}, config = cfg): GtoState {
  let s = state
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepGto(s, input(over), world, config, DT)
  return s
}
