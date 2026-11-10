import { useRef, useState } from 'react'
import { Archive, Copy, Upload } from 'lucide-react'
import { useNavigate } from 'react-router'
import { importConversation } from '../conversations/api.ts'
import { IconButton } from '../ui/IconButton.tsx'
import { useToast } from '../ui/toast.tsx'
import { Row, Section } from './parts.tsx'
import { errorMessage } from '../../shared/errors.ts'

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
        >
          {/* A button, not a label around a hidden input: keyboards can't focus those. */}
          <IconButton
            label="Import a chat"
            onClick={() => picker.current?.click()}
          >
            <Upload size={18} strokeWidth={1.5} />
          </IconButton>
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
                setError(errorMessage(err))
              }
            }}
          />
        </Row>
        <Row label="Archived chats">
          <IconButton label="Manage archived chats" onClick={onShowArchived}>
            <Archive size={18} strokeWidth={1.5} />
          </IconButton>
        </Row>
      </Section>
      <Section title="Backup">
        <Row
          label="Back up everything"
          description="Run this in a terminal to copy all chats, files, memories and projects into a folder. “chibot restore <folder>” puts them back (with chibot stopped). Settings and keys are not included."
        >
          <IconButton
            label="Copy command"
            onClick={() =>
              navigator.clipboard.writeText('chibot backup').then(
                () => toast('Copied “chibot backup”'),
                () => toast('Could not copy', { kind: 'error' }),
              )
            }
          >
            <Copy size={18} strokeWidth={1.5} />
          </IconButton>
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
