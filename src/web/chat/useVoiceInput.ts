import { useEffect, useRef, type RefObject } from 'react'
import { useDictation } from './useDictation.ts'
import { SHORTCUTS, useShortcuts } from '../ui/shortcuts.ts'
import { useToast } from '../ui/toast.tsx'

/**
 * Dictating into the message box: the transcript goes in at the cursor, for
 * review before sending. `transcription` says whether the server can
 * transcribe at all.
 */
export function useVoiceInput(
  transcription: boolean,
  inputRef: RefObject<HTMLTextAreaElement | null>,
  text: string,
  setText: (change: (current: string) => string) => void,
) {
  const dictation = useDictation((spoken) => {
    // At the cursor, for review before sending.
    const box = inputRef.current
    const start = box?.selectionStart ?? text.length
    const end = box?.selectionEnd ?? text.length
    setText((current) => current.slice(0, start) + spoken + current.slice(end))
    box?.focus()
  })
  const recording = dictation.state === 'recording'
  // The button's name changes, which a screen reader doesn't say by itself.
  const { announce } = useToast()
  const dictationState = useRef(dictation.state)
  useEffect(() => {
    if (dictationState.current === dictation.state) return
    dictationState.current = dictation.state
    if (dictation.state === 'recording') announce('Recording')
    if (dictation.state === 'transcribing') announce('Transcribing')
  }, [dictation.state, announce])
  function toggle() {
    if (!transcription) return
    if (recording) dictation.stop()
    else if (dictation.state === 'idle') void dictation.start()
  }
  useShortcuts({
    [SHORTCUTS.dictate.keys]: (e) => {
      e.preventDefault()
      toggle()
    },
  })
  const micLabel = !transcription
    ? 'Voice input needs a transcription model: choose one in Settings → Other models'
    : recording
      ? 'Stop recording'
      : dictation.state === 'transcribing'
        ? 'Transcribing…'
        : 'Dictate'
  return {
    state: dictation.state,
    stream: dictation.stream,
    error: dictation.error,
    recording,
    micLabel,
    /** Whether the mic can be used now (not while transcribing, or with no model). */
    disabled: !transcription || dictation.state === 'transcribing',
    toggle,
  }
}
