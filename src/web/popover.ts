import { useId, useRef, type KeyboardEvent, type ToggleEvent } from 'react'

/**
 * A popover placed by CSS anchor positioning next to the button that opens
 * it (`.menu` in styles.css: below, flipping when there's no room).
 *
 * Usage: `<button popoverTarget={id} style={triggerStyle}>` and
 * `<div id={id} ref={ref} popover="auto" className="menu" style={style}>`;
 * a menu of `.menu-item`s also spreads `menuProps` for the keyboard.
 */
export function useAnchoredPopover() {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  // useId's characters aren't all valid in a CSS name.
  const anchorName = `--anchor-${id.replace(/[^\w-]/g, '')}`
  return {
    id,
    ref,
    triggerStyle: { anchorName },
    style: { positionAnchor: anchorName },
    hide: () => ref.current?.hidePopover(),
    menuProps: { onToggle: focusFirstItem, onKeyDown: moveBetweenItems },
  }
}

// The menu's usable items, in order.
const itemsOf = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)'),
]

// A menu opens on its first item, so the arrow keys work straight away.
// (Closing it with Esc returns focus to its button: the Popover API does.)
function focusFirstItem(e: ToggleEvent<HTMLElement>) {
  if (e.newState === 'open') itemsOf(e.currentTarget)[0]?.focus()
}

// ↑ / ↓ move between items (wrapping round), Home / End to the ends.
function moveBetweenItems(e: KeyboardEvent<HTMLElement>) {
  const items = itemsOf(e.currentTarget)
  if (items.length === 0) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'ArrowDown'
      ? (at + 1) % items.length
      : e.key === 'ArrowUp'
        ? (at - 1 + items.length) % items.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : null
  if (next === null) return
  e.preventDefault()
  items[next]!.focus()
}
