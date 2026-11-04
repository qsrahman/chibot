import { describe, expect, it } from 'vitest'
import {
  fuse,
  reciprocalRankFusion,
  type Hit,
} from '../../../src/server/projects/fusion.ts'

const hits = (...ids: number[]): Hit[] =>
  ids.map((id, i) => ({ id, score: ids.length - i }))

describe('reciprocalRankFusion', () => {
  it('puts a chunk both lists rank well ahead of one only a list ranks first', () => {
    expect(reciprocalRankFusion([hits(1, 2, 3), hits(2, 4, 1)])).toEqual([
      2, 1, 4, 3,
    ])
  })

  it('keeps one list’s order', () => {
    expect(reciprocalRankFusion([hits(5, 3, 9)])).toEqual([5, 3, 9])
    expect(reciprocalRankFusion([hits()])).toEqual([])
  })

  it('lets a weight favour one list', () => {
    const lists = [hits(1, 2), hits(3, 4)]
    // Each list's first is a tie at equal weights (the first list wins it).
    expect(reciprocalRankFusion(lists).slice(0, 2)).toEqual([1, 3])
    expect(
      reciprocalRankFusion(lists, { weights: [1, 2] }).slice(0, 2),
    ).toEqual([3, 4])
  })

  it('counts rank, not score', () => {
    expect(
      reciprocalRankFusion([
        [{ id: 1, score: 0.01 }],
        [{ id: 2, score: 1000 }],
      ]),
    ).toEqual([1, 2])
  })
})

describe('fuse', () => {
  it('uses the keyword hits alone without embeddings', () => {
    expect(fuse(hits(7, 8), null)).toEqual([7, 8])
  })

  it('merges keyword hits with those nearest in meaning', () => {
    expect(fuse(hits(1, 2), hits(2, 3))).toEqual([2, 1, 3])
  })
})
