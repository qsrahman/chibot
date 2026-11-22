import { useEffect, useRef, useState } from 'react'
import {
  useLocation,
  useMatch,
  useNavigate,
  useSearchParams,
} from 'react-router'
import { Keyboard, PanelLeft, Search, Settings, SquarePen } from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import { ArchivedDialog } from './conversations/ArchivedDialog.tsx'
import { ConversationRow } from './conversations/ConversationRow.tsx'
import { groupConversations } from './conversations/dates.ts'
import { DeleteChatDialog } from './conversations/DeleteChatDialog.tsx'
import {
  MoveToProjectDialog,
  ProjectNameDialog,
} from './projects/ProjectDialogs.tsx'
import { SearchDialog } from './conversations/SearchDialog.tsx'
import { SettingsDialog, type SettingsTab } from './settings/SettingsDialog.tsx'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { isTyping, SHORTCUTS, useShortcuts } from './ui/shortcuts.ts'
import { useToast } from './ui/toast.tsx'
import type { ConversationsApi } from './conversations/useConversations.ts'
import type { ProjectsApi } from './projects/useProjects.ts'
import type { SettingsApi } from './settings/useSettings.ts'
import { BrandMark } from './BrandMark.tsx'
import { SidebarButton } from './SidebarButton.tsx'
import { SidebarProjects } from './SidebarProjects.tsx'
import { useDrawerFocus } from './useDrawerFocus.ts'

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
  /** Opens the Memories dialog (kept by the App, which the chat also opens it from). */
  onShowMemories: () => void
}

export function Sidebar({
  collapsed,
  onToggle,
  drawer,
  onDismiss,
  conversations,
  projects,
  settings,
  onShowMemories,
}: Props) {
  const navigate = useNavigate()
  const nav = useRef<HTMLElement>(null)
  const open = drawer && !collapsed
  useDrawerFocus(open, nav)
  const openId = useMatch('/c/:id')?.params.id
  const { pathname } = useLocation()
  // Opening a chat (or a new one) closes the drawer.
  useEffect(() => {
    if (drawer) onDismiss()
  }, [pathname])
  const [searchOpen, setSearchOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
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
    [SHORTCUTS.showShortcutsHint.keys]: (e) => {
      if (isTyping(e.target)) return
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
          {!collapsed && <BrandMark />}
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
            <SidebarProjects
              projects={projects.projects}
              error={
                projects.error !== conversations.error ? projects.error : null
              }
              onNew={() => setNewProjectOpen(true)}
            />
            {conversations.loaded &&
              !conversations.error &&
              conversations.conversations.length === 0 && (
                <p className="sidebar-note">
                  No chats yet. Your conversations appear here.
                </p>
              )}
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
          onShowMemories={onShowMemories}
        />
        <ShortcutsDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
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
