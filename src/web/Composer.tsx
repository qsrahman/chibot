import { useState, type KeyboardEvent } from 'react'

interface Props {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const canSend = !busy && text.trim() !== ''

  function submit() {
    if (!canSend) return
    onSend(text)
    setText('')
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
        aria-label="Message"
        placeholder="Message chibot"
        rows={1}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <button type="button" onClick={onStop} aria-label="Stop">
          ■
        </button>
      ) : (
        <button type="submit" disabled={!canSend} aria-label="Send">
          ↑
        </button>
      )}
    </form>
  )
}
