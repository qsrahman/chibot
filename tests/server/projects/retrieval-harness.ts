import OpenAI from 'openai'
import { openDatabase } from '../../../src/server/database.ts'
import type { Hit } from '../../../src/server/projects/fusion.ts'
import {
  DEFAULT_RESULTS,
  ProjectIndex,
  type EmbeddingDeps,
} from '../../../src/server/projects/project-index.ts'
import type { Reranker } from '../../../src/server/projects/reranker.ts'
import { ProjectStore } from '../../../src/server/projects/project-store.ts'
import { testFiles } from '../fakes.ts'

// What the project search evaluations share: retrieval.test.ts (a small corpus
// with filler) and retrieval-docs.test.ts (real documents).

export interface Question {
  ask: string
  /** The file that answers it. */
  file: string
  /** Text the answering passage contains. */
  has: string
  /** The PDF page, where the file has pages. */
  page?: number
}

/**
 * Indexes `corpus` into a fresh project (by keyword, and by meaning with
 * `embedding`); searches are put in order by `reranker` when given.
 */
export async function indexCorpus(
  corpus: [string, Uint8Array][],
  embedding: EmbeddingDeps | null,
  reranker: Reranker | null = null,
) {
  const db = openDatabase(':memory:')
  const files = testFiles(db)
  const projects = new ProjectStore(db, files)
  const index = new ProjectIndex(db, projects, files, embedding, reranker)
  const projectId = projects.create('Corpus').id
  for (const [name, bytes] of corpus) {
    const file = files.save(null, name, 'application/octet-stream', bytes)
    projects.addFile(projectId, file.id)
    await index.index(file.id)
  }
  return { index, projectId }
}

/** The ids of the chunks to return, best first, from what each search found. */
export type Merge = (found: {
  keyword: Hit[]
  meaning: Hit[] | null
}) => number[]

/** How often the answer is the first hit, and among the first three. */
export async function score(
  { index, projectId }: { index: ProjectIndex; projectId: string },
  questions: Question[],
  merge?: Merge,
) {
  const missed = { 1: [] as string[], 3: [] as string[], 6: [] as string[] }
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
    if (rank < 0 || rank >= 6) missed[6].push(ask)
  }
  const recall = (at: 1 | 3 | 6) => 1 - missed[at].length / questions.length
  const summary =
    `recall@1: ${(recall(1) * 100).toFixed(0)}%  recall@3: ${(recall(3) * 100).toFixed(0)}%  recall@6: ${(recall(6) * 100).toFixed(0)}% (${questions.length} questions)` +
    (missed[3].length ? `\nnot in the first 3: ${missed[3].join(' | ')}` : '') +
    (missed[1].length ? `\nnot first: ${missed[1].join(' | ')}` : '')
  return { recall, summary }
}

/**
 * An embedding client that puts a prefix before every text, for models
 * trained to expect one (nomic's "search_document: " and "search_query: ").
 * It indexes with the document prefix until `state.mode` is set to 'query'.
 */
export function prefixedClient(base: OpenAI, query: string, document: string) {
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

/** The `[Page n]` marker before `has` in a passage. */
function pageOf(text: string, has: string): number | null {
  const before = text.slice(0, text.indexOf(has))
  const marks = [...before.matchAll(/\[Page (\d+)\]/g)]
  return marks.length ? Number(marks.at(-1)![1]) : null
}
