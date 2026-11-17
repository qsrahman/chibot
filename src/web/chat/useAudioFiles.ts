import { useEffect, useRef, useState } from 'react'
import { AUDIO_LIMIT, isAudioFile } from '../../shared/documents.ts'
import { errorMessage } from '../../shared/errors.ts'
import { useToast } from '../ui/toast.tsx'
import { transcribe } from './api.ts'

/**
 * Recordings added to the message (picked, pasted or dropped) are not
 * attached: they are turned into text by the transcription model, which goes
 * into the message box for review, like dictation. `take` gets the files and
 * hands back the ones that are not recordings, for the usual attaching.
 * `transcription` says whether the server can transcribe at all.
 */
export function useAudioFiles({
  transcription,
  onText,
}: {
  transcription: boolean
  /** The text of one recording, to put in the message box. */
  onText: (text: string) => void
}) {
  const { toast } = useToast()
  /** The names of the recordings being transcribed. */
  const [busy, setBusy] = useState<string[]>([])
  const aborted = useRef(new AbortController())
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  useEffect(() => {
    const controller = aborted.current
    return () => controller.abort()
  }, [])

  async function transcribeAll(files: File[]) {
    // One after another: the server's endpoint is one request at a time to
    // the model, and the texts come back in the order they were added.
    for (const file of files) {
      if (file.size > AUDIO_LIMIT) {
        toast(`${file.name} is larger than 25 MB`, { kind: 'error' })
        continue
      }
      setBusy((names) => [...names, file.name])
      try {
        const text = (
          await transcribe(file, aborted.current.signal, file.name)
        ).trim()
        if (text) onTextRef.current(text)
        else toast(`No speech found in ${file.name}`, { kind: 'info' })
      } catch (err) {
        if (!aborted.current.signal.aborted) {
          toast(`${file.name}: ${errorMessage(err)}`, { kind: 'error' })
        }
      } finally {
        setBusy((names) => names.filter((name) => name !== file.name))
      }
    }
  }

  function take(files: File[]): File[] {
    const audio = files.filter((file) => isAudioFile(file.name, file.type))
    if (audio.length === 0) return files
    if (transcription) {
      void transcribeAll(audio)
    } else {
      toast(
        'Audio needs a transcription model: choose one in Settings → Other models',
        { kind: 'error' },
      )
    }
    return files.filter((file) => !audio.includes(file))
  }

  return { take, busy }
}
