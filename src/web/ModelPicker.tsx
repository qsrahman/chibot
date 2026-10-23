import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { listModels } from './api.ts'
import { useAnchoredPopover } from './popover.ts'

interface Props {
  model: string
  defaultModel: string
  onSelect: (model: string) => void
}

/**
 * The header's model menu: searchable when the server lists its models,
 * a plain name field when it can't. Enter picks the top match, or the typed
 * name if nothing matches (for models the list doesn't show).
 */
export function ModelPicker({ model, defaultModel, onSelect }: Props) {
  const popover = useAnchoredPopover()
  // undefined: not loaded yet; null: the server can't list models.
  const [models, setModels] = useState<string[] | null>()
  const [query, setQuery] = useState('')

  function open() {
    setQuery('')
    if (models === undefined) {
      listModels().then(
        (res) => setModels(res.models),
        () => setModels(null),
      )
    }
  }

  function choose(id: string) {
    popover.hide()
    if (id.trim() && id !== model) onSelect(id.trim())
  }

  const q = query.trim().toLowerCase()
  const matches = (models ?? []).filter((id) => id.toLowerCase().includes(q))

  return (
    <>
      <button
        type="button"
        className="model-button"
        popoverTarget={popover.id}
        style={popover.triggerStyle}
        onClick={open}
      >
        {model}
        <ChevronDown size={16} strokeWidth={1.5} />
      </button>
      <div
        id={popover.id}
        ref={popover.ref}
        popover="auto"
        className="menu model-menu"
        style={popover.style}
        onToggle={(e) => {
          if (e.newState === 'open') {
            e.currentTarget.querySelector('input')?.focus()
          }
        }}
      >
        <input
          className="model-search"
          aria-label={models === null ? 'Model name' : 'Search models'}
          placeholder={models === null ? 'Model name' : 'Search models'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') choose(matches[0] ?? query)
          }}
        />
        {models === null && (
          <p className="menu-note">
            This server doesn’t list its models. Type a name and press Enter.
          </p>
        )}
        {models === undefined && <p className="menu-note">Loading…</p>}
        <div className="model-list" role="listbox" aria-label="Models">
          {matches.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === model}
              className="menu-item"
              onClick={() => choose(id)}
            >
              <span className="model-id">{id}</span>
              {id === defaultModel && (
                <span className="menu-hint">default</span>
              )}
              {id === model && <Check size={16} strokeWidth={1.5} />}
            </button>
          ))}
          {models && q && matches.length === 0 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => choose(query)}
            >
              Use “{query.trim()}”
            </button>
          )}
        </div>
      </div>
    </>
  )
}
