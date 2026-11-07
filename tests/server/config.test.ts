import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config, layered, readEnvFiles } from '../../src/server/config.ts'

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
    expect(open.exposure).toContain('CHIBOT_ALLOW_OPEN=1')
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

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => new Config({ OPENAI_API_KEY: 'k', PORT: port })).toThrow(
      /PORT/,
    )
  })
})

describe('readEnvFiles', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-env-'))
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('reads the values without putting them in the environment', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'CHIBOT_T_REPO=file\nOPENAI_MODEL="quoted model"\n')
    expect(readEnvFiles([file])).toEqual({
      values: { CHIBOT_T_REPO: 'file', OPENAI_MODEL: 'quoted model' },
      files: [file],
    })
    expect(process.env.CHIBOT_T_REPO).toBeUndefined()
  })

  it('lets the first file win, skips a missing one and reads a duplicate once', () => {
    const first = join(dir, 'first.env')
    const second = join(dir, 'second.env')
    writeFileSync(first, 'A=first\n')
    writeFileSync(second, 'A=second\nB=second\n')
    expect(readEnvFiles([join(dir, 'none.env'), first, second, first])).toEqual(
      { values: { A: 'first', B: 'second' }, files: [first, second] },
    )
  })

  it('does not read the current folder’s .env', () => {
    // A global command runs in any folder; that folder's file is not its settings.
    const before = process.cwd()
    writeFileSync(join(dir, '.env'), 'CHIBOT_T_REPO=from-the-folder\n')
    process.chdir(dir)
    try {
      expect(readEnvFiles().values.CHIBOT_T_REPO).not.toBe('from-the-folder')
    } finally {
      process.chdir(before)
    }
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
  const legacy = {
    OPENAI_MODEL: 'legacy',
    OPENAI_API_KEY: 'legacy',
    PORT: '1111',
    HOST: '10.0.0.1',
  }
  const file = {
    chat: { model: 'file', apiKey: 'file' },
    server: { port: 2222 },
  }
  const env = { OPENAI_API_KEY: 'env', PORT: '3333' }

  it('lets each place beat the ones below it: an old .env, config.json, the environment, a flag', () => {
    const merged = layered({ legacy, file, env, flags: { PORT: '4444' } })
    expect(merged).toMatchObject({
      PORT: '4444', // a flag
      OPENAI_API_KEY: 'env', // the environment, over the file and .env
      OPENAI_MODEL: 'file', // config.json, over a leftover .env
      HOST: '10.0.0.1', // only the old .env has it
    })
  })

  it('does not let a leftover .env override a later `config set`', () => {
    expect(
      new Config(
        layered({
          legacy,
          file: { chat: { model: 'new', apiKey: 'k' } },
          env: {},
          flags: {},
        }),
      ).chat.model,
    ).toBe('new')
  })

  it('ignores what the file does not set', () => {
    expect(
      layered({ legacy: {}, file: {}, env: { A: '1' }, flags: {} }),
    ).toEqual({ A: '1' })
  })
})
