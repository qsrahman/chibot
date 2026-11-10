import { useState } from 'react'
import { Ellipsis, Folder, Pencil, Trash2 } from 'lucide-react'
import type { Project } from '../../shared/types.ts'
import { MenuItem } from '../conversations/ConversationRow.tsx'
import { ConfirmDialog } from '../ui/Dialog.tsx'
import { useAnchoredPopover } from '../ui/popover.ts'
import { ProjectDetailsDialog } from './ProjectDialogs.tsx'

/** The project page's heading: its name and description, edit and delete. */
export function ProjectHeading({
  project,
  onEdit,
  onDelete,
}: {
  project: Project
  onEdit: (patch: { name: string; description: string }) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menu = useAnchoredPopover()
  // Edit and delete wait in a menu, like a chat's, so the page's most
  // visible control isn't a destructive one.
  const act = (action: () => void) => () => {
    menu.hide()
    action()
  }
  return (
    <div className="greeting">
      <div className="project-heading">
        <h1>
          <Folder size={26} strokeWidth={1.5} aria-hidden />
          {project.name}
        </h1>
        <button
          type="button"
          className="icon-button"
          aria-label="Project options"
          title="Project options"
          popoverTarget={menu.id}
          style={menu.triggerStyle}
        >
          <Ellipsis size={20} strokeWidth={1.5} />
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
          <MenuItem icon={<Pencil />} onClick={act(() => setEditing(true))}>
            Edit
          </MenuItem>
          <MenuItem
            icon={<Trash2 />}
            danger
            onClick={act(() => setDeleting(true))}
          >
            Delete project
          </MenuItem>
        </div>
      </div>
      {project.description && (
        <p className="project-description">{project.description}</p>
      )}
      <ProjectDetailsDialog
        key={String(editing)}
        open={editing}
        project={project}
        onConfirm={onEdit}
        onClose={() => setEditing(false)}
      />
      <ConfirmDialog
        open={deleting}
        title="Delete project?"
        message={`This deletes "${project.name}" with its chats and files. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={onDelete}
        onClose={() => setDeleting(false)}
      />
    </div>
  )
}
