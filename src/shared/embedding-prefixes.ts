// Some embedding models are trained to expect a short instruction before each
// text, one for what is searched with and one for what is searched: leaving it
// out costs accuracy. Others (OpenAI's, all-minilm) take plain text. The
// Settings → Other models rows are filled from here when the model is known.

export interface Prefixes {
  /** Before the question. */
  query: string
  /** Before each chunk of a file. Changing it indexes the files again. */
  document: string
}

const KNOWN: { matches: RegExp; prefixes: Prefixes }[] = [
  {
    matches: /nomic-embed-text/,
    prefixes: { query: 'search_query: ', document: 'search_document: ' },
  },
  {
    matches: /embeddinggemma/,
    prefixes: {
      query: 'task: search result | query: ',
      document: 'title: none | text: ',
    },
  },
  {
    matches: /(^|[/:-])e5([-_:]|$)/,
    prefixes: { query: 'query: ', document: 'passage: ' },
  },
  {
    matches: /mxbai-embed-large/,
    prefixes: {
      query: 'Represent this sentence for searching relevant passages: ',
      document: '',
    },
  },
]

/** The prefixes the maker of `model` asks for, or `null` for one not known (or that needs none). */
export function suggestedPrefixes(model: string): Prefixes | null {
  const name = model.toLowerCase()
  return KNOWN.find(({ matches }) => matches.test(name))?.prefixes ?? null
}
