import { parseHTML } from 'linkedom'
import { z } from 'zod'
import { Tool, type ToolContext } from '../tool.ts'

const FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const
const TIMEOUT_MS = 10_000

/** The part of Brave's web search response chibot reads. */
interface BraveResponse {
  web?: {
    results: {
      title: string
      url: string
      description?: string
      age?: string
      extra_snippets?: string[]
    }[]
  }
}

/** A search result as the model (and the Sources list) sees it. */
interface SearchResult {
  title: string
  url: string
  description: string
  age?: string
  snippets?: string[]
}

/** Web search through the Brave Search API. */
export class WebSearchTool extends Tool {
  readonly name = 'web_search'
  readonly label = 'Search the web'
  override readonly untrustedOutput = true
  readonly description =
    'Searches the web (Brave Search) for current or specific information: ' +
    'news, recent events, prices, documentation, facts you are unsure of. ' +
    'Returns the top results with snippets. Cite the sources you use inline ' +
    'as Markdown links, e.g. [Node.js 26 release](https://nodejs.org/…). Use ' +
    'fetch_url to read a result in full.'
  readonly parameters = z.object({
    query: z.string().describe('The search query, as you would type it'),
    freshness: z
      .enum(['day', 'week', 'month', 'year'])
      .nullable()
      .describe('Only results from the past day/week/month/year, or null'),
  })
  readonly #apiKey: string
  readonly #baseURL: string

  constructor(apiKey: string, baseURL = 'https://api.search.brave.com/res/v1') {
    super()
    this.#apiKey = apiKey
    this.#baseURL = baseURL
  }

  async run(
    { query, freshness }: z.output<typeof this.parameters>,
    { signal }: ToolContext,
  ) {
    const url = new URL(`${this.#baseURL}/web/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('count', '5')
    if (freshness) url.searchParams.set('freshness', FRESHNESS[freshness])
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.#apiKey,
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!res.ok) {
      throw new Error(
        `Brave Search answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
      )
    }
    const { web } = (await res.json()) as BraveResponse
    const results: SearchResult[] = (web?.results ?? []).map((r) => ({
      title: plainText(r.title),
      url: r.url,
      description: plainText(r.description ?? ''),
      ...(r.age && { age: r.age }),
      ...(r.extra_snippets?.length && {
        snippets: r.extra_snippets.map(plainText),
      }),
    }))
    return JSON.stringify({ query, results })
  }
}

/** Brave marks matches with `<strong>` and escapes entities. */
function plainText(html: string): string {
  return parseHTML(`<p>${html}</p>`).document.querySelector('p')!.textContent
}
