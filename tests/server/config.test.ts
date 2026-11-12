import { describe, expect, it } from 'vitest'
import { Config, layered } from '../../src/server/config.ts'

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

  it('says when listening beyond this machine has no token to protect it', () => {
    const base = { OPENAI_API_KEY: 'k' }
    expect(new Config(base).exposure).toBeNull()
    expect(new Config({ ...base, HOST: 'localhost' }).exposure).toBeNull()
    const open = new Config({ ...base, HOST: '0.0.0.0' })
    expect(open.exposure).toContain('HOST=0.0.0.0 would expose chibot')
    expect(open.exposure).toContain('server.allowOpen')
    const token = 'a'.repeat(16)
    expect(
      new Config({ ...base, HOST: '0.0.0.0', CHIBOT_TOKEN: token }).exposure,
    ).toBeNull()
    for (const yes of ['1', 'true', 'YES']) {
      const config = new Config({
        ...base,
        HOST: '10.0.0.1',
        CHIBOT_ALLOW_OPEN: yes,
      })
      expect(config.allowOpen).toBe(true)
      expect(config.exposure).toBeNull()
    }
    expect(
      new Config({ ...base, HOST: '10.0.0.1', CHIBOT_ALLOW_OPEN: '0' })
        .exposure,
    ).not.toBeNull()
  })

  it('resolves the folders (see locations.test.ts for the defaults)', () => {
    const custom = new Config({
      OPENAI_API_KEY: 'k',
      CHIBOT_DATA_DIR: 'x/y',
      CHIBOT_CONFIG_DIR: 'x/c',
    })
    expect(custom.dataDir).toBe(`${process.cwd()}/x/y`)
    expect(custom.databasePath).toBe(`${process.cwd()}/x/y/chibot.db`)
    expect(custom.configDir).toBe(`${process.cwd()}/x/c`)
  })

  it('inherits the chat endpoint for images', () => {
    const openai = new Config({ OPENAI_API_KEY: 'k' })
    expect(openai.image).toEqual({
      baseURL: undefined,
      apiKey: 'k',
      model: 'gpt-image-2',
    })
    // Also when OpenAI's URL is spelled out.
    expect(
      new Config({
        OPENAI_API_KEY: 'k',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_MODEL: 'gpt-6-astra',
      }).image?.model,
    ).toBe('gpt-image-2')
    // A compatible chat server has no image model unless one is named (it
    // can be chosen in Settings).
    const ollama = {
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'gemma4',
      OPENAI_API_KEY: 'sk-openai',
    }
    expect(new Config(ollama).image).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'sk-openai',
      model: '',
    })
    expect(
      new Config({
        ...ollama,
        OPENAI_IMAGE_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_IMAGE_MODEL: 'gpt-image-2.5-flare',
      }).image,
    ).toEqual({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model: 'gpt-image-2.5-flare',
    })
  })

  it('inherits the chat endpoint for embeddings', () => {
    expect(new Config({ OPENAI_API_KEY: 'k' }).embedding?.model).toBe(
      'text-embedding-3-small',
    )
    const ollama = {
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'gemma4',
    }
    expect(new Config(ollama).embedding).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'unused',
      model: '',
    })
    expect(
      new Config({ ...ollama, OPENAI_EMBEDDING_MODEL: 'nomic-embed-text' })
        .embedding,
    ).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'unused',
      model: 'nomic-embed-text',
    })
  })

  it('has no reranking server unless one is named, and then shares the chat key', () => {
    const chat = {
      OPENAI_BASE_URL: 'http://localhost:8080/v1',
      OPENAI_API_KEY: 'k',
      OPENAI_MODEL: 'gemma4',
    }
    // The chat server is not assumed to have a /rerank route.
    expect(new Config(chat).rerank).toBeNull()
    expect(
      new Config({
        ...chat,
        OPENAI_RERANK_BASE_URL: 'http://localhost:9000/v1',
        OPENAI_RERANK_MODEL: 'bge-reranker-v2-m3',
      }).rerank,
    ).toEqual({
      baseURL: 'http://localhost:9000/v1',
      apiKey: 'k',
      model: 'bge-reranker-v2-m3',
    })
  })

  it('inherits the chat endpoint for transcription', () => {
    expect(new Config({ OPENAI_API_KEY: 'k' }).transcription?.model).toBe(
      'gpt-transcribe',
    )
    const ollama = {
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'gemma4',
      OPENAI_API_KEY: 'sk-openai',
    }
    expect(new Config(ollama).transcription).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'sk-openai',
      model: '',
    })
    expect(
      new Config({
        ...ollama,
        OPENAI_TRANSCRIBE_BASE_URL: 'https://api.openai.com/v1',
      }).transcription,
    ).toEqual({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model: 'gpt-transcribe',
    })
  })

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: port })).toThrow(
      /PORT/,
    )
  })
})

describe('Config errors', () => {
  it('name the setting as well as the variable', () => {
    expect(() => new Config({})).toThrow(
      /OPENAI_API_KEY \(chat\.apiKey\): is not set \(run `chibot init`/,
    )
    expect(() => new Config({ OPENAI_BASE_URL: 'http://h/v1' })).toThrow(
      /OPENAI_MODEL \(chat\.model\): is required/,
    )
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: 'x' })).toThrow(
      /PORT \(server\.port\)/,
    )
  })
})

describe('layered', () => {
  const file = {
    chat: { model: 'file', apiKey: 'file' },
    server: { port: 2222 },
  }
  const env = { OPENAI_API_KEY: 'env', PORT: '3333' }

  it('lets each place beat the ones below it: config.json, the environment, a flag', () => {
    const merged = layered({ file, env, flags: { PORT: '4444' } })
    expect(merged).toMatchObject({
      PORT: '4444', // a flag
      OPENAI_API_KEY: 'env', // the environment, over the file
      OPENAI_MODEL: 'file', // config.json
    })
  })

  it('ignores what the file does not set', () => {
    expect(layered({ file: {}, env: { A: '1' }, flags: {} })).toEqual({
      A: '1',
    })
  })
})
