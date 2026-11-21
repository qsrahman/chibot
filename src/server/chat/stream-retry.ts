import { setTimeout as sleep } from 'node:timers/promises'
import OpenAI from 'openai'

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
