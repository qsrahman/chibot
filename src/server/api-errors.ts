import { APIConnectionError, APIError } from 'openai'

// Servers say it in their own words: OpenAI's code is `insufficient_quota`,
// Ollama Cloud says "monthly usage limit".
const OUT_OF_QUOTA = /quota|usage limit|billing|credits|upgrade|subscription/i

/**
 * What the user sees for a failed chat request: the server's message, and for
 * a 429 (which servers use both for "slow down" and for "you've used up your
 * plan") which of the two it is and what to do about it.
 */
export function explainApiError(err: APIError): string {
  if (err.status !== 429) return err.message
  const said = err.message.replace(/^429\s+/, '')
  if (err.code === 'insufficient_quota' || OUT_OF_QUOTA.test(said)) {
    return (
      'This model server says you have reached its usage limit. Pick another ' +
      'model in the header, or add credits or upgrade with the provider. ' +
      `The server said: ${said}`
    )
  }
  const seconds = Number(err.headers?.get('retry-after'))
  const wait = seconds > 0 ? ` (try again in ${Math.ceil(seconds)} s)` : ''
  return (
    `This model server is limiting requests right now${wait}. Wait a moment ` +
    'and send again, or pick another model in the header. ' +
    `The server said: ${said}`
  )
}

/**
 * Why a request never reached the server: the first `code` (`ECONNREFUSED`, …)
 * in the error's chain of causes, else what the deepest cause says ("bad port").
 */
function whyUnreachable(err: unknown): string | undefined {
  let deepest: string | undefined
  let e = (err as { cause?: unknown } | undefined)?.cause as
    { code?: unknown; message?: unknown; cause?: unknown } | undefined
  for (let i = 0; e && i < 5; i++, e = e.cause as typeof e) {
    if (typeof e.code === 'string') return e.code
    if (typeof e.message === 'string' && e.message !== 'fetch failed') {
      deepest = e.message
    }
  }
  return deepest
}

/**
 * Says on the console that something at a model server failed. A server that
 * is down or refuses is an ordinary condition, so it gets one line (with why:
 * `ECONNREFUSED`, …) rather than a stack trace; anything else keeps its stack,
 * since that may be a bug.
 */
export function logFailure(what: string, err: unknown): void {
  if (err instanceof APIConnectionError) {
    const code = whyUnreachable(err)
    console.error(`${what}: can't reach the server${code ? ` (${code})` : ''}`)
  } else if (err instanceof APIError) {
    console.error(`${what}: ${err.message}`)
  } else {
    console.error(`${what}:`, err)
  }
}
