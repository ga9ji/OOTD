import { useGameFullscreen } from '../lib/gameFullscreen'
import { useI18n } from '../lib/i18n'

/** ゲームを全画面にする／戻すボタン。どのゲームのどの画面にも同じものを置く。 */
export default function GameFullscreenButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const { active, toggle } = useGameFullscreen()
  const label = t(active ? '全画面を終了' : '全画面にする')
  return (
    <button
      type="button"
      className={`game-fs-btn${className ? ` ${className}` : ''}`}
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        {active ? (
          <path d="M6 1.5V6H1.5M10 1.5V6h4.5M6 14.5V10H1.5M10 14.5V10h4.5" />
        ) : (
          <path d="M1.5 6V1.5H6M14.5 6V1.5H10M1.5 10v4.5H6M14.5 10v4.5H10" />
        )}
      </svg>
    </button>
  )
}
