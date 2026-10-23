import { useId, useRef } from 'react'

/**
 * A popover placed by CSS anchor positioning next to the button that opens
 * it (`.menu` in styles.css: below, flipping when there's no room).
 *
 * Usage: `<button popoverTarget={id} style={triggerStyle}>` and
 * `<div id={id} ref={ref} popover="auto" className="menu" style={style}>`.
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
  }
}
