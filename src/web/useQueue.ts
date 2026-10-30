import { useRef, useState } from 'react'

/** A message to send once the current answer is saved. */
export interface Queued {
  text: string
  /** A tool to force on that message. */
  tool?: string
}

/**
 * A message typed while an answer streams (text only: files need uploading
 * first). `take` reads the latest value, for a run's async continuation, where
 * the state variable would be stale.
 */
export function useQueue() {
  const [queued, setQueued] = useState<Queued | null>(null)
  const latest = useRef<Queued | null>(null)
  latest.current = queued
  return {
    queued,
    put: setQueued,
    clear: () => setQueued(null),
    /** Empties the queue; the message that was in it, if any. */
    take(): Queued | null {
      const next = latest.current
      if (next) setQueued(null)
      return next
    },
  }
}
