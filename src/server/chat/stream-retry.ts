import { setTimeout as sleep } from 'node:timers/promises'
import OpenAI from 'openai'
import { isContextOverflow, StreamTooLong } from './context.ts'

/** Waits before each retry of a stream that dropped before any output. */
const RETRY_DELAYS_MS = [500, 1500] as const

export const MAX_STREAM_RETRIES = RETRY_DELAYS_MS.length

/**
 * Whether a stream failed the way a lost connection does: undici ends a
 * response that was cut with a `TypeError` ("terminated"), and the SDK reports
 * its own timeouts and resets as `APIConnectionError`. Failures the server
 * sent (a status, or an error inside the stream) are not here, because
 * repeating the request would only get them again, and the SDK has already
 * retried the request itself (it does for 408, 409, 429 and 5xx).
 */
export function isDroppedStream(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIConnectionError ||
    (err instanceof TypeError && !(err instanceof OpenAI.APIError))
  )
}

/** Waits for retry number `attempt` (from 0), a little randomly; rejects when `signal` aborts. */
export function waitToRetry(attempt: number, signal?: AbortSignal) {
  const jitter = Math.floor(Math.random() * 151)
  return sleep(RETRY_DELAYS_MS[attempt]! + jitter, undefined, { signal })
}

/** What a failed request of a turn's model call gets next (see `recoveryFor`). */
export interface RecoveryState {
  /** The server accepted the request: the failure came from the stream. */
  connected: boolean
  /** The model has begun answering: a repeat would show the user the same text twice. */
  started: boolean
  /** Times it was asked again after a drop. */
  dropped: number
  /** The context was already summarized harder for this request. */
  compacted: boolean
  aborted: boolean
  autoCompact: boolean
}

/**
 * How to go on after `err`, or `null` to fail with it:
 * - `'wait'`: the connection dropped before any output; ask again after a
 *   short wait, without the user having seen a thing.
 * - `'compact'`: the estimate was too low and the server says the request is
 *   too long, in its reply or at the start of the stream; summarize harder
 *   and ask once more.
 */
export function recoveryFor(
  err: unknown,
  s: RecoveryState,
): 'wait' | 'compact' | null {
  if (s.started) return null
  if (
    s.connected &&
    s.dropped < MAX_STREAM_RETRIES &&
    !s.aborted &&
    isDroppedStream(err)
  ) {
    return 'wait'
  }
  if (
    !s.compacted &&
    s.autoCompact &&
    (isContextOverflow(err) || err instanceof StreamTooLong)
  ) {
    return 'compact'
  }
  return null
}
