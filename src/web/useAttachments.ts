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
 * The composer's attachments, kept per chat (`chat`: the open chat's draft
 * key), so files added in one chat don't follow you to another. Files upload
 * as soon as they're added, so sending only waits for the ones still on
 * their way.
 */
export function useAttachments(chat: string) {
  const [byChat, setByChat] = useState<Record<string, Draft[]>>({})
  const drafts = byChat[chat] ?? []
  // Restoring a refused send goes to the chat open by then (a new chat may
  // have moved to its own URL meanwhile).
  const chatRef = useRef(chat)
  chatRef.current = chat
  const setDrafts = (change: (list: Draft[]) => Draft[], key = chat) =>
    setByChat((all) => ({ ...all, [key]: change(all[key] ?? []) }))
  const uploads = useRef(new Map<string, AbortController>())

  // Unmounting abandons uploads; the server sweeps unsent files.
  useEffect(() => {
    const pending = uploads.current
    return () => pending.forEach((upload) => upload.abort())
  }, [])

  // An upload finishing updates its draft wherever it is, even in a chat
  // the user has since left.
  const patch = (key: string, change: Partial<Draft>) =>
    setByChat((all) =>
      Object.fromEntries(
        Object.entries(all).map(([chatKey, list]) => [
          chatKey,
          list.map((d) => (d.key === key ? { ...d, ...change } : d)),
        ]),
      ),
    )

  function add(files: File[]) {
    for (const file of files) {
      const key = crypto.randomUUID()
      const image = fileKind(file.name)?.kind === 'image'
      const upload = new AbortController()
      uploads.current.set(key, upload)
      setDrafts((list) => [
        ...list,
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
    setDrafts((list) => list.filter((d) => d.key !== key))
  }

  /** Empties the composer once its message is sent. */
  function clear() {
    for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview)
    setDrafts(() => [])
  }

  /** Puts back drafts after a send the server refused before saving them. */
  function restore(previous: Draft[]) {
    // Their preview URLs were revoked by `clear`.
    setDrafts(
      () => previous.map((draft) => ({ ...draft, preview: null })),
      chatRef.current,
    )
  }

  return {
    drafts,
    add,
    remove,
    clear,
    restore,
    /** Some files are still on their way. */
    uploading: drafts.some((d) => !d.attachment && !d.error),
    /** Some files were refused; they must be removed before sending. */
    failed: drafts.some((d) => d.error !== null),
    ready: drafts.flatMap((d) => (d.attachment ? [d.attachment] : [])),
  }
}

export type AttachmentsApi = ReturnType<typeof useAttachments>
