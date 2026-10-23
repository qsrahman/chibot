// A stand-in for an OpenAI-compatible Responses API, for the e2e tests.
// Streams `Answer #n to: <last user message>` word by word. A question that
// contains "slow" streams a long answer slowly (to act mid-answer), "think"
// first streams a reasoning summary, and "compact" returns a compaction item.
// "calculate" calls the calculator tool, "approve" the test-only e2e_note tool
// (see server.ts), "search" web_search, "read <url>" fetch_url, "draw"
// generate_image and "bluer" edit_image (on the chat's last image); a forced
// tool_choice is followed. Once the tool's output arrives, the answer quotes
// it. It also fakes the Brave Search API (/brave/…), serves a test page
// (/pages/robots) and makes 1×1 images (/v1/images/…).
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
app.get('/debug/last-request', (c) => c.json(lastRequest))
app.get('/debug/requests', (c) => c.json(requests.slice(-10)))
app.get('/debug/last-image-request', (c) => c.json(lastImageRequest))

app.get('/brave/res/v1/web/search', (c) => {
  const q = c.req.query('q')
  return c.json({
    web: {
      results: [
        {
          title: `Result for <strong>${q}</strong>`,
          url: `http://127.0.0.1:${PORT}/pages/robots`,
          description: 'All about <strong>robots</strong>.',
        },
      ],
    },
  })
})

app.get('/pages/robots', (c) =>
  c.html(`<!doctype html><html><head><title>Robots</title></head><body>
    <nav>Home · About</nav><article><h1>Robots</h1>
    <p>Robots are machines that can carry out a series of actions on their
       own. They are used in factories, homes and space, and they keep
       getting cheaper, smaller and more capable every year.</p>
    <p>This paragraph is here so that Readability finds enough text to be
       sure it found the article and not the navigation around it.</p>
    </article></body></html>`),
)

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
app.get('/v1/models', (c) =>
  c.json({
    object: 'list',
    data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'e2e' })),
  }),
)

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
  const question =
    typeof body.input === 'string'
      ? body.input
      : String(body.input.findLast((i) => i.role === 'user')?.content ?? '')
  const slow = question.includes('slow')
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
  const compaction = {
    id: `cmp_${crypto.randomUUID()}`,
    type: 'compaction',
    encrypted_content: 'e2e',
  }
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
  const output = [
    ...(question.includes('compact') ? [compaction] : []),
    ...(thinking ? [reasoning] : []),
    call ?? message(reply),
  ]

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
      await stream.sleep(slow ? 100 : 5)
    }
    await send({
      type: 'response.completed',
      response: { id, status: 'completed', model: body.model, output, usage },
    })
  })
})

/** The tool call the question asks for (see the top of this file). */
function pickTool(
  question: string,
  input: unknown,
  forced: string | undefined,
): { name: string; arguments: string } | null {
  const call = (name: string, args: unknown) => ({
    name,
    arguments: JSON.stringify(args),
  })
  const url = /https?:\/\/\S+/.exec(question)?.[0]
  if (forced === 'web_search' || question.includes('search')) {
    return call('web_search', { query: question, freshness: null })
  }
  if (forced === 'generate_image' || question.includes('draw')) {
    return call('generate_image', { prompt: question, size: 'square' })
  }
  if (question.includes('bluer')) {
    // The chat's last image, from the tool outputs in its history.
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
    const id = ids.at(-1)
    return call('edit_image', { image_id: id, prompt: 'make it bluer' })
  }
  if (question.includes('read') && url) return call('fetch_url', { url })
  if (question.includes('calculate')) {
    return call('calculator', { expression: '6 * 7' })
  }
  if (question.includes('approve')) return call('e2e_note', { text: 'hello' })
  return null
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () =>
  console.log(`fake OpenAI on http://127.0.0.1:${PORT}/v1`),
)
