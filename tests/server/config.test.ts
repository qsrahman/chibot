import { describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'

describe('Config', () => {
  it('applies defaults', () => {
    const config = new Config({ OPENAI_API_KEY: 'sk-test' })
    expect(config).toMatchObject({
      apiKey: 'sk-test',
      model: 'gpt-6-astra',
      host: '127.0.0.1',
      port: 3000,
    })
    expect(config.isLoopback).toBe(true)
  })

  it('flags a non-loopback HOST', () => {
    const config = new Config({ OPENAI_API_KEY: 'k', HOST: '0.0.0.0' })
    expect(config.host).toBe('0.0.0.0')
    expect(config.isLoopback).toBe(false)
  })

  it('reads overrides', () => {
    const config = new Config({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-6.1-sol',
      PORT: '8080',
    })
    expect(config.model).toBe('gpt-6.1-sol')
    expect(config.port).toBe(8080)
  })

  it('requires an API key', () => {
    expect(() => new Config({ OPENAI_API_KEY: '  ' })).toThrow(/OPENAI_API_KEY/)
  })

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: port })).toThrow(
      /PORT/,
    )
  })
})
