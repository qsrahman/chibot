import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import { ProjectIndex } from '../../src/server/project-index.ts'
import { ProjectStore } from '../../src/server/project-store.ts'
import { documentKind } from '../../src/shared/documents.ts'
import { documentText } from '../../src/server/text.ts'
import { testFiles } from './fakes.ts'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '../fixtures', name)))

/** Embeddings that are 3 letter counts (a, e, i): deterministic and cheap. */
function fakeEmbeddings(calls: string[][], { fail = false } = {}) {
  const create = async ({ input }: { input: string[] }) => {
    calls.push(input)
    if (fail) throw new Error('model not found')
    return {
      data: input.map((text, index) => ({
        index,
        embedding: ['a', 'e', 'i'].map((c) => text.split(c).length - 1 + 0.1),
      })),
    }
  }
  return { embeddings: { create } } as unknown as OpenAI
}

describe('document text', () => {
  it('knows the supported types by extension', () => {
    expect(documentKind('Report.PDF')).toMatchObject({ kind: 'pdf' })
    expect(documentKind('notes.docx')?.kind).toBe('docx')
    expect(documentKind('main.ts')).toEqual({
      kind: 'text',
      mime: 'text/plain',
    })
    expect(documentKind('photo.png')).toBeNull()
  })

  it('reads text files without a known extension, by name', () => {
    const text = { kind: 'text', mime: 'text/plain' }
    for (const name of [
      'Dockerfile',
      'dockerfile.dev',
      'Makefile',
      'README',
      'LICENSE',
      '.gitignore',
      'events.jsonl',
      'schema.graphql',
      'build.gradle',
      'deploy.tf',
      'notes.mdx',
      'subs.SRT',
    ]) {
      expect(documentKind(name), name).toEqual(text)
    }
    // Secrets and binaries stay out.
    for (const name of [
      '.env',
      'id_rsa',
      'app.exe',
      'archive.zip',
      'Dockerfiles',
    ]) {
      expect(documentKind(name), name).toBeNull()
    }
  })

  it('marks the pages of a longer PDF, so passages can cite them', async () => {
    const page = () =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents %CONTENT% >>`
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
      page().replace('%CONTENT%', '4 0 R'),
      '<< /Length 38 >>\nstream\nBT /F1 12 Tf 10 50 Td (First) Tj ET\nendstream',
      page().replace('%CONTENT%', '6 0 R'),
      '<< /Length 39 >>\nstream\nBT /F1 12 Tf 10 50 Td (Second) Tj ET\nendstream',
    ]
    const pdf = `%PDF-1.4\n${objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}trailer\n<< /Root 1 0 R /Size 7 >>\n%%EOF`
    expect(await documentText('pdf', Buffer.from(pdf))).toBe(
      '[Page 1]\n\nFirst\n\n[Page 2]\n\nSecond',
    )
  })

  it('reads PDF, Word and HTML', async () => {
    // As FileStore returns them: Buffers.
    expect(await documentText('pdf', Buffer.from(fixture('secret.pdf')))).toBe(
      'The secret code is KESTREL.',
    )
    expect(await documentText('docx', fixture('notes.docx'))).toBe(
      'Meeting notes\n\nThe launch is planned for March 3.',
    )
    const html = new TextEncoder().encode(
      '<!doctype html><html><head><title>T</title></head><body><p>Hello <b>there</b></p></body></html>',
    )
    expect(await documentText('html', html)).toContain('Hello there')
  })
})

describe('ProjectIndex', () => {
  let db: DatabaseSync
  let files: FileStore
  let projects: ProjectStore
  let projectId: string
  beforeEach(() => {
    db = openDatabase(':memory:')
    files = testFiles(db)
    projects = new ProjectStore(db, files)
    projectId = projects.create('P').id
  })

  function add(name: string, data: Uint8Array | string) {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    const file = files.save(null, name, 'text/plain', bytes)
    projects.addFile(projectId, file.id)
    return file.id
  }
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n

  it('indexes a file by keyword and by meaning', async () => {
    const calls: string[][] = []
    const index = new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings(calls),
      model: 'emb',
    })
    const id = add('notes.md', 'Alpha beta.\n\nGamma delta.')
    await index.index(id)

    expect(projects.files(projectId)[0]).toMatchObject({
      status: 'ready',
      error: null,
    })
    expect(
      count("SELECT count(*) n FROM chunks_fts WHERE chunks_fts MATCH 'gamma'"),
    ).toBe(1)
    expect(count('SELECT count(*) n FROM chunk_vectors')).toBe(1)
    expect(db.prepare('SELECT * FROM embedding_model').get()).toEqual({
      model: 'emb',
      dimensions: 3,
    })
    expect(calls).toEqual([['Alpha beta.\n\nGamma delta.']])
  })

  it('keeps a file searchable by keywords when embedding fails', async () => {
    const index = new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings([], { fail: true }),
      model: 'emb',
    })
    await index.index(add('notes.md', 'Alpha.'))
    expect(projects.files(projectId)[0]).toMatchObject({
      status: 'ready',
      error: 'Searchable by keywords only: model not found',
    })
    expect(count('SELECT count(*) n FROM chunks')).toBe(1)
  })

  it('reports files it can’t read', async () => {
    const index = new ProjectIndex(db, projects, files, null)
    await index.index(add('empty.txt', '  '))
    await index.index(add('photo.png', 'x'))
    expect(projects.files(projectId).map((f) => [f.status, f.error])).toEqual([
      ['failed', 'found no text in the file'],
      ['failed', "can't read photo.png"],
    ])
  })

  it('keeps going when a status write fails', async () => {
    const broken = {
      setStatus: () => {
        throw new Error('disk full')
      },
    } as unknown as ProjectStore
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const index = new ProjectIndex(db, broken, files, null)
      await index.index(add('a.md', 'Alpha.'))
      // The queue isn't left rejected, so the next file is still indexed.
      await index.index(add('b.md', 'Beta.'))
      expect(logged).toHaveBeenCalledTimes(2)
    } finally {
      logged.mockRestore()
    }
  })

  it('resumes unfinished files and re-embeds for a new model', async () => {
    const first = new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings([]),
      model: 'old',
    })
    await first.index(add('a.md', 'Alpha.'))
    add('b.md', 'Beta.') // added, but the server stopped before indexing it

    const calls: string[][] = []
    await new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings(calls),
      model: 'new',
    }).resume()

    expect(calls.flat().sort()).toEqual(['Alpha.', 'Beta.'])
    expect(projects.files(projectId).map((f) => f.status)).toEqual([
      'ready',
      'ready',
    ])
    expect(db.prepare('SELECT model FROM embedding_model').get()).toEqual({
      model: 'new',
    })
    expect(count('SELECT count(*) n FROM chunk_vectors')).toBe(2)
  })

  it('indexes files again that an older chunker split', async () => {
    const index = new ProjectIndex(db, projects, files, null)
    const id = add('notes.md', '# Title\n\nAlpha.')
    await index.index(id)
    const chunker = () => count('SELECT chunker n FROM project_files') as number
    expect(chunker()).toBeGreaterThan(0)

    // As left by an older version: stale chunks, chunker 0.
    db.exec(
      "UPDATE chunks SET text = 'stale'; UPDATE project_files SET chunker = 0",
    )
    await index.resume()
    expect(db.prepare('SELECT text FROM chunks').all()).toEqual([
      { text: '# Title\n\nAlpha.' },
    ])
    expect(chunker()).toBeGreaterThan(0)

    // Up to date: left alone.
    db.exec("UPDATE chunks SET text = 'kept'")
    await index.resume()
    expect(db.prepare('SELECT text FROM chunks').all()).toEqual([
      { text: 'kept' },
    ])
  })

  it('re-embeds files indexed before embeddings were configured', async () => {
    await new ProjectIndex(db, projects, files, null).index(
      add('a.md', 'Alpha.'),
    )
    expect(projects.files(projectId)[0]).toMatchObject({
      status: 'ready',
      error: null,
    })
    expect(
      count(
        "SELECT count(*) n FROM sqlite_master WHERE name = 'chunk_vectors'",
      ),
    ).toBe(0)

    const calls: string[][] = []
    await new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings(calls),
      model: 'emb',
    }).resume()

    expect(calls).toEqual([['Alpha.']])
    expect(count('SELECT count(*) n FROM chunk_vectors')).toBe(1)
    expect(db.prepare('SELECT * FROM embedding_model').get()).toEqual({
      model: 'emb',
      dimensions: 3,
    })
  })

  it('removes chunks and vectors with the file', async () => {
    const index = new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings([]),
      model: 'emb',
    })
    const id = add('a.md', 'Alpha.')
    await index.index(id)
    projects.removeFile(projectId, id)
    expect(count('SELECT count(*) n FROM chunks')).toBe(0)
    expect(count('SELECT count(*) n FROM chunks_fts')).toBe(0)
    expect(count('SELECT count(*) n FROM chunk_vectors')).toBe(0)
    expect(files.get(id)).toBeNull()
  })

  it('keeps no chunks of a file removed while it was indexed', async () => {
    let release!: () => void
    const slow = {
      embeddings: {
        create: async ({ input }: { input: string[] }) => {
          await new Promise<void>((resolve) => (release = resolve))
          return {
            data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
          }
        },
      },
    } as unknown as OpenAI
    const index = new ProjectIndex(db, projects, files, {
      client: slow,
      model: 'emb',
    })
    const id = add('a.md', 'Alpha.')
    const indexing = index.index(id)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    projects.removeFile(projectId, id) // while the embedding is on its way
    release()
    await indexing

    expect(count('SELECT count(*) n FROM chunks')).toBe(0)
    expect(count('SELECT count(*) n FROM chunks_fts')).toBe(0)
    // Nothing was embedded, so there's no vector table either.
    expect(
      count(
        "SELECT count(*) n FROM sqlite_master WHERE name = 'chunk_vectors'",
      ),
    ).toBe(0)
  })
})
