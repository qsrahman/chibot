import { useState } from 'react'
import { Folder } from 'lucide-react'
import type { Project } from '../shared/types.ts'
import { Dialog } from './Dialog.tsx'

/** Asks for a new project's name (also used to rename one). */
export function ProjectNameDialog({
  open,
  title,
  initial = '',
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  initial?: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const valid = name.trim() !== '' && name.trim() !== initial

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
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
