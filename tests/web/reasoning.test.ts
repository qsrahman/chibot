import { describe, expect, it } from 'vitest'
import { effortLabel, REASONING_EFFORTS } from '../../src/shared/reasoning.ts'

describe('effortLabel', () => {
  it('calls the model default "Auto" and capitalizes the levels', () => {
    expect(effortLabel(null)).toBe('Auto')
    expect(effortLabel(undefined)).toBe('Auto')
    expect(REASONING_EFFORTS.map(effortLabel)).toEqual([
      'None',
      'Minimal',
      'Low',
      'Medium',
      'High',
      'Xhigh',
      'Max',
    ])
  })
})
