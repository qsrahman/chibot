import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseCreateParams } from 'openai/resources/responses/responses'
import { ConversationStore } from '../../../src/server/conversations/index.ts'
import { cleanSuggestions } from '../../../src/server/chat/prompts.ts'
import {
  answerEvents,
  drain,
  type FakeOptions,
  memoryStore,
  testApp,
  testChatServices,
  testSettings,
} from '../fakes.ts'

describe('FollowUpWriter', () => {
  let store: ConversationStore
  beforeEach(() => {
    store = memoryStore()
  })

  async function answered(options: FakeOptions, suggestionModel = 'sm') {
    const settings = testSettings('m', { suggestionModel })
    const services = testChatServices(answerEvents('Pangolins eat ants.'), {
      store,
      settings,
      client: options,
    })
    const { id } = store.createConversation()
    await drain(services.chat.runTurn(id, { text: 'Tell me about pangolins' }))
    return { ...services, id, settings }
  }

  it('asks the suggestion model about the last exchange', async () => {
    const suggestionCalls: ResponseCreateParams[] = []
    const { followUps, id } = await answered({
      suggestions:
        '1. What do they eat?\n- Where do they live?\n"Are they rare?"\nA fourth',
      suggestionCalls,
    })
    expect(await followUps.suggest(id)).toEqual([
      'What do they eat?',
      'Where do they live?',
      'Are they rare?',
    ])
    expect(suggestionCalls[0]).toMatchObject({ model: 'sm', store: false })
    expect(suggestionCalls[0]!.input).toContain('<exchange>')
    expect(suggestionCalls[0]!.input).toContain('Pangolins eat ants.')
  })

  it('is off while the model is empty, and reads it on each call', async () => {
    const suggestionCalls: ResponseCreateParams[] = []
    const { followUps, id, settings } = await answered(
      { suggestions: 'One?', suggestionCalls },
      '',
    )
    expect(await followUps.suggest(id)).toEqual([])
    expect(suggestionCalls).toHaveLength(0)
    settings.update({ suggestionModel: 'later' })
    expect(await followUps.suggest(id)).toEqual(['One?'])
  })

  it('gives none when the model fails, and none for a chat with no answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { followUps, id } = await answered({ suggestions: new Error('boom') })
    expect(await followUps.suggest(id)).toEqual([])
    expect(await followUps.suggest(store.createConversation().id)).toEqual([])
    vi.restoreAllMocks()
  })

  it('answers over HTTP, 404 for an unknown chat', async () => {
    const app = testApp({ store })
    expect(
      (
        await app.request('/api/conversations/nope/suggestions', {
          method: 'POST',
        })
      ).status,
    ).toBe(404)
    const { id } = store.createConversation()
    const res = await app.request(`/api/conversations/${id}/suggestions`, {
      method: 'POST',
    })
    expect(await res.json()).toEqual({ suggestions: [] })
  })
})

describe('cleanSuggestions', () => {
  it('strips list marks and quotes, drops long and repeated lines', () => {
    expect(
      cleanSuggestions(`* "Why?"\n2) Why?\n\n${'x'.repeat(90)}\n• How so`),
    ).toEqual(['Why?', 'How so'])
  })
})
