import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { importConversation } from '../conversations/api.ts'
import { useToast } from '../ui/toast.tsx'
import { Row, Section } from './parts.tsx'

export function Data({
  onImported,
  onShowArchived,
}: {
  onImported: (id: string) => string
  onShowArchived: () => void
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const picker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <Section title="Chats">
        <Row
          label="Import a chat"
          description="A JSON file exported from a chat's menu."
          htmlFor="setting-import"
        >
          {/* A button, not a label around a hidden input: keyboards can't focus those. */}
          <button
            id="setting-import"
            type="button"
            className="button"
            onClick={() => picker.current?.click()}
          >
            Choose file…
          </button>
          <input
            ref={picker}
            aria-label="Chat file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                const { id } = await importConversation(file)
                setError(null)
                navigate(`/c/${onImported(id)}`)
                toast('Chat imported')
              } catch (err) {
                setError((err as Error).message)
              }
            }}
          />
        </Row>
        <Row label="Archived chats">
          <button type="button" className="button" onClick={onShowArchived}>
            Manage
          </button>
        </Row>
      </Section>
      <Section title="Backup">
        <Row
          label="Back up everything"
          description="Run this in a terminal to copy all chats, files, memories and projects into a folder. “chibot restore <folder>” puts them back (with chibot stopped). Settings and keys are not included."
        >
          <button
            type="button"
            className="button"
            onClick={() =>
              navigator.clipboard.writeText('chibot backup').then(
                () => toast('Copied “chibot backup”'),
                () => toast('Could not copy'),
              )
            }
          >
            Copy command
          </button>
        </Row>
      </Section>
      {error && (
        <p className="error" role="alert">
          Import failed: {error}
        </p>
      )}
    </>
  )
}
