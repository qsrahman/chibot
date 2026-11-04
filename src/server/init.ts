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
  let useServer = compatible
  for (;;) {
    const where = (await ask(`Choose [${compatible ? 2 : 1}]`)).trim()
    if (where === '') break
    if (where === '1' || where === '2') {
      useServer = where === '2'
      break
    }
    say('Type 1 or 2.')
  }

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

/**
 * Offers to move the servers of a standalone `mcp.json` into the config, where
 * they sit with the rest of the settings (readable by you only). The file
 * itself is left for you to delete.
 */
export async function offerMcpImport(
  { ask, say }: Prompts,
  file: ConfigFile,
  mcpPath: string,
  servers: Record<string, unknown> | null,
): Promise<ConfigFile> {
  if (file.mcpServers || !servers || Object.keys(servers).length === 0) {
    return file
  }
  const names = Object.keys(servers).join(', ')
  const yes = await ask(
    `Found MCP servers in ${mcpPath} (${names}). Move them into chibot's config? [Y/n]`,
  )
  if (/^n/i.test(yes)) return file
  say(
    `Moved. You can delete ${mcpPath}. \${NAME} in them is still filled from your environment, or from \`chibot config set env.NAME <value>\`.`,
  )
  return { ...file, mcpServers: servers }
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
  // Ctrl+D (or a closed input) ends the questions: without this the pending
  // one never settles, and Node exits with a warning about the unsettled await.
  const closed = new Promise<never>((_, reject) =>
    rl.once('close', () =>
      reject(new Error('Setup cancelled; nothing was saved.')),
    ),
  )
  closed.catch(() => {})
  return {
    async ask(question, { secret = false } = {}) {
      muted = false
      process.stdout.write(`${question}: `)
      muted = secret
      try {
        return await Promise.race([rl.question(''), closed])
      } finally {
        if (secret) process.stdout.write('\n')
        muted = false
      }
    },
    say: (message) => console.log(message),
    close: () => rl.close(),
  }
}
