import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { ArrowUp, LoaderCircle, Mic, Square, X } from 'lucide-react'
import type { Settings } from '../../shared/settings.ts'
import { AddMenu, type ToolOption } from './AddMenu.tsx'
import { loadDrafts, saveDrafts } from './composerDrafts.ts'
import { appendQuote } from './quote.ts'
import { DictationMeter } from './DictationMeter.tsx'
import { DraftAttachments } from './DraftAttachments.tsx'
import { EffortSwitch } from './EffortSwitch.tsx'
import { QueuedMessage } from './QueuedMessage.tsx'
import type { Attachment } from './turns.ts'
import type { AttachmentsApi } from './useAttachments.ts'
import { useDictation } from './useDictation.ts'
import { SHORTCUTS, useShortcuts } from '../ui/shortcuts.ts'
import { useToast } from '../ui/toast.tsx'
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
  /** Text to put in the box (a starter prompt); a new `n` puts it again. */
  /** Text to put in the box: replacing what is there, or (`append`) added under it. */
  prefill: { text: string; n: number; append?: boolean } | null
}

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
  // Each chat keeps its own unsent text and picked tool, so a draft doesn't
  // follow you to another chat. Texts are also kept in this browser, so a
  // reload doesn't lose them (files can't be).
  const [texts, setTexts] = useState(loadDrafts)
  useEffect(() => saveDrafts(texts), [texts])
  const [pickedTools, setPickedTools] = useState<
    Record<string, ToolOption | null>
  >({})
  const keyRef = useRef(draftKey)
  keyRef.current = draftKey
  const text = texts[draftKey] ?? ''
  const picked = pickedTools[draftKey] ?? null
  // `key`: the chat to change; a refused send is put back into the chat open
  // by then (a new chat may have moved to its own URL meanwhile).
  const setText = (
    change: string | ((current: string) => string),
    key = draftKey,
  ) =>
    setTexts((all) => ({
      ...all,
      [key]: typeof change === 'function' ? change(all[key] ?? '') : change,
    }))
  const setPicked = (option: ToolOption | null, key = draftKey) =>
    setPickedTools((all) => ({ ...all, [key]: option }))
  // Sent while files were uploading: goes once they're all up.
  const [uploadQueued, setUploadQueued] = useState(false)
  // A queued send belongs to the chat it was made in.
  useEffect(() => setUploadQueued(false), [draftKey])
  const textRef = useRef(text)
  textRef.current = text
  const draftsRef = useRef(attachments.drafts)
  draftsRef.current = attachments.drafts
  const touchOnly = useMediaQuery(TOUCH_ONLY)
  useEffect(() => {
    if (!prefill) return
    setText((current) =>
      prefill.append ? appendQuote(current, prefill.text) : prefill.text,
    )
    const box = inputRef.current
    box?.focus()
    // After React has put the text in, so the caret ends up after it.
    requestAnimationFrame(() => {
      const end = box?.value.length ?? 0
      box?.setSelectionRange(end, end)
    })
    // Only a new suggestion; the box's own text may change freely.
  }, [prefill?.n])
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
  function toggleDictation() {
    if (!transcription) return
    if (recording) dictation.stop()
    else if (dictation.state === 'idle') void dictation.start()
  }
  useShortcuts({
    [SHORTCUTS.dictate.keys]: (e) => {
      e.preventDefault()
      toggleDictation()
    },
  })
  const micLabel = !transcription
    ? 'Voice input needs a transcription model: choose one in Settings → Other models'
    : recording
      ? 'Stop recording'
      : dictation.state === 'transcribing'
        ? 'Transcribing…'
        : 'Dictate'
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

  const formRef = useRef<HTMLFormElement>(null)
  // Toasts stand above the box however tall it grows (see toast.css); a box
  // that is not at the bottom (a project's, or the new-chat page's) leaves
  // them at the default.
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const root = document.documentElement
    const place = () => {
      const { top, bottom } = form.getBoundingClientRect()
      if (window.innerHeight - bottom < 160) {
        root.style.setProperty(
          '--toast-bottom',
          `${window.innerHeight - top + 12}px`,
        )
      } else root.style.removeProperty('--toast-bottom')
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(form)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      root.style.removeProperty('--toast-bottom')
    }
  }, [])

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
      <div className="composer-actions">
        <EffortSwitch effort={effort} onChange={onEffort} />
        {dictation.stream && <DictationMeter stream={dictation.stream} />}
        <button
          type="button"
          className={recording ? 'icon-button recording' : 'icon-button'}
          aria-label={micLabel}
          title={micLabel}
          // aria-disabled rather than disabled, so the tooltip still shows.
          aria-disabled={!transcription || dictation.state === 'transcribing'}
          aria-pressed={recording}
          onClick={toggleDictation}
        >
          {dictation.state === 'transcribing' ? (
            <LoaderCircle className="spin" size={20} strokeWidth={1.5} />
          ) : recording ? (
            <Square size={14} fill="currentColor" />
          ) : (
            <Mic size={20} strokeWidth={1.5} />
          )}
        </button>
        {busy && canQueue && (
          <button
            type="button"
            className="icon-button"
            aria-label="Stop"
            title="Stop"
            onClick={() => {
              onStop()
              inputRef.current?.focus()
            }}
          >
            <Square size={14} fill="currentColor" />
          </button>
        )}
        {busy ? (
          canQueue ? (
            <button
              type="submit"
              className="icon-button primary"
              aria-label="Queue message"
              title="Send after this answer"
            >
              <ArrowUp size={20} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              className="icon-button primary"
              aria-label="Stop"
              title="Stop"
              onClick={() => {
                onStop()
                inputRef.current?.focus()
              }}
            >
              <Square size={14} fill="currentColor" />
            </button>
          )
        ) : (
          <button
            type="submit"
            className="icon-button primary"
            aria-label={
              uploadQueued ? 'Sending when the files are uploaded' : 'Send'
            }
            title={
              uploadQueued ? 'Sending when the files are uploaded' : 'Send'
            }
            disabled={!canSend}
          >
            {uploadQueued ? (
              <LoaderCircle className="spin" size={20} strokeWidth={2} />
            ) : (
              <ArrowUp size={20} strokeWidth={2} />
            )}
          </button>
        )}
      </div>
      {dictation.error && (
        <p className="composer-error" role="alert">
          {dictation.error}
        </p>
      )}
    </form>
  )
}
