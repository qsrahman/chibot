import { useRef, type KeyboardEvent, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { Settings } from '../../shared/settings.ts'
import { AddMenu, type ToolOption } from './AddMenu.tsx'
import { ComposerActions } from './ComposerActions.tsx'
import { DraftAttachments } from './DraftAttachments.tsx'
import { QueuedMessage } from './QueuedMessage.tsx'
import type { Attachment } from './turns.ts'
import type { AttachmentsApi } from './useAttachments.ts'
import { useDrafts, type Prefill } from './useDrafts.ts'
import { useSendMessage } from './useSendMessage.ts'
import { useVoiceInput } from './useVoiceInput.ts'
import { useToastAbove } from '../ui/useToastAbove.ts'
import { TOUCH_ONLY, useMediaQuery } from '../ui/useMediaQuery.ts'

interface Props {
  busy: boolean
  /** `tool` is the picked tool's name, if any. */
  onSend: (
    text: string,
    tool?: string,
    attachments?: Attachment[],
  ) => void | Promise<boolean>
  onStop: () => void
  /** A message waiting for the current answer (text only). */
  queued: string | null
  onQueue: (text: string, tool?: string) => void
  onCancelQueued: () => void
  /** Takes the queued message back, to edit it; `null` if there is none. */
  onTakeQueued: () => string | null
  /** ↑ in an empty box: edit the last message, as in ChatGPT. */
  onEditLast?: () => void
  /** The textarea, so the page can focus it (e.g. from a shortcut). */
  inputRef: RefObject<HTMLTextAreaElement | null>
  tools: ToolOption[]
  /** Owned by the page, which also attaches dropped files. */
  attachments: AttachmentsApi
  /** The open chat's draft (its id, or the new chat's), kept per chat. */
  draftKey: string
  /** The server can transcribe (voice input). */
  transcription: boolean
  /** Reasoning effort (see `EffortSwitch`). */
  effort: Settings['reasoningEffort']
  onEffort: (effort: Settings['reasoningEffort']) => void
  /** Text to put in the box: a starter prompt or a quote (see `Prefill`). */
  prefill: Prefill | null
}

/** The message box: its text, files, picked tool, voice input and send buttons. */
export function Composer({
  busy,
  onSend,
  onStop,
  queued,
  onQueue,
  onCancelQueued,
  onTakeQueued,
  onEditLast,
  inputRef,
  tools,
  attachments,
  draftKey,
  transcription,
  effort,
  onEffort,
  prefill,
}: Props) {
  const { text, picked, setText, setPicked, keyRef } = useDrafts(
    draftKey,
    prefill,
    inputRef,
  )
  const touchOnly = useMediaQuery(TOUCH_ONLY)
  const voice = useVoiceInput(transcription, inputRef, text, setText)
  const { submit, canSend, canQueue, uploadQueued, tool } = useSendMessage({
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
  })
  const formRef = useRef<HTMLFormElement>(null)
  useToastAbove(formRef)

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      e.key === 'ArrowUp' &&
      text === '' &&
      attachments.drafts.length === 0 &&
      onEditLast
    ) {
      e.preventDefault()
      onEditLast()
      return
    }
    // isComposing: Enter confirms IME input (e.g. Japanese) rather than sending.
    // On touch-only devices (no Shift for a new line) Enter adds a line and
    // the send button sends.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !touchOnly
    ) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form
      ref={formRef}
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {queued !== null && (
        <QueuedMessage
          text={queued}
          onEdit={() => {
            const taken = onTakeQueued()
            if (taken === null) return
            setText(taken)
            inputRef.current?.focus()
          }}
          onCancel={onCancelQueued}
        />
      )}
      {attachments.drafts.length > 0 && (
        <DraftAttachments
          drafts={attachments.drafts}
          onRemove={attachments.remove}
        />
      )}
      <div className="composer-left">
        <AddMenu
          tools={tools}
          onFiles={(files) => {
            attachments.add(files)
            inputRef.current?.focus()
          }}
          onPick={(option) => {
            setPicked(option)
            inputRef.current?.focus()
          }}
        />
        {tool && (
          <button
            type="button"
            className="composer-chip"
            title={`${tool.label}: click to remove`}
            aria-label={`Remove ${tool.label}`}
            onClick={() => setPicked(null)}
          >
            {tool.icon}
            {tool.chip}
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <textarea
        ref={inputRef}
        aria-label="Message"
        dir="auto"
        placeholder="Ask anything"
        rows={1}
        // Not on a touch screen: it would raise the keyboard over the page.
        autoFocus={!touchOnly}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        enterKeyHint={touchOnly ? 'enter' : 'send'}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length === 0) return
          e.preventDefault()
          attachments.add(files)
        }}
      />
      <ComposerActions
        voice={voice}
        effort={effort}
        onEffort={onEffort}
        busy={busy}
        canQueue={canQueue}
        canSend={canSend}
        uploadQueued={uploadQueued}
        onStop={() => {
          onStop()
          inputRef.current?.focus()
        }}
      />
      {voice.error && (
        <p className="composer-error" role="alert">
          {voice.error}
        </p>
      )}
    </form>
  )
}
