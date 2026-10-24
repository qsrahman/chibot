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
import type { Settings } from '../shared/settings.ts'
import { FileCard } from './FileCard.tsx'
import { ModeSwitch } from './ModeSwitch.tsx'
import { useAnchoredPopover } from './popover.ts'
import type { Attachment } from './turns.ts'
import type { AttachmentsApi, Draft } from './useAttachments.ts'
import { useDictation } from './useDictation.ts'
import { TOUCH_ONLY, useMediaQuery } from './useMediaQuery.ts'

/** A tool the user can pick for the next message ("+" menu). */
export interface ToolOption {
  name: string
  /** In the menu, e.g. "Search the web". */
  label: string
  /** On the chip once picked, e.g. "Search". */
  chip: string
  icon: ReactNode
  /** Why it can't be used (not set up, or switched off), or `null`. */
  unavailable: string | null
}

interface Props {
  busy: boolean
  /** `tool` is the picked tool's name, if any. */
  onSend: (
    text: string,
    tool?: string,
    attachments?: Attachment[],
  ) => void | Promise<boolean>
  onStop: () => void
  /** The textarea, so the page can focus it (e.g. from a shortcut). */
  inputRef: RefObject<HTMLTextAreaElement | null>
  tools: ToolOption[]
  /** Owned by the page, which also attaches dropped files. */
  attachments: AttachmentsApi
  /** The server can transcribe (voice input). */
  transcription: boolean
  /** Reasoning effort, picked as a mode (see `ModeSwitch`). */
  effort: Settings['reasoningEffort']
  onEffort: (effort: Settings['reasoningEffort']) => void
}

export function Composer({
  busy,
  onSend,
  onStop,
  inputRef,
  tools,
  attachments,
  transcription,
  effort,
  onEffort,
}: Props) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ToolOption | null>(null)
  // Sent while files were uploading: goes once they're all up.
  const [queued, setQueued] = useState(false)
  const textRef = useRef(text)
  textRef.current = text
  const draftsRef = useRef(attachments.drafts)
  draftsRef.current = attachments.drafts
  const menu = useAnchoredPopover()
  const pickerRef = useRef<HTMLInputElement>(null)
  const touchOnly = useMediaQuery(TOUCH_ONLY)
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
    picked && tools.some((t) => t.name === picked.name && !t.unavailable)
      ? picked
      : null

  function submit({ force = false } = {}) {
    // Files still uploading count (the send queues for them), but a queued
    // send can't go if its files were removed meanwhile.
    const sendable =
      !attachments.failed &&
      (text.trim() !== '' ||
        (attachments.uploading
          ? attachments.drafts.length > 0
          : attachments.ready.length > 0))
    if ((!force && !canSend) || !sendable) {
      if (force) setQueued(false)
      return
    }
    if (attachments.uploading) {
      setQueued(true)
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
        setText(draft.text)
        setPicked(draft.picked)
        attachments.restore(draft.attachments)
      })
    }
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
        style={menu.triggerStyle}
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
        className="menu above"
        role="menu"
        style={menu.style}
        {...menu.menuProps}
      >
        <button
          type="button"
          role="menuitem"
          className="menu-item has-hint"
          onClick={() => {
            menu.hide()
            pickerRef.current?.click()
          }}
        >
          <Paperclip size={18} strokeWidth={1.5} aria-hidden />
          <span className="menu-item-text">
            Add photos & files
            <span className="menu-hint">Images, PDF, Word, text and code</span>
          </span>
        </button>
        {tools.map((option) => (
          <button
            key={option.name}
            type="button"
            role="menuitem"
            className={option.unavailable ? 'menu-item has-hint' : 'menu-item'}
            disabled={option.unavailable !== null}
            onClick={() => {
              setPicked(option)
              menu.hide()
              inputRef.current?.focus()
            }}
          >
            {option.icon}
            <span className="menu-item-text">
              {option.label}
              {option.unavailable && (
                <span className="menu-hint">{option.unavailable}</span>
              )}
            </span>
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
        enterKeyHint={touchOnly ? 'enter' : 'send'}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length === 0) return
          e.preventDefault()
          attachments.add(files)
        }}
      />
      <ModeSwitch effort={effort} onChange={onEffort} />
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
