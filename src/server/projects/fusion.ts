/** A chunk a search found, with how well (higher is better). */
export interface Hit {
  id: number
  score: number
}

/** The usual constant of reciprocal rank fusion. */
export const RRF_K = 60

/**
 * Merges ranked lists into one by reciprocal rank fusion: a chunk scores
 * `weight / (k + rank)` in each list that has it, so one ranked well by
 * several comes first and no list's own scores need to match another's.
 * Returns the chunk ids, best first.
 */
export function reciprocalRankFusion(
  lists: Hit[][],
  { k = RRF_K, weights = lists.map(() => 1) } = {},
): number[] {
  const scores = new Map<number, number>()
  for (const [i, hits] of lists.entries()) {
    hits.forEach(({ id }, rank) =>
      scores.set(id, (scores.get(id) ?? 0) + weights[i]! / (k + rank + 1)),
    )
  }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/**
 * The chunk ids best first, from the keyword hits and (with embeddings,
 * `null` without) the nearest by meaning.
 */
export function fuse(keyword: Hit[], meaning: Hit[] | null): number[] {
  return reciprocalRankFusion(meaning ? [keyword, meaning] : [keyword])
}
