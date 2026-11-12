import OpenAI from 'openai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { explainApiError, logFailure } from '../../src/server/api-errors.ts'

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

describe('logFailure', () => {
  afterEach(() => vi.restoreAllMocks())
  const logged = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  it('says a server that is down in one line, with why', () => {
    const log = logged()
    // As the SDK reports a refused connection: fetch failed, caused by ECONNREFUSED.
    const refused = Object.assign(new AggregateError([], ''), {
      code: 'ECONNREFUSED',
    })
    const err = new OpenAI.APIConnectionError({
      cause: new TypeError('fetch failed', { cause: refused }),
    })
    logFailure('Listing models from http://localhost:11434/v1 failed', err)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Listing models from http://localhost:11434/v1 failed: can't reach the server (ECONNREFUSED)",
    )
  })

  it('says what the deepest cause says when there is no code', () => {
    const log = logged()
    const err = new OpenAI.APIConnectionError({
      cause: new TypeError('fetch failed', { cause: new Error('bad port') }),
    })
    logFailure('Listing models failed', err)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Listing models failed: can't reach the server (bad port)",
    )
  })

  it('gives the server’s own message for an error it answered with', () => {
    const log = logged()
    logFailure(
      'Transcription failed',
      new OpenAI.NotFoundError(
        404,
        { message: 'no such model' },
        'no such model',
        new Headers(),
      ),
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Transcription failed: 404 no such model',
    )
  })

  it('keeps the stack of anything else, which may be a bug', () => {
    const log = logged()
    const err = new TypeError('x is not a function')
    logFailure('Title generation failed', err)
    expect(log).toHaveBeenCalledExactlyOnceWith('Title generation failed:', err)
  })
})
