import { describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import { Transcription } from '../../src/server/transcription.ts'
import { testApp } from './fakes.ts'

/** A client whose transcriptions answer `text`, or fail with `error`. */
function fakeAudio(answer: string | Error, seen: File[] = []) {
  return {
    baseURL: 'http://localhost:11434/v1',
    audio: {
      transcriptions: {
        create: async ({ file }: { file: File }) => {
          seen.push(file)
          if (answer instanceof Error) throw answer
          return { text: answer }
        },
      },
    },
  } as unknown as OpenAI
}

const record = (app: ReturnType<typeof testApp>) => {
  const form = new FormData()
  form.append('file', new File(['audio'], 'recording.webm'))
  return app.request('/api/transcriptions', { method: 'POST', body: form })
}

describe('POST /api/transcriptions', () => {
  it('transcribes a recording', async () => {
    const seen: File[] = []
    const app = testApp({
      transcription: new Transcription(fakeAudio('Hello there.', seen), 't-1'),
    })
    const res = await record(app)
    expect(await res.json()).toEqual({ text: 'Hello there.' })
    expect(seen[0]!.name).toBe('recording.webm')
    expect(await (await app.request('/api/health')).json()).toMatchObject({
      features: { transcription: true },
    })
  })

  it('is off without a transcription endpoint', async () => {
    expect((await record(testApp())).status).toBe(501)
  })

  it('says which endpoint failed, and what to set', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const message = 'path "/v1/audio/transcriptions" not found'
    const missing = new OpenAI.NotFoundError(
      404,
      { message },
      message,
      new Headers(),
    )
    const app = testApp({
      transcription: new Transcription(fakeAudio(missing), 'gemma4:cloud'),
    })
    const res = await record(app)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(
      /^Transcription at http:\/\/localhost:11434\/v1 \(model gemma4:cloud\) failed: .*not found\. It needs a transcription model .*OPENAI_TRANSCRIBE_MODEL/,
    )
    vi.restoreAllMocks()
  })
})
