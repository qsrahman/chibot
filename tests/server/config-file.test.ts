import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'
import {
  configFileSchema,
  fromEnv,
  mcpVariables,
  readConfigFile,
  redacted,
  toEnv,
  withSetting,
  writeConfigFile,
  type ConfigFile,
} from '../../src/server/config-file.ts'

const full: ConfigFile = {
  chat: {
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'sk-chat',
    model: 'gemma4',
  },
  image: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-img',
    model: 'gpt-image-2',
  },
  embedding: { model: 'nomic-embed-text' },
  rerank: { baseURL: 'http://localhost:9000/v1', model: 'bge-reranker-v2-m3' },
  transcription: { model: 'gpt-transcribe' },
  server: { host: '0.0.0.0', port: 8080 },
  token: 'a-token-of-16-chars',
}

describe('config.json', () => {
  it('becomes the variables Config reads, and back', () => {
    const env = toEnv(full)
    expect(env).toMatchObject({
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_API_KEY: 'sk-chat',
      OPENAI_MODEL: 'gemma4',
      OPENAI_IMAGE_API_KEY: 'sk-img',
      OPENAI_EMBEDDING_MODEL: 'nomic-embed-text',
      OPENAI_RERANK_BASE_URL: 'http://localhost:9000/v1',
      OPENAI_RERANK_MODEL: 'bge-reranker-v2-m3',
      OPENAI_TRANSCRIBE_MODEL: 'gpt-transcribe',
      HOST: '0.0.0.0',
      PORT: '8080',
      CHIBOT_TOKEN: 'a-token-of-16-chars',
    })
    expect(fromEnv(env)).toEqual(full)
    // And Config takes it as it is.
    const config = new Config(env)
    expect(config.chat).toMatchObject({ model: 'gemma4', apiKey: 'sk-chat' })
    expect(config.port).toBe(8080)
  })

  it('ignores unset and blank variables when importing', () => {
    expect(
      fromEnv({ OPENAI_API_KEY: ' sk ', OPENAI_MODEL: '', HOME: '/x' }),
    ).toEqual({
      chat: { apiKey: 'sk' },
    })
  })

  it('refuses unknown settings, so a typo is not silently ignored', () => {
    expect(configFileSchema.safeParse({ chatt: {} }).success).toBe(false)
    expect(configFileSchema.safeParse({ chat: { modle: 'x' } }).success).toBe(
      false,
    )
    expect(configFileSchema.safeParse({ server: { port: 0 } }).success).toBe(
      false,
    )
  })
})

describe('reading and writing it', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-cfg-'))
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('is empty when there is no file', () => {
    expect(readConfigFile(join(dir, 'none'))).toMatchObject({
      file: {},
      exists: false,
    })
  })

  it('writes it readable by its owner only, and reads it back', () => {
    const path = writeConfigFile(join(dir, 'a', 'b'), full)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'a', 'b')).mode & 0o777).toBe(0o700)
    expect(readConfigFile(join(dir, 'a', 'b'))).toMatchObject({
      file: full,
      exists: true,
      tooOpen: false,
    })
    // Replaced whole: no half-written file or leftover.
    writeConfigFile(join(dir, 'a', 'b'), { chat: { model: 'x' } })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      chat: { model: 'x' },
    })
  })

  it('says when others can read it', () => {
    const path = writeConfigFile(dir, full)
    chmodSync(path, 0o644)
    expect(readConfigFile(dir).tooOpen).toBe(true)
  })

  it('names the file when it is broken', () => {
    writeFileSync(join(dir, 'config.json'), '{ nope')
    expect(() => readConfigFile(dir)).toThrow(/config\.json isn't valid JSON/)
    writeFileSync(join(dir, 'config.json'), '{"chat":{"modle":"x"}}')
    expect(() => readConfigFile(dir)).toThrow(/config\.json has a problem/)
  })
})

describe('changing a setting', () => {
  it('sets one, keeping the others, and reads a port as a number', () => {
    const next = withSetting({ chat: { model: 'a' } }, 'chat.apiKey', 'sk')
    expect(next).toEqual({ chat: { model: 'a', apiKey: 'sk' } })
    expect(withSetting(next, 'server.port', '4000').server).toEqual({
      port: 4000,
    })
  })

  it('removes one with an empty value, and the section when it is empty', () => {
    expect(
      withSetting(
        { chat: { model: 'a' }, token: 'a-token-of-16-chars' },
        'chat.model',
        '',
      ),
    ).toEqual({ token: 'a-token-of-16-chars' })
  })

  it('refuses an unknown setting or a bad value, and leaves the file as it was', () => {
    const file: ConfigFile = { chat: { model: 'a' } }
    expect(() => withSetting(file, 'chat.nope', 'x')).toThrow(/Unknown setting/)
    expect(() => withSetting(file, 'server.port', '70000')).toThrow(
      /server\.port/,
    )
    expect(() => withSetting(file, 'server.port', 'abc')).toThrow(
      /server\.port/,
    )
    expect(file).toEqual({ chat: { model: 'a' } })
  })

  it('shows keys as set and the rest as they are', () => {
    expect(redacted(full)).toMatchObject({
      chat: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'set',
        model: 'gemma4',
      },
      image: { apiKey: 'set' },
      token: 'set',
      server: { host: '0.0.0.0', port: 8080 },
    })
    expect(JSON.stringify(redacted(full))).not.toMatch(/sk-chat|sk-img|a-token/)
  })
})

describe('variables for mcp.json', () => {
  it('are set with env.NAME, removed with an empty value, and shown only as names', () => {
    const one = withSetting({}, 'env.GITHUB_TOKEN', 'ghp-secret')
    expect(one).toEqual({ env: { GITHUB_TOKEN: 'ghp-secret' } })
    expect(redacted(one)).toEqual({ env: { GITHUB_TOKEN: 'set' } })
    expect(JSON.stringify(redacted(one))).not.toContain('ghp-secret')
    expect(withSetting(one, 'env.GITHUB_TOKEN', '')).toEqual({})
    // Not Chibot's own settings: they do not reach Config.
    expect(toEnv(one)).toEqual({})
  })

  it('refuse a name that mcp.json could not use', () => {
    expect(() => withSetting({}, 'env.my-token', 'x')).toThrow(/env/)
    expect(() => withSetting({}, 'env.a b', 'x')).toThrow(/env/)
  })

  describe('in the environment', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'chibot-mcpenv-'))
      writeConfigFile(dir, { env: { CHIBOT_T_A: 'file', CHIBOT_T_B: 'file' } })
      process.env.CHIBOT_T_A = 'real'
    })
    afterEach(() => {
      delete process.env.CHIBOT_T_A
      rmSync(dir, { recursive: true })
    })

    it('lose to the real environment, and are read again each time', () => {
      expect(mcpVariables(dir)).toMatchObject({
        CHIBOT_T_A: 'real',
        CHIBOT_T_B: 'file',
      })
      writeConfigFile(dir, { env: { CHIBOT_T_B: 'changed' } })
      expect(mcpVariables(dir).CHIBOT_T_B).toBe('changed')
    })
  })
})

describe('values refused when set', () => {
  it('a token under 16 characters, and an address that is not http(s)', () => {
    expect(() => withSetting({}, 'token', 'short')).toThrow(/at least 16/)
    expect(withSetting({}, 'token', 'a-token-of-16-chars').token).toBeDefined()
    expect(() => withSetting({}, 'chat.baseURL', 'localhost:11434')).toThrow(
      /chat\.baseURL|http\(s\) address/,
    )
    expect(() => withSetting({}, 'chat.baseURL', 'ftp://h/')).toThrow(
      /http\(s\) address/,
    )
    expect(
      withSetting({}, 'chat.baseURL', 'http://localhost:11434/v1').chat,
    ).toEqual({ baseURL: 'http://localhost:11434/v1' })
  })
})

describe('a setting that no longer does anything', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-obsolete-'))
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('is read without it, named, and left out when the file is saved', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ chat: { model: 'm' }, braveApiKey: 'brave-secret' }),
    )
    const read = readConfigFile(dir)
    expect(read.file).toEqual({ chat: { model: 'm' } })
    expect(read.obsolete).toEqual(['braveApiKey'])
    writeConfigFile(dir, withSetting(read.file, 'chat.model', 'n'))
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).not.toContain(
      'brave',
    )
    expect(readConfigFile(dir).obsolete).toEqual([])
    // Other unknown settings are still refused (typos).
    writeFileSync(join(dir, 'config.json'), '{"brave":"x"}')
    expect(() => readConfigFile(dir)).toThrow(/Unrecognized key/)
  })
})
