import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { explainApiError } from '../../src/server/api-errors.ts'

const rateLimit = (message: string, headers: Record<string, string> = {}) =>
  new OpenAI.RateLimitError(429, { message }, message, new Headers(headers))

describe('explainApiError', () => {
  it('says when the plan’s usage limit is reached, in either server’s words', () => {
    // Ollama Cloud's wording, as seen from a real account.
    const ollama = explainApiError(
      rateLimit(
        'you (someone) have reached your monthly usage limit, upgrade for higher limits: https://ollama.com/upgrade',
      ),
    )
    expect(ollama).toMatch(
      /^This model server says you have reached its usage limit/,
    )
    expect(ollama).toContain('Pick another model in the header')
    expect(ollama).toContain('The server said: you (someone) have reached')
    expect(ollama).not.toContain('429')

    // OpenAI marks it with a code instead.
    const openai = explainApiError(
      new OpenAI.RateLimitError(
        429,
        {
          message: 'You exceeded your current limit.',
          code: 'insufficient_quota',
        },
        'You exceeded your current limit.',
        new Headers(),
      ),
    )
    expect(openai).toMatch(/reached its usage limit/)
  })

  it('says when the server is only slowing down, with how long to wait', () => {
    const slow = explainApiError(
      rateLimit('Too many requests', { 'retry-after': '12' }),
    )
    expect(slow).toContain('limiting requests right now (try again in 12 s)')
    expect(slow).toContain('The server said: Too many requests')
    expect(explainApiError(rateLimit('Too many requests'))).toContain(
      'limiting requests right now. Wait a moment',
    )
  })

  it('leaves every other error as the server worded it', () => {
    const bad = new OpenAI.AuthenticationError(
      401,
      { message: 'Incorrect API key' },
      'Incorrect API key',
      new Headers(),
    )
    expect(explainApiError(bad)).toBe(bad.message)
  })
})
