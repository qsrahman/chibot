import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import { chunkText, ProjectIndex } from '../../src/server/project-index.ts'
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

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('One.\n\nTwo.')).toEqual(['One.\n\nTwo.'])
  })

  it('splits at paragraph breaks, overlapping by whole paragraphs', () => {
    const paragraphs = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
    expect(chunkText(paragraphs.join('\n\n'), 90, 45)).toEqual([
      `${'a'.repeat(40)}\n\n${'b'.repeat(40)}`,
      `${'b'.repeat(40)}\n\n${'c'.repeat(40)}`,
    ])
  })

  it('cuts paragraphs longer than a chunk at spaces', () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkText(words, 50, 10)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 50)).toBe(true)
    expect(chunks.join(' ')).toContain('w59')
  })
})

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
})
