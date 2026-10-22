import { useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Square } from 'lucide-react'

interface Props {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = !busy && text.trim() !== ''

  function submit() {
    if (!canSend) return
    onSend(text)
    setText('')
    inputRef.current?.focus()
  }

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
      <textarea
        ref={inputRef}
        aria-label="Message"
        placeholder="Ask anything"
        rows={1}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
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
          aria-label="Send"
          disabled={!canSend}
        >
          <ArrowUp size={20} strokeWidth={2} />
        </button>
      )}
    </form>
  )
}
