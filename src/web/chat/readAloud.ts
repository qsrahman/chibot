import { useSyncExternalStore } from 'react'

/**
 * What a spoken answer says: its Markdown without the marks, and without what
 * is no use read out (code blocks, tables' rules, bare links and citation
 * numbers, HTML tags). Code and tables are dropped; the prose around them
 * says what they are.
 */
export function speakableText(markdown: string): string {
  return (
    markdown
      // Fenced code: not read.
      .replace(/```[\s\S]*?(```|$)/g, '\n\n')
      // A table's divider row, and its pipes between cells.
      .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, ' ')
      .replace(/\|/g, ', ')
      // Images are dropped; a link reads as its words, and a citation (just a number) not at all.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[(\d+)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<https?:\/\/[^>]+>/g, ' ')
      .replace(/<[^>\n]+>/g, ' ')
      // Headings, quotes, list marks, emphasis and inline code marks.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '')
      .replace(/(\*\*|__|~~|\*|_|`)/g, '')
      .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
  )
}

/**
 * The text in pieces a voice takes one at a time: Chrome stops a long
 * utterance after about fifteen seconds, so each piece is a few sentences.
 */
export function speechChunks(text: string, max = 220): string[] {
  const chunks: string[] = []
  let current = ''
  for (const part of text.split(/(?<=[.!?؟۔…])\s+|\n+/)) {
    const piece = part.trim()
    if (!piece) continue
    if (current && current.length + 1 + piece.length > max) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current} ${piece}` : piece
    // One sentence longer than a piece goes on its own.
    while (current.length > max * 2) {
      const cut = current.lastIndexOf(' ', max)
      const at = cut > 0 ? cut : max
      chunks.push(current.slice(0, at))
      current = current.slice(at).trim()
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** A language for the voice when the text is in Arabic script (Urdu, Arabic, Persian), else the browser's own. */
export function speechLanguage(text: string): string | undefined {
  return /[؀-ۿ]/.test(text) ? 'ur-PK' : undefined
}

// Which answer (its item id) is being read, if any. One at a time, as there is one voice.
let reading: string | null = null
const listeners = new Set<() => void>()
const set = (key: string | null) => {
  reading = key
  listeners.forEach((listener) => listener())
}

/** Whether this browser can speak text (the Web Speech API). */
export const canSpeak = () =>
  typeof speechSynthesis !== 'undefined' &&
  typeof SpeechSynthesisUtterance !== 'undefined'

/** Stops what is being read, if anything. */
export function stopReading() {
  if (reading === null) return
  speechSynthesis.cancel()
  set(null)
}

/** Reads `markdown` aloud as answer `key`, or stops if it is already being read. */
export function toggleReading(key: string, markdown: string) {
  if (!canSpeak()) return
  const wasThis = reading === key
  speechSynthesis.cancel()
  if (wasThis) return set(null)
  const text = speakableText(markdown)
  const chunks = speechChunks(text)
  if (chunks.length === 0) return set(null)
  const lang = speechLanguage(text)
  set(key)
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    if (lang) utterance.lang = lang
    const done = () => {
      if (i === chunks.length - 1 && reading === key) set(null)
    }
    utterance.onend = done
    utterance.onerror = done
    speechSynthesis.speak(utterance)
  })
}

/** The key of the answer being read, or `null`. */
export const useReading = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => reading,
  )
