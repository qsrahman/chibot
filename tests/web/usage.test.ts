import { describe, expect, it } from 'vitest'
import type { ResponseUsage } from 'openai/resources/responses/responses'
import { addUsage, describeUsage } from '../../src/web/usage.ts'

const full = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

describe('describeUsage', () => {
  it('summarises totals and breaks down input and output', () => {
    const label = describeUsage({
      input_tokens: 1180,
      input_tokens_details: { cached_tokens: 512, cache_write_tokens: 0 },
      output_tokens: 64,
      output_tokens_details: { reasoning_tokens: 20 },
      total_tokens: 1244,
    })
    expect(label).toEqual({
      short: `${compact.format(1244)} tokens`,
      detail: `Input ${full.format(1180)} (cached 512) · Output 64 (reasoning 20)`,
    })
  })

  it('omits zero or missing details (compatible servers)', () => {
    const label = describeUsage({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    } as ResponseUsage)
    expect(label?.detail).toBe('Input 10 · Output 5')
  })

  it('shows nothing without usage', () => {
    expect(describeUsage(null)).toBeNull()
    expect(describeUsage({ total_tokens: 0 } as ResponseUsage)).toBeNull()
  })
})

describe('addUsage', () => {
  it('sums the responses of one answer', () => {
    const a = {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 10 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 105,
    } as ResponseUsage
    // Compatible servers may leave out the details.
    const b = {
      input_tokens: 120,
      output_tokens: 20,
      total_tokens: 140,
    } as ResponseUsage
    expect(addUsage(null, a)).toBe(a)
    expect(addUsage(a, b)).toEqual({
      input_tokens: 220,
      input_tokens_details: { cached_tokens: 10, cache_write_tokens: 0 },
      output_tokens: 25,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 245,
    })
  })
})
