import { describe, expect, it } from 'vitest'
import { appendQuote, quoteText } from '../../../src/web/chat/quote.ts'

describe('quoteText', () => {
  it('makes a block quote with a blank line to write under it', () => {
    expect(quoteText(' one\ntwo ')).toBe('> one\n> two\n\n')
  })

  it('keeps blank lines in the quote without trailing spaces', () => {
    expect(quoteText('a\n\nb')).toBe('> a\n>\n> b\n\n')
  })

  it('reads Windows line breaks', () => {
    expect(quoteText('a\r\nb')).toBe('> a\n> b\n\n')
  })
})

describe('appendQuote', () => {
  it('starts an empty box with the quote', () => {
    expect(appendQuote('  ', '> a\n\n')).toBe('> a\n\n')
  })

  it('sets the quote under what is already written', () => {
    expect(appendQuote('Why?\n', '> a\n\n')).toBe('Why?\n\n> a\n\n')
  })
})
