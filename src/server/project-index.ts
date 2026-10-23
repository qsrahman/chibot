import type { DatabaseSync } from 'node:sqlite'
import type OpenAI from 'openai'
import { documentKind } from '../shared/documents.ts'
import { anyWordQuery, transaction } from './database.ts'
import type { FileStore } from './file-store.ts'
import type { ProjectStore } from './project-store.ts'
import { documentText } from './text.ts'

const CHUNK_SIZE = 3200
const CHUNK_OVERLAP = 480
// About 1,500 chunks: plenty for notes and documents, bounded for embedding.
const MAX_TEXT = 5_000_000
const EMBED_BATCH = 64
// Hits taken from each search before merging, and the usual RRF constant.
const CANDIDATES = 30
const RRF_K = 60

/** The embedding endpoint's client and model. */
export interface EmbeddingDeps {
  client: OpenAI
  model: string
}

/**
 * Makes project files searchable: extracts their text, splits it into
 * chunks, indexes those by keyword (FTS5) and, with an embedding endpoint, by
 * meaning (sqlite-vec). Files are indexed one at a time, in the background.
 */
export class ProjectIndex {
  readonly #db: DatabaseSync
  readonly #projects: ProjectStore
  readonly #files: FileStore
  readonly #embedding: EmbeddingDeps | null
  #queue: Promise<void> = Promise.resolve()

  constructor(
    db: DatabaseSync,
    projects: ProjectStore,
    files: FileStore,
    embedding: EmbeddingDeps | null,
  ) {
    this.#db = db
    this.#projects = projects
    this.#files = files
    this.#embedding = embedding
  }

  /** Queues a file for indexing; resolves once it's done (or failed). */
  index(fileId: string): Promise<void> {
    const done = this.#queue.then(() => this.#index(fileId))
    this.#queue = done
    return done
  }

  /**
   * At startup: re-indexes files whose indexing didn't finish, and all files
   * when the embedding model changed (vectors of different models don't mix).
   */
  resume(): Promise<void> {
    const info = this.#vectorInfo()
    const model = this.#embedding?.model
    const fileIds = new Set(
      this.#projects.unfinishedFiles().map((f) => f.fileId),
    )
    if (model && info && info.model !== model) {
      this.#dropVectors()
      this.#indexedFileIds().forEach((id) => fileIds.add(id))
    }
    return Promise.all([...fileIds].map((id) => this.index(id))).then(() => {})
  }

  async #index(fileId: string): Promise<void> {
    const file = this.#files.get(fileId)
    if (!file) return // removed while queued
    this.#projects.setStatus(fileId, 'indexing')
    try {
      const kind = documentKind(file.name)
      if (!kind) throw new Error(`can't read ${file.name}`)
      const text = await documentText(kind.kind, this.#files.read(fileId))
      if (!text) throw new Error('found no text in the file')
      const chunks = chunkText(text.slice(0, MAX_TEXT))
      const ids = this.#saveChunks(fileId, chunks)
      let note: string | null = null
      const projectId = this.#projects.projectOf(fileId)
      if (this.#embedding && projectId) {
        try {
          await this.#embed(projectId, ids, chunks)
        } catch (err) {
          note = `Searchable by keywords only: ${(err as Error).message}`
        }
      }
      this.#projects.setStatus(fileId, 'ready', note)
    } catch (err) {
      this.#projects.setStatus(fileId, 'failed', (err as Error).message)
    }
  }

  #saveChunks(fileId: string, chunks: string[]): number[] {
    const ids: number[] = []
    transaction(this.#db, () => {
      this.#projects.deleteChunks(fileId)
      const insert = this.#db.prepare(
        'INSERT INTO chunks (file_id, position, text) VALUES (?, ?, ?)',
      )
      const index = this.#db.prepare(
        'INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)',
      )
      for (const [position, text] of chunks.entries()) {
        const id = Number(insert.run(fileId, position, text).lastInsertRowid)
        index.run(id, text)
        ids.push(id)
      }
    })
    return ids
  }

  async #embed(
    projectId: string,
    ids: number[],
    texts: string[],
  ): Promise<void> {
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const vectors = await this.#vectors(
        texts.slice(start, start + EMBED_BATCH),
      )
      transaction(this.#db, () => {
        for (const [i, vector] of vectors.entries()) {
          this.#ensureVectors(this.#embedding!.model, vector.length)
          this.#db
            .prepare(
              `INSERT INTO chunk_vectors (rowid, project_id, embedding)
               VALUES (?, ?, ?)`,
            )
            // vec0 needs an integer rowid; node:sqlite binds BigInts as such.
            .run(BigInt(ids[start + i]!), projectId, vector)
        }
      })
    }
  }

  /** Embeddings of `texts`, in order. */
  async #vectors(texts: string[]): Promise<Float32Array[]> {
    const { client, model } = this.#embedding!
    const { data } = await client.embeddings.create({ model, input: texts })
    return data
      .toSorted((a, b) => a.index - b.index)
      .map((d) => new Float32Array(d.embedding))
  }

  /**
   * The project's chunks best matching `query`: keyword hits (any word, see
   * `anyWordQuery`) and, with embeddings, the nearest by meaning, merged by
   * reciprocal rank fusion, so a chunk ranked well by both comes first.
   */
  async search(
    projectId: string,
    query: string,
    limit = 6,
  ): Promise<{ fileId: string; name: string; text: string }[]> {
    const lists = [this.#keywordHits(projectId, query)]
    if (
      this.#embedding &&
      this.#vectorInfo()?.model === this.#embedding.model
    ) {
      try {
        const [vector] = await this.#vectors([query])
        const nearest = this.#db
          .prepare(
            `SELECT rowid AS id FROM chunk_vectors
              WHERE embedding MATCH ? AND k = ? AND project_id = ?
              ORDER BY distance`,
          )
          .all(vector!, CANDIDATES, projectId) as { id: number }[]
        lists.push(nearest.map(({ id }) => id))
      } catch (err) {
        // The keyword hits still answer.
        console.error('Embedding the search failed:', err)
      }
    }
    const scores = new Map<number, number>()
    for (const ids of lists) {
      ids.forEach((id, rank) =>
        scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)),
      )
    }
    const get = this.#db.prepare(
      `SELECT c.file_id AS fileId, f.name, c.text
         FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ?`,
    )
    return [...scores]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(
        ([id]) => get.get(id) as { fileId: string; name: string; text: string },
      )
  }

  #keywordHits(projectId: string, query: string): number[] {
    const match = anyWordQuery(query)
    if (!match) return []
    const rows = this.#db
      .prepare(
        `SELECT c.id FROM chunks_fts
           JOIN chunks c ON c.id = chunks_fts.rowid
           JOIN project_files p ON p.file_id = c.file_id
          WHERE chunks_fts MATCH ? AND p.project_id = ?
          ORDER BY chunks_fts.rank
          LIMIT ?`,
      )
      .all(match, projectId, CANDIDATES) as { id: number }[]
    return rows.map(({ id }) => id)
  }

  /** Creates the vector table on first use, sized for the model. */
  #ensureVectors(model: string, dimensions: number) {
    const info = this.#vectorInfo()
    if (info?.model === model && info.dimensions === dimensions) return
    this.#dropVectors()
    this.#db.exec(
      `CREATE VIRTUAL TABLE chunk_vectors USING vec0(
         project_id TEXT PARTITION KEY,
         embedding float[${dimensions}] distance_metric=cosine)`,
    )
    this.#db
      .prepare('INSERT INTO embedding_model (model, dimensions) VALUES (?, ?)')
      .run(model, dimensions)
  }

  #dropVectors() {
    this.#db.exec(
      'DROP TABLE IF EXISTS chunk_vectors; DELETE FROM embedding_model',
    )
  }

  #vectorInfo() {
    return this.#db.prepare('SELECT * FROM embedding_model').get() as
      { model: string; dimensions: number } | undefined
  }

  #indexedFileIds(): string[] {
    return (
      this.#db.prepare('SELECT DISTINCT file_id FROM chunks').all() as {
        file_id: string
      }[]
    ).map((row) => row.file_id)
  }
}

/**
 * Splits text into chunks of about `size` characters at paragraph breaks,
 * each starting with the end (about `overlap` characters) of the one before,
 * so a passage cut in two is still found whole in one of them. Paragraphs
 * longer than `size` are cut at spaces.
 */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= size ? [p] : cut(p, size, overlap)))
  const chunks: string[] = []
  let current: string[] = []
  let length = 0
  for (const paragraph of paragraphs) {
    if (current.length > 0 && length + paragraph.length > size) {
      chunks.push(current.join('\n\n'))
      // Carry the last paragraphs that fit in the overlap.
      const carried: string[] = []
      let carriedLength = 0
      for (const p of current.toReversed()) {
        if (carriedLength + p.length > overlap) break
        carried.unshift(p)
        carriedLength += p.length + 2
      }
      current = carried
      length = carriedLength
    }
    current.push(paragraph)
    length += paragraph.length + 2
  }
  if (current.length > 0) chunks.push(current.join('\n\n'))
  return chunks
}

/** Windows of `size` characters, `overlap` apart, ending at spaces. */
function cut(text: string, size: number, overlap: number): string[] {
  const pieces: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    const space = text.lastIndexOf(' ', end)
    if (end < text.length && space > start + size / 2) end = space
    pieces.push(text.slice(start, end).trim())
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return pieces
}
