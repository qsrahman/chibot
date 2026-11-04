import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config, loadEnvFiles } from '../../src/server/config.ts'

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

  it('finds mcp.json in the chibot folder unless told otherwise', () => {
    expect(new Config({ OPENAI_API_KEY: 'k' }).mcpConfigPath).toMatch(
      /[/\\]mcp\.json$/,
    )
    expect(
      new Config({ OPENAI_API_KEY: 'k', CHIBOT_MCP_CONFIG: '/etc/chibot.json' })
        .mcpConfigPath,
    ).toBe('/etc/chibot.json')
  })

  it('reads the Brave key, treating blank as unset', () => {
    expect(new Config({ OPENAI_API_KEY: 'k' }).braveApiKey).toBeNull()
    expect(
      new Config({ OPENAI_API_KEY: 'k', BRAVE_API_KEY: ' ' }).braveApiKey,
    ).toBeNull()
    expect(
      new Config({ OPENAI_API_KEY: 'k', BRAVE_API_KEY: 'b' }).braveApiKey,
    ).toBe('b')
  })

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: port })).toThrow(
      /PORT/,
    )
  })
})

describe('loadEnvFiles', () => {
  const names = ['CHIBOT_T_REAL', 'CHIBOT_T_REPO']
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-env-'))
  })
  afterEach(() => {
    names.forEach((n) => delete process.env[n])
    rmSync(dir, { recursive: true })
  })

  it('keeps the real environment over the file', () => {
    process.env.CHIBOT_T_REAL = 'real'
    const file = join(dir, '.env')
    writeFileSync(file, 'CHIBOT_T_REAL=file\nCHIBOT_T_REPO=file\n')
    expect(loadEnvFiles([file])).toEqual([file])
    expect(names.map((n) => process.env[n])).toEqual(['real', 'file'])
  })

  it('skips a missing file, and loads a duplicate path once', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'CHIBOT_T_REPO=file\n')
    expect(loadEnvFiles([join(dir, 'none', '.env'), file, file])).toEqual([
      file,
    ])
  })

  it('does not read the current folder’s .env', () => {
    // A global command runs in any folder; that folder's file is not its settings.
    const before = process.cwd()
    writeFileSync(join(dir, '.env'), 'CHIBOT_T_REPO=from-the-folder\n')
    process.chdir(dir)
    try {
      loadEnvFiles()
    } finally {
      process.chdir(before)
    }
    expect(process.env.CHIBOT_T_REPO).toBeUndefined()
  })
})
