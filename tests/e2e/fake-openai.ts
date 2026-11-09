// A stand-in for an OpenAI-compatible Responses API, for the e2e tests.
// Streams `Answer #n to: <last user message>` word by word. A question that
// contains "slow" streams a long answer slowly (to act mid-answer), "hold"
// streams its first word and waits there until POST /debug/release (so a test
// can act mid-answer without racing a timer), "think"
// first streams a reasoning summary, and "compact" returns a compaction item.
// A question's words can call a tool ("approve", "draw", "remember <fact>",
// "mcp echo <text>", …): `TRIGGERS` below lists
// them. A forced tool_choice is followed. Once the tool's output arrives, the
// answer quotes it. It also makes 1×1 images (/v1/images/…), embeds text as counts
// of a few letters (/v1/embeddings) and transcribes any recording as
// "Hello from the microphone" (/v1/audio/transcriptions). Its Files API
// (/v1/files) keeps uploads until POST /debug/forget-files; a request naming
// an unknown file gets a 404, as on OpenAI, and e2e-other rejects
// `input_file` parts with a 400, as Ollama does.
// Non-streaming requests are title requests. GET /debug/last-request shows
// the last chat request, so tests can check what chibot sent.
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'

const PORT = Number(process.env.FAKE_OPENAI_PORT ?? 4010)
const usage = {
  input_tokens: 40,
  input_tokens_details: { cached_tokens: 8, cache_write_tokens: 0 },
  output_tokens: 12,
  output_tokens_details: { reasoning_tokens: 4 },
  total_tokens: 52,
}

const MODELS = ['e2e-model', 'e2e-other']
const THOUGHT = 'Considering the question carefully.'

let answers = 0
let lastRequest: unknown = null
// Chat requests, newest last, for checks on earlier steps of a turn.
const requests: unknown[] = []
let lastImageRequest: unknown = null
const app = new Hono()

app.get('/health', (c) => c.text('ok'))
// Answers that "hold" wait here; a test lets them finish with POST /debug/release.
// (Thirty seconds at most, so a test that fails leaves nothing hanging.)
const held = new Set<() => void>()
const hold = () =>
  new Promise<void>((resolve) => {
    held.add(resolve)
    setTimeout(resolve, 30_000).unref()
  })
app.post('/debug/release', (c) => {
  for (const release of held) release()
  held.clear()
  return c.body(null, 204)
})

app.get('/debug/last-request', (c) => c.json(lastRequest))
app.get('/debug/requests', (c) => c.json(requests.slice(-10)))
app.get('/debug/last-image-request', (c) => c.json(lastImageRequest))

// A tracking pixel on another origin than chibot's (port 4010, not 4011), and
// what it was asked: the specs check that chibot never loads it by itself.
const pixelHits: string[] = []
app.get('/debug/pixel', (c) => {
  pixelHits.push(c.req.url)
  return c.body(
    Uint8Array.from(
      atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
      (ch) => ch.charCodeAt(0),
    ),
    200,
    { 'Content-Type': 'image/gif' },
  )
})
app.get('/debug/pixel-hits', (c) => c.json(pixelHits))

// A tenth of a second of silence: a sound a browser can play.
function wav(): Uint8Array {
  const samples = 800
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) =>
    [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  return bytes
}
app.get('/media/beep.wav', (c) => {
  const bytes = wav()
  const range = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '')
  if (!range) {
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
    })
  }
  const start = Number(range[1])
  const end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1)
  return c.body(bytes.slice(start, end + 1) as unknown as ArrayBuffer, 206, {
    'Content-Type': 'audio/wav',
    'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
  })
})

// A 1×1 transparent PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const image = (c: Context, request: unknown) => {
  lastImageRequest = request
  return c.json({ created: 0, data: [{ b64_json: PNG }], output_format: 'png' })
}
app.post('/v1/images/generations', async (c) =>
  image(c, { endpoint: 'generations', ...(await c.req.json()) }),
)
app.post('/v1/images/edits', async (c) => {
  const { prompt, model } = await c.req.parseBody()
  return image(c, { endpoint: 'edits', prompt, model })
})
let lastTranscription: { model: unknown; name: string; size: number } | null =
  null
app.get('/debug/last-transcription', (c) => c.json(lastTranscription))
app.post('/v1/audio/transcriptions', async (c) => {
  const { file, model } = await c.req.parseBody()
  if (!(file instanceof File))
    return c.json({ error: { message: 'no file' } }, 400)
  lastTranscription = { model, name: file.name, size: file.size }
  return c.json({ text: 'Hello from the microphone' })
})

app.get('/v1/models', (c) =>
  c.json({
    object: 'list',
    data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'e2e' })),
  }),
)

app.post('/v1/embeddings', async (c) => {
  const { input } = (await c.req.json()) as { input: string[] }
  return c.json({
    object: 'list',
    data: input.map((text, index) => ({
      object: 'embedding',
      index,
      embedding: ['a', 'e', 'i', 'o', 'u'].map(
        (letter) => text.split(letter).length,
      ),
    })),
    usage: { prompt_tokens: 1, total_tokens: 1 },
  })
})

const uploads = new Map<string, string>()
let uploadCount = 0
app.post('/v1/files', async (c) => {
  const { file, purpose } = await c.req.parseBody()
  if (!(file instanceof File)) {
    return c.json({ error: { message: 'no file' } }, 400)
  }
  const id = `file-${++uploadCount}`
  uploads.set(id, file.name)
  return c.json({
    id,
    object: 'file',
    bytes: file.size,
    created_at: Math.floor(Date.now() / 1000),
    filename: file.name,
    purpose,
    status: 'processed',
  })
})
app.delete('/v1/files/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, object: 'file', deleted: uploads.delete(id) })
})
app.get('/debug/files', (c) =>
  c.json({ count: uploadCount, kept: [...uploads.values()] }),
)
app.post('/debug/forget-files', (c) => {
  uploads.clear()
  return c.json({ ok: true })
})

app.post('/v1/responses', async (c) => {
  const body = (await c.req.json()) as {
    model: string
    stream?: boolean
    input:
      | string
      | { role?: string; type?: string; content?: unknown; output?: string }[]
    tool_choice?: { type: string; name: string }
  }
  const message = (text: string) => ({
    id: `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  })

  if (!body.stream) {
    // A summary request (chibot's own instructions): a question with
    // "fail-summary" in it gets an answer without the <summary> tags.
    if (JSON.stringify(body.input).includes('Write the notes now.')) {
      return c.json({
        id: `resp_${crypto.randomUUID()}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output: [
          message(
            JSON.stringify(body.input).includes('fail-summary')
              ? 'no tags here'
              : '<analysis>thinking</analysis><summary>## Goal\nE2E summary</summary>',
          ),
        ],
        usage,
      })
    }
    return c.json({
      id: `resp_${crypto.randomUUID()}`,
      object: 'response',
      status: 'completed',
      output: [message('E2E Title')],
      usage,
    })
  }

  lastRequest = body
  requests.push(body)
  const parts =
    typeof body.input === 'string'
      ? []
      : body.input.flatMap((item) =>
          Array.isArray(item.content)
            ? (item.content as { type: string; file_id?: string }[])
            : [],
        )
  const missing = parts.flatMap((part) =>
    part.file_id && !uploads.has(part.file_id) ? [part.file_id] : [],
  )
  if (missing.length > 0) {
    return c.json(
      { error: { message: `Files [${missing.join(', ')}] were not found` } },
      404,
    )
  }
  if (
    body.model === 'e2e-other' &&
    parts.some((part) => part.type === 'input_file')
  ) {
    return c.json(
      { error: { message: 'file inputs are not currently supported' } },
      400,
    )
  }
  const question =
    typeof body.input === 'string'
      ? body.input
      : textOf(body.input.findLast((i) => i.role === 'user')?.content)
  const slow = question.includes('slow')
  const holding = question.includes('hold')
  const text = slow
    ? Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    : `Answer #${++answers} to: ${question}`
  const id = `resp_${crypto.randomUUID()}`
  const thinking = question.includes('think')
  const reasoning = {
    id: `rs_${crypto.randomUUID()}`,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: THOUGHT }],
    encrypted_content: 'e2e',
  }
  // A question with "huge" in it reports a context past the 32k window's
  // trigger, so the next message summarizes the chat first.
  const reported = question.includes('huge')
    ? { ...usage, input_tokens: 40_000, total_tokens: 40_012 }
    : usage
  const last = typeof body.input === 'string' ? null : body.input.at(-1)
  const tool =
    last?.type === 'function_call_output'
      ? null
      : pickTool(question, body.input, body.tool_choice?.name)
  const call = tool && {
    id: `fc_${crypto.randomUUID()}`,
    type: 'function_call',
    status: 'completed',
    call_id: `call_${crypto.randomUUID()}`,
    ...tool,
  }
  const reply =
    last?.type === 'function_call_output' ? `Tool said: ${last.output}` : text
  const output = [...(thinking ? [reasoning] : []), call ?? message(reply)]

  return streamSSE(c, async (stream) => {
    const send = (event: Record<string, unknown> & { type: string }) =>
      stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
    await send({ type: 'response.created', response: { id, output: [] } })
    if (thinking) {
      for (const word of THOUGHT.split(/(?= )/)) {
        await send({
          type: 'response.reasoning_summary_text.delta',
          item_id: reasoning.id,
          output_index: 0,
          summary_index: 0,
          delta: word,
        })
        await stream.sleep(50)
      }
    }
    if (call) {
      await send({
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...call, arguments: '' },
      })
      await stream.sleep(50)
      await send({
        type: 'response.output_item.done',
        output_index: 0,
        item: call,
      })
    }
    for (const [i, word] of (call ? [] : reply.split(' ')).entries()) {
      if (stream.aborted) return
      await send({
        type: 'response.output_text.delta',
        item_id: 'msg',
        output_index: 0,
        content_index: 0,
        delta: i === 0 ? word : ` ${word}`,
      })
      if (holding && i === 0) await hold()
      await stream.sleep(slow ? 100 : 5)
    }
    await send({
      type: 'response.completed',
      response: {
        id,
        status: 'completed',
        model: body.model,
        output,
        usage: reported,
      },
    })
  })
})

/** A message's text; with attachments, its `input_text` parts. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? '')
  return (content as { type: string; text?: string }[])
    .filter((part) => part.type === 'input_text')
    .map((part) => part.text)
    .join('\n')
}

/** What `args` of a trigger gets to work with. */
interface Asked {
  question: string
  /** The request's input items, for finding earlier outputs. */
  input: unknown
}

/**
 * A question that calls a tool, by its words. The first matching row wins; a
 * row with `forced` also fires when the request's `tool_choice` names its
 * tool (then `found` is `null`). Add a row to make the fake call a new tool.
 */
const TRIGGERS: {
  tool: string
  when: RegExp
  forced?: true
  args: (found: RegExpExecArray | null, asked: Asked) => unknown
}[] = [
  {
    tool: 'memory',
    when: /remember (.+)/,
    args: (found) => ({ action: 'save', id: null, text: found![1] }),
  },
  {
    tool: 'fixture__echo',
    when: /mcp echo (.+)/,
    args: (found) => ({ text: found![1] }),
  },
  { tool: 'fixture__picture', when: /mcp picture/, args: () => ({}) },
  {
    tool: 'search_project_files',
    when: /in my files (.+)/,
    args: (found) => ({ query: found![1], file: null, limit: null }),
  },
  {
    tool: 'read_project_file',
    when: /whole file (\S+)/,
    args: (found) => ({ file: found![1], from_part: null }),
  },
  {
    tool: 'search_chats',
    when: /earlier chats (.+)/,
    args: (found) => ({ query: found![1], after: null, before: null }),
  },
  {
    tool: 'generate_image',
    when: /draw/,
    forced: true,
    args: (_, { question }) => ({ prompt: question, size: 'square' }),
  },
  {
    tool: 'edit_image',
    when: /bluer/,
    args: (_, { input }) => ({
      image_id: lastImageId(input),
      prompt: 'make it bluer',
    }),
  },
  { tool: 'e2e_note', when: /approve/, args: () => ({ text: 'hello' }) },
]

/** The tool call the question asks for (see `TRIGGERS`). */
function pickTool(
  question: string,
  input: unknown,
  forced: string | undefined,
): { name: string; arguments: string } | null {
  for (const trigger of TRIGGERS) {
    const found = trigger.when.exec(question)
    if (!found && !(trigger.forced && forced === trigger.tool)) continue
    return {
      name: trigger.tool,
      arguments: JSON.stringify(trigger.args(found, { question, input })),
    }
  }
  return null
}

/** The chat's last image, from the tool outputs in its history. */
function lastImageId(input: unknown): string | undefined {
  const ids = (Array.isArray(input) ? input : []).flatMap(
    (item: { type?: string; output?: string }) => {
      if (item.type !== 'function_call_output') return []
      try {
        const { image_id } = JSON.parse(item.output ?? '') as {
          image_id?: string
        }
        return image_id ? [image_id] : []
      } catch {
        return []
      }
    },
  )
  return ids.at(-1)
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () =>
  console.log(`fake OpenAI on http://127.0.0.1:${PORT}/v1`),
)
