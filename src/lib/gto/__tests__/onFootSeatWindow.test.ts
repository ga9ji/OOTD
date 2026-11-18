import { describe, expect, it } from 'vitest'
import { glassSeen, openingFrom } from '../../../components/gto/renderActorSeat'

describe('gto onfoot: 車内の体を見せるのぞき窓', () => {
  it('閉じたドアの窓越しは、横〜斜め後ろから見ているときだけ（真後ろ・真ん前の浅い角度と、車の内側からは見せない）', () => {
    // 真横 3m
    expect(glassSeen(0, 3)).toBe(true)
    // 斜め後ろ 45°
    expect(glassSeen(3, 3)).toBe(true)
    expect(glassSeen(-3, 3)).toBe(true)
    // 運転中の背後カメラ（後ろ 6m・外へ 0.5m）
    expect(glassSeen(6, 0.5)).toBe(false)
    // 浅い角度（後ろ 5m・外へ 1.5m）
    expect(glassSeen(5, 1.5)).toBe(false)
    // 窓の面の内側・すれすれ
    expect(glassSeen(0, -1)).toBe(false)
    expect(glassSeen(0, 0.1)).toBe(false)
  })

  it('開いたドアの開口は、斜め後ろの外からは板に隠れない所から見え、車の内側からは見えない', () => {
    const angle = 1.13
    expect(openingFrom(3, 2, 1, angle)).not.toBeNull()
    expect(openingFrom(3, -0.5, 1, angle)).toBeNull()
    // ドアの前へ回り込むと、板が開口を全部隠す
    expect(openingFrom(-3, 2, 1, angle)).toBeNull()
  })
})
