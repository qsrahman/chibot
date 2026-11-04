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
  transcription: { model: 'gpt-transcribe' },
  braveApiKey: 'brave',
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
      OPENAI_TRANSCRIBE_MODEL: 'gpt-transcribe',
      BRAVE_API_KEY: 'brave',
      HOST: '0.0.0.0',
      PORT: '8080',
      CHIBOT_TOKEN: 'a-token-of-16-chars',
    })
    expect(fromEnv(env)).toEqual(full)
    // And Config takes it as it is.
    const config = new Config(env)
    expect(config.chat).toMatchObject({ model: 'gemma4', apiKey: 'sk-chat' })
    expect(config.port).toBe(8080)
    expect(config.braveApiKey).toBe('brave')
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
      withSetting({ chat: { model: 'a' }, braveApiKey: 'b' }, 'chat.model', ''),
    ).toEqual({
      braveApiKey: 'b',
    })
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
      braveApiKey: 'set',
      token: 'set',
      server: { host: '0.0.0.0', port: 8080 },
    })
    expect(JSON.stringify(redacted(full))).not.toMatch(
      /sk-chat|sk-img|brave"|a-token/,
    )
  })
})
