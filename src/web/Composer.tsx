import {
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { ArrowUp, Plus, Square, X } from 'lucide-react'
import { useAnchoredPopover } from './popover.ts'

/** A tool the user can pick for the next message ("+" menu). */
export interface ToolOption {
  name: string
  /** In the menu, e.g. "Search the web". */
  label: string
  /** On the chip once picked, e.g. "Search". */
  chip: string
  icon: ReactNode
}

interface Props {
  busy: boolean
  /** `tool` is the picked tool's name, if any. */
  onSend: (text: string, tool?: string) => void
  onStop: () => void
  /** The textarea, so the page can focus it (e.g. from a shortcut). */
  inputRef: RefObject<HTMLTextAreaElement | null>
  tools: ToolOption[]
}

export function Composer({ busy, onSend, onStop, inputRef, tools }: Props) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ToolOption | null>(null)
  const menu = useAnchoredPopover()
  const canSend = !busy && text.trim() !== ''
  // A tool switched off meanwhile can't be used any more.
  const tool =
    picked && tools.some((t) => t.name === picked.name) ? picked : null

  function submit() {
    if (!canSend) return
    onSend(text, tool?.name)
    setText('')
    setPicked(null)
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
      className={tools.length > 0 ? 'composer with-tools' : 'composer'}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {tools.length > 0 && (
        <>
          <button
            type="button"
            className="icon-button"
            aria-label="Choose a tool"
            title="Choose a tool"
            popoverTarget={menu.id}
            onClick={(e) => menu.place(e.currentTarget, { above: true })}
          >
            <Plus size={24} strokeWidth={1.5} />
          </button>
          <div
            id={menu.id}
            ref={menu.ref}
            popover="auto"
            className="menu"
            role="menu"
            style={menu.style}
          >
            {tools.map((option) => (
              <button
                key={option.name}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setPicked(option)
                  menu.hide()
                  inputRef.current?.focus()
                }}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
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
