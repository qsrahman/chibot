import { describe, expect, it } from 'vitest'
import { suggestedPrefixes } from '../../src/shared/embedding-prefixes.ts'

describe('suggestedPrefixes', () => {
  it('knows what the makers of some models ask for', () => {
    expect(suggestedPrefixes('nomic-embed-text')).toEqual({
      query: 'search_query: ',
      document: 'search_document: ',
    })
    // Tags and versions don't matter.
    expect(suggestedPrefixes('nomic-embed-text-v2-moe:latest')).toMatchObject({
      query: 'search_query: ',
    })
    expect(suggestedPrefixes('embeddinggemma-2:latest')).toMatchObject({
      query: 'task: search result | query: ',
      document: 'title: none | text: ',
    })
    expect(suggestedPrefixes('multilingual-e5-large')).toEqual({
      query: 'query: ',
      document: 'passage: ',
    })
    expect(suggestedPrefixes('mxbai-embed-large')).toMatchObject({
      document: '',
    })
  })

  it('says nothing for models that take plain text, or that it does not know', () => {
    expect(suggestedPrefixes('text-embedding-3-small')).toBeNull()
    expect(suggestedPrefixes('all-minilm')).toBeNull()
    expect(suggestedPrefixes('')).toBeNull()
    // "e5" inside another name is not the e5 family.
    expect(suggestedPrefixes('some-embed5-model')).toBeNull()
  })
})
