// One turn of a chat: the question, then the answer with its thoughts, tool
// activity, images, sources and actions.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Pencil, RefreshCw, Wrench } from 'lucide-react'
import { FileCard } from './FileCard.tsx'
import { ImageViewer, opensViewer, type ViewedImage } from './ImageViewer.tsx'
import { Markdown } from './Markdown.tsx'
import { TOUCH_ONLY, useMediaQuery } from './useMediaQuery.ts'
import { CopyButton, IconAction, VersionSwitcher } from './MessageActions.tsx'
import { type ToolActivity, type Turn } from './turns.ts'
import { describeContext, describeUsage } from './usage.ts'
import { AnswerImages } from './AnswerImages.tsx'
import { Sources } from './Sources.tsx'
import { Summary } from './Summary.tsx'
import { ToolCalls, ToolDetails } from './ToolCalls.tsx'

interface TurnViewProps {
  turn: Turn
  /** Still streaming: shown without actions. */
  pending?: boolean
  /** The last turn: its actions stay visible, as on ChatGPT. */
  latest?: boolean
  busy?: boolean
  /** Shown instead of the answer's actions while tool calls wait for it. */
  approval?: ReactNode
  /** Its question is open for editing (the page tracks which one is). */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  onEdit?: (text: string) => void
  onRegenerate?: () => void
  onSwitch?: (itemId: number) => void
  /** An image loaded (and grew the page): keep following the answer. */
  onImageLoad?: () => void
  /** Tokens before chibot compacts the context; `null` turns it off. */
  compactThreshold: number | null
}

export function TurnView({
  turn: { question, answer, compacted },
  pending,
  latest,
  busy,
  approval,
  editing = false,
  onEditingChange,
  onEdit,
  onRegenerate,
  onSwitch,
  onImageLoad,
  compactThreshold,
}: TurnViewProps) {
  const setEditing = (on: boolean) => onEditingChange?.(on)
  const [viewing, setViewing] = useState<ViewedImage | null>(null)
  // Shown after a Stop before the server's ids are known: no edit/regenerate.
  const saved = question.itemId !== null
  const answerUsage = describeUsage(answer?.usage)
  const contextUsage = describeContext(answer?.usage, compactThreshold)

  return (
    <div className={latest ? 'turn latest' : 'turn'}>
      {editing ? (
        <EditBox
          initial={question.text}
          onCancel={() => setEditing(false)}
          onSend={(text) => {
            setEditing(false)
            onEdit?.(text)
          }}
        />
      ) : (
        <div className="message user">
          {question.attachments.length > 0 && (
            <ul className="message-attachments" aria-label="Attachments">
              {question.attachments.map(({ fileId, image, name }) => (
                <li key={fileId}>
                  <a
                    href={`/api/files/${fileId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={
                      image
                        ? opensViewer(() =>
                            setViewing({ fileId, label: 'Attached image' }),
                          )
                        : undefined
                    }
                  >
                    {image ? (
                      <img
                        src={`/api/files/${fileId}`}
                        alt="Attached image"
                        onLoad={onImageLoad}
                      />
                    ) : (
                      <FileCard name={name ?? 'File'} />
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {question.text && <p>{question.text}</p>}
        </div>
      )}
      {!pending && !editing && (
        <div className="actions user-actions">
          {question.text && <CopyButton text={question.text} />}
          {saved && (
            <IconAction
              label="Edit message"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </IconAction>
          )}
          {question.versions && onSwitch && (
            <VersionSwitcher
              versions={question.versions}
              disabled={busy}
              onSwitch={onSwitch}
            />
          )}
        </div>
      )}

      {compacted && (
        <p className="compaction-note" role="note">
          Earlier messages were summarized to save context.
        </p>
      )}
      {answer?.thinking && (
        <Thoughts
          text={answer.thinking}
          live={pending && !answer.text && answer.tools.length === 0}
        />
      )}
      {answer && (
        <ToolCalls
          // Waiting calls are shown by the approval card instead.
          tools={answer.tools.filter((tool) => pending || tool.output !== null)}
        />
      )}
      {answer && (
        <AnswerImages
          answer={answer}
          onLoad={onImageLoad}
          onView={(fileId) => setViewing({ fileId, label: 'Generated image' })}
        />
      )}
      {answer?.text ? (
        <div className="message assistant">
          <Markdown text={answer.text} />
        </div>
      ) : (
        pending &&
        !answer?.thinking &&
        !answer?.tools.length && (
          <div className="thinking" aria-label="Waiting for answer" />
        )
      )}
      {answer && <Sources answer={answer} />}
      {approval}
      {!pending && !approval && (
        <div className="actions answer-actions">
          {answer && <CopyButton text={answer.text} />}
          {saved && (
            <IconAction
              label={answer ? 'Regenerate' : 'Retry'}
              disabled={busy}
              onClick={() => onRegenerate?.()}
            >
              <RefreshCw />
            </IconAction>
          )}
          {answer?.versions && onSwitch && (
            <VersionSwitcher
              versions={answer.versions}
              disabled={busy}
              onSwitch={onSwitch}
            />
          )}
          {answer?.model && (
            <span className="usage" title="Model that wrote this answer">
              {answer.model}
            </span>
          )}
          {contextUsage && (
            <span
              className={contextUsage.nearLimit ? 'usage near-limit' : 'usage'}
              title={[contextUsage.detail, answerUsage?.detail]
                .filter(Boolean)
                .join(' · ')}
            >
              {contextUsage.short}
            </span>
          )}
        </div>
      )}
      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/** The model's reasoning summary, collapsed (as on ChatGPT). */
function Thoughts({ text, live }: { text: string; live?: boolean }) {
  return (
    <details className="thoughts">
      <Summary live={live}>{live ? 'Thinking…' : 'Thoughts'}</Summary>
      <div className="thoughts-body">
        <Markdown text={text} />
      </div>
    </details>
  )
}

/** Tool calls that wait for the user's Approve / Deny. */
export function ApprovalCard({
  calls,
  busy,
  onAnswer,
}: {
  calls: ToolActivity[]
  busy: boolean
  onAnswer: (approved: boolean) => void
}) {
  const names = [...new Set(calls.map((call) => call.name))].join(', ')
  return (
    <section className="approval" aria-label="Tool approval">
      <h2>
        <Wrench size={16} aria-hidden />
        chibot wants to use {names}
      </h2>
      {calls.map((call) => (
        <ToolDetails key={call.callId} tool={call} />
      ))}
      <p>Sending a new message instead denies it.</p>
      <div className="approval-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
        >
          Deny
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => onAnswer(true)}
        >
          Approve
        </button>
      </div>
    </section>
  )
}

/**
 * Inline editor for a sent message. Enter sends (on touch-only devices it adds
 * a line, and the Send button sends), Esc cancels.
 */
function EditBox({
  initial,
  onCancel,
  onSend,
}: {
  initial: string
  onCancel: () => void
  onSend: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  const canSend = text.trim() !== '' && text !== initial
  const touchOnly = useMediaQuery(TOUCH_ONLY)

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') onCancel()
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !touchOnly
    ) {
      e.preventDefault()
      if (canSend) onSend(text)
    }
  }

  return (
    <div className="edit-box">
      <textarea
        aria-label="Edit message"
        enterKeyHint={touchOnly ? 'enter' : 'send'}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(e) =>
          e.currentTarget.setSelectionRange(text.length, text.length)
        }
      />
      <div className="edit-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!canSend}
          onClick={() => onSend(text)}
        >
          Send
        </button>
      </div>
    </div>
  )
}
