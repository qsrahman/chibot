import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Link,
  NavLink,
  useLocation,
  useMatch,
  useNavigate,
  useSearchParams,
} from 'react-router'
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
import { ArchivedDialog } from './conversations/ArchivedDialog.tsx'
import { ConversationRow } from './conversations/ConversationRow.tsx'
import { MemoriesDialog } from './settings/MemoriesDialog.tsx'
import { groupConversations } from './conversations/dates.ts'
import { DeleteChatDialog } from './conversations/DeleteChatDialog.tsx'
import {
  MoveToProjectDialog,
  ProjectNameDialog,
} from './projects/ProjectDialogs.tsx'
import { SearchDialog } from './conversations/SearchDialog.tsx'
import { SettingsDialog, type SettingsTab } from './settings/SettingsDialog.tsx'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { SHORTCUTS, useShortcuts } from './ui/shortcuts.ts'
import { useToast } from './ui/toast.tsx'
import type { ConversationsApi } from './conversations/useConversations.ts'
import type { ProjectsApi } from './projects/useProjects.ts'
import type { SettingsApi } from './settings/useSettings.ts'

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
  const nav = useRef<HTMLElement>(null)
  // The phone drawer covers the page like a dialog: focus moves into it, and
  // back to what opened it once it closes (the page behind is inert, and
  // Escape closes it: see App and the nav's onKeyDown).
  const open = drawer && !collapsed
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    nav.current?.querySelector<HTMLElement>('button, a[href]')?.focus()
    return () => {
      // Unless something else has taken focus meanwhile (a chat opened).
      // Hiding the drawer has usually sent it to the page by now.
      const active = document.activeElement
      const free =
        !active || active === document.body || nav.current?.contains(active)
      if (opener instanceof HTMLElement && opener.isConnected && free) {
        opener.focus()
      }
    }
  }, [open])
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>()
  // Back from an MCP server's sign-in (`/?settings=tools`).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('settings') !== 'tools') return
    setSettingsTab('tools')
    setSettingsOpen(true)
    setSearchParams({}, { replace: true })
  }, [searchParams])
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
  const { toast } = useToast()
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)
  const [toMove, setToMove] = useState<ConversationListItem | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  async function addProject(name: string) {
    const id = await projects.create(name)
    if (id) navigate(`/projects/${id}`)
  }

  async function remove(id: string) {
    if (!(await conversations.remove(id))) return
    toast('Chat deleted')
    if (id === openId) navigate('/')
  }

  // Archiving can be undone at once; deleting can't, so that one asks first.
  async function archive(id: string) {
    if (!(await conversations.update(id, { archived: true }))) return
    toast('Chat archived', {
      action: {
        label: 'Undo',
        onClick: () => void conversations.update(id, { archived: false }),
      },
    })
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
        ref={nav}
        className={['sidebar', collapsed && 'collapsed', drawer && 'drawer']
          .filter(Boolean)
          .join(' ')}
        // In the capture phase: an open menu or dialog closes itself on Escape
        // before the event bubbles back, and would no longer be open to be seen.
        onKeyDownCapture={(e) => {
          // A menu or dialog of the drawer takes its own Escape first (focus
          // may still be on the button that opened a menu, so look for any
          // that is open).
          const covered = e.currentTarget.querySelector(
            ':popover-open, dialog[open]',
          )
          if (open && e.key === 'Escape' && !covered) {
            // Not also the shortcut for Stop, which listens on the window.
            e.stopPropagation()
            onDismiss()
          }
        }}
      >
        <div className="sidebar-top">
          {!collapsed && (
            <span className="brand">
              <svg
                className="brand-mark"
                viewBox="0 0 32 32"
                aria-hidden="true"
              >
                <g
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3.2}
                  strokeLinecap="round"
                >
                  <path d="M8.5 7.5C11.8 7.7 15 10.5 15 17V25" />
                  <path d="M15 18C15 12.5 18.8 9.5 21.5 9.5" />
                </g>
                <circle className="bead" cx="23.7" cy="9.5" r="2.5" />
              </svg>
              chibot
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
            title={collapsed ? 'Open sidebar' : 'Close sidebar'}
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
              {/* Labels, not headings: the sidebar comes before the page's own
                  heading, and its groups would be the first outline a screen
                  reader lists. */}
              <p className="sidebar-heading">Projects</p>
              <SidebarButton
                icon={<FolderPlus />}
                label="New project"
                onClick={() => setNewProjectOpen(true)}
              />
              {/* One message when the server is down, under the chats. */}
              {projects.error && projects.error !== conversations.error && (
                <p className="sidebar-note">{projects.error}</p>
              )}
              {projects.projects.map((project) => (
                <NavLink
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="sidebar-row"
                  title={
                    project.description
                      ? `${project.name}: ${project.description}`
                      : project.name
                  }
                >
                  <span className="row-icon" aria-hidden>
                    <Folder />
                  </span>
                  <span className="row-label">{project.name}</span>
                </NavLink>
              ))}
            </section>
            {conversations.error && (
              <p className="sidebar-note" role="alert">
                {conversations.error}{' '}
                <button
                  type="button"
                  className="sidebar-note-action"
                  onClick={() => {
                    void conversations.refresh()
                    void projects.refresh()
                  }}
                >
                  Try again
                </button>
              </p>
            )}
            {groupConversations(conversations.conversations).map((group) => (
              <section key={group.label}>
                <p className="sidebar-heading">{group.label}</p>
                {group.items.map((item) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    onRename={(title) =>
                      void conversations.update(item.id, { title })
                    }
                    onRetitle={() => void conversations.retitle(item.id)}
                    onPin={() =>
                      void conversations.update(item.id, {
                        pinned: !item.pinned,
                      })
                    }
                    onArchive={() => void archive(item.id)}
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
            className="keyboard-only"
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
          startTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsTab(undefined)
          }}
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
  className,
  onClick,
}: {
  icon: ReactElement
  label: string
  to?: string
  className?: string
  onClick?: () => void
}) {
  const classes = className ? `sidebar-row ${className}` : 'sidebar-row'
  const content = (
    <>
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      <span className="row-label">{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className={classes} aria-label={label} title={label}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={classes}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
