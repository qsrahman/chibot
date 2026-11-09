import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { Reranker } from '../../../src/server/projects/reranker.ts'
import type { Hit } from '../../../src/server/projects/fusion.ts'
import {
  HELD_OUT,
  OFF_TOPIC,
  PARAPHRASES,
  SAME_WORDS,
} from '../../fixtures/retrieval-docs-questions.ts'
import {
  indexCorpus,
  prefixedClient,
  score,
  type Merge,
} from './retrieval-harness.ts'

// Project search over real documents: a frozen copy of chibot's own docs
// (tests/fixtures/retrieval-docs, eight files) with 87 questions whose
// answers are single facts in them, in three sets (the answer's own words,
// paraphrases, and paraphrases held out), and 20 that no document answers.
// The small corpus in retrieval.test.ts has 28 chunks, six of them real; this
// one is for telling a better change from noise. A second set of 147 questions
// was written by a model from the documents, quote and all (see the end of
// this file). Keyword search needs no
// endpoint (below); with an embedding endpoint it compares keyword, meaning and
// the shipped hybrid, with and without the model's task prefixes, and shows how
// close the best passage is for questions the documents can't answer:
//   RETRIEVAL_EMBEDDING_URL=http://localhost:11434/v1 \
//   RETRIEVAL_EMBEDDING_MODEL=embeddinggemma-2 \
//   RETRIEVAL_QUERY_PREFIX='task: search result | query: ' \
//   RETRIEVAL_DOCUMENT_PREFIX='title: none | text: ' \
//   pnpm exec vitest run tests/server/projects/retrieval-docs.test.ts \
//     --disable-console-intercept

const dir = join(import.meta.dirname, '../../fixtures/retrieval-docs')
const corpus: [string, Uint8Array][] = readdirSync(dir)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))])

// The lowest shares the current code reaches by keyword alone, on questions
// that use the answer's own words: a drop fails.
const SAME_WORDS_AT_1 = 0.7
const SAME_WORDS_AT_3 = 0.85
const SAME_WORDS_AT_6 = 0.9

describe('project search over real documents (keywords)', () => {
  let keyword: Awaited<ReturnType<typeof indexCorpus>>
  beforeAll(async () => {
    keyword = await indexCorpus(corpus, null)
  })

  it('has the documents, and a question set that is sound', () => {
    expect(corpus.map(([name]) => name)).toHaveLength(8)
    for (const set of [SAME_WORDS, PARAPHRASES, HELD_OUT]) {
      for (const { file, has } of set) {
        const text = Buffer.from(
          corpus.find(([n]) => n === file)![1],
        ).toString()
        expect(text.split(has).length - 1, `${file}: ${has}`).toBe(1)
      }
    }
    expect(SAME_WORDS.length + PARAPHRASES.length + HELD_OUT.length).toBe(87)
    expect(OFF_TOPIC).toHaveLength(20)
  })

  it('finds the passage that answers a question that uses its words', async () => {
    const { recall, summary } = await score(keyword, SAME_WORDS)
    console.log(`keyword, same words\n${summary}\n`)
    expect(recall(1)).toBeGreaterThanOrEqual(SAME_WORDS_AT_1)
    expect(recall(3)).toBeGreaterThanOrEqual(SAME_WORDS_AT_3)
    expect(recall(6)).toBeGreaterThanOrEqual(SAME_WORDS_AT_6)
  })
})

const embeddingUrl = process.env.RETRIEVAL_EMBEDDING_URL
describe.skipIf(!embeddingUrl)(
  'project search over real documents (meaning)',
  () => {
    const model = () => process.env.RETRIEVAL_EMBEDDING_MODEL!
    const base = () => new OpenAI({ baseURL: embeddingUrl, apiKey: 'none' })
    const sets = [
      ['same words', SAME_WORDS],
      ['paraphrases', PARAPHRASES],
      ['held out', HELD_OUT],
    ] as const
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4)

    it('compares keyword, meaning and the shipped hybrid, with and without prefixes', async () => {
      const keyword = await indexCorpus(corpus, null)
      const plain = await indexCorpus(corpus, { client: base(), model })
      const variants: [
        string,
        Merge | undefined,
        'keyword' | 'plain' | 'prefixed',
      ][] = [
        ['keyword only', ({ keyword }) => keyword.map((h) => h.id), 'keyword'],
        [
          'meaning only',
          ({ meaning }) => (meaning ?? []).map((h) => h.id),
          'plain',
        ],
        ['hybrid (shipped)', undefined, 'plain'],
      ]
      const lines = [
        `${''.padEnd(26)}${sets.map(([name]) => name.padEnd(30)).join('')}(first hit / first three / all 12  MRR)`,
      ]
      const rows = async (
        name: string,
        which: typeof variants,
        indexes: Record<string, Awaited<ReturnType<typeof indexCorpus>>>,
        suffix = '',
      ) => {
        for (const [label, merge, use] of which) {
          const cells: string[] = []
          for (const [, questions] of sets) {
            const { recall, mrr } = await score(indexes[use]!, questions, merge)
            cells.push(
              `${pct(recall(1))} /${pct(recall(3))} /${pct(recall(12))}  ${mrr.toFixed(2)}`.padEnd(
                30,
              ),
            )
          }
          lines.push(`${`${label}${suffix}`.padEnd(26)}${cells.join('')}`)
        }
        void name
      }
      await rows('plain', variants, { keyword, plain })

      // With the model's task prefixes, if given: a fresh index, since the
      // vectors change.
      const query = process.env.RETRIEVAL_QUERY_PREFIX
      const document = process.env.RETRIEVAL_DOCUMENT_PREFIX
      let prefixed: Awaited<ReturnType<typeof indexCorpus>> | undefined
      if (query !== undefined && document !== undefined) {
        const { client, state } = prefixedClient(base(), query, document)
        prefixed = await indexCorpus(corpus, { client, model })
        state.mode = 'query'
        lines.push('')
        await rows(
          'prefixed',
          variants
            .filter(([, , use]) => use !== 'keyword')
            .map(([l, m]) => [l, m, 'prefixed'] as const) as typeof variants,
          { prefixed },
          ' + prefixes',
        )
      }

      // How close the best passage is to a question, by meaning (cosine): for
      // questions the documents answer, and for ones they don't.
      const best = async (
        index: Awaited<ReturnType<typeof indexCorpus>>,
        questions: string[],
      ) => {
        const found: number[] = []
        for (const ask of questions) {
          const { meaning } = await index.index.candidates(index.projectId, ask)
          found.push(
            Math.max(...((meaning ?? []) as Hit[]).map((h) => h.score)),
          )
        }
        return found.sort((a, b) => a - b)
      }
      const spread = (xs: number[]) => {
        const at = (p: number) =>
          xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!.toFixed(2)
        return `min ${at(0)}  median ${at(0.5)}  max ${at(0.99)}`
      }
      const onTopic = [...SAME_WORDS, ...PARAPHRASES, ...HELD_OUT].map(
        (q) => q.ask,
      )
      const closeness = async (
        label: string,
        index: Awaited<ReturnType<typeof indexCorpus>>,
      ) => {
        const on = await best(index, onTopic)
        const off = await best(index, OFF_TOPIC)
        lines.push(
          '',
          `best passage's cosine similarity, ${label}`,
          `  documents answer: ${spread(on)}`,
          `  nothing answers : ${spread(off)}`,
        )
        for (const t of [0.5, 0.55, 0.6, 0.65, 0.7]) {
          const kept = on.filter((x) => x >= t).length / on.length
          const rejected = off.filter((x) => x < t).length / off.length
          lines.push(
            `  floor ${t.toFixed(2)}: keeps ${pct(kept)} of the answerable, rejects ${pct(rejected)} of the rest`,
          )
        }
      }
      await closeness('as shipped', plain)
      if (prefixed) await closeness('with prefixes', prefixed)
      console.log(`\n${lines.join('\n')}\n`)
    }, 600_000)
  },
)

// With a server that has a /rerank route (llama.cpp's llama-server with a
// reranker GGUF, vLLM, Jina, Cohere): what reordering the best 20 passages
// does to keyword search, and to the hybrid when embeddings are set too.
//   RETRIEVAL_RERANK_URL=http://localhost:8080/v1 \
//   RETRIEVAL_RERANK_MODEL=bge-reranker-v2-m3 [RETRIEVAL_RERANK_KEY=…] \
//   pnpm exec vitest run tests/server/projects/retrieval-docs.test.ts \
//     --disable-console-intercept
describe.skipIf(!process.env.RETRIEVAL_RERANK_URL)(
  'project search over real documents (reranking)',
  () => {
    const sets = [
      ['same words', SAME_WORDS],
      ['paraphrases', PARAPHRASES],
      ['held out', HELD_OUT],
    ] as const
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4)

    it('compares search with and without reordering by a reranking model', async () => {
      const reranker = () =>
        new Reranker({
          baseURL: process.env.RETRIEVAL_RERANK_URL!,
          apiKey: process.env.RETRIEVAL_RERANK_KEY ?? 'unused',
          model: () => process.env.RETRIEVAL_RERANK_MODEL!,
        })
      const embedding = embeddingUrl
        ? {
            client: new OpenAI({ baseURL: embeddingUrl, apiKey: 'none' }),
            model: () => process.env.RETRIEVAL_EMBEDDING_MODEL!,
          }
        : null
      const rows: [string, Awaited<ReturnType<typeof indexCorpus>>][] = [
        ['keyword', await indexCorpus(corpus, null)],
        ['keyword + rerank', await indexCorpus(corpus, null, reranker())],
      ]
      if (embedding) {
        rows.push(
          ['hybrid', await indexCorpus(corpus, embedding)],
          ['hybrid + rerank', await indexCorpus(corpus, embedding, reranker())],
        )
      }
      const lines = [
        `${''.padEnd(20)}${sets.map(([name]) => name.padEnd(30)).join('')}(first hit / first three / all 12  MRR)`,
      ]
      for (const [label, index] of rows) {
        const cells: string[] = []
        for (const [, questions] of sets) {
          const { recall, mrr } = await score(index, questions)
          cells.push(
            `${pct(recall(1))} /${pct(recall(3))} /${pct(recall(12))}  ${mrr.toFixed(2)}`.padEnd(
              30,
            ),
          )
        }
        lines.push(`${label.padEnd(20)}${cells.join('')}`)
      }
      console.log(`\n${lines.join('\n')}\n`)
    }, 900_000)
  },
)

// Questions a model wrote from the documents (scripts/generate-retrieval-questions.ts,
// gemma4:12b-mlx, seed 11), each with the sentence that answers it, checked to
// be in the file word for word and nowhere else. They are in the user's own
// kind of words more than the 87 above are, and there are more of them. The
// generator read README.txt too, so it is in this corpus.
interface Generated {
  file: string
  question: string
  evidence: string
  /** Share of the question's content words that are in the quote: low is a paraphrase. */
  overlap: number
}
const generated = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../fixtures/retrieval-docs-generated.json'),
    'utf8',
  ),
) as Generated[]
const generatedQuestions = generated.map(({ file, question, evidence }) => ({
  ask: question,
  file,
  has: evidence,
}))
const generatedCorpus: [string, Uint8Array][] = readdirSync(dir)
  .filter((name) => /\.(md|txt)$/.test(name))
  .sort()
  .map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))])
const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

// The share of them a keyword search puts in its results (all 12 passages).
const GENERATED_FOUND = 0.6

describe('project search over questions a model wrote (keywords)', () => {
  it('has quotes that are in their files, once', () => {
    const texts = new Map(
      generatedCorpus.map(([name, bytes]) => [
        name,
        flat(Buffer.from(bytes).toString()),
      ]),
    )
    const everything = [...texts.values()].join(' | ')
    expect(generated).toHaveLength(147)
    for (const { file, evidence } of generated) {
      expect(texts.get(file)!, evidence).toContain(evidence)
      expect(everything.split(evidence).length - 1, evidence).toBe(1)
    }
  })

  it('finds the answer in its results for most of them', async () => {
    const keyword = await indexCorpus(generatedCorpus, null)
    const { recall, mrr, summary } = await score(keyword, generatedQuestions)
    // (the lists of what was missed are too long to print for this many)
    console.log(`keyword, questions a model wrote\n${summary.split('\n')[0]}\n`)
    expect(recall(12)).toBeGreaterThanOrEqual(GENERATED_FOUND)
    expect(mrr).toBeGreaterThan(0.25)
  })
})

describe.skipIf(!embeddingUrl)(
  'project search over questions a model wrote (meaning)',
  () => {
    it('compares keyword and the shipped hybrid, by how much the question repeats the quote', async () => {
      const embedding = {
        client: new OpenAI({ baseURL: embeddingUrl, apiKey: 'none' }),
        model: () => process.env.RETRIEVAL_EMBEDDING_MODEL!,
      }
      const buckets: [string, (g: Generated) => boolean][] = [
        ['all', () => true],
        ['paraphrases (overlap < 0.3)', (g) => g.overlap < 0.3],
        [
          'some of its words (0.3 to 0.6)',
          (g) => g.overlap >= 0.3 && g.overlap < 0.6,
        ],
        ['most of its words (0.6 and up)', (g) => g.overlap >= 0.6],
      ]
      const lines = ['found in the 12 results / first hit / MRR']
      for (const [label, index] of [
        ['keyword', await indexCorpus(generatedCorpus, null)],
        ['hybrid', await indexCorpus(generatedCorpus, embedding)],
      ] as const) {
        for (const [bucket, keep] of buckets) {
          const questions = generatedQuestions.filter((_, i) =>
            keep(generated[i]!),
          )
          const { recall, mrr } = await score(index, questions)
          lines.push(
            `${label.padEnd(8)}${bucket.padEnd(34)}${pct(recall(12))} /${pct(recall(1))} / ${mrr.toFixed(2)}  (${questions.length} questions)`,
          )
        }
      }
      console.log(`\n${lines.join('\n')}\n`)
    }, 600_000)
  },
)

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`.padStart(4)
}
