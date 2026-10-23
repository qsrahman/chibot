import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/server/database.ts'

describe('openDatabase', () => {
  it('loads sqlite-vec for nearest-neighbour search', () => {
    const db = openDatabase(':memory:')
    db.exec(
      'CREATE VIRTUAL TABLE v USING vec0(embedding float[2] distance_metric=cosine)',
    )
    const insert = db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)')
    // vec0 rowids must be bound as integers: node:sqlite binds BigInts so.
    insert.run(1n, new Float32Array([1, 0]))
    insert.run(2n, new Float32Array([0, 1]))
    const nearest = db
      .prepare('SELECT rowid FROM v WHERE embedding MATCH ? AND k = 1')
      .get(new Float32Array([0.9, 0.1])) as { rowid: number }
    expect(nearest.rowid).toBe(1)
  })

  it("doesn't let SQL load extensions", () => {
    const db = openDatabase(':memory:')
    expect(() => db.exec("SELECT load_extension('x')")).toThrow()
  })
})
