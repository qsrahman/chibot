import { describe, expect, it } from 'vitest'
import { chatModels } from '../../src/server/chat-models.ts'

const OPENAI_IDS = [
  'gpt-6-astra',
  'gpt-5.4-mini',
  'o3',
  'gpt-5.2-codex',
  'text-embedding-3-small',
  'gpt-image-2',
  'chatgpt-image-latest',
  'dall-e-3',
  'gpt-4o-mini-tts',
  'tts-1-hd',
  'whisper-1',
  'gpt-transcribe',
  'gpt-4o-transcribe-diarize',
  'gpt-realtime-mini',
  'gpt-audio',
  'gpt-live-1',
  'omni-moderation-latest',
  'sora-2',
  'gpt-4o-mini-search-preview',
  'gpt-5-search-api',
  'babbage-002',
  'gpt-3.5-turbo-instruct',
]

/** An Ollama `/api/show` that knows these models' capabilities. */
const ollama =
  (capabilities: Record<string, string[]>): typeof fetch =>
  async (url, init) => {
    expect(String(url)).toBe('http://localhost:11434/api/show')
    const { model } = JSON.parse(String(init?.body)) as { model: string }
    return Response.json({ capabilities: capabilities[model] ?? [] })
  }

describe('chatModels', () => {
  it('leaves out non-chat model families by name', async () => {
    const notCalled: typeof fetch = () => {
      throw new Error('OpenAI has no /api/show')
    }
    expect(await chatModels(OPENAI_IDS, undefined, notCalled)).toEqual([
      'gpt-6-astra',
      'gpt-5.4-mini',
      'o3',
      'gpt-5.2-codex',
    ])
    expect(
      await chatModels(OPENAI_IDS, 'https://api.openai.com/v1', notCalled),
    ).toHaveLength(4)
  })

  it('asks Ollama what each model can do', async () => {
    const fetch = ollama({
      'gemma4:cloud': ['completion', 'thinking', 'tools', 'vision'],
      'gpt-oss:20b': ['completion', 'tools', 'thinking'],
      'nomic-embed-text': ['embedding'],
      'x/flux2-klein:9b': ['image'], // no hint in the name
    })
    expect(
      await chatModels(
        ['gemma4:cloud', 'nomic-embed-text', 'x/flux2-klein:9b', 'gpt-oss:20b'],
        'http://localhost:11434/v1',
        fetch,
      ),
    ).toEqual(['gemma4:cloud', 'gpt-oss:20b'])
  })

  it('falls back to names on other compatible servers', async () => {
    const lmStudio: typeof fetch = async () =>
      new Response('Not found', { status: 404 })
    expect(
      await chatModels(
        ['qwen3-8b', 'text-embedding-nomic-embed-text-v1.5'],
        'http://localhost:1234/v1',
        lmStudio,
      ),
    ).toEqual(['qwen3-8b'])
    const unreachable: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(
      await chatModels(['m', 'tts-1'], 'http://localhost:1234/v1', unreachable),
    ).toEqual(['m'])
  })
})
