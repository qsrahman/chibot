import { useEffect, useState } from 'react'
import type { Settings } from '../../shared/settings.ts'
import type { SettingsApi } from '../useSettings.ts'
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
    <Section title="Custom instructions">
      <div className="settings-field">
        <label htmlFor="setting-about">
          What should chibot know about you?
        </label>
        <textarea
          id="setting-about"
          maxLength={1500}
          value={aboutUser}
          onChange={(e) => setAboutUser(e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="setting-style">How should chibot respond?</label>
        <textarea
          id="setting-style"
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
          Save
        </button>
      </div>
    </Section>
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
        <button type="button" className="button" onClick={onManage}>
          Manage
        </button>
      </Row>
    </Section>
  )
}
