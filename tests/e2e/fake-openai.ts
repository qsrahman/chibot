// A stand-in for an OpenAI-compatible Responses API, for the e2e tests.
// Streams `Answer #n to: <last user message>` word by word. A question that
// contains "slow" streams a long answer slowly (to act mid-answer), "think"
// first streams a reasoning summary, and "compact" returns a compaction item.
// "calculate" calls the calculator tool and "approve" the test-only e2e_note
// tool (see server.ts); once the tool's output arrives, the answer quotes it.
// Non-streaming requests are title requests. GET /debug/last-request shows
// the last chat request, so tests can check what chibot sent.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
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
const app = new Hono()

app.get('/health', (c) => c.text('ok'))
app.get('/debug/last-request', (c) => c.json(lastRequest))
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
      : question.includes('calculate')
        ? { name: 'calculator', arguments: '{"expression":"6 * 7"}' }
        : question.includes('approve')
          ? { name: 'e2e_note', arguments: '{"text":"hello"}' }
          : null
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

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () =>
  console.log(`fake OpenAI on http://127.0.0.1:${PORT}/v1`),
)
