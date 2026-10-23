// One turn of a chat: the question, then the answer with its thoughts, tool
// activity, images, sources and actions.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Download, Pencil, RefreshCw, Wrench } from 'lucide-react'
import { FileCard } from './FileCard.tsx'
import { Markdown } from './Markdown.tsx'
import { CopyButton, IconAction, VersionSwitcher } from './MessageActions.tsx'
import {
  imageOf,
  sourcesOf,
  type Answer,
  type ToolActivity,
  type Turn,
} from './turns.ts'
import { describeUsage } from './usage.ts'

/** What a tool call says while running and once done. */
const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  web_search: ['Searching the web…', 'Searched the web'],
  fetch_url: ['Reading a page…', 'Read a page'],
  generate_image: ['Creating an image…', 'Created an image'],
  edit_image: ['Editing the image…', 'Edited the image'],
  calculator: ['Calculating…', 'Used calculator'],
  memory: ['Updating memory…', 'Memory updated'],
  search_chats: ['Searching your chats…', 'Searched your chats'],
  search_project_files: ['Searching project files…', 'Searched project files'],
}

interface TurnViewProps {
  turn: Turn
  /** Still streaming: shown without actions. */
  pending?: boolean
  /** The last turn: its actions stay visible, as on ChatGPT. */
  latest?: boolean
  busy?: boolean
  /** Shown instead of the answer's actions while tool calls wait for it. */
  approval?: ReactNode
  onEdit?: (text: string) => void
  onRegenerate?: () => void
  onSwitch?: (itemId: number) => void
  /** An image loaded (and grew the page): keep following the answer. */
  onImageLoad?: () => void
}

export function TurnView({
  turn: { question, answer, compacted },
  pending,
  latest,
  busy,
  approval,
  onEdit,
  onRegenerate,
  onSwitch,
  onImageLoad,
}: TurnViewProps) {
  const [editing, setEditing] = useState(false)
  // Shown after a Stop before the server's ids are known: no edit/regenerate.
  const saved = question.itemId !== null
  const answerUsage = describeUsage(answer?.usage)

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
      {answer?.tools.map(
        (tool) =>
          // Waiting calls are shown by the approval card instead.
          (pending || tool.output !== null) && (
            <ToolCall key={tool.callId} tool={tool} />
          ),
      )}
      {answer && <Images answer={answer} onLoad={onImageLoad} />}
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
          {answerUsage && (
            <span className="usage" title={answerUsage.detail}>
              {answerUsage.short}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** The model's reasoning summary, collapsed (as on ChatGPT). */
function Thoughts({ text, live }: { text: string; live?: boolean }) {
  return (
    <details className="thoughts">
      <summary className={live ? 'live' : undefined}>
        {live ? 'Thinking…' : 'Thoughts'}
      </summary>
      <div className="thoughts-body">
        <Markdown text={text} />
      </div>
    </details>
  )
}

/** A tool call in an answer: running, or collapsed with its result. */
function ToolCall({ tool }: { tool: ToolActivity }) {
  const running = tool.output === null
  const [busyLabel, doneLabel] = TOOL_LABELS[tool.name] ?? [
    `Running ${tool.name}…`,
    `Used ${tool.name}`,
  ]
  return (
    <details className="thoughts tool-call">
      <summary className={running ? 'live' : undefined}>
        {running ? busyLabel : doneLabel}
      </summary>
      <div className="thoughts-body">
        <ToolDetails tool={tool} />
      </div>
    </details>
  )
}

function ToolDetails({ tool }: { tool: ToolActivity }) {
  return (
    <dl className="tool-details">
      <dt>Arguments</dt>
      <dd>
        <pre>{prettyJson(tool.arguments)}</pre>
      </dd>
      {tool.output !== null && (
        <>
          <dt>Result</dt>
          <dd>
            <pre>{tool.output}</pre>
          </dd>
        </>
      )}
    </dl>
  )
}

/** Images the answer's tools made, or placeholders while they're made. */
function Images({ answer, onLoad }: { answer: Answer; onLoad?: () => void }) {
  const images = answer.tools.flatMap((tool) => {
    const image = imageOf(tool)
    return image ? [{ key: tool.callId, image }] : []
  })
  if (images.length === 0) return null
  return (
    <div className="images">
      {images.map(({ key, image }) =>
        image === 'pending' ? (
          <div
            key={key}
            className="image-placeholder"
            aria-label="Creating image"
          />
        ) : (
          <figure key={key} className="image">
            <a href={`/api/files/${image}`} target="_blank" rel="noreferrer">
              <img
                src={`/api/files/${image}`}
                alt="Generated image"
                onLoad={onLoad}
              />
            </a>
            <a
              className="icon-button image-download"
              href={`/api/files/${image}`}
              download
              aria-label="Download image"
              title="Download"
            >
              <Download size={18} strokeWidth={1.5} />
            </a>
          </figure>
        ),
      )}
    </div>
  )
}

/** The pages the answer searched or read, collapsed under "Sources". */
function Sources({ answer }: { answer: Answer }) {
  const sources = sourcesOf(answer)
  if (sources.length === 0) return null
  return (
    <details className="sources">
      <summary>Sources · {sources.length}</summary>
      <ul>
        {sources.map(({ url, title, kind }) => (
          <li key={url}>
            {kind === 'chat' ? (
              <Link to={url}>
                <span className="source-title">{title}</span>
                <span className="source-host">Your chats</span>
              </Link>
            ) : (
              <a href={url} target="_blank" rel="noreferrer">
                <span className="source-title">{title}</span>
                <span className="source-host">
                  {kind === 'file' ? 'Project file' : new URL(url).hostname}
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>
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

/** Indented JSON when `text` is JSON, else `text` as is. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Inline editor for a sent message. Enter sends, Esc cancels. */
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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend(text)
    }
  }

  return (
    <div className="edit-box">
      <textarea
        aria-label="Edit message"
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
