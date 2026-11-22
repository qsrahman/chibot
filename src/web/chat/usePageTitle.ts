import { useEffect } from 'react'
import { useAnswerAlert } from './useAnswerAlert.ts'

/**
 * Tabs, history and bookmarks name the chat (or project) on screen; a bullet
 * marks an answer or approval waiting while the page is in the background.
 */
export function usePageTitle(
  chat: string | undefined,
  pageTitle: string | null | undefined,
  state: { busy: boolean; waiting: boolean; failed: boolean },
) {
  const alerted = useAnswerAlert(chat, state, pageTitle ?? 'chibot')
  useEffect(() => {
    const name = pageTitle ? `${pageTitle} – chibot` : 'chibot'
    document.title = alerted ? `• ${name}` : name
  }, [pageTitle, alerted])
}
