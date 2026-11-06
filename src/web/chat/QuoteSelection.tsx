import { useEffect, useState, type RefObject } from 'react'
import { Quote } from 'lucide-react'
import { TOUCH_ONLY, useMediaQuery } from '../ui/useMediaQuery.ts'

interface Placing {
  /** Viewport coordinates of the selection's middle, and its top and bottom. */
  x: number
  top: number
  bottom: number
  text: string
}

const EDGE = 56

/**
 * A button next to text selected in the chat (`within`) that quotes it in the
 * message box. It stays out of the way of a phone's own selection menu, which
 * opens above the text, by sitting below it.
 */
export function QuoteSelection({
  within,
  onQuote,
}: {
  within: RefObject<HTMLElement | null>
  onQuote: (text: string) => void
}) {
  const [placing, setPlacing] = useState<Placing | null>(null)
  const touch = useMediaQuery(TOUCH_ONLY)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      const selection = document.getSelection()
      const root = within.current
      const text = selection?.toString().trim()
      if (
        !selection ||
        !root ||
        !text ||
        selection.isCollapsed ||
        !root.contains(selection.anchorNode) ||
        !root.contains(selection.focusNode)
      ) {
        return setPlacing(null)
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setPlacing({
        x: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        text,
      })
    }
    // While the selection is still being dragged, wait for it to settle.
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(check, 150)
    }
    document.addEventListener('selectionchange', soon)
    // Scrolling moves the text under it.
    document.addEventListener('scroll', check, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', soon)
      document.removeEventListener('scroll', check, true)
    }
  }, [within])

  if (!placing) return null
  const below = touch || placing.top < 56
  return (
    <button
      type="button"
      className="quote-button"
      style={{
        left: Math.min(Math.max(placing.x, EDGE), window.innerWidth - EDGE),
        top: below ? placing.bottom + 8 : placing.top - 8,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      }}
      // Keep the selection while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(placing.text)
        document.getSelection()?.removeAllRanges()
        setPlacing(null)
      }}
    >
      <Quote size={16} strokeWidth={1.5} aria-hidden /> Quote
    </button>
  )
}
