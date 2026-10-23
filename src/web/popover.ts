import { useId, useRef, useState, type CSSProperties } from 'react'

/**
 * A popover placed under (or above) the button that opens it. CSS anchor positioning
 * isn't in every browser yet, so the trigger calls `place` on click (before
 * the popover opens) and the popover gets fixed coordinates.
 *
 * Usage: `<button popoverTarget={id} onClick={(e) => place(e.currentTarget)}>`
 * and `<div id={id} ref={ref} popover="auto" className="menu" style={style}>`.
 */
export function useAnchoredPopover() {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>()

  function place(trigger: HTMLElement, { above = false } = {}) {
    const r = trigger.getBoundingClientRect()
    setStyle(
      above
        ? { bottom: innerHeight - r.top + 4, left: r.left }
        : { top: r.bottom + 4, left: r.left },
    )
  }

  const hide = () => ref.current?.hidePopover()

  return { id, ref, style, place, hide }
}
