import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { openDatabase } from '../../../src/server/database.ts'
import {
  DEFAULT_RESULTS,
  ProjectIndex,
  type EmbeddingDeps,
} from '../../../src/server/projects/project-index.ts'
import {
  fuse,
  reciprocalRankFusion,
  type Hit,
} from '../../../src/server/projects/fusion.ts'
import { ProjectStore } from '../../../src/server/projects/project-store.ts'
import { pdfOf, testFiles } from '../fakes.ts'

// How often a project search puts the passage that answers a question among
// its first hits, over a small corpus (tests/fixtures/retrieval) plus filler
// documents that share the corpus's everyday words. Keyword search only: no
// embedding endpoint, so a question must share a word with its passage. Run
// it before and after changing chunking or ranking; the threshold below is
// what the current code reaches, so a drop fails.

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/retrieval', name))

/** Sections that talk about leave, travel, security… without answering the questions. */
function filler(): string {
  const topics = [
    'travel',
    'leave',
    'security',
    'expenses',
    'remote work',
    'onboarding',
    'meals',
    'passwords',
    'devices',
    'release',
  ]
  return topics
    .flatMap((topic, t) =>
      Array.from({ length: 6 }, (_, n) => {
        const id = t * 6 + n + 1
        return `## ${topic[0]!.toUpperCase()}${topic.slice(1)} note ${id}\n\nOur ${topic} policy number ${id} applies to employees in the ${['Berlin', 'Lisbon', 'Dublin', 'Warsaw', 'Oslo', 'Prague'][n]} office. Employees should read the ${topic} guidance, ask their manager when something is unclear, and report problems to the team lead within ${id + 2} days. The ${topic} guidance is reviewed every year.`
      }),
    )
    .join('\n\n')
}

interface Question {
  ask: string
  /** The file that answers it. */
  file: string
  /** Text the answering passage contains. */
  has: string
  /** The PDF page, where the file has pages. */
  page?: number
}

const QUESTIONS: Question[] = [
  {
    ask: 'How many weeks of parental leave do new parents get?',
    file: 'handbook.md',
    has: '16 weeks',
  },
  {
    ask: 'What is the hotel limit per night in major cities?',
    file: 'handbook.md',
    has: '180 euros per night',
  },
  {
    ask: 'By when must I submit expense receipts?',
    file: 'handbook.md',
    has: 'within 30 days',
  },
  {
    ask: 'How soon must a lost laptop be reported?',
    file: 'handbook.md',
    has: 'within one hour',
  },
  {
    ask: 'How many days a week can I work from home?',
    file: 'handbook.md',
    has: 'up to three days a week',
  },
  {
    ask: 'What does the retry logic do on a 503 response?',
    file: 'api.ts',
    has: 'exponential backoff',
  },
  {
    ask: 'How does the token bucket rate limiter refill?',
    file: 'api.ts',
    has: 'tryAcquire',
  },
  {
    ask: 'Which orders count as open?',
    file: 'api.ts',
    has: "o.status === 'pending'",
  },
  {
    ask: 'Why did the mobile release move to 19 March?',
    file: 'meeting-notes.txt',
    has: 'payments SDK',
  },
  {
    ask: 'Which Android version are we dropping support for?',
    file: 'meeting-notes.txt',
    has: 'Android 8',
  },
  {
    ask: 'How much will moving thumbnails to a cheaper tier save?',
    file: 'meeting-notes.txt',
    has: '4,000 euros',
  },
  {
    ask: 'How long do I bake the sourdough bread covered?',
    file: 'recipes.md',
    has: 'covered pot at 240 degrees',
  },
  {
    ask: 'What goes into the lemon cake?',
    file: 'recipes.md',
    has: 'zest of two lemons',
  },
  {
    ask: 'How long is probation?',
    file: 'handbook.md',
    has: 'Probation lasts six months',
  },
  {
    ask: 'When are reimbursements paid?',
    file: 'handbook.md',
    has: 'last Friday of the month',
  },
  {
    ask: 'How much is the home-office allowance?',
    file: 'handbook.md',
    has: '400 euros',
  },
  {
    ask: 'Who owns the security review?',
    file: 'meeting-notes.txt',
    has: 'Tomas owns the review',
  },
  {
    ask: 'At what temperature do I roast tomatoes for the soup?',
    file: 'recipes.md',
    has: 'at 200 degrees for 35 minutes',
  },
  {
    ask: 'Do phishing tests penalise repeated failures?',
    file: 'handbook.md',
    has: 'not a penalty',
  },
  {
    ask: 'What is the warranty period of the espresso machine?',
    file: 'manual.pdf',
    has: '24 months',
    page: 3,
  },
  {
    ask: 'How do I descale the espresso machine?',
    file: 'manual.pdf',
    has: 'citric acid',
    page: 2,
  },
]

// Questions that share no distinctive word with the passage that answers them
// ("computer" for laptop, "missing" for lost), so only a search by meaning can
// find them. Keyword search is expected to miss most; see the opt-in test.
const PARAPHRASES: Question[] = [
  {
    ask: 'How long do mothers and fathers get off work after a baby arrives?',
    file: 'handbook.md',
    has: '16 weeks',
  },
  {
    ask: 'How much may I spend on a place to sleep when I travel to a large city?',
    file: 'handbook.md',
    has: '180 euros per night',
  },
  {
    ask: 'What should I do if my work computer goes missing?',
    file: 'handbook.md',
    has: 'within one hour',
  },
  {
    ask: 'Can I do my job from my living room?',
    file: 'handbook.md',
    has: 'up to three days a week',
  },
  {
    ask: 'When do I get my money back for things I paid out of pocket?',
    file: 'handbook.md',
    has: 'last Friday of the month',
  },
  {
    ask: 'Why are we delaying the phone app launch?',
    file: 'meeting-notes.txt',
    has: 'payments SDK',
  },
  {
    ask: 'Which old operating system will we stop supporting?',
    file: 'meeting-notes.txt',
    has: 'Android 8',
  },
  {
    ask: 'How do we keep the program from calling the server too often?',
    file: 'api.ts',
    has: 'tryAcquire',
  },
  {
    ask: 'What happens when a network call fails for a moment?',
    file: 'api.ts',
    has: 'exponential backoff',
  },
  {
    ask: 'How do I make a loaf rise slowly in the cold?',
    file: 'recipes.md',
    has: 'proof overnight in the fridge',
  },
  {
    ask: 'Which dessert uses citrus fruit?',
    file: 'recipes.md',
    has: 'zest of two lemons',
  },
  {
    ask: 'How often should I remove limescale from the machine?',
    file: 'manual.pdf',
    has: 'citric acid',
    page: 2,
  },
]

// Paraphrases written before any way of merging the searches was compared, to
// check that a choice made on the other two sets is not just fitted to them.
const HELD_OUT: Question[] = [
  {
    ask: 'What is the daily food allowance when I am on a trip?',
    file: 'handbook.md',
    has: '60 euros per day',
  },
  {
    ask: 'Is there an upper limit on how many days I can stay home ill?',
    file: 'handbook.md',
    has: 'not capped',
  },
  {
    ask: 'What does a new employee get handed on the first morning?',
    file: 'handbook.md',
    has: 'a laptop on day one',
  },
  {
    ask: 'Who is checking the payments component for safety?',
    file: 'meeting-notes.txt',
    has: 'Tomas owns the review',
  },
  {
    ask: 'How much money did finance approve for stress-testing the system?',
    file: 'meeting-notes.txt',
    has: '15,000 euro budget',
  },
  {
    ask: 'How do I turn a text file of settings lines into an object?',
    file: 'api.ts',
    has: 'parseEnv',
  },
  {
    ask: 'How do I add up the cost of purchases in euros?',
    file: 'api.ts',
    has: 'totalInEuros',
  },
  {
    ask: 'How long should the vegetables for the bisque stay in the oven?',
    file: 'recipes.md',
    has: 'at 200 degrees for 35 minutes',
  },
]

// The lowest shares of questions whose answer is the first hit, and among
// the first three.
const RECALL_AT_1 = 0.8
const RECALL_AT_3 = 0.95

/** The corpus, indexed (by keyword, and by meaning with `embedding`). */
async function buildIndex(embedding: EmbeddingDeps | null) {
  const db = openDatabase(':memory:')
  const files = testFiles(db)
  const projects = new ProjectStore(db, files)
  const index = new ProjectIndex(db, projects, files, embedding)
  const projectId = projects.create('Corpus').id
  const corpus: [string, Uint8Array][] = [
    ['handbook.md', fixture('handbook.md')],
    ['api.ts', fixture('api.ts')],
    ['meeting-notes.txt', fixture('meeting-notes.txt')],
    ['recipes.md', fixture('recipes.md')],
    ['filler.md', new TextEncoder().encode(filler())],
    [
      'manual.pdf',
      pdfOf([
        'Espresso machine manual. Safety first.',
        'Descale every three months with citric acid and rinse twice.',
        'The warranty period is 24 months from purchase.',
      ]),
    ],
  ]
  for (const [name, bytes] of corpus) {
    const file = files.save(null, name, 'application/octet-stream', bytes)
    projects.addFile(projectId, file.id)
    await index.index(file.id)
  }
  return { index, projectId }
}

/** The ids of the chunks to return, best first, from what each search found. */
type Merge = (found: { keyword: Hit[]; meaning: Hit[] | null }) => number[]

/** How often the answer is the first hit, and among the first three. */
async function score(
  { index, projectId }: { index: ProjectIndex; projectId: string },
  questions: Question[],
  merge?: Merge,
) {
  const missed = { 1: [] as string[], 3: [] as string[] }
  for (const { ask, file, has, page } of questions) {
    const hits = merge
      ? index.passages(
          merge(await index.candidates(projectId, ask)).slice(
            0,
            DEFAULT_RESULTS,
          ),
        )
      : await index.search(projectId, ask)
    const rank = hits.findIndex(
      (h) =>
        h.name === file &&
        h.text.includes(has) &&
        (page === undefined || pageOf(h.text, has) === page),
    )
    if (rank !== 0) missed[1].push(ask)
    if (rank < 0 || rank >= 3) missed[3].push(ask)
  }
  const recall = (at: 1 | 3) => 1 - missed[at].length / questions.length
  const summary =
    `recall@1: ${(recall(1) * 100).toFixed(0)}%  recall@3: ${(recall(3) * 100).toFixed(0)}% (${questions.length} questions)` +
    (missed[3].length ? `\nnot in the first 3: ${missed[3].join(' | ')}` : '') +
    (missed[1].length ? `\nnot first: ${missed[1].join(' | ')}` : '')
  return { recall, summary }
}

describe('project search quality', () => {
  let corpus: Awaited<ReturnType<typeof buildIndex>>
  beforeAll(async () => {
    corpus = await buildIndex(null)
  })

  it('finds the passage that answers a question among the first hits', async () => {
    const { recall, summary } = await score(corpus, QUESTIONS)
    console.log(summary)
    expect(recall(3)).toBeGreaterThanOrEqual(RECALL_AT_3)
    expect(recall(1)).toBeGreaterThanOrEqual(RECALL_AT_1)
  })

  it('answers a question about a long file with the right file first', async () => {
    const [first] = await corpus.index.search(
      corpus.projectId,
      'parental leave new parents',
    )
    expect(first).toMatchObject({ name: 'handbook.md' })
    expect(first!.text).toContain('16 weeks')
  })
})

/**
 * An embedding client that puts a prefix before every text, for models
 * trained to expect one (nomic's "search_document: " and "search_query: ").
 * It indexes with the document prefix until `state.mode` is set to 'query'.
 */
function prefixedClient(base: OpenAI, query: string, document: string) {
  const state = { mode: 'document' as 'document' | 'query' }
  const client = {
    embeddings: {
      create: (
        params: OpenAI.EmbeddingCreateParams,
        options?: OpenAI.RequestOptions,
      ) =>
        base.embeddings.create(
          {
            ...params,
            input: (params.input as string[]).map(
              (text) => (state.mode === 'query' ? query : document) + text,
            ),
          },
          options,
        ),
    },
  } as unknown as OpenAI
  return { client, state }
}

// Opt-in, with a real embedding endpoint (nothing here needs the network
// otherwise). For a local one:
//   RETRIEVAL_EMBEDDING_URL=http://localhost:11434/v1 \
//   RETRIEVAL_EMBEDDING_MODEL=nomic-embed-text-v2-moe pnpm exec vitest run \
//   tests/server/projects/retrieval.test.ts
// It prints keyword-only against hybrid scores, for both question sets.
const embeddingUrl = process.env.RETRIEVAL_EMBEDDING_URL
describe.skipIf(!embeddingUrl)('project search by meaning', () => {
  let keyword: Awaited<ReturnType<typeof buildIndex>>
  let hybrid: Awaited<ReturnType<typeof buildIndex>>
  beforeAll(async () => {
    keyword = await buildIndex(null)
    hybrid = await buildIndex({
      client: new OpenAI({
        baseURL: embeddingUrl,
        apiKey: process.env.RETRIEVAL_EMBEDDING_KEY ?? 'none',
      }),
      model: () => process.env.RETRIEVAL_EMBEDDING_MODEL!,
    })
  }, 300_000)

  it('does not lose what keyword search finds, and finds paraphrases', async () => {
    const results = {
      'keyword, same words': await score(keyword, QUESTIONS),
      'hybrid, same words': await score(hybrid, QUESTIONS),
      'keyword, paraphrases': await score(keyword, PARAPHRASES),
      'hybrid, paraphrases': await score(hybrid, PARAPHRASES),
    }
    for (const [name, { summary }] of Object.entries(results)) {
      console.log(`${name}\n${summary}\n`)
    }
    // Adding meaning to keywords must not cost what keywords find…
    expect(results['hybrid, same words'].recall(3)).toBeGreaterThanOrEqual(
      results['keyword, same words'].recall(3),
    )
    // …and is the only way to find a question put in other words.
    expect(results['hybrid, paraphrases'].recall(3)).toBeGreaterThan(
      results['keyword, paraphrases'].recall(3),
    )
  }, 300_000)

  // Not a pass/fail check: a table, to compare ways of merging what the two
  // searches found. Pick on the first two columns; the last says whether the
  // pick holds on questions that were not used to choose.
  it('compares ways of merging the two searches', async () => {
    const minMax = (hits: Hit[]) => {
      const scores = hits.map((h) => h.score)
      const low = Math.min(...scores)
      const span = Math.max(...scores) - low || 1
      return new Map(hits.map((h) => [h.id, (h.score - low) / span]))
    }
    const blend =
      (keywordShare: number): Merge =>
      ({ keyword, meaning }) => {
        const k = minMax(keyword)
        const m = minMax(meaning ?? [])
        const ids = new Set([...k.keys(), ...m.keys()])
        const mix = (id: number) =>
          keywordShare * (k.get(id) ?? 0) +
          (1 - keywordShare) * (m.get(id) ?? 0)
        return [...ids].sort((x, y) => mix(y) - mix(x))
      }
    const rrf =
      (options: Parameters<typeof reciprocalRankFusion>[1]): Merge =>
      ({ keyword, meaning }) =>
        reciprocalRankFusion([keyword, meaning ?? []], options)
    const variants: Record<string, Merge> = {
      'keyword only': ({ keyword }) => keyword.map((h) => h.id),
      'meaning only': ({ meaning }) => (meaning ?? []).map((h) => h.id),
      'RRF k=60 (shipped)': ({ keyword, meaning }) => fuse(keyword, meaning),
      'RRF k=20': rrf({ k: 20 }),
      'RRF k=10': rrf({ k: 10 }),
      'RRF meaning x1.5': rrf({ weights: [1, 1.5] }),
      'RRF meaning x2': rrf({ weights: [1, 2] }),
      'RRF meaning x3': rrf({ weights: [1, 3] }),
      'blend 30% keyword': blend(0.3),
      'blend 50% keyword': blend(0.5),
      'blend 70% keyword': blend(0.7),
    }
    const sets = [
      ['same words', QUESTIONS],
      ['paraphrases', PARAPHRASES],
      ['held out', HELD_OUT],
    ] as const
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4)
    const lines = [
      `${''.padEnd(32)}${sets.map(([name]) => name.padEnd(17)).join('')}  (first hit / first three)`,
    ]
    const rows = async (
      corpus: Awaited<ReturnType<typeof buildIndex>>,
      suffix: string,
    ) => {
      for (const [name, merge] of Object.entries(variants)) {
        const cells: string[] = []
        for (const [, questions] of sets) {
          const { recall } = await score(corpus, questions, merge)
          cells.push(`${pct(recall(1))} / ${pct(recall(3))}`.padEnd(17))
        }
        lines.push(`${`${name}${suffix}`.padEnd(32)}${cells.join('')}`)
      }
    }
    await rows(hybrid, '')
    // With the model's task prefixes, if given (RETRIEVAL_QUERY_PREFIX and
    // RETRIEVAL_DOCUMENT_PREFIX): a fresh index, since the vectors change.
    const query = process.env.RETRIEVAL_QUERY_PREFIX
    const document = process.env.RETRIEVAL_DOCUMENT_PREFIX
    if (query !== undefined && document !== undefined) {
      const { client, state } = prefixedClient(
        new OpenAI({ baseURL: embeddingUrl, apiKey: 'none' }),
        query,
        document,
      )
      const prefixed = await buildIndex({
        client,
        model: () => process.env.RETRIEVAL_EMBEDDING_MODEL!,
      })
      state.mode = 'query'
      lines.push('')
      await rows(prefixed, ' + prefixes')
    }
    console.log(`\n${lines.join('\n')}\n`)
  }, 300_000)
})

/** The `[Page n]` marker before `has` in a passage. */
function pageOf(text: string, has: string): number | null {
  const before = text.slice(0, text.indexOf(has))
  const marks = [...before.matchAll(/\[Page (\d+)\]/g)]
  return marks.length ? Number(marks.at(-1)![1]) : null
}
