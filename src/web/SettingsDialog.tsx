import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Database,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { effortLabel, REASONING_EFFORTS } from '../shared/reasoning.ts'
import type { Settings } from '../shared/settings.ts'
import type { McpServerStatus } from '../shared/types.ts'
import {
  importConversation,
  listMcpServers,
  reconnectMcpServer,
  signInToMcpServer,
  signOutOfMcpServer,
} from './api.ts'
import { Dialog } from './Dialog.tsx'
import { useColorScheme, type ColorScheme } from './theme.ts'
import { TOOL_GROUPS, TOOL_TEXT } from './tools.ts'
import { mcpToolName } from './turns.ts'
import { useLoad } from './useLoad.ts'
import type { SettingsApi } from './useSettings.ts'

const TABS = [
  { id: 'general', label: 'General', icon: <SettingsIcon /> },
  { id: 'personalization', label: 'Personalization', icon: <UserRound /> },
  { id: 'model', label: 'Model', icon: <Sparkles /> },
  { id: 'tools', label: 'Tools', icon: <Wrench /> },
  { id: 'data', label: 'Data', icon: <Database /> },
] as const
export type SettingsTab = (typeof TABS)[number]['id']

interface Props {
  open: boolean
  /** The tab to show on opening (else the last one). */
  startTab?: SettingsTab
  onClose: () => void
  settings: SettingsApi
  /** A chat was imported, so the sidebar list should reload. */
  onImported: () => void
  onShowArchived: () => void
  onShowMemories: () => void
}

/** Settings (DESIGN.md §4): tabs on the left, cards of rows on the right. */
export function SettingsDialog({
  open,
  startTab,
  onClose,
  settings,
  onImported,
  onShowArchived,
  onShowMemories,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const tabsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (open && startTab) setTab(startTab)
  }, [open, startTab])

  // On a phone the tabs are a scrolling row: keep the current one in sight.
  useEffect(() => {
    if (!open) return
    tabsRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [open, tab])
  const current = settings.settings

  return (
    <Dialog open={open} onClose={onClose} title="Settings" className="settings">
      <div className="settings-layout">
        <nav
          ref={tabsRef}
          className="settings-tabs"
          aria-label="Settings sections"
        >
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
            <>
              <Personalization settings={current} onSave={settings.update} />
              {settings.tools.some((tool) => tool.name === 'memory') && (
                <Memory
                  on={!current.disabledTools.includes('memory')}
                  onChange={(on) =>
                    void settings.update({
                      disabledTools: on
                        ? current.disabledTools.filter((n) => n !== 'memory')
                        : [...current.disabledTools, 'memory'],
                    })
                  }
                  onManage={onShowMemories}
                />
              )}
            </>
          )}
          {tab === 'model' && current && settings.defaults && (
            <Model
              settings={current}
              defaults={settings.defaults}
              onChange={settings.update}
            />
          )}
          {tab === 'tools' && current && (
            <>
              <Tools
                tools={settings.tools}
                disabled={current.disabledTools}
                onChange={settings.update}
              />
              <McpServers settings={current} onChange={settings.update} />
            </>
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
  unavailable = false,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  /** Greyed out: it can't be used (e.g. not set up). */
  unavailable?: boolean
  children: ReactNode
}) {
  return (
    <div className={unavailable ? 'settings-row unavailable' : 'settings-row'}>
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

/** The memory tool's switch (also in Tools), and its memories. */
function Memory({
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
            <option value="default">{effortLabel(null)}</option>
            {REASONING_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effortLabel(effort)}
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

function Tools({
  tools,
  disabled,
  onChange,
}: {
  tools: SettingsApi['tools']
  disabled: string[]
  onChange: SettingsApi['update']
}) {
  // MCP servers' tools (`<server>__<tool>`) are listed with their server.
  tools = tools.filter((tool) => !mcpToolName(tool.name))
  const offered = new Set(tools.map((tool) => tool.name))
  // Known tools the server doesn't offer are listed too, saying what's
  // missing, so they can be found.
  const missing = Object.entries(TOOL_TEXT).flatMap(([name, text]) =>
    !offered.has(name) && text.setup ? [{ name, text }] : [],
  )
  const order = Object.keys(TOOL_TEXT)
  const rank = (name: string) =>
    order.includes(name) ? order.indexOf(name) : order.length
  const groups = [...TOOL_GROUPS, 'Other'].map((group) => ({
    group,
    rows: [
      ...tools.flatMap((tool) =>
        (TOOL_TEXT[tool.name]?.group ?? 'Other') === group ? [tool] : [],
      ),
      ...missing.flatMap(({ name, text }) =>
        text.group === group ? [{ name, label: text.label }] : [],
      ),
    ].sort((a, b) => rank(a.name) - rank(b.name)),
  }))
  return (
    <>
      {tools.length === 0 && missing.length === 0 && (
        <p className="settings-empty">This server offers no tools.</p>
      )}
      {groups.map(
        ({ group, rows }) =>
          rows.length > 0 && (
            <Section key={group} title={group}>
              {rows.map(({ name, label }) => {
                const available = offered.has(name)
                return (
                  <Row
                    key={name}
                    label={TOOL_TEXT[name]?.label ?? label}
                    description={
                      available
                        ? TOOL_TEXT[name]?.description
                        : TOOL_TEXT[name]?.setup
                    }
                    htmlFor={`setting-tool-${name}`}
                    unavailable={!available}
                  >
                    <input
                      id={`setting-tool-${name}`}
                      type="checkbox"
                      role="switch"
                      className="switch"
                      disabled={!available}
                      checked={available && !disabled.includes(name)}
                      onChange={(e) =>
                        void onChange({
                          disabledTools: e.target.checked
                            ? disabled.filter((n) => n !== name)
                            : [...disabled, name],
                        })
                      }
                    />
                  </Row>
                )
              })}
            </Section>
          ),
      )}
    </>
  )
}

const MCP_STATE: Record<McpServerStatus['state'], string> = {
  disabled: 'Off',
  connecting: 'Connecting…',
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in',
  failed: 'Failed',
}

/** The servers in `mcp.json`: a switch, status and actions each, and tools. */
function McpServers({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: SettingsApi['update']
}) {
  const { data, error, reload, act } = useLoad(listMcpServers)
  const servers = data?.servers
  // Connecting settles within the server's 10 s timeout: check back.
  const connecting = servers?.some((s) => s.state === 'connecting')
  useEffect(() => {
    if (!connecting) return
    const timer = setInterval(() => void reload(), 1000)
    return () => clearInterval(timer)
  }, [connecting, reload])

  const {
    disabledMcpServers: off,
    askMcpServers: asking,
    disabledTools,
  } = settings
  const switchServer = (name: string, on: boolean) =>
    act(() =>
      onChange({
        disabledMcpServers: on ? off.filter((n) => n !== name) : [...off, name],
      }),
    )
  const signIn = (name: string) =>
    act(async () => {
      const { url } = await signInToMcpServer(name)
      if (url) location.assign(url)
    })

  if (!servers) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null
  }
  if (servers.length === 0) {
    return (
      <Section title="MCP servers">
        <p className="settings-empty">
          Add servers to mcp.json in chibot’s folder (mcp.example.json shows
          how), then restart chibot.
        </p>
      </Section>
    )
  }
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {servers.map((server) => {
        const status =
          server.state === 'connected'
            ? `Connected · ${server.tools.length} ${server.tools.length === 1 ? 'tool' : 'tools'}`
            : server.state === 'failed' && server.error
              ? `Failed: ${server.error}`
              : MCP_STATE[server.state]
        const kind = server.type === 'local' ? 'Local server' : 'Remote server'
        return (
          <Section key={server.name} title={`MCP · ${server.name}`}>
            <Row
              label={kind}
              description={status}
              htmlFor={`setting-mcp-${server.name}`}
            >
              <div className="settings-controls">
                {server.state === 'needs-sign-in' && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void signIn(server.name)}
                  >
                    Sign in
                  </button>
                )}
                {server.signedIn && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void act(() => signOutOfMcpServer(server.name))
                    }
                  >
                    Sign out
                  </button>
                )}
                {(server.state === 'failed' ||
                  server.state === 'connected') && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void act(() => reconnectMcpServer(server.name))
                    }
                  >
                    Reconnect
                  </button>
                )}
                <input
                  id={`setting-mcp-${server.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  aria-label={`Use ${server.name}`}
                  checked={server.state !== 'disabled'}
                  onChange={(e) =>
                    void switchServer(server.name, e.target.checked)
                  }
                />
              </div>
            </Row>
            {server.state !== 'disabled' && (
              <Row
                label="Ask before using its tools"
                description="Each call waits for your Approve or Deny."
                htmlFor={`setting-mcp-ask-${server.name}`}
              >
                <input
                  id={`setting-mcp-ask-${server.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={asking.includes(server.name)}
                  onChange={(e) =>
                    void onChange({
                      askMcpServers: e.target.checked
                        ? [...asking, server.name]
                        : asking.filter((n) => n !== server.name),
                    })
                  }
                />
              </Row>
            )}
            {server.tools.map((tool) => (
              <Row
                key={tool.name}
                label={tool.title}
                description={tool.description}
                htmlFor={`setting-tool-${tool.name}`}
              >
                <input
                  id={`setting-tool-${tool.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={!disabledTools.includes(tool.name)}
                  onChange={(e) =>
                    void onChange({
                      disabledTools: e.target.checked
                        ? disabledTools.filter((n) => n !== tool.name)
                        : [...disabledTools, tool.name],
                    })
                  }
                />
              </Row>
            ))}
          </Section>
        )
      })}
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
