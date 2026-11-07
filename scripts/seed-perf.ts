// Fills a data folder with a lot of chats, for measuring how the app copes:
// `pnpm seed:perf --data <folder> [--chats 300] [--turns 500] [--output 20000]`.
// One chat ("Perf: long chat") has `turns` turns, each with a tool call whose
// result is `output` characters, a long answer with a code block and a table;
// the rest are small. Then run chibot on it:
// `CHIBOT_DATA_DIR=<folder> chibot --port 4177`.
// It refuses your real data folder and a folder that already holds chats.
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ConversationStore } from '../src/server/conversations/index.ts'
import { openDatabase } from '../src/server/database.ts'
import { locations } from '../src/server/locations.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    chats: { type: 'string', default: '300' },
    turns: { type: 'string', default: '500' },
    output: { type: 'string', default: '20000' },
  },
})
if (!values.data) {
  console.error(
    'Usage: pnpm seed:perf --data <folder> [--chats N] [--turns N] [--output chars]',
  )
  process.exit(1)
}
const dir = resolve(values.data)
if (dir === locations(process.env).dataDir) {
  console.error('That is your real data folder: pick another.')
  process.exit(1)
}
if (existsSync(join(dir, 'chibot.db'))) {
  console.error(
    `${dir} already holds chibot.db: delete it, or pick another folder.`,
  )
  process.exit(1)
}
mkdirSync(dir, { recursive: true, mode: 0o700 })

const chats = Number(values.chats)
const turns = Number(values.turns)
const output = Number(values.output)
const store = new ConversationStore(openDatabase(join(dir, 'chibot.db')))

const answer = (n: number) =>
  `Here is answer ${n}.\n\n` +
  'Some **bold** and `inline code` in a paragraph that goes on a little, so lines wrap.\n\n' +
  '```ts\nexport function add(a: number, b: number) {\n  return a + b\n}\n```\n\n' +
  '| name | value |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n\n' +
  'And a closing sentence about the table above, with a [link](https://example.com).'

const started = Date.now()

// The small chats first, so the long one is the newest and shows in the sidebar.
for (let c = 1; c <= chats; c++) {
  const { id } = store.createConversation()
  const [q] = store.appendItems(id, null, [
    { role: 'user', content: `Small chat ${c}` },
  ])
  store.appendItems(id, q!.id, [{ role: 'assistant', content: answer(c) }])
  store.updateConversation(id, { title: `Perf: small chat ${c}` })
}
const long = store.createConversation()
let leaf: number | null = null
for (let i = 1; i <= turns; i++) {
  const [question] = store.appendItems(long.id, leaf, [
    { role: 'user', content: `Question ${i}: what does step ${i} do?` },
  ])
  const items = store.appendItems(
    long.id,
    question!.id,
    [
      {
        type: 'function_call',
        call_id: `call_${i}`,
        name: 'search_chats',
        arguments: JSON.stringify({ query: `step ${i}` }),
      },
      {
        type: 'function_call_output',
        call_id: `call_${i}`,
        output: `result ${i} `.repeat(Math.ceil(output / 10)).slice(0, output),
      },
      { role: 'assistant', content: answer(i) },
    ],
    {
      input_tokens: 1000 + i,
      output_tokens: 200,
      total_tokens: 1200 + i,
    } as never,
    'seed-model',
  )
  leaf = items.at(-1)!.id
}
store.updateConversation(long.id, { title: 'Perf: long chat' })

console.log(
  `Seeded ${chats + 1} chats (one of ${turns} turns, ${output} characters per tool result) in ${dir} in ${Date.now() - started} ms.`,
)
console.log(
  `Run it: CHIBOT_DATA_DIR=${dir} OPENAI_API_KEY=x chibot --port 4177`,
)
