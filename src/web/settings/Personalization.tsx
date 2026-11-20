import { useEffect, useState } from 'react'
import { List, Save } from 'lucide-react'
import type { Settings } from '../../shared/settings.ts'
import type { SettingsApi } from './useSettings.ts'
import { IconButton } from '../ui/IconButton.tsx'
import { Row, Section } from './parts.tsx'

export function Personalization({
  settings,
  onSave,
}: {
  settings: Settings
  onSave: SettingsApi['update']
}) {
  const [aboutUser, setAboutUser] = useState(settings.aboutUser)
  const [responseStyle, setResponseStyle] = useState(settings.responseStyle)
  const [saved, setSaved] = useState(false)
  const dirty =
    aboutUser !== settings.aboutUser || responseStyle !== settings.responseStyle

  useEffect(() => {
    if (dirty) setSaved(false)
  }, [dirty])

  return (
    <>
      <Section title="Greeting">
        <NameRow settings={settings} onSave={onSave} />
      </Section>
      <Section title="Custom instructions">
        <div className="settings-field">
          <label htmlFor="setting-about">
            What should chibot know about you?
          </label>
          <textarea
            id="setting-about"
            dir="auto"
            maxLength={1500}
            value={aboutUser}
            onChange={(e) => setAboutUser(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="setting-style">How should chibot respond?</label>
          <textarea
            id="setting-style"
            dir="auto"
            maxLength={1500}
            value={responseStyle}
            onChange={(e) => setResponseStyle(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          {saved && <span className="settings-saved">Saved</span>}
          <button
            type="button"
            className="button primary"
            disabled={!dirty}
            onClick={async () =>
              setSaved(await onSave({ aboutUser, responseStyle }))
            }
          >
            <Save size={16} strokeWidth={1.5} aria-hidden /> Save
          </button>
        </div>
      </Section>
    </>
  )
}

/** What the greeting calls the user; saved when the box is left or Enter is pressed. */
function NameRow({
  settings,
  onSave,
}: {
  settings: Settings
  onSave: SettingsApi['update']
}) {
  const [draft, setDraft] = useState(settings.userName)

  function save() {
    const next = draft.trim()
    if (next !== settings.userName) void onSave({ userName: next })
  }

  return (
    <Row
      label="Your name"
      description="Shown in the greeting on a new chat. It stays in this chibot; the model is not told."
      htmlFor="setting-user-name"
    >
      <input
        id="setting-user-name"
        type="text"
        dir="auto"
        maxLength={60}
        value={draft}
        placeholder="Optional"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </Row>
  )
}

/** The memory tool's switch (also in Tools), and its memories. */
export function Memory({
  on,
  onChange,
  onManage,
}: {
  on: boolean
  onChange: (on: boolean) => void
  onManage: () => void
}) {
  return (
    <Section title="Memory">
      <Row
        label="Remember across chats"
        description="chibot saves facts and preferences you share, and uses them in new chats. Temporary chats don't use memory."
        htmlFor="setting-memory"
      >
        <input
          id="setting-memory"
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          onChange={(e) => onChange(e.target.checked)}
        />
      </Row>
      <Row label="Saved memories">
        <IconButton label="Manage memories" onClick={onManage}>
          <List size={18} strokeWidth={1.5} />
        </IconButton>
      </Row>
    </Section>
  )
}
