import { describe, expect, it } from 'vitest'
import { errorMessage } from '../../src/shared/errors.ts'

describe('errorMessage', () => {
  it('gives the message of an Error and the text of anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})
