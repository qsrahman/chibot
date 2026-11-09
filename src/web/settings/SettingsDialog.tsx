import { useEffect, useRef, useState } from 'react'
import {
  Boxes,
  Database,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { Dialog } from '../ui/Dialog.tsx'
import { withMember } from './mcp.ts'
import { Data } from './Data.tsx'
import { General } from './General.tsx'
import { McpServers } from './McpServers.tsx'
import { Skills } from './Skills.tsx'
import { Memory, Personalization } from './Personalization.tsx'
import { Model } from './Model.tsx'
import { OtherModels } from './OtherModels.tsx'
import { Tools } from './Tools.tsx'
import type { SettingsApi } from './useSettings.ts'

const TABS = [
  { id: 'general', label: 'General', icon: <SettingsIcon /> },
  { id: 'personalization', label: 'Personalization', icon: <UserRound /> },
  { id: 'model', label: 'Model', icon: <Sparkles /> },
  { id: 'other-models', label: 'Other models', icon: <Boxes /> },
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

  // Settings that save as soon as they change say so briefly; Personalization
  // has its own Save button, and its own "Saved".
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(savedTimer.current), [])
  // Another tab is another subject.
  useEffect(() => setSaved(false), [tab])
  const save: SettingsApi['update'] = async (patch) => {
    const ok = await settings.update(patch)
    if (ok) {
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    }
    return ok
  }

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
          <div className="settings-flash" role="status">
            {saved && <span>Saved</span>}
          </div>
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
                    void save({
                      disabledTools: withMember(
                        current.disabledTools,
                        'memory',
                        !on,
                      ),
                    })
                  }
                  onManage={onShowMemories}
                />
              )}
            </>
          )}
          {tab === 'model' && current && settings.defaults && (
            <Model settings={current} onChange={save} />
          )}
          {tab === 'other-models' && current && settings.defaults && (
            <OtherModels
              settings={current}
              defaults={settings.defaults}
              endpoints={settings.endpoints}
              onChange={save}
            />
          )}
          {tab === 'tools' && current && (
            <>
              <Tools
                tools={settings.tools}
                disabled={current.disabledTools}
                onChange={save}
              />
              <Skills />
              <McpServers onToolsChanged={() => void settings.reloadTools()} />
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
