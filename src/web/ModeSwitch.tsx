import { Check, ChevronDown } from 'lucide-react'
import type { Settings } from '../shared/settings.ts'
import { useAnchoredPopover } from './popover.ts'

type Effort = Settings['reasoningEffort']

/** The composer's modes: named reasoning efforts (the rest are in Settings). */
const MODES: { label: string; effort: Effort; hint: string }[] = [
  { label: 'Auto', effort: null, hint: 'The model decides how long to think' },
  { label: 'Fast', effort: 'low', hint: 'Answers quickly' },
  {
    label: 'Thinking',
    effort: 'high',
    hint: 'Thinks longer for harder questions',
  },
]

/** Picks the reasoning effort for the next messages, as a mode. */
export function ModeSwitch({
  effort,
  onChange,
}: {
  effort: Effort
  onChange: (effort: Effort) => void
}) {
  const menu = useAnchoredPopover()
  // An effort chosen elsewhere that no mode names shows as itself.
  const label = MODES.find((m) => m.effort === effort)?.label ?? effort
  return (
    <>
      <button
        type="button"
        className="mode-button"
        aria-label={`Mode: ${label}`}
        popoverTarget={menu.id}
        style={menu.triggerStyle}
      >
        {label}
        <ChevronDown size={16} strokeWidth={1.5} />
      </button>
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu above"
        role="menu"
        style={menu.style}
        {...menu.menuProps}
      >
        {MODES.map((mode) => (
          <button
            key={mode.label}
            type="button"
            role="menuitemradio"
            aria-checked={mode.effort === effort}
            className="menu-item has-hint"
            onClick={() => {
              menu.hide()
              if (mode.effort !== effort) onChange(mode.effort)
            }}
          >
            <span className="menu-item-text">
              {mode.label}
              <span className="menu-hint">{mode.hint}</span>
            </span>
            {mode.effort === effort && <Check size={16} strokeWidth={1.5} />}
          </button>
        ))}
      </div>
    </>
  )
}
