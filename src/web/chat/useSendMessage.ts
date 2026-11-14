import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ToolOption } from './AddMenu.tsx'
import type { Attachment } from './turns.ts'
import type { AttachmentsApi } from './useAttachments.ts'

interface Options {
  busy: boolean
  text: string
  picked: ToolOption | null
  tools: ToolOption[]
  attachments: AttachmentsApi
  /** The open chat's draft (see `useDrafts`), and the chat it is for now. */
  draftKey: string
  keyRef: { readonly current: string }
  inputRef: RefObject<HTMLTextAreaElement | null>
  setText: (change: string, key?: string) => void
  setPicked: (option: ToolOption | null, key?: string) => void
  /** `tool` is the picked tool's name, if any. */
  onSend: (
    text: string,
    tool?: string,
    attachments?: Attachment[],
  ) => void | Promise<boolean>
  onQueue: (text: string, tool?: string) => void
}

/**
 * Sending what is in the message box: now, queued behind the answer that
 * streams, or once the files being uploaded are up. A send the server refused
 * puts the draft back.
 */
export function useSendMessage({
  busy,
  text,
  picked,
  tools,
  attachments,
  draftKey,
  keyRef,
  inputRef,
  setText,
  setPicked,
  onSend,
  onQueue,
}: Options) {
  // Sent while files were uploading: goes once they're all up.
  const [uploadQueued, setUploadQueued] = useState(false)
  // A queued send belongs to the chat it was made in.
  useEffect(() => setUploadQueued(false), [draftKey])
  const textRef = useRef(text)
  textRef.current = text
  const draftsRef = useRef(attachments.drafts)
  draftsRef.current = attachments.drafts

  // Files alone are a message too.
  const hasMessage =
    (text.trim() !== '' || attachments.drafts.length > 0) && !attachments.failed
  const canSend = !busy && !uploadQueued && hasMessage
  // A tool switched off meanwhile can't be used any more.
  const tool =
    picked && tools.some((t) => t.name === picked.name && !t.unavailable)
      ? picked
      : null
  // While an answer streams, only text can wait: files need uploading first.
  const canQueue = busy && text.trim() !== '' && attachments.drafts.length === 0

  function submit({ force = false } = {}) {
    // Busy: the answer is saved before the next turn starts, so the message
    // waits for it instead of failing on a second run.
    if (busy) {
      if (!canQueue) return
      onQueue(text, tool?.name)
      setText('')
      setPicked(null)
      inputRef.current?.focus()
      return
    }
    // Files still uploading count (the send queues for them), but a queued
    // send can't go if its files were removed meanwhile.
    const sendable =
      !attachments.failed &&
      (text.trim() !== '' ||
        (attachments.uploading
          ? attachments.drafts.length > 0
          : attachments.ready.length > 0))
    if ((!force && !canSend) || !sendable) {
      if (force) setUploadQueued(false)
      return
    }
    if (attachments.uploading) {
      setUploadQueued(true)
      return
    }
    const draft = { text, picked, attachments: attachments.drafts }
    const result = onSend(text, tool?.name, attachments.ready)
    setText('')
    setPicked(null)
    attachments.clear()
    // Cleared immediately so the next message can be typed; if the server
    // refused the send before saving it, put the draft back (unless the user
    // started another one meanwhile).
    textRef.current = ''
    draftsRef.current = []
    if (result && typeof result.then === 'function') {
      void result.then((accepted) => {
        if (accepted || textRef.current !== '' || draftsRef.current.length > 0)
          return
        setText(draft.text, keyRef.current)
        setPicked(draft.picked, keyRef.current)
        attachments.restore(draft.attachments)
      })
    }
    inputRef.current?.focus()
  }

  // Re-run as uploads finish: send once the last one is up, or give up when
  // one fails (its chip shows why).
  useEffect(() => {
    if (!uploadQueued || attachments.uploading) return
    setUploadQueued(false)
    if (!attachments.failed) submit({ force: true })
  }, [uploadQueued, attachments.uploading])

  return { submit, canSend, canQueue, uploadQueued, tool }
}
