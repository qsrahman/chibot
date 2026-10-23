import { useEffect, useRef, useState } from 'react'
import { transcribe } from './api.ts'

/**
 * Voice input: records from the microphone in the browser's own format
 * (webm/opus, ogg or mp4), then hands the transcript to `onText`.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const transcription = useRef<AbortController | null>(null)
  // Covers the gap before the recorder exists (getUserMedia is pending).
  const active = useRef(false)
  const disposed = useRef(false)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  // Leaving mid-recording discards it and frees the microphone; a transcription
  // still in flight is cancelled.
  useEffect(
    () => () => {
      disposed.current = true
      transcription.current?.abort()
      const rec = recorder.current
      if (!rec) return
      rec.onstop = null
      rec.stop()
      rec.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  async function start() {
    if (active.current) return
    active.current = true
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      active.current = false
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Microphone access was denied'
          : `Can’t use the microphone: ${(err as Error).message}`,
      )
      return
    }
    if (disposed.current) {
      stream.getTracks().forEach((track) => track.stop())
      active.current = false
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      recorder.current = null
      const controller = new AbortController()
      transcription.current = controller
      setState('transcribing')
      transcribe(new Blob(chunks, { type: rec.mimeType }), controller.signal)
        .then((text) => {
          if (text.trim()) onTextRef.current(text.trim())
        })
        .catch((err: Error) => {
          if (!controller.signal.aborted) setError(err.message)
        })
        .finally(() => {
          transcription.current = null
          active.current = false
          if (!disposed.current) setState('idle')
        })
    }
    rec.start()
    recorder.current = rec
    setState('recording')
  }

  return { state, error, start, stop: () => recorder.current?.stop() }
}
