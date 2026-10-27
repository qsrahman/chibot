import { useEffect, useRef, useState } from 'react'
import {
  Database,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { Dialog } from './Dialog.tsx'
import { withMember } from './mcp.ts'
import { Data } from './settings/Data.tsx'
import { General } from './settings/General.tsx'
import { McpServers } from './settings/McpServers.tsx'
import { Memory, Personalization } from './settings/Personalization.tsx'
import { Model } from './settings/Model.tsx'
import { Tools } from './settings/Tools.tsx'
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
