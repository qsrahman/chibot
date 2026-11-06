import { describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { Compactor } from '../../../src/server/chat/compactor.ts'
import { fromCompaction } from '../../../src/server/chat/context.ts'
import { ModelRequests } from '../../../src/server/chat/model-requests.ts'
import { chatInstructions } from '../../../src/server/chat/prompts.ts'
import { openDatabase } from '../../../src/server/database.ts'
import {
  SettingsStore,
  settingsDefaults,
} from '../../../src/server/settings-store.ts'
import { ConversationStore } from '../../../src/server/conversations/index.ts'

// Does a summary keep what a chat needs? Opt-in, with a real model: facts are
// planted in the first turns of a long chat, the start of the chat is
// summarized with chibot's own prompt, and the model is asked about them from
// the summary alone. For local models:
//   RECALL_URL=http://localhost:11434/v1 RECALL_MODELS=gemma4:e4b \
//   pnpm exec vitest run tests/server/chat/recall.test.ts
// RECALL_KEY and RECALL_SAMPLES (default 2) are optional. It prints the share
// of facts recalled per model, and fails below 60 %. Models answer differently
// each time: read a failure as a reason to look, and re-run it. Run it when
// changing the summary prompt (`SUMMARY_INSTRUCTIONS`).

const url = process.env.RECALL_URL
const models = (process.env.RECALL_MODELS ?? '').split(',').filter(Boolean)
const SAMPLES = Number(process.env.RECALL_SAMPLES ?? 2)

// What was said early on, and what to ask later (the answer must contain `has`).
const FACTS = [
  {
    said: 'We are building an invoicing tool. Its code name is Heron-47.',
    ask: 'What is the code name of the project?',
    has: /heron-47/i,
  },
  {
    said: 'The money code lives in `src/billing/invoice.ts`; start there.',
    ask: 'Which file did I say to start in?',
    has: /src\/billing\/invoice\.ts/,
  },
  {
    said: 'Please never use semicolons in the code you write for me.',
    ask: 'What did I ask you to never use in code?',
    has: /semicolon/i,
  },
  {
    said: 'The deadline is 14 March, and the demo is for the client Marlowe.',
    ask: 'Who is the demo for?',
    has: /marlowe/i,
  },
]
const FILLER =
  'Here is how that part works in detail. '.repeat(8) +
  'It reads the records, checks each total against the ledger, and reports ' +
  'any difference so that it can be corrected before the invoice is sent.'

async function recalled(client: OpenAI, model: string) {
  const db = openDatabase(':memory:')
  const store = new ConversationStore(db)
  const settings = new SettingsStore(db, settingsDefaults(model))
  settings.update({
    contextWindow: 4000,
    compactAt: 75,
    compactReserve: 0,
    keepRecent: 500,
  })
  const compactor = new Compactor(new ModelRequests(client), store, settings)
  const id = store.createConversation().id
  let leaf: number | null = null
  const say = (role: 'user' | 'assistant', content: string) => {
    leaf = store.appendItems(id, leaf, [{ role, content }]).at(-1)!.id
  }
  FACTS.forEach(({ said }, i) => {
    say('user', said)
    say('assistant', `Understood. ${FILLER} (part ${i + 1})`)
  })
  for (let i = 0; i < 4; i++) {
    say('user', `Tell me more about step ${i + 1} of the check.`)
    say('assistant', FILLER)
  }
  const job = compactor.prepare(id, leaf!)
  expect(job, 'something to summarize').not.toBeNull()
  const compaction = await compactor.run(job!)
  const path = store.getPath(id, leaf!)
  const { items, lead } = fromCompaction(path, compaction)
  let hits = 0
  for (const { ask, has } of FACTS) {
    const response = await client.responses.create({
      model,
      instructions: chatInstructions({ aboutUser: '', responseStyle: '' }),
      input: [
        ...lead,
        ...items.map((item) => item.data),
        { role: 'user', content: ask },
      ],
      store: false,
    })
    if (has.test(response.output_text)) hits++
  }
  return { hits, degraded: compaction.degraded }
}

describe.skipIf(!url || models.length === 0)('recall after a summary', () => {
  const client = new OpenAI({
    baseURL: url,
    apiKey: process.env.RECALL_KEY ?? 'none',
  })

  it.each(models)(
    '%s: answers about early facts from the summary',
    async (model) => {
      let hits = 0
      let degraded = 0
      for (let i = 0; i < SAMPLES; i++) {
        const result = await recalled(client, model)
        hits += result.hits
        if (result.degraded) degraded++
      }
      const total = FACTS.length * SAMPLES
      console.log(
        `${model}: recalled ${hits}/${total} facts; ${degraded}/${SAMPLES} summaries marked degraded`,
      )
      expect(hits).toBeGreaterThanOrEqual(Math.ceil(total * 0.6))
    },
    600_000,
  )
})
