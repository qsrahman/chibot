import { useEffect, useState, type ReactElement } from 'react'
import { Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router'
import {
  Folder,
  FolderPlus,
  Keyboard,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import { ArchivedDialog } from './ArchivedDialog.tsx'
import { ConversationRow } from './ConversationRow.tsx'
import { MemoriesDialog } from './MemoriesDialog.tsx'
import { groupConversations } from './dates.ts'
import { DeleteChatDialog } from './Dialog.tsx'
import { MoveToProjectDialog, ProjectNameDialog } from './ProjectDialogs.tsx'
import { SearchDialog } from './SearchDialog.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { SHORTCUTS, useShortcuts } from './shortcuts.ts'
import type { ConversationsApi } from './useConversations.ts'
import type { ProjectsApi } from './useProjects.ts'
import type { SettingsApi } from './useSettings.ts'

interface Props {
  collapsed: boolean
  onToggle: () => void
  /** A drawer over the chat (phones), hidden while collapsed. */
  drawer: boolean
  /** Closes the drawer. */
  onDismiss: () => void
  conversations: ConversationsApi
  projects: ProjectsApi
  settings: SettingsApi
}

export function Sidebar({
  collapsed,
  onToggle,
  drawer,
  onDismiss,
  conversations,
  projects,
  settings,
}: Props) {
  const navigate = useNavigate()
  const openId = useMatch('/c/:id')?.params.id
  const { pathname } = useLocation()
  // Opening a chat (or a new one) closes the drawer.
  useEffect(() => {
    if (drawer) onDismiss()
  }, [pathname])
  const [searchOpen, setSearchOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useShortcuts({
    [SHORTCUTS.newChat.keys]: (e) => {
      e.preventDefault()
      navigate('/')
    },
    [SHORTCUTS.search.keys]: (e) => {
      e.preventDefault()
      setSearchOpen(true)
    },
    [SHORTCUTS.toggleSidebar.keys]: (e) => {
      e.preventDefault()
      onToggle()
    },
    [SHORTCUTS.settings.keys]: (e) => {
      e.preventDefault()
      setSettingsOpen(true)
    },
    [SHORTCUTS.showShortcuts.keys]: (e) => {
      e.preventDefault()
      setShortcutsOpen(true)
    },
  })
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)
  const [toMove, setToMove] = useState<ConversationListItem | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  async function addProject(name: string) {
    const id = await projects.create(name)
    if (id) navigate(`/projects/${id}`)
  }

  async function remove(id: string) {
    if ((await conversations.remove(id)) && id === openId) navigate('/')
  }

  const toolbar = (
    <>
      <SidebarButton icon={<SquarePen />} label="New chat" to="/" />
      <SidebarButton
        icon={<Search />}
        label="Search chats"
        onClick={() => setSearchOpen(true)}
      />
    </>
  )

  return (
    <>
      {drawer && !collapsed && (
        <div className="drawer-backdrop" aria-hidden onClick={onDismiss} />
      )}
      <nav
        className={['sidebar', collapsed && 'collapsed', drawer && 'drawer']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="sidebar-top">
          {!collapsed && <span className="brand">chibot</span>}
          <button
            type="button"
            className="icon-button"
            aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <PanelLeft size={20} strokeWidth={1.5} />
          </button>
        </div>
        {toolbar}

        {!collapsed && (
          <div className="sidebar-list">
            <section>
              <h3 className="sidebar-heading">Projects</h3>
              <SidebarButton
                icon={<FolderPlus />}
                label="New project"
                onClick={() => setNewProjectOpen(true)}
              />
              {projects.error && (
                <p className="sidebar-note">{projects.error}</p>
              )}
              {projects.projects.map((project) => (
                <NavLink
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="sidebar-row"
                  title={project.name}
                >
                  <span className="row-icon" aria-hidden>
                    <Folder />
                  </span>
                  <span className="row-label">{project.name}</span>
                </NavLink>
              ))}
            </section>
            {conversations.error && (
              <p className="sidebar-note">{conversations.error}</p>
            )}
            {groupConversations(conversations.conversations).map((group) => (
              <section key={group.label}>
                <h3 className="sidebar-heading">{group.label}</h3>
                {group.items.map((item) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    onRename={(title) =>
                      void conversations.update(item.id, { title })
                    }
                    onPin={() =>
                      void conversations.update(item.id, {
                        pinned: !item.pinned,
                      })
                    }
                    onArchive={() =>
                      void conversations.update(item.id, { archived: true })
                    }
                    onDelete={() => setToDelete(item)}
                    onMove={() => setToMove(item)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}

        <div className="sidebar-bottom">
          <SidebarButton
            icon={<Settings />}
            label="Settings"
            onClick={() => setSettingsOpen(true)}
          />
          <SidebarButton
            icon={<Keyboard />}
            label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          />
        </div>

        <SearchDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          recent={conversations.conversations}
        />
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onImported={conversations.refresh}
          onShowArchived={() => setArchivedOpen(true)}
          onShowMemories={() => setMemoriesOpen(true)}
        />
        <ShortcutsDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
        <MemoriesDialog
          open={memoriesOpen}
          onClose={() => setMemoriesOpen(false)}
        />
        <ArchivedDialog
          open={archivedOpen}
          onClose={() => setArchivedOpen(false)}
          onChanged={conversations.refresh}
          onDeleted={(id) => id === openId && navigate('/')}
        />
        <ProjectNameDialog
          key={String(newProjectOpen)}
          open={newProjectOpen}
          title="New project"
          confirmLabel="Create project"
          onConfirm={(name) => void addProject(name)}
          onClose={() => setNewProjectOpen(false)}
        />
        <MoveToProjectDialog
          open={toMove !== null}
          projects={projects.projects}
          onMove={(projectId) => {
            const id = toMove!.id
            void conversations.update(id, { projectId }).then((moved) => {
              // The open chat left the list: show where it went.
              if (moved && id === openId) navigate(`/projects/${projectId}`)
            })
          }}
          onClose={() => setToMove(null)}
        />
        <DeleteChatDialog
          chat={toDelete}
          onDelete={(id) => void remove(id)}
          onClose={() => setToDelete(null)}
        />
      </nav>
    </>
  )
}

/** A full-width row in the expanded sidebar, an icon in the collapsed rail. */
function SidebarButton({
  icon,
  label,
  to,
  onClick,
}: {
  icon: ReactElement
  label: string
  to?: string
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      <span className="row-label">{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className="sidebar-row" aria-label={label}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className="sidebar-row"
      aria-label={label}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
