import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import { openDatabase } from '../../src/server/database.ts'
import {
  DEFAULT_COMPACT_THRESHOLD,
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  type FakeCall,
  testApp,
} from './fakes.ts'

describe('SettingsStore', () => {
  let db: DatabaseSync
  let settings: SettingsStore
  beforeEach(() => {
    db = openDatabase(':memory:')
    settings = new SettingsStore(db, settingsDefaults('env-model'))
  })

  it('starts from the defaults', () => {
    expect(settings.get()).toEqual({
      model: 'env-model',
      reasoningEffort: null,
      aboutUser: '',
      responseStyle: '',
      compactThreshold: DEFAULT_COMPACT_THRESHOLD,
      disabledTools: [],
    })
    expect(DEFAULT_COMPACT_THRESHOLD).toBe(64_000)
  })

  it('saves partial updates over the defaults', () => {
    settings.update({ model: 'other', reasoningEffort: 'high' })
    settings.update({ compactThreshold: null })
    expect(settings.get()).toMatchObject({
      model: 'other',
      reasoningEffort: 'high',
      compactThreshold: null,
      aboutUser: '',
    })
    // Survives a new store on the same database (i.e. a restart).
    expect(new SettingsStore(db, settingsDefaults('x')).get().model).toBe(
      'other',
    )
  })

  it('ignores stored values that no longer validate', () => {
    db.prepare(
      "INSERT INTO settings VALUES ('reasoningEffort', '\"huge\"')",
    ).run()
    expect(settings.get().reasoningEffort).toBeNull()
  })

  it('ignores corrupt stored values', () => {
    db.prepare("INSERT INTO settings VALUES ('aboutUser', 'not json')").run()
    db.prepare("INSERT INTO settings VALUES ('model', '\"other\"')").run()
    expect(settings.get()).toMatchObject({
      model: 'other',
      aboutUser: '',
    })
  })
})

describe('settings routes and use', () => {
  const config = new Config({ OPENAI_API_KEY: 'k' })
  let settings: SettingsStore
  let calls: FakeCall[]
  let app: ReturnType<typeof testApp>
  beforeEach(() => {
    settings = new SettingsStore(
      openDatabase(':memory:'),
      settingsDefaults('env-model'),
    )
    calls = []
    const store = memoryStore()
    const chat = new ChatService(
      fakeClient(answerEvents('a'), calls),
      store,
      settings,
    )
    app = testApp({
      config,
      store,
      settings,
      chat,
    })
  })

  const patch = (body: unknown) =>
    app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('reads and updates settings', async () => {
    const res = await patch({ model: ' gpt-x ', aboutUser: 'I like Rust.' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      model: 'gpt-x',
      aboutUser: 'I like Rust.',
    })
    const got = (await (await app.request('/api/settings')).json()) as {
      settings: { model: string }
      defaults: { model: string }
    }
    expect(got.settings.model).toBe('gpt-x')
    expect(got.defaults.model).toBe('env-model')
  })

  it('rejects invalid or unknown settings', async () => {
    for (const body of [
      { reasoningEffort: 'huge' },
      { compactThreshold: 10 },
      { model: '' },
      { apiKey: 'sk-nope' },
    ]) {
      const res = await patch(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toHaveProperty('error')
    }
  })

  it('uses the chosen model for new turns', async () => {
    settings.update({ model: 'picked' })
    const store = memoryStore()
    const chat = new ChatService(
      fakeClient(answerEvents('a'), calls),
      store,
      settings,
    )
    await drain(chat.runTurn(store.createConversation().id, { text: 'hi' }))
    expect(calls.at(-1)!.params.model).toBe('picked')
  })
})
