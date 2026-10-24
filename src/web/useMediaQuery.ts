import { useSyncExternalStore } from 'react'

/** Phones: the sidebar becomes a drawer over the chat. */
export const NARROW = '(max-width: 767px)'

/** Touch-only devices (a touchscreen laptop still has a fine pointer). */
export const TOUCH_ONLY = '(hover: none) and (pointer: coarse)'

/** Whether `query` matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
  )
}
