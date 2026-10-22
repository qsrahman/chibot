// A stand-in for an OpenAI-compatible Responses API, for the e2e tests.
// Streams `Answer #n to: <last user message>` word by word; a message that
// contains "slow" streams a long answer slowly, so tests can act mid-answer.
// Non-streaming requests are title requests.
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

let answers = 0
const app = new Hono()

app.get('/health', (c) => c.text('ok'))

app.post('/v1/responses', async (c) => {
  const body = (await c.req.json()) as {
    stream?: boolean
    input: string | { role?: string; content?: unknown }[]
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

  const question =
    typeof body.input === 'string'
      ? body.input
      : String(body.input.findLast((i) => i.role === 'user')?.content ?? '')
  const slow = question.includes('slow')
  const text = slow
    ? Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    : `Answer #${++answers} to: ${question}`
  const words = text.split(' ')
  const id = `resp_${crypto.randomUUID()}`

  return streamSSE(c, async (stream) => {
    const send = (event: Record<string, unknown> & { type: string }) =>
      stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
    await send({ type: 'response.created', response: { id, output: [] } })
    for (const [i, word] of words.entries()) {
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
      response: { id, status: 'completed', output: [message(text)], usage },
    })
  })
})

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () =>
  console.log(`fake OpenAI on http://127.0.0.1:${PORT}/v1`),
)
