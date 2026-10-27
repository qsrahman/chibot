import { useState } from 'react'
import { useNavigate } from 'react-router'
import { importConversation } from '../api.ts'
import { Row, Section } from './parts.tsx'

export function Data({
  onImported,
  onShowArchived,
}: {
  onImported: (id: string) => string
  onShowArchived: () => void
}) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <Section title="Chats">
        <Row
          label="Import a chat"
          description="A JSON file exported from a chat's menu."
          htmlFor="setting-import"
        >
          <label className="button">
            Choose file…
            <input
              id="setting-import"
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
                } catch (err) {
                  setError((err as Error).message)
                }
              }}
            />
          </label>
        </Row>
        <Row label="Archived chats">
          <button type="button" className="button" onClick={onShowArchived}>
            Manage
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
