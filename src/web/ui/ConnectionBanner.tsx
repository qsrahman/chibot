import { WifiOff } from 'lucide-react'
import type { Connection } from './useReconnect.ts'

/**
 * Over the page while chibot's server can't be reached. Announced once (it
 * stays the same while the page keeps looking), and takes no focus.
 */
export function ConnectionBanner({ checking, retry }: Connection) {
  return (
    <div className="connection-banner" role="alert">
      <WifiOff size={20} strokeWidth={1.5} aria-hidden />
      <div className="connection-text">
        <p className="connection-title">Can’t reach chibot</p>
        <p className="connection-hint">
          Check that <code>chibot</code> is running
          {location.host ? ` (this page expects it at ${location.host})` : ''}.
          This page reconnects by itself.
        </p>
      </div>
      <button
        type="button"
        className="button"
        aria-disabled={checking}
        onClick={() => !checking && void retry()}
      >
        {checking ? 'Trying…' : 'Retry'}
      </button>
    </div>
  )
}
