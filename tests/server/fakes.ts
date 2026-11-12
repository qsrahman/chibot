import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import OpenAI from 'openai'
import { z } from 'zod'
import { createApp, type AppDeps } from '../../src/server/app.ts'
import { Attachments } from '../../src/server/attachments.ts'
import { ChatService } from '../../src/server/chat/index.ts'
import { ModelRequests } from '../../src/server/chat/index.ts'
import { TitleWriter } from '../../src/server/chat/index.ts'
import { Compactor } from '../../src/server/chat/index.ts'
import { ToolRegistry } from '../../src/server/tool-registry.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationSearch } from '../../src/server/conversations/index.ts'
import { MediaProxy } from '../../src/server/media-proxy.ts'
import { ConversationStore } from '../../src/server/conversations/index.ts'
import { openDatabase } from '../../src/server/database.ts'
import { FileStore } from '../../src/server/file-store.ts'
import { InstructionWriter } from '../../src/server/projects/index.ts'
import { MemoryStore } from '../../src/server/memory-store.ts'
import {
  FolderWatcher,
  ProjectIndex,
  ProjectSync,
} from '../../src/server/projects/index.ts'
import { McpServerFile, McpServers } from '../../src/server/mcp/index.ts'
import { SkillStore } from '../../src/server/skills/index.ts'
import { ProjectStore } from '../../src/server/projects/index.ts'
import {
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import { Tool } from '../../src/server/tool.ts'
import type { Settings } from '../../src/shared/settings.ts'
import type {
  ResponseCreateParams,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from 'openai/resources/responses/responses'

/** Collects everything a stream yields. */
export async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const item of stream) seen.push(item)
  return seen
}

export const usage = {
  input_tokens: 12,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 3,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 15,
} as ResponseUsage

/** A streamed answer: one delta per chunk, then `response.completed`. */
export function answerEvents(...chunks: string[]): ResponseStreamEvent[] {
  const text = chunks.join('')
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  } as unknown as ResponseInputItem
  return [
    ...chunks.map((delta) => ({ type: 'response.output_text.delta', delta })),
    { type: 'response.completed', response: { output: [message], usage } },
  ] as unknown as ResponseStreamEvent[]
}

export interface FakeCall {
  params: ResponseCreateParamsStreaming
  signal: AbortSignal | undefined
}

export interface FakeOptions {
  /** What the title request returns as `output_text`, or throws. */
  title?:
    | string
    | Error
    | ((
        params: ResponseCreateParams,
      ) => string | Error | Promise<string | Error>)
  titleCalls?: ResponseCreateParams[]
  /** What `models.list()` yields, or the error it throws. */
  models?: string[] | Error
  /** Streaming calls with `reasoning` fail with 400, like non-reasoning models. */
  rejectReasoning?: boolean
  /** An error for a streaming call (e.g. a 400 for its input), or none. */
  reject?: (params: ResponseCreateParamsStreaming) => Error | undefined
  /** Records uploaded file names (`files.create`, ids `file-1`, …), or the error it throws (no Files API). */
  uploads?: string[] | Error
  /** Records the ids passed to `files.delete`. */
  deletedUploads?: string[]
}

/**
 * An OpenAI client whose streaming `responses.create` yields the given
 * events (or rejects with an error), honouring the abort signal between
 * events. Non-streaming calls are title requests: see `FakeOptions`.
 */
export function fakeClient(
  /** Per streaming call: the events, an error, or a function picking them. */
  events:
    ResponseStreamEvent[] | Error | ((call: number) => ResponseStreamEvent[]),
  calls: FakeCall[] = [],
  {
    title = 'Test Title',
    titleCalls = [],
    models = ['m-2', 'm-1'],
    rejectReasoning = false,
    reject,
    uploads = [],
    deletedUploads = [],
  }: FakeOptions = {},
): OpenAI {
  const create = async (
    params: ResponseCreateParams,
    options?: { signal?: AbortSignal },
  ) => {
    if (!params.stream) {
      titleCalls.push(structuredClone(params))
      const result = await (typeof title === 'function' ? title(params) : title)
      if (result instanceof Error) throw result
      return { output_text: result }
    }
    calls.push({
      params: structuredClone(params) as ResponseCreateParamsStreaming,
      signal: options?.signal,
    })
    if (events instanceof Error) throw events
    const streamed =
      typeof events === 'function' ? events(calls.length - 1) : events
    const rejected = reject?.(params as ResponseCreateParamsStreaming)
    if (rejected) throw rejected
    if (rejectReasoning && params.reasoning) {
      throw new OpenAI.BadRequestError(
        400,
        { message: 'reasoning is not supported' },
        'reasoning is not supported',
        new Headers(),
      )
    }
    return (async function* () {
      for (const event of streamed) {
        await Promise.resolve()
        if (options?.signal?.aborted) throw new OpenAI.APIUserAbortError()
        yield event
      }
    })()
  }
  async function* list() {
    if (models instanceof Error) throw models
    for (const id of models) yield { id }
  }
  const files = {
    create: async ({ file }: { file: File }) => {
      if (uploads instanceof Error) throw uploads
      return { id: `file-${uploads.push(file.name)}` }
    },
    delete: async (id: string) => {
      deletedUploads.push(id)
      return { id, deleted: true }
    },
  }
  return {
    responses: { create },
    models: { list },
    files,
  } as unknown as OpenAI
}

/** A conversation store on `db` (by default a fresh in-memory database). */
export const memoryStore = (db = openDatabase(':memory:')) =>
  new ConversationStore(db)

/** A memory store on `db` (by default a fresh in-memory database). */
export const testMemories = (db = openDatabase(':memory:')) =>
  new MemoryStore(db)

/** A file store on `db`, keeping bytes in a new temporary folder. */
export const testFiles = (db = openDatabase(':memory:')) =>
  new FileStore(db, mkdtempSync(join(tmpdir(), 'chibot-files-')))

/**
 * A `ChatService` on fakes: `events` answer its streaming requests (see
 * `fakeClient`; `calls` records them, `client` sets the fake's options).
 * `store` and `settings` default to fresh ones (`settings` for `model`), and
 * the rest are the service's own options (`tools`, `attachments`, …).
 */
export function testChat(
  events: Parameters<typeof fakeClient>[0],
  {
    store = memoryStore(),
    calls,
    client,
    model = 'm',
    settings = testSettings(model),
    ...options
  }: {
    store?: ConversationStore
    calls?: FakeCall[]
    client?: FakeOptions
    model?: string
    settings?: SettingsStore
  } & NonNullable<ConstructorParameters<typeof ChatService>[5]> = {},
) {
  return chatOn(fakeClient(events, calls, client), store, settings, options)
}

/** `testChat`, with the title writer it uses too. */
export function testChatServices(
  events: Parameters<typeof fakeClient>[0],
  {
    store = memoryStore(),
    calls,
    client,
    settings = testSettings('m'),
    ...options
  }: {
    store?: ConversationStore
    calls?: FakeCall[]
    client?: FakeOptions
    settings?: SettingsStore
  } & NonNullable<ConstructorParameters<typeof ChatService>[5]> = {},
) {
  return chatServices(
    fakeClient(events, calls, client),
    store,
    settings,
    options,
  )
}

/** A `ChatService` on `client`, with its model requests and title writer. */
export function chatServices(
  client: OpenAI,
  store: ConversationStore,
  settings: SettingsStore,
  options: NonNullable<ConstructorParameters<typeof ChatService>[5]> = {},
) {
  const model = new ModelRequests(client, options.attachments)
  const titles = new TitleWriter(model, store, settings)
  const compactor = new Compactor(model, store, settings)
  const chat = new ChatService(
    model,
    titles,
    compactor,
    store,
    settings,
    options,
  )
  return { chat, titles, model, compactor }
}

/** A `ChatService` on `client`. */
export const chatOn = (...args: Parameters<typeof chatServices>) =>
  chatServices(...args).chat

/** Settings with `model` (and any overrides), on their own in-memory database. */
export function testSettings(model = 'm', overrides: Partial<Settings> = {}) {
  const settings = new SettingsStore(
    openDatabase(':memory:'),
    settingsDefaults(model),
  )
  settings.update(overrides)
  return settings
}

/** Echoes `text` back, or throws when it is "fail". */
export class EchoTool extends Tool {
  readonly name: string
  readonly label = 'Echo'
  readonly description = 'Echoes text back.'
  readonly parameters = z.object({ text: z.string() })
  readonly runs: string[] = []
  override readonly requiresApproval: boolean | 'after-untrusted'
  override readonly untrustedOutput: boolean
  readonly #unavailable: string | null

  constructor({
    name = 'echo',
    requiresApproval = false as boolean | 'after-untrusted',
    untrustedOutput = false,
    unavailable = null as string | null,
  } = {}) {
    super()
    this.name = name
    this.requiresApproval = requiresApproval
    this.untrustedOutput = untrustedOutput
    this.#unavailable = unavailable
  }

  override unavailable() {
    return this.#unavailable
  }

  async run({ text }: { text: string }) {
    if (text === 'fail') throw new Error('it failed')
    this.runs.push(text)
    return `echo: ${text}`
  }
}

/** A streamed response that calls `name` with `args` (one call per entry). */
export function callEvents(
  ...calls: { name?: string; args: unknown; callId?: string }[]
): ResponseStreamEvent[] {
  const output = calls.map(({ name = 'echo', args, callId }, i) => ({
    id: `fc_${i}`,
    type: 'function_call',
    status: 'completed',
    call_id: callId ?? `call_${i}`,
    name,
    arguments: JSON.stringify(args),
  }))
  return [
    ...output.map((item) => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed', response: { output, usage } },
  ] as unknown as ResponseStreamEvent[]
}

/** A watcher that never sees a change, so a test app touches no real folders. */
const noWatcher = { close: () => {}, on: () => noWatcher } as never

/**
 * The app on one in-memory database, with fakes for whatever `deps` leaves
 * out (an OpenAI key config, a chat service whose client streams nothing).
 */
export function testApp(deps: Partial<AppDeps> = {}) {
  const db = openDatabase(':memory:')
  const store = deps.store ?? new ConversationStore(db)
  const settings = deps.settings ?? testSettings()
  const files = deps.files ?? testFiles(db)
  const projects = deps.projects ?? new ProjectStore(db, files)
  const index = new ProjectIndex(db, projects, files, null)
  const sync = new ProjectSync(projects, files, index)
  const { chat, compactor, titles, model } = chatServices(
    fakeClient([]),
    store,
    settings,
  )
  return createApp({
    config: new Config({ OPENAI_API_KEY: 'k' }),
    search: new ConversationSearch(db),
    chat,
    compactor,
    titles,
    model,
    registry: new ToolRegistry([]),
    memories: new MemoryStore(db),
    index,
    sync,
    skills: new SkillStore(join(tmpdir(), 'chibot-no-skills')),
    watcher: new FolderWatcher(projects, sync, { watch: () => noWatcher }),
    instructionWriter: new InstructionWriter(
      fakeClient([]),
      settings,
      projects,
      index,
    ),
    attachments: new Attachments(fakeClient([]), files),
    transcription: null,
    media: new MediaProxy(),
    mcp: new McpServers({}),
    mcpFile: new McpServerFile({
      source: 'config.json',
      locked: null,
      read: () => ({}),
      write: () => {},
      check: () => {},
    }),
    ...deps,
    projects,
    store,
    settings,
    files,
  })
}

/** A small PDF with one line of text on each page. */
export function pdfOf(pages: string[]): Buffer {
  const kids = pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    ...pages.flatMap((text, i) => {
      const stream = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4 + 2 * i} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ]
    }),
  ]
  const body = objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')
  return Buffer.from(
    `%PDF-1.4\n${body}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF`,
  )
}
