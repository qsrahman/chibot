import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { fromEnv, type ConfigFile } from './config-file.ts'

/** Questions and answers, so the setup can be driven by a person or a test. */
export interface Prompts {
  ask(question: string, options?: { secret?: boolean }): Promise<string>
  say(message: string): void
}

const OLLAMA = 'http://localhost:11434/v1'

/**
 * The setup conversation: where the models are, the key, the model, and
 * optionally a web search key. An empty answer keeps what `existing` has.
 * `legacyEnv` holds what an old `.env` set: offered as is, if there is no
 * config yet.
 */
export async function runInit(
  prompts: Prompts,
  {
    existing,
    legacyEnv,
    legacyPath,
  }: {
    existing: ConfigFile
    legacyEnv: Record<string, string | undefined>
    legacyPath: string | null
  },
): Promise<ConfigFile> {
  const { ask, say } = prompts
  const imported = fromEnv(legacyEnv)
  if (
    legacyPath &&
    Object.keys(existing).length === 0 &&
    Object.keys(imported).length > 0
  ) {
    const yes = await ask(
      `Found settings in ${legacyPath}. Move them into chibot's config? [Y/n]`,
    )
    if (!/^n/i.test(yes)) return imported
  }

  const chat = existing.chat ?? {}
  const compatible = chat.baseURL !== undefined
  say('Where are your models?')
  say('  1) OpenAI')
  say('  2) An OpenAI-compatible server (Ollama, LM Studio, …)')
  const where = (await ask(`Choose [${compatible ? 2 : 1}]`)).trim()
  const useServer = where === '' ? compatible : where === '2'

  const next: NonNullable<ConfigFile['chat']> = {}
  if (useServer) {
    next.baseURL =
      (await ask(`Server address [${chat.baseURL ?? OLLAMA}]`)).trim() ||
      chat.baseURL ||
      OLLAMA
    for (;;) {
      const model =
        (
          await ask(`Model name${chat.model ? ` [${chat.model}]` : ''}`)
        ).trim() || chat.model
      if (model) {
        next.model = model
        break
      }
      say('A server needs a model name (for Ollama, `ollama list` shows them).')
    }
    const key = (
      await ask(
        `API key, if it needs one${chat.apiKey ? ' [keep the saved one]' : ''}`,
        { secret: true },
      )
    ).trim()
    if (key || chat.apiKey) next.apiKey = key || chat.apiKey!
  } else {
    for (;;) {
      const key = (
        await ask(
          `OpenAI API key${chat.apiKey ? ' [keep the saved one]' : ''}`,
          { secret: true },
        )
      ).trim()
      if (key || chat.apiKey) {
        next.apiKey = key || chat.apiKey!
        break
      }
      say('OpenAI needs an API key (https://platform.openai.com/api-keys).')
    }
    const model = (
      await ask(
        `Model [${chat.model ?? 'press Enter for the built-in default'}]`,
      )
    ).trim()
    if (model || chat.model) next.model = model || chat.model!
  }

  const brave = (
    await ask(
      `Brave Search API key, to let it search the web (optional)${existing.braveApiKey ? ' [keep the saved one]' : ''}`,
      { secret: true },
    )
  ).trim()
  const braveApiKey = brave || existing.braveApiKey
  return {
    ...existing,
    chat: next,
    ...(braveApiKey && { braveApiKey }),
  }
}

/** Prompts on the terminal; a secret is not echoed as it is typed. */
export function terminalPrompts(): Prompts & { close(): void } {
  let muted = false
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding)
      done()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  return {
    async ask(question, { secret = false } = {}) {
      muted = false
      process.stdout.write(`${question}: `)
      muted = secret
      try {
        return await rl.question('')
      } finally {
        if (secret) process.stdout.write('\n')
        muted = false
      }
    },
    say: (message) => console.log(message),
    close: () => rl.close(),
  }
}
