import { useEffect, useState } from 'react'
import { readStored, writeStored } from './storage.ts'

/**
 * A browser preference from a fixed list of values (PLAN.md §6), kept in
 * `localStorage` under `key`, applied with `apply` (the same way the inline
 * script in index.html does before first paint), and synced across tabs.
 * `null` is the default.
 */
function useStoredChoice<T extends string>(
  key: string,
  values: readonly T[],
  apply: (value: T | null) => void,
) {
  const load = () => values.find((v) => v === readStored(key)) ?? null
  const [value, setValue] = useState<T | null>(load)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return
      const next = load()
      setValue(next)
      apply(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  })

  function choose(next: T | null) {
    setValue(next)
    apply(next)
    writeStored(key, next)
  }
  return [value, choose] as const
}

/** The accent presets (the colours are in base.css); the default is blue. */
export const ACCENTS = [
  { value: 'violet', label: 'Violet' },
  { value: 'teal', label: 'Teal' },
  { value: 'green', label: 'Green' },
  { value: 'orange', label: 'Orange' },
  { value: 'pink', label: 'Pink' },
] as const
type Accent = (typeof ACCENTS)[number]['value']

export function useAccent() {
  return useStoredChoice<Accent>(
    'chibot.accent',
    ACCENTS.map((a) => a.value),
    (accent) => {
      if (accent) document.documentElement.dataset.accent = accent
      else delete document.documentElement.dataset.accent
    },
  )
}
