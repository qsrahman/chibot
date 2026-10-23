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

  // Leaving mid-recording discards it and frees the microphone.
  useEffect(
    () => () => {
      const rec = recorder.current
      if (!rec) return
      rec.onstop = null
      rec.stop()
      rec.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  async function start() {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Microphone access was denied'
          : `Can’t use the microphone: ${(err as Error).message}`,
      )
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      recorder.current = null
      setState('transcribing')
      transcribe(new Blob(chunks, { type: rec.mimeType }))
        .then((text) => {
          if (text.trim()) onText(text.trim())
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setState('idle'))
    }
    rec.start()
    recorder.current = rec
    setState('recording')
  }

  return { state, error, start, stop: () => recorder.current?.stop() }
}
