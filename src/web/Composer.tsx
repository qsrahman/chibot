import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  ArrowUp,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { ATTACHMENT_ACCEPT } from '../shared/documents.ts'
import { FileCard } from './FileCard.tsx'
import { useAnchoredPopover } from './popover.ts'
import type { Attachment } from './turns.ts'
import type { AttachmentsApi, Draft } from './useAttachments.ts'
import { useDictation } from './useDictation.ts'

/** A tool the user can pick for the next message ("+" menu). */
export interface ToolOption {
  name: string
  /** In the menu, e.g. "Search the web". */
  label: string
  /** On the chip once picked, e.g. "Search". */
  chip: string
  icon: ReactNode
}

interface Props {
  busy: boolean
  /** `tool` is the picked tool's name, if any. */
  onSend: (text: string, tool?: string, attachments?: Attachment[]) => void
  onStop: () => void
  /** The textarea, so the page can focus it (e.g. from a shortcut). */
  inputRef: RefObject<HTMLTextAreaElement | null>
  tools: ToolOption[]
  /** Owned by the page, which also attaches dropped files. */
  attachments: AttachmentsApi
  /** The server can transcribe (voice input). */
  transcription: boolean
}

export function Composer({
  busy,
  onSend,
  onStop,
  inputRef,
  tools,
  attachments,
  transcription,
}: Props) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ToolOption | null>(null)
  // Sent while files were uploading: goes once they're all up.
  const [queued, setQueued] = useState(false)
  const menu = useAnchoredPopover()
  const pickerRef = useRef<HTMLInputElement>(null)
  const dictation = useDictation((spoken) => {
    // At the cursor, for review before sending.
    const box = inputRef.current
    const start = box?.selectionStart ?? text.length
    const end = box?.selectionEnd ?? text.length
    setText((current) => current.slice(0, start) + spoken + current.slice(end))
    box?.focus()
  })
  const recording = dictation.state === 'recording'
  const micLabel = !transcription
    ? 'Voice input needs a transcription model (OPENAI_TRANSCRIBE_MODEL)'
    : recording
      ? 'Stop recording'
      : dictation.state === 'transcribing'
        ? 'Transcribing…'
        : 'Dictate'
  // Files alone are a message too.
  const canSend =
    !busy &&
    !queued &&
    (text.trim() !== '' || attachments.drafts.length > 0) &&
    !attachments.failed
  // A tool switched off meanwhile can't be used any more.
  const tool =
    picked && tools.some((t) => t.name === picked.name) ? picked : null

  function submit({ force = false } = {}) {
    if (!canSend && !force) return
    if (attachments.uploading) {
      setQueued(true)
      return
    }
    onSend(text, tool?.name, attachments.ready)
    setText('')
    setPicked(null)
    attachments.clear()
    inputRef.current?.focus()
  }

  // Re-run as uploads finish: send once the last one is up, or give up when
  // one fails (its chip shows why).
  useEffect(() => {
    if (!queued || attachments.uploading) return
    setQueued(false)
    if (!attachments.failed) submit({ force: true })
  }, [queued, attachments.uploading])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter confirms IME input (e.g. Japanese) rather than sending.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {attachments.drafts.length > 0 && (
        <ul className="composer-attachments" aria-label="Attachments">
          {attachments.drafts.map((draft) => (
            <DraftChip
              key={draft.key}
              draft={draft}
              onRemove={() => attachments.remove(draft.key)}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="Add files and more"
        title="Add files and more"
        popoverTarget={menu.id}
        onClick={(e) => menu.place(e.currentTarget, { above: true })}
      >
        <Plus size={24} strokeWidth={1.5} />
      </button>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        accept={ATTACHMENT_ACCEPT}
        aria-label="Add photos & files"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          attachments.add(files)
          inputRef.current?.focus()
        }}
      />
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu"
        role="menu"
        style={menu.style}
      >
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            menu.hide()
            pickerRef.current?.click()
          }}
        >
          <Paperclip size={18} strokeWidth={1.5} aria-hidden />
          Add photos & files
        </button>
        {tools.map((option) => (
          <button
            key={option.name}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setPicked(option)
              menu.hide()
              inputRef.current?.focus()
            }}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
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
      <textarea
        ref={inputRef}
        aria-label="Message"
        placeholder="Ask anything"
        rows={1}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length === 0) return
          e.preventDefault()
          attachments.add(files)
        }}
      />
      <button
        type="button"
        className={recording ? 'icon-button recording' : 'icon-button'}
        aria-label={micLabel}
        title={micLabel}
        // aria-disabled rather than disabled, so the tooltip still shows.
        aria-disabled={!transcription || dictation.state === 'transcribing'}
        aria-pressed={recording}
        onClick={() => {
          if (!transcription) return
          if (recording) dictation.stop()
          else if (dictation.state === 'idle') void dictation.start()
        }}
      >
        {dictation.state === 'transcribing' ? (
          <LoaderCircle className="spin" size={20} strokeWidth={1.5} />
        ) : recording ? (
          <Square size={14} fill="currentColor" />
        ) : (
          <Mic size={20} strokeWidth={1.5} />
        )}
      </button>
      {busy ? (
        <button
          type="button"
          className="icon-button primary"
          aria-label="Stop"
          onClick={() => {
            onStop()
            inputRef.current?.focus()
          }}
        >
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          className="icon-button primary"
          aria-label={queued ? 'Sending when the files are uploaded' : 'Send'}
          title={queued ? 'Sending when the files are uploaded' : undefined}
          disabled={!canSend}
        >
          {queued ? (
            <LoaderCircle className="spin" size={20} strokeWidth={2} />
          ) : (
            <ArrowUp size={20} strokeWidth={2} />
          )}
        </button>
      )}
      {dictation.error && (
        <p className="composer-error" role="alert">
          {dictation.error}
        </p>
      )}
    </form>
  )
}

/** An attachment in the composer: a thumbnail or a file card, with ×. */
function DraftChip({
  draft,
  onRemove,
}: {
  draft: Draft
  onRemove: () => void
}) {
  const state = draft.error
    ? 'failed'
    : draft.attachment
      ? 'ready'
      : 'uploading'
  return (
    <li
      className={`attachment ${draft.preview ? 'image' : 'file'} ${state}`}
      title={draft.error ?? draft.name}
    >
      {draft.preview ? (
        <img src={draft.preview} alt={draft.name} />
      ) : (
        <FileCard name={draft.name} detail={draft.error ?? undefined} />
      )}
      {state === 'uploading' && (
        <LoaderCircle
          className="attachment-spinner"
          size={20}
          aria-label="Uploading"
        />
      )}
      <button
        type="button"
        className="attachment-remove"
        aria-label={`Remove ${draft.name}`}
        onClick={onRemove}
      >
        <X size={12} strokeWidth={2.5} aria-hidden />
      </button>
    </li>
  )
}
