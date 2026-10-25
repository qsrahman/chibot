// One turn of a chat: the question, then the answer with its thoughts, tool
// activity, images, sources and actions.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Download, Pencil, RefreshCw, Wrench } from 'lucide-react'
import { FileCard } from './FileCard.tsx'
import { ImageViewer, opensViewer, type ViewedImage } from './ImageViewer.tsx'
import { Markdown } from './Markdown.tsx'
import { TOUCH_ONLY, useMediaQuery } from './useMediaQuery.ts'
import { CopyButton, IconAction, VersionSwitcher } from './MessageActions.tsx'
import {
  type Answer,
  imagesOf,
  mcpToolName,
  type Source,
  sourcesOf,
  summarizeTool,
  type ToolActivity,
  type Turn,
} from './turns.ts'
import { describeContext, describeUsage } from './usage.ts'

/** What a tool call says while running and once done. */
const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  web_search: ['Searching the web…', 'Searched the web'],
  fetch_url: ['Reading a page…', 'Read a page'],
  generate_image: ['Creating an image…', 'Created an image'],
  edit_image: ['Editing the image…', 'Edited the image'],
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
        <Images
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

/**
 * A disclosure's label with a chevron that turns when open. `live` shimmers
 * the label while the model works.
 */
function Summary({ live, children }: { live?: boolean; children: ReactNode }) {
  return (
    <summary>
      <ChevronRight className="disclosure-chevron" size={16} aria-hidden />
      <span className={live ? 'live' : undefined}>{children}</span>
    </summary>
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

/** A tool call in an answer: running, or collapsed with its result. */
/** What a tool call shows while it runs, and once it's done. */
function labelsOf(tool: ToolActivity): [running: string, done: string] {
  const labels = TOOL_LABELS[tool.name]
  if (labels) return labels
  const mcp = mcpToolName(tool.name)
  const name = mcp ? `${mcp.tool} · ${mcp.server}` : tool.name
  return [`Running ${name}…`, `Used ${name}`]
}

/**
 * An answer's tool calls. Several sit in one collapsed group, labelled with
 * what they did ("Searched the web, Memory updated": a memory change stays
 * visible) or, while one runs, with what it's doing; each opens on its own.
 */
function ToolCalls({ tools }: { tools: ToolActivity[] }) {
  if (tools.length === 0) return null
  if (tools.length === 1) return <ToolCall tool={tools[0]!} />
  const running = tools.find((tool) => tool.output === null)
  const label = running
    ? labelsOf(running)[0]
    : [...new Set(tools.map((tool) => labelsOf(tool)[1]))].join(', ')
  return (
    <details className="thoughts tool-calls">
      <Summary live={running !== undefined}>{label}</Summary>
      <div className="thoughts-body tool-call-list">
        {tools.map((tool) => (
          <ToolCall key={tool.callId} tool={tool} />
        ))}
      </div>
    </details>
  )
}

function ToolCall({ tool }: { tool: ToolActivity }) {
  const running = tool.output === null
  const [busyLabel, doneLabel] = labelsOf(tool)
  return (
    <details className="thoughts tool-call">
      <Summary live={running}>{running ? busyLabel : doneLabel}</Summary>
      <div className="thoughts-body">
        <ToolDetails tool={tool} />
      </div>
    </details>
  )
}

/** What a tool did, in plain terms, with its raw call one click away. */
function ToolDetails({ tool }: { tool: ToolActivity }) {
  const summary = summarizeTool(tool)
  if (!summary) return <RawToolCall tool={tool} />
  const { input, result, links } = summary
  return (
    <div className="tool-summary">
      {input && <p className="tool-input">{input}</p>}
      {result && <p className="tool-result">{result}</p>}
      {links.length > 0 && (
        <ul className="source-list">
          {links.map((source) => (
            <li key={source.url}>
              <SourceLink source={source} />
            </li>
          ))}
        </ul>
      )}
      <details className="tool-raw">
        <Summary>Raw</Summary>
        <RawToolCall tool={tool} />
      </details>
    </div>
  )
}

/** A tool call's arguments and output as they were sent. */
function RawToolCall({ tool }: { tool: ToolActivity }) {
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
function Images({
  answer,
  onLoad,
  onView,
}: {
  answer: Answer
  onLoad?: () => void
  onView: (fileId: string) => void
}) {
  const images = answer.tools.flatMap((tool) => {
    return imagesOf(tool).map((image, i) => ({
      key: `${tool.callId}-${i}`,
      image,
    }))
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
            <a
              href={`/api/files/${image}`}
              target="_blank"
              rel="noreferrer"
              onClick={opensViewer(() => onView(image))}
            >
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
      <Summary>Sources · {sources.length}</Summary>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.url}>
            <SourceLink source={source} />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** A source: a chat in chibot, a project file or a web page (in a new tab). */
function SourceLink({ source: { url, title, kind } }: { source: Source }) {
  if (kind === 'chat') {
    return (
      <Link to={url}>
        <span className="source-title">{title}</span>
        <span className="source-host">Your chats</span>
      </Link>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <span className="source-title">{title}</span>
      <span className="source-host">
        {kind === 'file' ? 'Project file' : new URL(url).hostname}
      </span>
    </a>
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
