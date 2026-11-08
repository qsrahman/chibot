import { Check, ChevronDown } from 'lucide-react'
import {
  EFFORT_HINTS,
  effortChoices,
  effortLabel,
} from '../../shared/reasoning.ts'
import type { Settings } from '../../shared/settings.ts'
import { useAnchoredPopover } from '../ui/popover.ts'

type Effort = Settings['reasoningEffort']

/** Picks the reasoning effort for the next messages (also in Settings). */
export function EffortSwitch({
  effort,
  onChange,
}: {
  effort: Effort
  onChange: (effort: Effort) => void
}) {
  const menu = useAnchoredPopover()
  const label = effortLabel(effort)
  return (
    <>
      <button
        type="button"
        className="mode-button"
        aria-label={`Reasoning effort: ${label}`}
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
        aria-label="Reasoning effort"
        style={menu.style}
        {...menu.menuProps}
      >
        {effortChoices(effort).map((option) => (
          <button
            key={option ?? 'auto'}
            type="button"
            role="menuitemradio"
            aria-checked={option === effort}
            className="menu-item has-hint"
            onClick={() => {
              menu.hide()
              if (option !== effort) onChange(option)
            }}
          >
            <span className="menu-item-text">
              {effortLabel(option)}
              <span className="menu-hint">
                {EFFORT_HINTS[option ?? 'auto']}
              </span>
            </span>
            {option === effort && <Check size={16} strokeWidth={1.5} />}
          </button>
        ))}
      </div>
    </>
  )
}
