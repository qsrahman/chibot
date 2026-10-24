import { useCallback, useEffect, useState, type DragEvent } from 'react'
import {
  Ellipsis,
  FileText,
  Folder,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { DOCUMENT_ACCEPT } from '../shared/documents.ts'
import type {
  ConversationListItem,
  ConversationPatch,
  Project,
  ProjectFile,
} from '../shared/types.ts'
import {
  addProjectFile,
  deleteConversation,
  getProject,
  removeProjectFile,
  updateConversation,
  updateProject,
} from './api.ts'
import { ConversationRow, MenuItem } from './ConversationRow.tsx'
import { ConfirmDialog, DeleteChatDialog } from './Dialog.tsx'
import { useAnchoredPopover } from './popover.ts'
import { ProjectNameDialog } from './ProjectDialogs.tsx'
import { useLoad } from './useLoad.ts'

/** The project page's heading: its name, rename and delete. */
export function ProjectHeading({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menu = useAnchoredPopover()
  // Rename and delete wait in a menu, like a chat's, so the page's most
  // visible control isn't a destructive one.
  const act = (action: () => void) => () => {
    menu.hide()
    action()
  }
  return (
    <div className="greeting project-heading">
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
        style={menu.style}
      >
        <MenuItem icon={<Pencil />} onClick={act(() => setRenaming(true))}>
          Rename
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          danger
          onClick={act(() => setDeleting(true))}
        >
          Delete project
        </MenuItem>
      </div>
      <ProjectNameDialog
        key={String(renaming)}
        open={renaming}
        title="Rename project"
        initial={project.name}
        confirmLabel="Rename"
        onConfirm={onRename}
        onClose={() => setRenaming(false)}
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

/**
 * Below the composer on the project page: files, instructions and chats.
 * `onChatsChanged`: a chat left the project (so the sidebar should reload).
 */
export function ProjectDetails({
  projectId,
  onChatsChanged,
}: {
  projectId: string
  onChatsChanged: () => void
}) {
  const {
    data: contents,
    error,
    reload,
    act,
  } = useLoad(useCallback(() => getProject(projectId), [projectId]))

  // Files are indexed in the background: check back until they're done.
  const indexing = contents?.files.some((f) => f.status === 'indexing')
  useEffect(() => {
    if (!indexing) return
    const timer = setTimeout(() => void reload(), 1500)
    return () => clearTimeout(timer)
  }, [indexing, contents, reload])

  if (!contents) {
    return error ? (
      <p className="error project-details" role="alert">
        {error}
      </p>
    ) : null
  }

  return (
    <div className="project-details">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Files
        files={contents.files}
        onAdd={(files) =>
          void act(async () => {
            for (const file of files) await addProjectFile(projectId, file)
          })
        }
        onRemove={(fileId) =>
          void act(() => removeProjectFile(projectId, fileId))
        }
      />
      <Instructions
        key={contents.project.instructions}
        instructions={contents.project.instructions}
        onSave={(instructions) =>
          void act(() => updateProject(projectId, { instructions }))
        }
      />
      <Chats
        chats={contents.conversations}
        onUpdate={(id, patch) =>
          void act(() => updateConversation(id, patch)).then(onChatsChanged)
        }
        onDelete={(id) => void act(() => deleteConversation(id))}
      />
    </div>
  )
}

function Files({
  files,
  onAdd,
  onRemove,
}: {
  files: ProjectFile[]
  onAdd: (files: File[]) => void
  onRemove: (fileId: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) onAdd([...e.dataTransfer.files])
  }
  return (
    <section
      className={dragging ? 'project-card dragging' : 'project-card'}
      aria-label="Project files"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <header>
        <h2>Files</h2>
        <label className="button">
          <Upload size={16} strokeWidth={1.5} aria-hidden />
          Add files
          <input
            type="file"
            multiple
            hidden
            accept={DOCUMENT_ACCEPT}
            aria-label="Add files"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])]
              e.target.value = ''
              if (picked.length) onAdd(picked)
            }}
          />
        </label>
      </header>
      {files.length === 0 ? (
        <p className="project-hint">
          PDFs, Word documents and text files (notes, code, data) that chats in
          this project can search. Drop them here.
        </p>
      ) : (
        <ul className="project-files">
          {files.map((file) => (
            <li key={file.fileId}>
              <FileText size={18} strokeWidth={1.5} aria-hidden />
              <a
                className="project-file-name"
                href={`/api/files/${file.fileId}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.name}
              </a>
              <span
                className={`file-status ${file.status}`}
                title={file.error ?? undefined}
              >
                {file.status === 'indexing'
                  ? 'Indexing…'
                  : file.status === 'failed'
                    ? `Failed: ${file.error}`
                    : file.error
                      ? 'Keywords only'
                      : 'Ready'}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                title="Remove"
                onClick={() => onRemove(file.fileId)}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Instructions({
  instructions,
  onSave,
}: {
  instructions: string
  onSave: (instructions: string) => void
}) {
  const [draft, setDraft] = useState(instructions)
  return (
    <section className="project-card" aria-label="Project instructions">
      <header>
        <h2>Instructions</h2>
        <button
          type="button"
          className="button primary"
          disabled={draft === instructions}
          onClick={() => onSave(draft)}
        >
          Save
        </button>
      </header>
      <textarea
        aria-label="Instructions"
        placeholder="How chibot should work in this project, e.g. “Answer in British English. Prices in yen.”"
        maxLength={8000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </section>
  )
}

function Chats({
  chats,
  onUpdate,
  onDelete,
}: {
  chats: ConversationListItem[]
  onUpdate: (id: string, patch: ConversationPatch) => void
  onDelete: (id: string) => void
}) {
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)
  if (chats.length === 0) return null
  return (
    <section className="project-chats" aria-label="Project chats">
      <h2>Chats</h2>
      {chats.map((item) => (
        <ConversationRow
          key={item.id}
          item={item}
          onRename={(title) => onUpdate(item.id, { title })}
          onPin={() => onUpdate(item.id, { pinned: !item.pinned })}
          onArchive={() => onUpdate(item.id, { archived: true })}
          onDelete={() => setToDelete(item)}
          onRemoveFromProject={() => onUpdate(item.id, { projectId: null })}
        />
      ))}
      <DeleteChatDialog
        chat={toDelete}
        onDelete={onDelete}
        onClose={() => setToDelete(null)}
      />
    </section>
  )
}
