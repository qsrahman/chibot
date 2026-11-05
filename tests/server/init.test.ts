import { describe, expect, it } from 'vitest'
import { runInit, type Prompts } from '../../src/server/init.ts'

/** Answers in order; what was asked, and which answers were secret, are kept. */
function scripted(answers: string[]) {
  const asked: { question: string; secret: boolean }[] = []
  const said: string[] = []
  const prompts: Prompts = {
    async ask(question, { secret = false } = {}) {
      asked.push({ question, secret })
      if (answers.length === 0)
        throw new Error(`unexpected question: ${question}`)
      return answers.shift()!
    },
    say: (message) => void said.push(message),
  }
  return { prompts, asked, said }
}
const nothing = { existing: {}, legacyEnv: {}, legacyPath: null }

describe('chibot init', () => {
  it('sets up OpenAI: the key (secret), then the model', async () => {
    const { prompts, asked } = scripted(['1', 'sk-abc', 'gpt-x'])
    expect(await runInit(prompts, nothing)).toEqual({
      chat: { apiKey: 'sk-abc', model: 'gpt-x' },
    })
    // The keys are asked as secrets (not echoed); the rest is not.
    expect(asked.filter((a) => a.secret).map((a) => a.question)).toEqual([
      expect.stringContaining('OpenAI API key'),
    ])
  })

  it('asks again for the OpenAI key, which it needs', async () => {
    const { prompts, said } = scripted(['', '', 'sk-abc', ''])
    const file = await runInit(prompts, nothing)
    expect(file.chat).toEqual({ apiKey: 'sk-abc' })
    expect(said.join('\n')).toMatch(/needs an API key/)
  })

  it('sets up a compatible server: address, model (required), key (optional)', async () => {
    const { prompts, said } = scripted(['2', '', '', 'gemma4', ''])
    expect(await runInit(prompts, nothing)).toEqual({
      chat: { baseURL: 'http://localhost:11434/v1', model: 'gemma4' },
    })
    expect(said.join('\n')).toMatch(/needs a model name/)
  })

  it('keeps what is saved when answers are empty, and the rest of the file', async () => {
    const existing = {
      chat: { baseURL: 'http://h/v1', apiKey: 'old', model: 'm' },
      server: { port: 9000 },
    }
    const { prompts } = scripted(['', '', '', ''])
    expect(await runInit(prompts, { ...nothing, existing })).toEqual(existing)
    const next = scripted(['2', 'http://new/v1', 'n', 'newkey'])
    expect(await runInit(next.prompts, { ...nothing, existing })).toEqual({
      chat: { baseURL: 'http://new/v1', model: 'n', apiKey: 'newkey' },
      server: { port: 9000 },
    })
  })

  it('offers to move an old .env, and then asks nothing more', async () => {
    const legacy = {
      legacyEnv: { OPENAI_API_KEY: 'sk-old', OPENAI_MODEL: 'm', PATH: '/bin' },
      legacyPath: '/repo/.env',
    }
    const yes = scripted([''])
    expect(await runInit(yes.prompts, { existing: {}, ...legacy })).toEqual({
      chat: { apiKey: 'sk-old', model: 'm' },
    })
    expect(yes.asked[0]!.question).toContain('/repo/.env')
    // Declined, it asks as usual. Not offered when a config exists already.
    const no = scripted(['n', '1', 'sk-new', ''])
    expect(
      await runInit(no.prompts, { existing: {}, ...legacy }),
    ).toMatchObject({
      chat: { apiKey: 'sk-new' },
    })
    const has = scripted(['1', '', ''])
    await runInit(has.prompts, {
      existing: { chat: { apiKey: 'k' } },
      ...legacy,
    })
    expect(has.asked[0]!.question).toContain('Choose')
  })
})

describe('chibot init, the provider question', () => {
  it('asks again for anything but 1 or 2, instead of guessing', async () => {
    const { prompts, said } = scripted(['x', '3', '1', 'sk-abc', ''])
    expect(
      await runInit(prompts, { existing: {}, legacyEnv: {}, legacyPath: null }),
    ).toEqual({
      chat: { apiKey: 'sk-abc' },
    })
    expect(said.filter((m) => m === 'Type 1 or 2.')).toHaveLength(2)
  })
})
