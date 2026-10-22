import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Composer } from './Composer.tsx'
import { Markdown } from './Markdown.tsx'
import type { ChatMessage } from './messages.ts'
import { useChat } from './useChat.ts'

export function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { messages, pending, error, busy, send, stop } = useChat(id, (newId) =>
    navigate(`/c/${newId}`),
  )
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending])

  // An empty chat centres the composer under a greeting, as ChatGPT does.
  // The composer stays the second child either way, so it keeps its focus
  // and text when the first message moves it to the bottom.
  const empty = messages.length === 0 && !pending && !error

  return (
    <main className={empty ? 'chat empty' : 'chat'}>
      {empty ? (
        <h1 className="greeting">What’s on your mind?</h1>
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
