import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Database,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { REASONING_EFFORTS } from '../shared/reasoning.ts'
import type { Settings } from '../shared/settings.ts'
import { importConversation } from './api.ts'
import { Dialog } from './Dialog.tsx'
import { useColorScheme, type ColorScheme } from './theme.ts'
import type { SettingsApi } from './useSettings.ts'

const TABS = [
  { id: 'general', label: 'General', icon: <SettingsIcon /> },
  { id: 'personalization', label: 'Personalization', icon: <UserRound /> },
  { id: 'model', label: 'Model', icon: <Sparkles /> },
  { id: 'data', label: 'Data', icon: <Database /> },
] as const
type Tab = (typeof TABS)[number]['id']

interface Props {
  open: boolean
  onClose: () => void
  settings: SettingsApi
  /** A chat was imported, so the sidebar list should reload. */
  onImported: () => void
  onShowArchived: () => void
}

/** Settings (DESIGN.md §4): tabs on the left, cards of rows on the right. */
export function SettingsDialog({
  open,
  onClose,
  settings,
  onImported,
  onShowArchived,
}: Props) {
  const [tab, setTab] = useState<Tab>('general')
  const current = settings.settings

  return (
    <Dialog open={open} onClose={onClose} title="Settings" className="settings">
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              className="sidebar-row"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <span className="row-icon" aria-hidden>
                {icon}
              </span>
              <span className="row-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          {settings.error && (
            <p className="error" role="alert">
              {settings.error}
            </p>
          )}
          {tab === 'general' && <General />}
          {tab === 'personalization' && current && (
            <Personalization settings={current} onSave={settings.update} />
          )}
          {tab === 'model' && current && settings.defaults && (
            <Model
              settings={current}
              defaults={settings.defaults}
              onChange={settings.update}
            />
          )}
          {tab === 'data' && (
            <Data
              onImported={(id) => {
                onImported()
                onClose()
                return id
              }}
              onShowArchived={onShowArchived}
            />
          )}
        </div>
      </div>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  )
}

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <label htmlFor={htmlFor}>{label}</label>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}

function General() {
  const { scheme, systemScheme, choose } = useColorScheme()
  const options: { value: ColorScheme; label: string }[] = [
    { value: null, label: `System (currently ${systemScheme})` },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]
  return (
    <Section title="Appearance">
      <Row label="Theme" htmlFor="setting-theme">
        <select
          id="setting-theme"
          value={scheme ?? 'system'}
          onChange={(e) =>
            choose(
              e.target.value === 'system'
                ? null
                : (e.target.value as 'light' | 'dark'),
            )
          }
        >
          {options.map(({ value, label }) => (
            <option key={label} value={value ?? 'system'}>
              {label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}

function Personalization({
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

function Model({
  settings,
  defaults,
  onChange,
}: {
  settings: Settings
  defaults: Settings
  onChange: SettingsApi['update']
}) {
  const threshold = settings.compactThreshold
  const [draft, setDraft] = useState(
    String(threshold ?? defaults.compactThreshold ?? 64_000),
  )

  function saveThreshold() {
    const value = Number(draft)
    if (Number.isInteger(value) && value >= 1000 && value !== threshold) {
      void onChange({ compactThreshold: value })
    } else {
      setDraft(String(threshold))
    }
  }

  return (
    <>
      <Section title="Reasoning">
        <Row
          label="Reasoning effort"
          description="How hard reasoning models think. Models without reasoning ignore it."
          htmlFor="setting-effort"
        >
          <select
            id="setting-effort"
            value={settings.reasoningEffort ?? 'default'}
            onChange={(e) =>
              void onChange({
                reasoningEffort:
                  e.target.value === 'default'
                    ? null
                    : (e.target.value as Settings['reasoningEffort']),
              })
            }
          >
            <option value="default">Model default</option>
            {REASONING_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Long chats">
        <Row
          label="Compact long chats"
          description="Summarizes earlier messages when a chat gets long, so it keeps working."
          htmlFor="setting-compact"
        >
          <input
            id="setting-compact"
            type="checkbox"
            role="switch"
            className="switch"
            checked={threshold !== null}
            onChange={(e) =>
              void onChange({
                compactThreshold: e.target.checked
                  ? Number(draft) || defaults.compactThreshold
                  : null,
              })
            }
          />
        </Row>
        {threshold !== null && (
          <Row
            label="Compact after"
            description="Tokens of context before compacting."
            htmlFor="setting-threshold"
          >
            <input
              id="setting-threshold"
              className="settings-number"
              type="number"
              min={1000}
              step={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveThreshold}
              onKeyDown={(e) => e.key === 'Enter' && saveThreshold()}
            />
          </Row>
        )}
      </Section>
    </>
  )
}

function Data({
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
