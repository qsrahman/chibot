import { useEffect, type RefObject } from 'react'

/**
 * Keeps toasts above `box`, however tall it grows (see toast.css). A box that
 * is not at the bottom of the window (a project's, or the new-chat page's)
 * leaves them where they are by default.
 */
export function useToastAbove(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = box.current
    if (!element) return
    const root = document.documentElement
    const place = () => {
      const { top, bottom } = element.getBoundingClientRect()
      if (window.innerHeight - bottom < 160) {
        root.style.setProperty(
          '--toast-bottom',
          `${window.innerHeight - top + 12}px`,
        )
      } else root.style.removeProperty('--toast-bottom')
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      root.style.removeProperty('--toast-bottom')
    }
  }, [])
}
