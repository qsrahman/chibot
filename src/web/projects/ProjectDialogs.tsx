import { useState } from 'react'
import { Folder } from 'lucide-react'
import type { Project } from '../../shared/types.ts'
import { Dialog } from '../ui/Dialog.tsx'

/** Asks for a new project's name. */
export function ProjectNameDialog({
  open,
  title,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const valid = name.trim() !== ''

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onConfirm(name.trim())
          onClose()
        }}
      >
        <input
          className="dialog-input"
          aria-label="Project name"
          placeholder="e.g. Japan trip"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!valid}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Changes a project's name and description. */
export function ProjectDetailsDialog({
  open,
  project,
  onConfirm,
  onClose,
}: {
  open: boolean
  project: Project
  onConfirm: (patch: { name: string; description: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const valid =
    name.trim() !== '' &&
    (name.trim() !== project.name || description.trim() !== project.description)

  return (
    <Dialog open={open} onClose={onClose} title="Edit project">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onConfirm({ name: name.trim(), description: description.trim() })
          onClose()
        }}
      >
        <input
          className="dialog-input"
          aria-label="Project name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="dialog-input"
          aria-label="Description"
          placeholder="A line that tells it apart, e.g. Two weeks in April"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Picks the project to move a chat into. */
export function MoveToProjectDialog({
  open,
  projects,
  onMove,
  onClose,
}: {
  open: boolean
  projects: Project[]
  onMove: (projectId: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Move to project">
      {projects.length === 0 ? (
        <p className="dialog-body">
          There are no projects yet. Create one with “New project” in the
          sidebar.
        </p>
      ) : (
        <ul className="project-choices">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="sidebar-row"
                onClick={() => {
                  onMove(project.id)
                  onClose()
                }}
              >
                <span className="row-icon" aria-hidden>
                  <Folder />
                </span>
                <span className="row-label">{project.name}</span>
                {project.description && (
                  <span className="row-detail">{project.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/** Writes a note that is kept as a project file (Markdown) and searched with the rest. */
export function NoteDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean
  onConfirm: (file: File) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const valid = title.trim() !== '' && text.trim() !== ''

  return (
    <Dialog open={open} onClose={onClose} title="Add a note">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          // Slashes and the like would make an odd file name.
          const name = title.trim().replace(/[\\/:*?"<>|]+/g, ' ')
          onConfirm(
            new File([text.trim()], `${name}.md`, { type: 'text/markdown' }),
          )
          onClose()
        }}
      >
        <input
          className="dialog-input"
          aria-label="Note title"
          placeholder="Title, e.g. Door codes"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <textarea
          className="dialog-input note-text"
          aria-label="Note"
          placeholder="What chats in this project should know"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!valid}>
            Add note
          </button>
        </div>
      </form>
    </Dialog>
  )
}
