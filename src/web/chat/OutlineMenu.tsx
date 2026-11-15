import { useMemo, useState, type RefObject } from 'react'
import { ListTree } from 'lucide-react'
import { jumpTo } from './find.ts'
import { useAnchoredPopover } from '../ui/popover.ts'
import { currentOutlineIndex, OUTLINE_FROM, outlineOf } from './outline.ts'
import type { Turn } from './turns.ts'

/** A header button and the list of the chat's messages, to jump to one. */
export function OutlineMenu({
  turns,
  thread,
  onJump,
}: {
  turns: Turn[]
  thread: RefObject<HTMLElement | null>
  /** Called before the view moves to a message. */
  onJump: () => void
}) {
  const menu = useAnchoredPopover()
  const items = useMemo(() => outlineOf(turns), [turns])
  const [current, setCurrent] = useState(0)
  if (items.length < OUTLINE_FROM) return null

  const turnElements = () => [
    ...(thread.current?.querySelectorAll(':scope > .turn') ?? []),
  ]

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Message outline"
        title="Message outline"
        popoverTarget={menu.id}
        style={menu.triggerStyle}
      >
        <ListTree size={20} strokeWidth={1.5} />
      </button>
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu outline"
        role="menu"
        aria-label="Your messages"
        style={menu.style}
        onKeyDown={menu.menuProps.onKeyDown}
        onToggle={(e) => {
          if (e.target !== e.currentTarget || e.newState !== 'open') return
          // Opens on the message in view, not the first.
          const list = thread.current?.parentElement
          const top = list?.getBoundingClientRect().top ?? 0
          const tops = turnElements().map(
            (el) => el.getBoundingClientRect().top - top,
          )
          const at = currentOutlineIndex(tops, (list?.clientHeight ?? 0) / 2)
          setCurrent(at)
          const item =
            e.currentTarget.querySelectorAll<HTMLElement>('.menu-item')[at]
          item?.focus()
          item?.scrollIntoView({ block: 'center' })
        }}
      >
        {items.map(({ index, label }) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            className="menu-item"
            aria-current={index === current ? 'true' : undefined}
            onClick={() => {
              menu.hide()
              onJump()
              jumpTo(turnElements()[index], 'start')
            }}
          >
            <span className="outline-number">{index + 1}</span>
            <span className="outline-label" dir="auto">
              {label}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
