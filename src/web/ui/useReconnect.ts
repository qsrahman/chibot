import { useCallback, useEffect, useRef, useState } from 'react'
import { reconnectDelay, useUnreachable } from './connection.ts'
import { useToast } from './toast.tsx'

/**
 * While chibot can't be reached, looks again with `probe` (an API request,
 * which tells `useUnreachable` how it went) after a growing delay, and when
 * the tab comes back to the front; a hidden tab is left alone. When chibot
 * answers, says so and calls `onBack` to load again what had failed.
 */
export function useReconnect(
  probe: () => Promise<unknown>,
  onBack: () => void,
) {
  const unreachable = useUnreachable()
  const { toast } = useToast()
  const [checking, setChecking] = useState(false)
  const wasDown = useRef(false)
  const back = useRef(onBack)
  back.current = onBack

  /** Looks now (Retry). */
  const retry = useCallback(async () => {
    setChecking(true)
    await probe().catch(() => {})
    setChecking(false)
  }, [probe])

  useEffect(() => {
    if (unreachable) {
      wasDown.current = true
      return
    }
    if (!wasDown.current) return
    wasDown.current = false
    toast('Reconnected', { kind: 'success' })
    back.current()
  }, [unreachable, toast])

  useEffect(() => {
    if (!unreachable) return
    let attempt = 0
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const look = () => void probe().catch(() => {})
    const wait = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible')
          await probe().catch(() => {})
        if (!stopped) wait()
      }, reconnectDelay(attempt++))
    }
    const onShow = () => document.visibilityState === 'visible' && look()
    wait()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [unreachable, probe])

  return { unreachable, checking, retry }
}

export type Connection = ReturnType<typeof useReconnect>
