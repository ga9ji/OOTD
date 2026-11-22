// Grand Theft Outfit [部品: areas] メニューの「のりかえ」。ほかのエリアへ移るボタンを、メニュー（M キーかミニマップで開く）の操作列の下に並べる。
// 入口: <GtoMenuTravel engine onTravel />（遊んでいるあいだだけ置く。見えるのはメニューを開いているあいだだけで、gto.css が出し分ける）
// 契約: 行き先は、いまいるエリア以外の全エリア（lib/gto/areas.ts の AREA_IDS の順）。押すとメニューを閉じてから onTravel を呼ぶ。
//       手配が付いているあいだは押せない（手配度は持ち越さないので、逃げ道にしない）。進行中の依頼があれば、取り消しになると添える。
//       手配度と依頼の有無は、メニューを開いているあいだも街が動くので、エンジンから数フレームおきに読み直す。
import { useEffect, useState } from 'react'
import { AREA_IDS, AREAS } from '../../lib/gto/areas'
import type { AreaId } from '../../lib/gto/types'
import { useI18n } from '../../lib/i18n'
import type { GtoEngine } from './engine'
import { MENU_EVENT } from './GtoHud'

type Props = {
  engine: GtoEngine
  /** 行き先を選んだ（メニューを閉じたあとに呼ぶ） */
  onTravel: (to: AreaId) => void
}

/** 手配度と依頼の有無を読み直す間隔（フレーム） */
const STATUS_EVERY = 10

export default function GtoMenuTravel({ engine, onTravel }: Props) {
  const { t } = useI18n()
  const [status, setStatus] = useState(() => engine.status())
  useEffect(() => {
    let count = 0
    setStatus(engine.status())
    return engine.subscribe(() => {
      if (count++ % STATUS_EVERY !== 0) return
      const next = engine.status()
      setStatus((cur) => (cur.wanted === next.wanted && cur.onMission === next.onMission ? cur : next))
    })
  }, [engine])

  const here = engine.world.area
  const blocked = status.wanted > 0
  const go = (to: AreaId, el: HTMLElement) => {
    // メニューを閉じてから街を入れ替える（閉じないと、移った先でもメニューが開いたまま始まる）
    el.closest('.gto-stage')?.dispatchEvent(new Event(MENU_EVENT))
    onTravel(to)
  }
  return (
    <div className="gto-menu-travel jp">
      <p>
        <b>{t('のりかえ')}</b>
        <span>{t('いま: {place}', { place: t(AREAS[here].name) })}</span>
      </p>
      <div className="gto-menu-travel-go">
        {AREA_IDS.filter((id) => id !== here).map((id) => (
          <button type="button" key={id} disabled={blocked} onClick={(e) => go(id, e.currentTarget)}>
            {t('{place}へ行く', { place: t(AREAS[id].name) })}
          </button>
        ))}
      </div>
      {(blocked || status.onMission) && <small>{t(blocked ? '手配中は移動できない' : '移動すると、進行中の依頼は取り消しになる')}</small>}
    </div>
  )
}
