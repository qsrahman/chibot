import { useEffect, useRef } from 'react'

const SHOW_AFTER = 350
// Moving from one control to the next while a tooltip was just up shows the
// next one at once, as a toolbar does.
const WARM = 400
const GAP = 8
const EDGE = 8

const TARGET = '[title]:not(input, textarea, select)'

/**
 * Tooltips for everything with a `title`, shown sooner than the browser's own
 * (which waits about a second, never appears on a keyboard focus and can't
 * be styled). One element in the top layer serves them all, so nothing clips
 * it and it shows above modal dialogs. While a tooltip is up its element's
 * `title` is set aside (the browser would show its own too) and put back
 * after; an icon-only control keeps its name in `aria-label`.
 */
export function Tooltips() {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tip = layer.current!
    let target: HTMLElement | null = null
    let saved = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastHidden = 0
    let removal: MutationObserver | undefined

    function hide() {
      clearTimeout(timer)
      removal?.disconnect()
      if (tip.matches(':popover-open')) {
        tip.hidePopover()
        lastHidden = Date.now()
      }
      if (target) {
        if (target.isConnected && !target.hasAttribute('title')) {
          target.setAttribute('title', saved)
        }
        target = null
      }
    }

    function show(el: HTMLElement) {
      const text = el.getAttribute('title')?.trim()
      if (!text) return
      target = el
      saved = el.getAttribute('title')!
      // The name an icon-only control had only from its title.
      if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) {
        el.setAttribute('aria-label', text)
      }
      el.removeAttribute('title')
      tip.textContent = text
      tip.showPopover()
      place(tip, el)
      // Gone while shown (a list re-rendered): its tooltip goes too.
      removal = new MutationObserver(() => {
        if (target && !target.isConnected) hide()
      })
      removal.observe(document.body, { childList: true, subtree: true })
    }

    function schedule(el: HTMLElement, immediate: boolean) {
      if (el === target) return
      hide()
      const delay = immediate || Date.now() - lastHidden < WARM ? 0 : SHOW_AFTER
      if (delay === 0) return show(el)
      timer = setTimeout(() => show(el), delay)
    }

    // The shown element has no `title` now, so `closest` can't find it again.
    const owner = (node: EventTarget | null) =>
      target?.contains(node as Node)
        ? target
        : (node as Element).closest<HTMLElement>(TARGET)
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = owner(e.target)
      if (el) schedule(el, false)
      else hide()
    }
    const focus = (e: FocusEvent) => {
      const el = owner(e.target)
      // Only a keyboard's focus: a click focuses a button too.
      if (el?.matches(':focus-visible')) schedule(el, true)
    }
    // Leaving the window, pressing, typing and scrolling all end it.
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) hide()
    }
    const events: [string, EventListener, boolean?][] = [
      ['pointerover', over as EventListener],
      ['focusin', focus as EventListener],
      ['focusout', hide],
      ['pointerdown', hide],
      ['keydown', hide],
      ['scroll', hide, true],
      ['pointerout', out as EventListener],
    ]
    for (const [name, handler, capture] of events) {
      document.addEventListener(name, handler, capture)
    }
    window.addEventListener('blur', hide)
    return () => {
      hide()
      for (const [name, handler, capture] of events) {
        document.removeEventListener(name, handler, capture)
      }
      window.removeEventListener('blur', hide)
    }
  }, [])

  return <div ref={layer} className="tooltip" role="tooltip" popover="manual" />
}

/** Below the element, centred, or above it when there is no room; kept in the window. */
function place(tip: HTMLElement, el: HTMLElement) {
  const anchor = el.getBoundingClientRect()
  const { width, height } = tip.getBoundingClientRect()
  const room = window.innerHeight - anchor.bottom
  const top =
    room >= height + GAP + EDGE
      ? anchor.bottom + GAP
      : Math.max(EDGE, anchor.top - GAP - height)
  const left = Math.min(
    Math.max(EDGE, anchor.left + anchor.width / 2 - width / 2),
    window.innerWidth - width - EDGE,
  )
  tip.style.top = `${top}px`
  tip.style.left = `${left}px`
}
