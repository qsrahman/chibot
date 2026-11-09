import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { Config } from '../../src/server/config.ts'
import { openDatabase } from '../../src/server/database.ts'
import {
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import { ProjectIndex, ProjectStore } from '../../src/server/projects/index.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  type FakeCall,
  testApp,
  testChat,
  testFiles,
} from './fakes.ts'

describe('SettingsStore', () => {
  let db: DatabaseSync
  let settings: SettingsStore
  beforeEach(() => {
    db = openDatabase(':memory:')
    settings = new SettingsStore(db, settingsDefaults('env-model'))
  })

  it('starts from the defaults', () => {
    expect(settings.get()).toEqual(settingsDefaults('env-model'))
    // The ones that matter: the environment's model, the model's own
    // reasoning effort, compaction on for a 32k window, nothing switched off.
    expect(settings.get()).toMatchObject({
      model: 'env-model',
      reasoningEffort: null,
      summaryModel: '',
      autoCompact: true,
      contextWindow: 32_000,
      compactAt: 75,
      compactReserve: 16_000,
      keepRecent: 15_000,
      disabledTools: [],
      disabledMcpServers: [],
      askMcpServers: [],
    })
  })

  it('has the other services’ models from the environment, off without one', () => {
    expect(settings.get()).toMatchObject({
      imageModel: '',
      embeddingModel: '',
      transcribeModel: '',
    })
    const store = new SettingsStore(
      db,
      settingsDefaults('m', { imageModel: 'gpt-image-2' }),
    )
    expect(store.get().imageModel).toBe('gpt-image-2')
    // Changed, and turned off with an empty name.
    store.update({ imageModel: 'other', embeddingModel: ' nomic ' })
    expect(store.get()).toMatchObject({
      imageModel: 'other',
      embeddingModel: 'nomic',
    })
    store.update({ imageModel: '' })
    expect(store.get().imageModel).toBe('')
  })

  it('saves partial updates over the defaults', () => {
    settings.update({ model: 'other', reasoningEffort: 'high' })
    settings.update({ autoCompact: false })
    expect(settings.get()).toMatchObject({
      model: 'other',
      reasoningEffort: 'high',
      autoCompact: false,
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
    const chat = testChat(answerEvents('a'), { store, calls, settings })
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

  it('says which other services have a server and key, and saves their models', async () => {
    const got = async () =>
      (await (await app.request('/api/settings')).json()) as {
        endpoints: Record<string, boolean>
      }
    expect((await got()).endpoints).toEqual({
      imageModel: true,
      embeddingModel: true,
      rerankModel: false,
      transcribeModel: true,
    })
    const res = await patch({ imageModel: ' my-image ', transcribeModel: '' })
    expect(await res.json()).toMatchObject({
      imageModel: 'my-image',
      transcribeModel: '',
    })
  })

  it('embeds project files again when the embedding model changes, and only then', async () => {
    const db = openDatabase(':memory:')
    const files = testFiles(db)
    const index = new ProjectIndex(db, new ProjectStore(db, files), files, null)
    const resume = vi.spyOn(index, 'resume').mockResolvedValue()
    const withIndex = testApp({ config, settings, index })
    const send = (body: unknown) =>
      withIndex.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    await send({ imageModel: 'x' })
    expect(resume).not.toHaveBeenCalled()
    await send({ embeddingModel: 'nomic-embed-text' })
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid or unknown settings', async () => {
    for (const body of [
      { reasoningEffort: 'huge' },
      { contextWindow: 10 },
      { compactAt: 100 },
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
    const chat = testChat(answerEvents('a'), { store, calls, settings })
    await drain(chat.runTurn(store.createConversation().id, { text: 'hi' }))
    expect(calls.at(-1)!.params.model).toBe('picked')
  })
})
