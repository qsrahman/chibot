import { useEffect, useState } from 'react'

/** `null` follows the system; otherwise the user's override. */
export type ColorScheme = 'light' | 'dark' | null

// The same key the inline script in index.html reads before first paint.
const KEY = 'chibot.colorScheme'
const meta = () =>
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!

function load(): ColorScheme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function apply(scheme: ColorScheme) {
  meta().content = scheme ?? 'light dark'
}

/**
 * The colour-scheme setting (PLAN.md §6: a browser preference). It's
 * applied through `<meta name="color-scheme">`, which the CSS maps to
 * `color-scheme`, and kept in sync across tabs.
 */
const systemQuery = matchMedia('(prefers-color-scheme: dark)')

export function useColorScheme() {
  const [scheme, setScheme] = useState<ColorScheme>(load)
  const [systemDark, setSystemDark] = useState(systemQuery.matches)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return
      const next = load()
      setScheme(next)
      apply(next)
    }
    const onSystem = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    window.addEventListener('storage', onStorage)
    systemQuery.addEventListener('change', onSystem)
    return () => {
      window.removeEventListener('storage', onStorage)
      systemQuery.removeEventListener('change', onSystem)
    }
  }, [])

  function choose(next: ColorScheme) {
    setScheme(next)
    apply(next)
    try {
      if (next) localStorage.setItem(KEY, next)
      else localStorage.removeItem(KEY)
    } catch {
      // Not persisted (e.g. blocked site data), but applied for this visit.
    }
  }

  return {
    scheme,
    systemScheme: systemDark ? 'dark' : 'light',
    choose,
  } as const
}
