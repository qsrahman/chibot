import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { MessageCircleDashed, Pencil, RefreshCw, Wrench } from 'lucide-react'
import type { Health } from './api.ts'
import { Composer } from './Composer.tsx'
import { Markdown } from './Markdown.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { CopyButton, IconAction, VersionSwitcher } from './MessageActions.tsx'
import { SHORTCUTS, useShortcuts } from './shortcuts.ts'
import { waitingCalls, type ToolActivity, type Turn } from './turns.ts'
import { describeUsage } from './usage.ts'
import { useChat } from './useChat.ts'
import type { SettingsApi } from './useSettings.ts'

interface Props {
  health: Health | undefined
  settings: SettingsApi
  onListChanged: () => void
}

export function ChatPage({ health, settings, onListChanged }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  // Chosen on a new chat before the first message; applies to that chat.
  const [temporaryMode, setTemporaryMode] = useState(false)
  const chat = useChat(id, {
    onCreated: (newId) => navigate(`/c/${newId}`),
    onListChanged,
    temporary: temporaryMode,
  })
  const { turns, pending, error, isTemporary, busy } = chat
  const waiting = pending ? [] : waitingCalls(turns)
  const chatUsage = describeUsage(chat.usage)
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Follow the answer only while the user is at the bottom, so scrolling up
  // to read isn't undone by every new token.
  const followRef = useRef(true)

  useEffect(() => {
    followRef.current = true
    // A new chat starts as a normal one again.
    if (!id) setTemporaryMode(false)
  }, [id])

  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, pending])

  useShortcuts({
    [SHORTCUTS.focusComposer.keys]: (e) => {
      e.preventDefault()
      composerRef.current?.focus()
    },
    [SHORTCUTS.copyLastAnswer.keys]: (e) => {
      const text = turns.at(-1)?.answer?.text
      if (!text) return
      e.preventDefault()
      void navigator.clipboard.writeText(text).catch(() => {})
    },
    [SHORTCUTS.stop.keys]: () => {
      // Esc in a dialog closes the dialog; it shouldn't also stop the answer.
      if (busy && !document.querySelector('dialog[open]')) chat.stop()
    },
  })

  /** Wraps an action that starts a turn: the view follows its answer. */
  function following<A extends unknown[]>(action: (...args: A) => unknown) {
    return (...args: A) => {
      followRef.current = true
      void action(...args)
    }
  }

  // An empty chat centres the composer under a greeting, as ChatGPT does.
  // The composer stays the third child either way, so it keeps its focus
  // and text when the first message moves it to the bottom.
  const empty = turns.length === 0 && !pending && !error
  const temporary = id ? isTemporary : temporaryMode

  return (
    <main className={empty ? 'chat empty' : 'chat'}>
      <header className="topbar">
        {!health ? (
          <span className="model">Server unreachable</span>
        ) : settings.settings && settings.defaults ? (
          <span title={health.baseURL ?? 'OpenAI'}>
            <ModelPicker
              model={settings.settings.model}
              defaultModel={settings.defaults.model}
              onSelect={(model) => void settings.update({ model })}
            />
          </span>
        ) : null}
        {id ? (
          <span className="topbar-info">
            {chatUsage && (
              <span
                className="usage"
                title={`This chat, all versions: ${chatUsage.detail}`}
              >
                {chatUsage.short}
              </span>
            )}
            {temporary && <span className="badge">Temporary chat</span>}
          </span>
        ) : (
          <button
            type="button"
            className={temporaryMode ? 'icon-button active' : 'icon-button'}
            aria-label="Temporary chat"
            aria-pressed={temporaryMode}
            title="Temporary chat"
            onClick={() => setTemporaryMode((on) => !on)}
          >
            <MessageCircleDashed size={20} strokeWidth={1.5} />
          </button>
        )}
      </header>
      {empty ? (
        <div className="greeting">
          <h1>{temporary ? 'Temporary chat' : 'What’s on your mind?'}</h1>
          {temporary && (
            <p>
              This chat won’t appear in your history or search, and it’s deleted
              when you leave it.
            </p>
          )}
        </div>
      ) : (
        <div
          className="messages"
          onScroll={(e) => {
            const el = e.currentTarget
            followRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          <div className="thread">
            {turns.map((turn, i) => (
              <TurnView
                key={turn.key}
                turn={turn}
                latest={!pending && i === turns.length - 1}
                busy={busy}
                onEdit={following((text: string) => chat.edit(i, text))}
                onRegenerate={following(() => chat.regenerate(i))}
                onSwitch={(itemId) => void chat.switchVersion(itemId)}
              />
            ))}
            {pending && (
              <TurnView
                turn={{
                  key: 'pending',
                  question: pending.question,
                  compacted: false,
                  answer:
                    pending.answer ||
                    pending.thinking ||
                    pending.tools.length > 0
                      ? {
                          itemId: null,
                          text: pending.answer,
                          thinking: pending.thinking,
                          tools: pending.tools,
                          usage: null,
                          model: null,
                          versions: null,
                        }
                      : null,
                }}
                pending
              />
            )}
            {waiting.length > 0 && (
              <ApprovalCard
                calls={waiting}
                busy={busy}
                onAnswer={following(chat.approve)}
              />
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}
      <Composer
        busy={busy}
        onSend={following(chat.send)}
        onStop={chat.stop}
        inputRef={composerRef}
      />
      <p className="disclaimer">
        chibot can make mistakes. Check important info.
      </p>
    </main>
  )
}

interface TurnViewProps {
  turn: Turn
  /** Still streaming: shown without actions. */
  pending?: boolean
  /** The last turn: its actions stay visible, as on ChatGPT. */
  latest?: boolean
  busy?: boolean
  onEdit?: (text: string) => void
  onRegenerate?: () => void
  onSwitch?: (itemId: number) => void
}

function TurnView({
  turn: { question, answer, compacted },
  pending,
  latest,
  busy,
  onEdit,
  onRegenerate,
  onSwitch,
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
          <p>{question.text}</p>
        </div>
      )}
      {!pending && !editing && (
        <div className="actions user-actions">
          <CopyButton text={question.text} />
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
      {!pending && (
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
  return (
    <details className="thoughts tool-call">
      <summary className={running ? 'live' : undefined}>
        {running ? `Running ${tool.name}…` : `Used ${tool.name}`}
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

/** Tool calls that wait for the user's Approve / Deny. */
function ApprovalCard({
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
