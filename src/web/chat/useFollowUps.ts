import { useEffect, useRef, useState } from 'react'
import { fetchSuggestions } from './api.ts'
import { suggestionTarget, type Found } from './followUps.ts'
import type { Turn } from './turns.ts'

/**
 * Asks for follow-up suggestions when an answer in this chat has just
 * finished (not on opening a chat), unless `enabled` is off. Failures give none.
 */
export function useFollowUps({
  chatId,
  turns,
  waiting,
  busy,
  queued,
  enabled,
}: {
  chatId: string | undefined
  turns: Turn[]
  waiting: number
  busy: boolean
  queued: boolean
  enabled: boolean
}) {
  const [found, setFound] = useState<Found | null>(null)
  const wasBusy = useRef(busy)
  const target = suggestionTarget(turns, waiting)

  useEffect(() => {
    const finished = wasBusy.current && !busy
    wasBusy.current = busy
    if (!finished || !enabled || !chatId || queued || target === null) return
    const controller = new AbortController()
    fetchSuggestions(chatId, controller.signal).then(
      (suggestions) => setFound({ chatId, itemId: target, suggestions }),
      () => {},
    )
    return () => controller.abort()
  }, [busy, chatId])

  return { found, target }
}
