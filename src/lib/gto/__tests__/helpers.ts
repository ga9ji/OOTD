// GTO のテストで使う共通の道具（テスト専用。アプリ本体には含めない）。
import { vi } from 'vitest'
import { NO_INPUT } from '../input'
import { loadWorld } from '../map'
import { createGtoState, stepGto, type StartOptions } from '../sim'
import type { GtoState, InputFrame, SimConfig } from '../types'

export const world = loadWorld()
export const cfg: SimConfig = { maxVehicles: 8, maxPeds: 12, outfitKeys: ['a', 'b', 'c', 'd'] }
export const DT = 1 / 60

/** 街を何十秒ぶんも進めるテストに与える時間の上限（ミリ秒）。 */
export const LONG_SIM_TIMEOUT_MS = 30_000

/**
 * 街を何十秒ぶんも進める重いテストのファイルで、先頭で1回呼ぶ。
 * 手元では 1〜2 秒で終わるが、CI の機械では数倍かかり、vitest の既定の 5 秒を超えて落ちる。
 * 設定はそのテストファイルの中だけに効く。
 */
export const allowLongSimulations = (): void => {
  vi.setConfig({ testTimeout: LONG_SIM_TIMEOUT_MS })
}
export const input = (over: Partial<InputFrame> = {}): InputFrame => ({ ...NO_INPUT, ...over })

export const start = (opts: StartOptions = {}, config = cfg) => createGtoState(world, config, opts)

/** 同じ入力で seconds 秒ぶん進める */
export function run(state: GtoState, seconds: number, over: Partial<InputFrame> = {}, config = cfg): GtoState {
  let s = state
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepGto(s, input(over), world, config, DT)
  return s
}
