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

  const empty = messages.length === 0 && !pending

  return (
    <main className="chat">
      <div className="messages">
        {empty && <p className="placeholder">What can I help with?</p>}
        {messages.map((m) => (
          <Message key={m.key} message={m} />
        ))}
        {pending && (
          <>
            <Message message={{ key: 'u', role: 'user', text: pending.user }} />
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
      <Composer busy={busy} onSend={send} onStop={stop} />
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
