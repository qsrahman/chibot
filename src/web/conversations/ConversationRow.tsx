import { useState } from 'react'
import { NavLink } from 'react-router'
import {
  Archive,
  Ellipsis,
  FileJson,
  FileText,
  FolderInput,
  FolderMinus,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ConversationListItem } from '../../shared/types.ts'
import { MenuItem } from '../ui/MenuItem.tsx'
import { exportUrl } from './api.ts'
import { useAnchoredPopover } from '../ui/popover.ts'
import { UNTITLED } from './useConversations.ts'

interface Props {
  item: ConversationListItem
  onRename: (title: string) => void
  /** Has the model name the chat again. */
  onRetitle: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  /** Offers "Move to project…" (chats in no project). */
  onMove?: () => void
  /** Offers "Remove from project" (chats in a project). */
  onRemoveFromProject?: () => void
}

/** A chat in the sidebar or a project, with its "…" menu. */
export function ConversationRow({
  item,
  onRename,
  onRetitle,
  onPin,
  onArchive,
  onDelete,
  onMove,
  onRemoveFromProject,
}: Props) {
  const [editing, setEditing] = useState(false)
  const menu = useAnchoredPopover()
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
        dir="auto"
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

  function act(action: () => void) {
    menu.hide()
    action()
  }

  return (
    <div className="conversation-row">
      <NavLink to={`/c/${item.id}`} className="sidebar-row" title={title}>
        <span className="row-label" dir="auto">
          {title}
        </span>
      </NavLink>
      <button
        type="button"
        className="row-menu-button"
        aria-label={`Options for ${title}`}
        title="Options"
        popoverTarget={menu.id}
        style={menu.triggerStyle}
      >
        <Ellipsis size={18} strokeWidth={1.5} />
      </button>
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu"
        role="menu"
        style={menu.style}
        {...menu.menuProps}
      >
        <MenuItem icon={<Pencil />} onClick={() => act(() => setEditing(true))}>
          Rename
        </MenuItem>
        <MenuItem icon={<Sparkles />} onClick={() => act(onRetitle)}>
          Regenerate title
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
        {onMove && (
          <MenuItem icon={<FolderInput />} onClick={() => act(onMove)}>
            Move to project…
          </MenuItem>
        )}
        {onRemoveFromProject && (
          <MenuItem
            icon={<FolderMinus />}
            onClick={() => act(onRemoveFromProject)}
          >
            Remove from project
          </MenuItem>
        )}
        <MenuItem
          icon={<FileText />}
          download={exportUrl(item.id, 'md')}
          onClick={menu.hide}
        >
          Export as Markdown
        </MenuItem>
        <MenuItem
          icon={<FileJson />}
          download={exportUrl(item.id, 'json')}
          onClick={menu.hide}
        >
          Export as JSON
        </MenuItem>
        <hr className="menu-divider" />
        <MenuItem icon={<Trash2 />} danger onClick={() => act(onDelete)}>
          Delete
        </MenuItem>
      </div>
    </div>
  )
}
