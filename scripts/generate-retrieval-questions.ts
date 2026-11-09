// Writes a set of questions for the project-search evaluation: a model reads
// passages of the documents in a folder and, for each, writes the question a
// user might ask and copies the sentence that answers it. A question is kept
// only if that sentence is in the document word for word and nowhere else in
// the folder, so what counts as the right answer is checked, not trusted.
//
//   node scripts/generate-retrieval-questions.ts --docs tests/fixtures/retrieval-docs \
//     --out tests/fixtures/retrieval-docs-generated.json --count 150 --seed 11 \
//     --model gemma4:12b-mlx [--url http://localhost:11434/v1] [--effort none]
//
// Any server with the Responses API and JSON-schema output will do (a local one
// keeps the documents on this machine). A model that thinks before it answers
// takes minutes over this; `--effort none` (the default) turns that off, and
// `--effort ''` leaves the setting out for a server that doesn't take it. The result is meant to be frozen: a new
// run writes different questions, which no longer compare with the old scores.
// The recipe is from github.com/daveebbelaar/ai-cookbook (hybrid-retrieval).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import OpenAI from 'openai'

const { values } = parseArgs({
  options: {
    docs: { type: 'string' },
    out: { type: 'string' },
    count: { type: 'string', default: '150' },
    seed: { type: 'string', default: '11' },
    model: { type: 'string' },
    url: { type: 'string', default: 'http://localhost:11434/v1' },
    effort: { type: 'string', default: 'none' },
  },
})
if (!values.docs || !values.out || !values.model) {
  throw new Error('Give --docs, --out and --model (see the top of this file)')
}
const { docs, out, model } = values as {
  docs: string
  out: string
  model: string
}
const COUNT = Number(values.count)
const client = new OpenAI({
  baseURL: values.url,
  apiKey: process.env.OPENAI_API_KEY ?? 'unused',
})

/** A seeded generator, so the same passages are picked in the same order. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = random(Number(values.seed))

// Line breaks and runs of spaces mean nothing to a reader (and a model joins
// hard-wrapped lines), so passages and quotes are compared without them.
const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const files = readdirSync(docs)
  .filter((name) => /\.(md|txt)$/.test(name))
  .sort()
const texts = new Map(
  files.map((name) => [
    flat(name),
    flat(readFileSync(join(docs, name), 'utf8')),
  ]),
)
const everything = [...texts.values()].join(' | ')

// Prose passages: blocks between blank lines, without code, headings or tables.
const passages: { file: string; text: string }[] = []
for (const file of files) {
  let fenced = false
  let block: string[] = []
  const end = () => {
    const text = flat(block.join(' '))
    block = []
    if (text.length >= 150 && text.length <= 3000 && !/^[#|]/.test(text)) {
      passages.push({ file, text })
    }
  }
  for (const line of readFileSync(join(docs, file), 'utf8').split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      end()
    } else if (!fenced) {
      if (line.trim() === '') end()
      else block.push(line)
    }
  }
  end()
}
for (let i = passages.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1))
  ;[passages[i], passages[j]] = [passages[j]!, passages[i]!]
}
console.log(`${files.length} files, ${passages.length} passages`)

const MENTIONS_THE_DOCUMENT =
  /\b(this|the) (passage|document|text|section|paragraph|excerpt|article|readme|file)\b|according to|mentioned (above|here)/i
const FILLER = new Set(
  'what which who whom does did can could should would will with from that this these those have has had into than then there their they them your about'.split(
    ' ',
  ),
)
const content = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
    (w) => !FILLER.has(w),
  )

async function write(passage: string) {
  const response = await client.responses.create({
    model,
    store: false,
    temperature: 0.5,
    ...(values.effort && {
      reasoning: { effort: values.effort as 'none' },
    }),
    input: `You are a user with a question. The passage below contains the answer.
Write ONE realistic question that a user would ask, in their own words.
Rules:
- The question must be answerable from the passage alone.
- Use natural language, not the passage's exact phrasing. Do not copy phrases of three or more words.
- Keep it under 20 words.
- Do not mention "the passage", "the document", "the text" or "this section".
Also return "evidence": the one sentence or line of the passage that contains the answer, copied exactly, character for character.

Passage:
${passage}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'question',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            evidence: { type: 'string' },
          },
          required: ['question', 'evidence'],
          additionalProperties: false,
        },
      },
    },
  })
  return JSON.parse(response.output_text) as {
    question: string
    evidence: string
  }
}

interface Kept {
  file: string
  question: string
  evidence: string
  /** Share of the question's content words that are also in the quote: low means a paraphrase. */
  overlap: number
}
const kept: Kept[] = []
const dropped: Record<string, number> = {}
const drop = (why: string) => void (dropped[why] = (dropped[why] ?? 0) + 1)
let next = 0

async function worker() {
  // Twice through the passages at most; a second question on a passage must
  // quote another sentence.
  while (kept.length < COUNT && next < passages.length * 2) {
    const passage = passages[next++ % passages.length]!
    try {
      const made = await write(passage.text)
      const question = made.question.trim()
      const evidence = flat(made.evidence)
      if (question.split(/\s+/).length > 25 || !question.endsWith('?')) {
        drop('not a short question')
      } else if (MENTIONS_THE_DOCUMENT.test(question)) {
        drop('mentions the document')
      } else if (evidence.length < 25 || evidence.length > 400) {
        drop('quote length')
      } else if (!texts.get(flat(passage.file))!.includes(evidence)) {
        drop('quote not word for word')
      } else if (everything.split(evidence).length - 1 !== 1) {
        drop('quote not unique')
      } else if (kept.some((k) => k.evidence === evidence)) {
        drop('same quote twice')
      } else {
        const inQuote = new Set(content(evidence))
        const words = content(question)
        const overlap = words.length
          ? words.filter((w) => inQuote.has(w)).length / words.length
          : 0
        kept.push({
          file: passage.file,
          question,
          evidence,
          overlap: Math.round(overlap * 100) / 100,
        })
        if (kept.length % 10 === 0)
          console.log(`${kept.length} of ${COUNT} kept`)
      }
    } catch (err) {
      drop(`error: ${(err as Error).message.slice(0, 40)}`)
    }
  }
}
await Promise.all([worker(), worker()])
writeFileSync(out, `${JSON.stringify(kept.slice(0, COUNT), null, 1)}\n`)
console.log(`kept ${Math.min(kept.length, COUNT)}; dropped`, dropped)
