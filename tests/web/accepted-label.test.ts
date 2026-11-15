import { describe, expect, it } from 'vitest'
import { ACCEPTED_LABEL, fileKind } from '../../src/shared/documents.ts'

// The drop overlay names what chibot takes; each word must be true.
describe('ACCEPTED_LABEL', () => {
  it('names only kinds that are accepted', () => {
    expect(ACCEPTED_LABEL).toBe('Images, PDF, Word, text and code')
    for (const name of ['a.png', 'a.pdf', 'a.docx', 'a.txt', 'a.py']) {
      expect(fileKind(name), name).not.toBeNull()
    }
  })
})
