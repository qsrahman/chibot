import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Link, NavLink, useMatch, useNavigate } from 'react-router'
import {
  Archive,
  Ellipsis,
  Keyboard,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import { ArchivedDialog } from './ArchivedDialog.tsx'
import { groupConversations } from './dates.ts'
import { DeleteChatDialog } from './Dialog.tsx'
import { SearchDialog } from './SearchDialog.tsx'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { SHORTCUTS, useShortcuts } from './shortcuts.ts'
import { UNTITLED, type ConversationsApi } from './useConversations.ts'

interface Props {
  collapsed: boolean
  onToggle: () => void
  conversations: ConversationsApi
}

export function Sidebar({ collapsed, onToggle, conversations }: Props) {
  const navigate = useNavigate()
  const openId = useMatch('/c/:id')?.params.id
  const [searchOpen, setSearchOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
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
    [SHORTCUTS.showShortcuts.keys]: (e) => {
      e.preventDefault()
      setShortcutsOpen(true)
    },
  })
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)

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
    <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
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
                    void conversations.update(item.id, { pinned: !item.pinned })
                  }
                  onArchive={() =>
                    void conversations.update(item.id, { archived: true })
                  }
                  onDelete={() => setToDelete(item)}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      <div className="sidebar-bottom">
        <SidebarButton
          icon={<Archive />}
          label="Archived chats"
          onClick={() => setArchivedOpen(true)}
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
      <DeleteChatDialog
        chat={toDelete}
        onDelete={(id) => void remove(id)}
        onClose={() => setToDelete(null)}
      />
    </nav>
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

interface RowProps {
  item: ConversationListItem
  onRename: (title: string) => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
}

function ConversationRow({
  item,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: RowProps) {
  const [editing, setEditing] = useState(false)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties>()
  const title = item.title ?? UNTITLED

  if (editing) {
    const finish = (value: string | null) => {
      setEditing(false)
      if (value !== null && value.trim() && value.trim() !== item.title) {
        onRename(value.trim())
      }
    }
    return (
      <input
        className="sidebar-rename"
        aria-label="Chat title"
        defaultValue={title}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value)
          if (e.key === 'Escape') finish(null)
        }}
      />
    )
  }

  // Runs before the popover opens. Anchor positioning isn't in every
  // browser yet, so the menu is placed from the trigger's position.
  function placeMenu(trigger: HTMLElement) {
    const r = trigger.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, left: r.left })
  }

  function act(action: () => void) {
    menuRef.current?.hidePopover()
    action()
  }

  return (
    <div className="conversation-row">
      <NavLink to={`/c/${item.id}`} className="sidebar-row" title={title}>
        <span className="row-label">{title}</span>
      </NavLink>
      <button
        type="button"
        className="row-menu-button"
        aria-label={`Options for ${title}`}
        popoverTarget={menuId}
        onClick={(e) => placeMenu(e.currentTarget)}
      >
        <Ellipsis size={18} strokeWidth={1.5} />
      </button>
      <div
        id={menuId}
        ref={menuRef}
        popover="auto"
        className="menu"
        style={menuPos}
      >
        <MenuItem icon={<Pencil />} onClick={() => act(() => setEditing(true))}>
          Rename
        </MenuItem>
        <MenuItem
          icon={item.pinned ? <PinOff /> : <Pin />}
          onClick={() => act(onPin)}
        >
          {item.pinned ? 'Unpin' : 'Pin'}
        </MenuItem>
        <MenuItem icon={<Archive />} onClick={() => act(onArchive)}>
          Archive
        </MenuItem>
        <hr className="menu-divider" />
        <MenuItem icon={<Trash2 />} danger onClick={() => act(onDelete)}>
          Delete
        </MenuItem>
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactElement
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={danger ? 'menu-item danger' : 'menu-item'}
      onClick={onClick}
    >
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  )
}
