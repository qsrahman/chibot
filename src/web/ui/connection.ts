import { useSyncExternalStore } from 'react'

/** Whether the last request to chibot's API reached chibot (see `apiFetch`). */
let unreachable = false
const listeners = new Set<() => void>()

/**
 * Whether a response is not chibot's: a proxy's gateway error. chibot's own
 * 502s (the model endpoint failed) are JSON, so they are not a lost connection.
 */
export const isGatewayFailure = (status: number, contentType: string | null) =>
  (status === 502 || status === 503 || status === 504) &&
  !contentType?.includes('application/json')

/** Called by every API request with whether it reached chibot. */
export function reportReachable(reachable: boolean) {
  if (unreachable === !reachable) return
  unreachable = !reachable
  listeners.forEach((listener) => listener())
}

/** The same, outside React. */
export const isUnreachable = () => unreachable

export const useUnreachable = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, isUnreachable)

/** How often a visible page checks that chibot is still there. */
export const HEALTH_CHECK_MS = 30_000

/** When to look again after `attempt` failed looks: 2 s, growing to 15 s. */
export const reconnectDelay = (attempt: number) =>
  Math.min(2000 * 1.5 ** attempt, 15_000)
