import { z } from 'zod'

// What Cohere, Jina, llama.cpp's server and vLLM all answer to `POST /rerank`.
const response = z.object({
  results: z.array(
    z.object({ index: z.number().int().min(0), relevance_score: z.number() }),
  ),
})

// A reranker reads each passage next to the question, so it is slower than a
// search; past this a slow server is passed over rather than waited for.
const TIMEOUT_MS = 30_000

/** The server of a reranking model: the model reorders passages by how well each answers a question. */
export interface RerankDeps {
  /** The server's address up to `/rerank` (e.g. `http://localhost:8080/v1`). */
  baseURL: string
  apiKey: string
  /** Read at each use, since Settings can change it; `''` is off. */
  model: () => string
}

/** Reorders passages with a reranking model, when one is set. */
export class Reranker {
  readonly #deps: RerankDeps

  constructor(deps: RerankDeps) {
    this.#deps = deps
  }

  get on(): boolean {
    return this.#deps.model() !== ''
  }

  /**
   * The positions of `passages`, the one that best answers `query` first;
   * `null` if the server fails, so the caller keeps the order it had.
   */
  async rank(
    query: string,
    passages: string[],
    signal?: AbortSignal,
  ): Promise<number[] | null> {
    const { baseURL, apiKey, model } = this.#deps
    try {
      const res = await fetch(`${baseURL.replace(/\/+$/, '')}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model(),
          query,
          documents: passages,
          top_n: passages.length,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
          : AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok)
        throw new Error(`${res.status} ${await res.text()}`.slice(0, 300))
      const { results } = response.parse(await res.json())
      const ranked = [
        ...new Set(
          results
            .toSorted((a, b) => b.relevance_score - a.relevance_score)
            .map((r) => r.index)
            .filter((i) => i < passages.length),
        ),
      ]
      // Any the server left out follow, in the order they had.
      const left = passages.map((_, i) => i).filter((i) => !ranked.includes(i))
      return [...ranked, ...left]
    } catch (err) {
      // A stop ends the call; any other failure keeps the order search gave.
      if (signal?.aborted) throw err
      // One line: a server without a /rerank route would otherwise print a
      // stack trace for every search.
      console.error(`Reranking failed: ${(err as Error).message}`)
      return null
    }
  }
}
