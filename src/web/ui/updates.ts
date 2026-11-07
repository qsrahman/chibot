import { useEffect, useRef } from 'react'
import type { Health } from '../../shared/types.ts'
import { useToast } from './toast.tsx'

const RELOADED = 'chibot.reloadedFor'

/**
 * A lazily loaded chunk that is gone means chibot was rebuilt since this page
 * loaded (a build replaces every file). Reload once for the new build; unsent
 * drafts are kept in `localStorage`. Once per build, so a chunk that is really
 * missing can't loop.
 */
export function reloadOnMissingChunk() {
  window.addEventListener('vite:preloadError', (event) => {
    try {
      if (sessionStorage.getItem(RELOADED) === __BUILD_ID__) return
      sessionStorage.setItem(RELOADED, __BUILD_ID__)
    } catch {
      return
    }
    event.preventDefault()
    location.reload()
  })
}

/**
 * Says so when the server serves a newer build than this page came from, with
 * a button to reload. `health` is checked again whenever the page returns to
 * the front (see `App`).
 */
export function useUpdateNotice(health: Health | undefined) {
  const { toast } = useToast()
  const told = useRef<string | null>(null)
  const build = health?.build
  useEffect(() => {
    if (!build || build === __BUILD_ID__ || told.current === build) return
    told.current = build
    toast('chibot was updated. Reload to use the new version.', {
      kind: 'info',
      action: { label: 'Reload', onClick: () => location.reload() },
      // Until it is used: a page that is out of date can break.
      duration: 24 * 60 * 60 * 1000,
    })
  }, [build, toast])
}
