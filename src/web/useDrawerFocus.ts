import { useEffect, type RefObject } from 'react'

/**
 * The phone drawer covers the page like a dialog: focus moves into it while
 * `open`, and back to what opened it once it closes (the page behind is
 * inert, and Escape closes it: see App and the nav's onKeyDown).
 */
export function useDrawerFocus(
  open: boolean,
  nav: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    nav.current?.querySelector<HTMLElement>('button, a[href]')?.focus()
    return () => {
      // Unless something else has taken focus meanwhile (a chat opened).
      // Hiding the drawer has usually sent it to the page by now.
      const active = document.activeElement
      const free =
        !active || active === document.body || nav.current?.contains(active)
      if (opener instanceof HTMLElement && opener.isConnected && free) {
        opener.focus()
      }
    }
  }, [open])
}
