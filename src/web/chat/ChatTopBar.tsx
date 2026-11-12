import { Link } from 'react-router'
import { MessageCircleDashed, PanelLeft } from 'lucide-react'
import type { Health, Project } from '../../shared/types.ts'
import type { SettingsApi } from '../settings/useSettings.ts'
import { ModelPicker } from './ModelPicker.tsx'
import type { describeUsage } from './usage.ts'

/** The chat's header: the model, and what the chat is or has used. */
export function ChatTopBar({
  id,
  projectHome,
  project,
  pageTitle,
  health,
  settings,
  usage,
  temporary,
  temporaryMode,
  onToggleTemporary,
  onOpenSidebar,
}: {
  /** The open chat, if any. */
  id: string | undefined
  /** A project's page (where a new chat starts in the project). */
  projectHome: string | undefined
  project: Project | undefined
  pageTitle: string | null | undefined
  health: Health | undefined
  settings: SettingsApi
  usage: ReturnType<typeof describeUsage>
  temporary: boolean
  /** The new-chat toggle (before the first message). */
  temporaryMode: boolean
  onToggleTemporary: () => void
  /** On phones while the sidebar is hidden: a header button opens it. */
  onOpenSidebar?: () => void
}) {
  return (
    <header className="topbar">
      <span className="topbar-start">
        {onOpenSidebar && (
          <button
            type="button"
            className="icon-button"
            aria-label="Open sidebar"
            title="Open sidebar"
            onClick={onOpenSidebar}
          >
            <PanelLeft size={20} strokeWidth={1.5} />
          </button>
        )}
        {id && project && (
          <Link className="breadcrumb" to={`/projects/${project.id}`}>
            {project.name} /
          </Link>
        )}
        {/* Phones only: with the sidebar hidden, say which chat this is. */}
        {id && pageTitle && (
          <span className="topbar-title" dir="auto" title={pageTitle}>
            {pageTitle}
          </span>
        )}
        {!health ? (
          <span className="model">Server unreachable</span>
        ) : settings.settings && settings.defaults ? (
          <span title={health.baseURL ?? 'OpenAI'}>
            <ModelPicker
              model={settings.settings.model}
              defaultModel={settings.defaults.model}
              onSelect={(model) => void settings.update({ model })}
            />
          </span>
        ) : null}
      </span>
      {projectHome ? null : id ? (
        <span className="topbar-info">
          {usage && (
            <span
              className="usage"
              title={`This chat, all versions: ${usage.detail}`}
            >
              {usage.short}
            </span>
          )}
          {temporary && (
            <span
              className="badge"
              title="Not saved: this chat is deleted when you leave it"
            >
              Temporary chat
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          className={temporaryMode ? 'icon-button active' : 'icon-button'}
          aria-label="Temporary chat"
          aria-pressed={temporaryMode}
          title="Temporary chat"
          onClick={onToggleTemporary}
        >
          <MessageCircleDashed size={20} strokeWidth={1.5} />
        </button>
      )}
    </header>
  )
}
