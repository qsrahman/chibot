import type { APIError } from 'openai'

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
