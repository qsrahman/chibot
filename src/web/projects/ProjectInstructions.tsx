import { useState } from 'react'
import { LoaderCircle, Pencil, Sparkles } from 'lucide-react'
import { IconButton } from '../ui/IconButton.tsx'

/**
 * What chats in the project are told. Shown as a preview with Edit (or a
 * prompt to add some), since they shape every answer; editing can start from
 * a draft written from the project's files.
 */
export function ProjectInstructions({
  instructions,
  canSuggest,
  onSuggest,
  onSave,
}: {
  instructions: string
  canSuggest: boolean
  onSuggest: () => Promise<string>
  onSave: (instructions: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(instructions)
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function suggest() {
    setSuggesting(true)
    setError(null)
    onSuggest().then(
      (text) => {
        setDraft(text)
        setSuggested(true)
        setSuggesting(false)
      },
      (err: Error) => {
        setError(err.message)
        setSuggesting(false)
      },
    )
  }

  const long = instructions.length > 240 || instructions.split('\n').length > 3
  return (
    <section
      className="project-card instructions"
      aria-label="Project instructions"
    >
      <header>
        <h2>Instructions</h2>
        {!editing && (
          <IconButton
            label={instructions ? 'Edit' : 'Add instructions'}
            onClick={() => setEditing(true)}
          >
            <Pencil size={18} strokeWidth={1.5} />
          </IconButton>
        )}
      </header>
      {editing ? (
        <>
          <textarea
            aria-label="Instructions"
            dir="auto"
            placeholder="How chibot should work in this project, e.g. “Answer in British English. Prices in yen.”"
            maxLength={8000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSuggested(false)
            }}
            autoFocus
          />
          {suggested && (
            <p className="project-hint">
              Drafted from your files. Check it before saving.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="instructions-actions">
            <IconButton
              label="Suggest from files"
              hint={
                canSuggest
                  ? 'Suggest from files: writes a draft with your chat model, from the start of each file (sent to it)'
                  : 'Add a file first: the draft is based on what is in the files'
              }
              disabled={!canSuggest || suggesting}
              onClick={suggest}
            >
              {suggesting ? (
                <LoaderCircle className="spin" size={18} aria-hidden />
              ) : (
                <Sparkles size={18} strokeWidth={1.5} />
              )}
            </IconButton>
            <span className="spacer" />
            <button
              type="button"
              className="button"
              onClick={() => {
                setEditing(false)
                setDraft(instructions)
                setSuggested(false)
                setError(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button primary"
              disabled={draft === instructions}
              onClick={() => onSave(draft)}
            >
              Save
            </button>
          </div>
        </>
      ) : instructions ? (
        <>
          <p
            className={
              expanded ? 'instructions-text' : 'instructions-text clamped'
            }
          >
            {instructions}
          </p>
          {long && (
            <button
              type="button"
              className="instructions-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((on) => !on)}
            >
              {expanded ? 'Show less' : 'Show all'}
            </button>
          )}
        </>
      ) : (
        <p className="project-hint">
          Tell chibot how to work in this project: the language, the tone, what
          the files are for. Every chat here follows them.
        </p>
      )}
    </section>
  )
}
