import { useState } from 'react'
import { readStored, writeStored } from './storage.ts'

// A browser preference (PLAN.md §6): whether to raise a notification when an
// answer is ready while chibot is in the background. Off until asked for,
// since the browser asks the user's leave the first time.
const KEY = 'chibot.notify'

const supported = () => typeof Notification !== 'undefined'

export function notificationsOn(): boolean {
  return (
    supported() &&
    readStored(KEY) === '1' &&
    Notification.permission === 'granted'
  )
}

/** Raises a notification, if they are on; clicking it brings chibot back. */
export function notify(title: string, body: string) {
  if (!notificationsOn()) return
  const note = new Notification(title, { body, tag: 'chibot-answer' })
  note.onclick = () => {
    window.focus()
    note.close()
  }
}

/** The Settings switch: asks the browser's leave when turned on. */
export function useNotifyPreference() {
  const [on, setOn] = useState(notificationsOn)
  const [blocked, setBlocked] = useState(
    () => supported() && Notification.permission === 'denied',
  )
  return {
    supported: supported(),
    on,
    /** The browser refused (change it in the site's settings). */
    blocked,
    async choose(next: boolean) {
      if (next) {
        const permission = await Notification.requestPermission()
        setBlocked(permission === 'denied')
        next = permission === 'granted'
      }
      writeStored(KEY, next ? '1' : '0')
      setOn(next)
    },
  }
}
