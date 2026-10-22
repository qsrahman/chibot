import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { MessageCircleDashed } from 'lucide-react'
import type { Health } from './api.ts'
import { Composer } from './Composer.tsx'
import { Markdown } from './Markdown.tsx'
import type { ChatMessage } from './messages.ts'
import { useChat } from './useChat.ts'

interface Props {
  health: Health | undefined
  onListChanged: () => void
}

export function ChatPage({ health, onListChanged }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  // Chosen on a new chat before the first message; applies to that chat.
  const [temporaryMode, setTemporaryMode] = useState(false)
  const { messages, pending, error, isTemporary, busy, send, stop } = useChat(
    id,
    {
      onCreated: (newId) => navigate(`/c/${newId}`),
      onListChanged,
      temporary: temporaryMode,
    },
  )
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A new chat starts as a normal one again.
    if (!id) setTemporaryMode(false)
  }, [id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending])

  // An empty chat centres the composer under a greeting, as ChatGPT does.
  // The composer stays the third child either way, so it keeps its focus
  // and text when the first message moves it to the bottom.
  const empty = messages.length === 0 && !pending && !error
  const temporary = id ? isTemporary : temporaryMode

  return (
    <main className={empty ? 'chat empty' : 'chat'}>
      <header className="topbar">
        <span className="model" title={health?.baseURL ?? 'OpenAI'}>
          {health ? health.model : 'Server unreachable'}
        </span>
        {id ? (
          temporary && <span className="badge">Temporary chat</span>
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
        <div className="messages">
          <div className="thread">
            {messages.map((m) => (
              <Message key={m.key} message={m} />
            ))}
            {pending && (
              <>
                <Message
                  message={{ key: 'u', role: 'user', text: pending.user }}
                />
                {pending.assistant ? (
                  <Message
                    message={{
                      key: 'a',
                      role: 'assistant',
                      text: pending.assistant,
                    }}
                  />
                ) : (
                  <div className="thinking" aria-label="Waiting for answer" />
                )}
              </>
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
      <Composer busy={busy} onSend={send} onStop={stop} />
      <p className="disclaimer">
        chibot can make mistakes. Check important info.
      </p>
    </main>
  )
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <div className={`message ${message.role}`}>
      {message.role === 'user' ? (
        <p>{message.text}</p>
      ) : (
        <Markdown text={message.text} />
      )}
    </div>
  )
}
