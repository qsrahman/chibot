import { describe, expect, it } from 'vitest'
import { settingsSchema } from '../../../src/shared/settings.ts'
import { greetingText } from '../../../src/web/chat/greeting.ts'

describe('greetingText', () => {
  it('asks the usual question without a name', () => {
    expect(greetingText('', 14)).toBe('What’s on your mind?')
    expect(greetingText('   ', 9)).toBe('What’s on your mind?')
  })

  it('greets by the time of day when it has a name', () => {
    expect(greetingText('Que', 5)).toBe('Good morning, Que')
    expect(greetingText('Que', 11)).toBe('Good morning, Que')
    expect(greetingText('Que', 12)).toBe('Good afternoon, Que')
    expect(greetingText('Que', 16)).toBe('Good afternoon, Que')
    expect(greetingText('Que', 17)).toBe('Good evening, Que')
    expect(greetingText('Que', 21)).toBe('Good evening, Que')
    // Small hours: no "morning" for someone still up.
    expect(greetingText('Que', 22)).toBe('Hello, Que')
    expect(greetingText('Que', 3)).toBe('Hello, Que')
  })

  it('trims the name', () => {
    expect(greetingText('  Que ', 13)).toBe('Good afternoon, Que')
  })
})

describe('the settings that came with it', () => {
  it('takes a short name, and a language code or none', () => {
    const { userName, transcribeLanguage } = settingsSchema.shape
    expect(userName.safeParse('  Que ').data).toBe('Que')
    expect(userName.safeParse('x'.repeat(61)).success).toBe(false)
    expect(transcribeLanguage.safeParse('ur').success).toBe(true)
    expect(transcribeLanguage.safeParse('').success).toBe(true)
    expect(transcribeLanguage.safeParse('urdu language').success).toBe(false)
    expect(transcribeLanguage.safeParse('u').success).toBe(false)
  })
})
