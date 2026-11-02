import type { DatabaseSync } from 'node:sqlite'
import type OpenAI from 'openai'
import { documentKind } from '../shared/documents.ts'
import { anyWordQuery, transaction } from './database.ts'
import type { FileStore } from './file-store.ts'
import type { ProjectStore } from './project-store.ts'
import {
  CHUNKER_VERSION,
  chunkPages,
  chunkStyle,
  chunkText,
} from './chunking.ts'
import { documentText } from './text.ts'

// About 1,500 chunks: plenty for notes and documents, bounded for embedding.
const MAX_TEXT = 5_000_000
const EMBED_BATCH = 64
// Hits taken from each search before merging, and the usual RRF constant.
const CANDIDATES = 30
const RRF_K = 60
// Passages a search returns unless asked for more or fewer, and the most it
// may return (each is about 3,200 characters of the model's context).
export const DEFAULT_RESULTS = 6
export const MAX_RESULTS = 15
// Parts of a file `read` returns at once (about 10,000 characters).
const READ_PARTS = 3

/** A passage of a project file; `part` of `parts` (1-based). */
export interface Passage {
  fileId: string
  name: string
  text: string
  part: number
  parts: number
  /** The PDF page it starts on, if the file has pages. */
  page: number | null
}

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
    const done = this.#queue
      .then(() => this.#index(fileId))
      .catch((err: unknown) => {
        // A failed status write (a database error) mustn't reject callers
        // that fire and forget, or leave the queue rejected for good.
        console.error(`Indexing ${fileId} failed:`, err)
      })
    this.#queue = done
    return done
  }

  /**
   * At startup: re-indexes files whose indexing didn't finish or was chunked
   * by an older chunker, and all files when the embedding model changed
   * (vectors of different models don't mix).
   */
  resume(): Promise<void> {
    const info = this.#vectorInfo()
    const model = this.#embedding?.model
    const fileIds = new Set(
      this.#projects.unfinishedFiles().map((f) => f.fileId),
    )
    this.#projects
      .outdatedFiles(CHUNKER_VERSION)
      .forEach((id) => fileIds.add(id))
    // `info` is missing when files were indexed before embeddings were
    // configured, so re-embed them too (and retry a failed first embedding).
    if (model && (!info || info.model !== model)) {
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
      // Removed (with its project, maybe) while its text was extracted.
      const projectId = this.#projects.projectOf(fileId)
      if (!projectId) return
      const chunks = chunkText(text.slice(0, MAX_TEXT), {
        style: chunkStyle(file.name),
      })
      const cut =
        text.length > MAX_TEXT
          ? `Only the first ${MAX_TEXT.toLocaleString('en')} of ${text.length.toLocaleString('en')} characters are searchable`
          : null
      const ids = this.#saveChunks(fileId, chunks)
      this.#projects.setChunker(fileId, CHUNKER_VERSION)
      let note = cut
      if (this.#embedding) {
        try {
          await this.#embed(fileId, projectId, ids, chunks)
        } catch (err) {
          const keywords = `Searchable by keywords only: ${(err as Error).message}`
          note = cut ? `${keywords}. ${cut}` : keywords
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
        'INSERT INTO chunks (file_id, position, text, page) VALUES (?, ?, ?, ?)',
      )
      const index = this.#db.prepare(
        'INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)',
      )
      const pages = chunkPages(chunks)
      for (const [position, text] of chunks.entries()) {
        const id = Number(
          insert.run(fileId, position, text, pages[position]!).lastInsertRowid,
        )
        index.run(id, text)
        ids.push(id)
      }
    })
    return ids
  }

  async #embed(
    fileId: string,
    projectId: string,
    ids: number[],
    texts: string[],
  ): Promise<void> {
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const vectors = await this.#vectors(
        texts.slice(start, start + EMBED_BATCH),
      )
      // Removed while this batch was embedded: drop what was saved for it.
      if (!this.#projects.projectOf(fileId)) {
        this.#projects.deleteChunks(fileId)
        return
      }
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
  async #vectors(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<Float32Array[]> {
    const { client, model } = this.#embedding!
    const { data } = await client.embeddings.create(
      { model, input: texts },
      { signal },
    )
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
    {
      signal,
      fileId,
      limit = DEFAULT_RESULTS,
    }: { signal?: AbortSignal; fileId?: string; limit?: number } = {},
  ): Promise<Passage[]> {
    // Only this file's chunks, when the search is limited to one.
    const only = fileId ? this.#chunkIds(fileId) : null
    const lists = [this.#keywordHits(projectId, query, fileId)]
    if (
      this.#embedding &&
      this.#vectorInfo()?.model === this.#embedding.model
    ) {
      try {
        const [vector] = await this.#vectors([query], signal)
        const nearest = this.#db
          .prepare(
            // The ids are our own integers, so listing them is safe.
            `SELECT rowid AS id FROM chunk_vectors
              WHERE embedding MATCH ? AND k = ? AND project_id = ?
                ${only ? `AND rowid IN (${only.join(',') || 'NULL'})` : ''}
              ORDER BY distance`,
          )
          .all(vector!, CANDIDATES, projectId) as { id: number }[]
        lists.push(nearest.map(({ id }) => id))
      } catch (err) {
        // A stop ends the call; any other failure still has the keyword hits.
        if (signal?.aborted) throw err
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
      `SELECT c.file_id AS fileId, f.name, c.text, c.position + 1 AS part, c.page,
              (SELECT count(*) FROM chunks WHERE file_id = c.file_id) AS parts
         FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ?`,
    )
    return [...scores]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(Math.max(limit, 1), MAX_RESULTS))
      .map(([id]) => get.get(id) as unknown as Passage)
  }

  /**
   * Parts of a project file's text from part `from` (1-based), a few at a
   * time. Neighbouring parts overlap a little.
   */
  read(
    projectId: string,
    fileId: string,
    from = 1,
  ): { parts: number; from: number; to: number; text: string } {
    const rows = this.#db
      .prepare(
        `SELECT c.text FROM chunks c
           JOIN project_files p ON p.file_id = c.file_id
          WHERE c.file_id = ? AND p.project_id = ? ORDER BY c.position`,
      )
      .all(fileId, projectId) as { text: string }[]
    const start = Math.min(Math.max(from, 1), Math.max(rows.length, 1))
    const shown = rows.slice(start - 1, start - 1 + READ_PARTS)
    return {
      parts: rows.length,
      from: start,
      to: start + shown.length - 1,
      text: shown.map((r) => r.text).join('\n\n'),
    }
  }

  /** The start of each of the project's indexed files, up to `limit` files. */
  excerpts(
    projectId: string,
    { limit = 12, length = 1500 } = {},
  ): { name: string; text: string }[] {
    const rows = this.#db
      .prepare(
        `SELECT f.name, c.text FROM project_files p
           JOIN files f ON f.id = p.file_id
           JOIN chunks c ON c.file_id = p.file_id AND c.position = 0
          WHERE p.project_id = ? ORDER BY p.rowid LIMIT ?`,
      )
      .all(projectId, limit) as { name: string; text: string }[]
    return rows.map(({ name, text }) => ({ name, text: text.slice(0, length) }))
  }

  #keywordHits(projectId: string, query: string, fileId?: string): number[] {
    const match = anyWordQuery(query)
    if (!match) return []
    const rows = this.#db
      .prepare(
        `SELECT c.id FROM chunks_fts
           JOIN chunks c ON c.id = chunks_fts.rowid
           JOIN project_files p ON p.file_id = c.file_id
          WHERE chunks_fts MATCH $match AND p.project_id = $projectId
            AND ($fileId IS NULL OR c.file_id = $fileId)
          ORDER BY chunks_fts.rank
          LIMIT $limit`,
      )
      .all({
        match,
        projectId,
        fileId: fileId ?? null,
        limit: CANDIDATES,
      }) as { id: number }[]
    return rows.map(({ id }) => id)
  }

  #chunkIds(fileId: string): number[] {
    return (
      this.#db
        .prepare('SELECT id FROM chunks WHERE file_id = ?')
        .all(fileId) as { id: number }[]
    ).map(({ id }) => id)
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
