import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ToolOption } from './AddMenu.tsx'
import { loadDrafts, saveDrafts } from './composerDrafts.ts'
import { appendQuote } from './quote.ts'

/** Text to put in the box: replacing what is there, or (`append`) added under it. A new `n` puts it again. */
export interface Prefill {
  text: string
  n: number
  append?: boolean
}

/**
 * The message box's unsent text and picked tool. Each chat keeps its own, so a
 * draft doesn't follow you to another chat; texts are also kept in this
 * browser, so a reload doesn't lose them (files can't be).
 */
export function useDrafts(
  draftKey: string,
  prefill: Prefill | null,
  inputRef: RefObject<HTMLTextAreaElement | null>,
) {
  const [texts, setTexts] = useState(loadDrafts)
  useEffect(() => saveDrafts(texts), [texts])
  const [pickedTools, setPickedTools] = useState<
    Record<string, ToolOption | null>
  >({})
  const keyRef = useRef(draftKey)
  keyRef.current = draftKey
  const text = texts[draftKey] ?? ''
  const picked = pickedTools[draftKey] ?? null
  // `key`: the chat to change; a refused send is put back into the chat open
  // by then (a new chat may have moved to its own URL meanwhile).
  const setText = (
    change: string | ((current: string) => string),
    key = draftKey,
  ) =>
    setTexts((all) => ({
      ...all,
      [key]: typeof change === 'function' ? change(all[key] ?? '') : change,
    }))
  const setPicked = (option: ToolOption | null, key = draftKey) =>
    setPickedTools((all) => ({ ...all, [key]: option }))

  useEffect(() => {
    if (!prefill) return
    setText((current) =>
      prefill.append ? appendQuote(current, prefill.text) : prefill.text,
    )
    const box = inputRef.current
    box?.focus()
    // After React has put the text in, so the caret ends up after it.
    requestAnimationFrame(() => {
      const end = box?.value.length ?? 0
      box?.setSelectionRange(end, end)
    })
    // Only a new suggestion; the box's own text may change freely.
  }, [prefill?.n])

  return { text, picked, setText, setPicked, keyRef }
}
