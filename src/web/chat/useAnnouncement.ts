import { useEffect, useRef, useState } from 'react'

/**
 * What screen readers are told through a live region: an answer starting,
 * then ready or waiting for approval. Errors announce themselves (alert).
 * Cleared when another chat opens.
 */
export function useAnnouncement(
  chat: string | undefined,
  busy: boolean,
  error: string | null,
  waiting: number,
): string {
  const [announcement, setAnnouncement] = useState('')
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy && !wasBusy.current) setAnnouncement('Answering…')
    else if (!busy && wasBusy.current && !error) {
      setAnnouncement(
        waiting > 0 ? 'A tool is waiting for your approval' : 'Answer ready',
      )
    }
    wasBusy.current = busy
  }, [busy, error, waiting])
  useEffect(() => setAnnouncement(''), [chat])
  return announcement
}
