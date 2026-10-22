import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('loadEnvFiles', () => {
  const names = ['CHIBOT_T_REAL', 'CHIBOT_T_CWD', 'CHIBOT_T_REPO']
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-env-'))
    mkdirSync(join(dir, 'cwd'))
    mkdirSync(join(dir, 'repo'))
  })
  afterEach(() => {
    names.forEach((n) => delete process.env[n])
    rmSync(dir, { recursive: true })
  })

  it('prefers the real environment, then the first file, then the second', () => {
    process.env.CHIBOT_T_REAL = 'real'
    writeFileSync(
      join(dir, 'cwd', '.env'),
      'CHIBOT_T_REAL=cwd\nCHIBOT_T_CWD=cwd\n',
    )
    writeFileSync(
      join(dir, 'repo', '.env'),
      'CHIBOT_T_REAL=repo\nCHIBOT_T_CWD=repo\nCHIBOT_T_REPO=repo\n',
    )
    const files = [join(dir, 'cwd', '.env'), join(dir, 'repo', '.env')]

    expect(loadEnvFiles(files)).toEqual(files)
    expect(names.map((n) => process.env[n])).toEqual(['real', 'cwd', 'repo'])
  })

  it('skips missing files and loads a duplicate path once', () => {
    writeFileSync(join(dir, 'repo', '.env'), 'CHIBOT_T_REPO=repo\n')
    const repo = join(dir, 'repo', '.env')
    expect(loadEnvFiles([join(dir, 'cwd', '.env'), repo, repo])).toEqual([repo])
    expect(process.env.CHIBOT_T_REPO).toBe('repo')
  })
})
