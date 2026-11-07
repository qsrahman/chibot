import { useEffect, useRef, useState } from 'react'
import { notify } from '../ui/notifications.ts'

/**
 * Tells you that an answer is done, or a tool waits for your approval, while
 * the page is in the background: `alerted` is true until you come back (the
 * page title shows it), and a notification is raised if you turned those on.
 * `busy` is whether an answer is streaming; `waiting` whether a tool needs
 * approval; `failed` whether the turn ended in an error.
 */
export function useAnswerAlert(
  chat: string | undefined,
  {
    busy,
    waiting,
    failed,
  }: { busy: boolean; waiting: boolean; failed: boolean },
  title: string,
) {
  const [alerted, setAlerted] = useState(false)
  const wasBusy = useRef(false)

  useEffect(() => {
    if (wasBusy.current && !busy && document.hidden) {
      setAlerted(true)
      notify(
        title,
        failed
          ? 'The answer failed'
          : waiting
            ? 'A tool is waiting for your approval'
            : 'Answer ready',
      )
    }
    wasBusy.current = busy
    // Only the end of an answer matters, not a change of title or of state after it.
  }, [busy])

  // Back in front, or in another chat: nothing to tell.
  useEffect(() => {
    const seen = () =>
      document.visibilityState === 'visible' && setAlerted(false)
    const focused = () => setAlerted(false)
    document.addEventListener('visibilitychange', seen)
    window.addEventListener('focus', focused)
    return () => {
      document.removeEventListener('visibilitychange', seen)
      window.removeEventListener('focus', focused)
    }
  }, [])
  useEffect(() => setAlerted(false), [chat])

  return alerted
}
