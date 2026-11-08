import { describe, expect, it } from 'vitest'
import {
  EFFORT_HINTS,
  effortChoices,
  effortLabel,
  REASONING_EFFORTS,
} from '../../src/shared/reasoning.ts'

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

describe('effortChoices', () => {
  it('offers Auto and the levels, without none', () => {
    expect(effortChoices(null).map(effortLabel)).toEqual([
      'Auto',
      'Minimal',
      'Low',
      'Medium',
      'High',
      'Xhigh',
      'Max',
    ])
  })

  it('keeps a none saved earlier while it is the current one', () => {
    expect(effortChoices('none')).toContain('none')
    expect(effortChoices('low')).not.toContain('none')
  })

  it('has a hint for every choice', () => {
    for (const choice of effortChoices('none')) {
      expect(EFFORT_HINTS[choice ?? 'auto']).toBeTruthy()
    }
  })
})
