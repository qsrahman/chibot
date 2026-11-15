import { describe, expect, it } from 'vitest'
import {
  COLLAPSE_OVER,
  countLines,
  fileName,
  isCollapsible,
} from '../../../src/web/chat/codeBlock.ts'

describe('fileName', () => {
  it('names a block from its language', () => {
    expect(fileName('ts')).toBe('code.ts')
    expect(fileName('python')).toBe('code.py')
    expect(fileName('bash')).toBe('code.sh')
    expect(fileName('JSON')).toBe('code.json')
    expect(fileName('patch')).toBe('code.diff')
    expect(fileName('c++')).toBe('code.cpp')
  })

  it('falls back to .txt, and never uses the label as a path', () => {
    expect(fileName(undefined)).toBe('code.txt')
    expect(fileName('')).toBe('code.txt')
    expect(fileName('klingon')).toBe('code.txt')
    expect(fileName('../../etc/passwd')).toBe('code.txt')
    expect(fileName('ts/../x')).toBe('code.txt')
    expect(fileName('constructor')).toBe('code.txt')
    expect(fileName('__proto__')).toBe('code.txt')
  })
})

describe('countLines', () => {
  it('does not count the newline that ends the text', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb\nc\n')).toBe(3)
    expect(countLines('a\n\nb')).toBe(3)
  })
})

describe('isCollapsible', () => {
  it('collapses only blocks over the limit', () => {
    expect(isCollapsible(COLLAPSE_OVER)).toBe(false)
    expect(isCollapsible(COLLAPSE_OVER + 1)).toBe(true)
    expect(isCollapsible(3)).toBe(false)
  })
})
