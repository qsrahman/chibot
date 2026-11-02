// A small HTTP client for the Northwind orders API.

export interface RetryOptions {
  /** How many times to retry after the first attempt. */
  retries: number
  /** The wait before the first retry; doubled each time. */
  baseDelayMs: number
}

const DEFAULT_RETRY: RetryOptions = { retries: 3, baseDelayMs: 200 }

/** Waits `ms` milliseconds. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetches `url`, retrying on network errors and on 502, 503 and 504 with
 * exponential backoff. Other statuses are returned to the caller as they are.
 */
export async function fetchWithRetry(
  url: string,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<Response> {
  let delay = options.baseDelayMs
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url)
      if (![502, 503, 504].includes(response.status)) return response
      if (attempt >= options.retries) return response
    } catch (error) {
      if (attempt >= options.retries) throw error
    }
    await sleep(delay)
    delay *= 2
  }
}

/** A token bucket: at most `capacity` calls in a burst, refilled per second. */
export class RateLimiter {
  readonly capacity: number
  readonly refillPerSecond: number
  #tokens: number
  #last = Date.now()

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity
    this.refillPerSecond = refillPerSecond
    this.#tokens = capacity
  }

  /** Takes a token if one is free; false when the caller must wait. */
  tryAcquire(): boolean {
    const now = Date.now()
    const earned = ((now - this.#last) / 1000) * this.refillPerSecond
    this.#tokens = Math.min(this.capacity, this.#tokens + earned)
    this.#last = now
    if (this.#tokens < 1) return false
    this.#tokens -= 1
    return true
  }
}

export interface Order {
  id: string
  customerId: string
  totalCents: number
  status: 'pending' | 'paid' | 'shipped' | 'cancelled'
}

/** Orders that are still open: pending or paid, not yet shipped. */
export function openOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status === 'pending' || o.status === 'paid')
}

/** The total of the orders in euros, rounded to cents. */
export function totalInEuros(orders: Order[]): number {
  const cents = orders.reduce((sum, o) => sum + o.totalCents, 0)
  return Math.round(cents) / 100
}

/** Parses "KEY=value" lines into an object, ignoring comments and blanks. */
export function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at > 0) result[trimmed.slice(0, at)] = trimmed.slice(at + 1)
  }
  return result
}
