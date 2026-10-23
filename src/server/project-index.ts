import type { DatabaseSync } from 'node:sqlite'
import type OpenAI from 'openai'
import { transaction } from './database.ts'
import type { FileStore } from './file-store.ts'
import type { ProjectStore } from './project-store.ts'
import { documentKind, documentText } from './text.ts'

const CHUNK_SIZE = 3200
const CHUNK_OVERLAP = 480
// About 1,500 chunks: plenty for notes and documents, bounded for embedding.
const MAX_TEXT = 5_000_000
const EMBED_BATCH = 64

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
      if (this.#embedding) {
        try {
          await this.#embed(ids, chunks)
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

  async #embed(ids: number[], texts: string[]): Promise<void> {
    const { client, model } = this.#embedding!
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const { data } = await client.embeddings.create({
        model,
        input: texts.slice(start, start + EMBED_BATCH),
      })
      transaction(this.#db, () => {
        for (const { index, embedding } of data) {
          this.#ensureVectors(model, embedding.length)
          this.#db
            .prepare(
              'INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)',
            )
            // vec0 needs an integer rowid; node:sqlite binds BigInts as such.
            .run(BigInt(ids[start + index]!), new Float32Array(embedding))
        }
      })
    }
  }

  /** Creates the vector table on first use, sized for the model. */
  #ensureVectors(model: string, dimensions: number) {
    const info = this.#vectorInfo()
    if (info?.model === model && info.dimensions === dimensions) return
    this.#dropVectors()
    this.#db.exec(
      `CREATE VIRTUAL TABLE chunk_vectors USING vec0(
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
