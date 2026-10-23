import { useEffect, useRef, useState } from 'react'
import { fileKind } from '../shared/documents.ts'
import { uploadFile } from './api.ts'
import type { Attachment } from './turns.ts'

/** A file added to the composer: uploading, uploaded or failed. */
export interface Draft {
  key: string
  name: string
  /** An object URL for images' thumbnails. */
  preview: string | null
  /** Set once uploaded. */
  attachment: Attachment | null
  error: string | null
}

/**
 * The composer's attachments. Files upload as soon as they're added, so
 * sending only waits for the ones still on their way.
 */
export function useAttachments() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const uploads = useRef(new Map<string, AbortController>())

  // Unmounting abandons uploads; the server sweeps unsent files.
  useEffect(() => {
    const pending = uploads.current
    return () => pending.forEach((upload) => upload.abort())
  }, [])

  const patch = (key: string, change: Partial<Draft>) =>
    setDrafts((all) =>
      all.map((d) => (d.key === key ? { ...d, ...change } : d)),
    )

  function add(files: File[]) {
    for (const file of files) {
      const key = crypto.randomUUID()
      const image = fileKind(file.name)?.kind === 'image'
      const upload = new AbortController()
      uploads.current.set(key, upload)
      setDrafts((all) => [
        ...all,
        {
          key,
          name: file.name,
          preview: image ? URL.createObjectURL(file) : null,
          attachment: null,
          error: null,
        },
      ])
      uploadFile(file, upload.signal)
        .then((stored) =>
          patch(key, {
            attachment: {
              fileId: stored.id,
              image,
              name: image ? null : stored.name,
            },
          }),
        )
        .catch((err: Error) => {
          if (!upload.signal.aborted) patch(key, { error: err.message })
        })
        .finally(() => uploads.current.delete(key))
    }
  }

  function remove(key: string) {
    uploads.current.get(key)?.abort()
    const preview = drafts.find((d) => d.key === key)?.preview
    if (preview) URL.revokeObjectURL(preview)
    setDrafts((all) => all.filter((d) => d.key !== key))
  }

  /** Empties the composer once its message is sent. */
  function clear() {
    for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview)
    setDrafts([])
  }

  return {
    drafts,
    add,
    remove,
    clear,
    /** Uploads still running, or failed ones to remove before sending. */
    blocked: drafts.some((d) => !d.attachment),
    ready: drafts.flatMap((d) => (d.attachment ? [d.attachment] : [])),
  }
}

export type AttachmentsApi = ReturnType<typeof useAttachments>
