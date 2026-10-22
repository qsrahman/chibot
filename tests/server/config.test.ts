import { describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'

describe('Config', () => {
  it('applies defaults', () => {
    const config = new Config({ OPENAI_API_KEY: 'sk-test' })
    expect(config.chat).toEqual({
      baseURL: undefined,
      apiKey: 'sk-test',
      model: 'gpt-6-astra',
    })
    expect(config).toMatchObject({ host: '127.0.0.1', port: 3000 })
    expect(config.isLoopback).toBe(true)
  })

  it('reads overrides', () => {
    const config = new Config({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-6.1-sol',
      PORT: '8080',
    })
    expect(config.chat.model).toBe('gpt-6.1-sol')
    expect(config.port).toBe(8080)
  })

  it('accepts a compatible server without a key', () => {
    const config = new Config({
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama4',
    })
    expect(config.chat).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'unused',
      model: 'llama4',
    })
  })

  it('requires a model for a compatible server', () => {
    expect(
      () => new Config({ OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
    ).toThrow(/OPENAI_MODEL/)
  })

  it('requires an API key for OpenAI', () => {
    expect(() => new Config({ OPENAI_API_KEY: '  ' })).toThrow(/OPENAI_API_KEY/)
  })

  it('flags a non-loopback HOST', () => {
    const config = new Config({ OPENAI_API_KEY: 'k', HOST: '0.0.0.0' })
    expect(config.host).toBe('0.0.0.0')
    expect(config.isLoopback).toBe(false)
  })

  it('resolves the data directory', () => {
    const fromRepo = new Config({ OPENAI_API_KEY: 'k' })
    expect(fromRepo.dataDir).toMatch(/chibot\/data$/)
    expect(fromRepo.databasePath).toBe(`${fromRepo.dataDir}/chibot.db`)

    const custom = new Config({ OPENAI_API_KEY: 'k', CHIBOT_DATA_DIR: 'x/y' })
    expect(custom.dataDir).toBe(`${process.cwd()}/x/y`)
  })

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: port })).toThrow(
      /PORT/,
    )
  })
})
