import { useCallback, useEffect, useState, type DragEvent } from 'react'
import {
  Ellipsis,
  FileText,
  Folder,
  FolderUp,
  LoaderCircle,
  NotebookPen,
  Pencil,
  RefreshCw,
  Sparkles,
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
  getProject,
  reindexProjectFile,
  removeProjectFile,
  suggestProjectInstructions,
  updateProject,
} from './projects/api.ts'
import {
  deleteConversation,
  regenerateTitle,
  updateConversation,
} from './conversations/api.ts'
import { ConversationRow, MenuItem } from './ConversationRow.tsx'
import { keepFolderFiles } from './folderFiles.ts'
import { droppedFiles, pickedFiles } from './folders.ts'
import { ConfirmDialog, DeleteChatDialog } from './Dialog.tsx'
import { useAnchoredPopover } from './popover.ts'
import { NoteDialog, ProjectDetailsDialog } from './ProjectDialogs.tsx'
import { useLoad } from './useLoad.ts'

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
          style={menu.style}
          {...menu.menuProps}
        >
          <MenuItem icon={<Pencil />} onClick={act(() => setEditing(true))}>
            Edit name and description
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
  // What an add did or is doing (not an error): progress, files skipped.
  const [notice, setNotice] = useState<string | null>(null)

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
      <Instructions
        key={contents.project.instructions}
        instructions={contents.project.instructions}
        canSuggest={contents.files.some((f) => f.status === 'ready')}
        onSuggest={() =>
          suggestProjectInstructions(projectId).then((r) => r.instructions)
        }
        onSave={(instructions) =>
          void act(() => updateProject(projectId, { instructions }))
        }
      />
      <Files
        files={contents.files}
        notice={notice}
        onAdd={(files) =>
          void act(async () => {
            const { kept, skipped } = keepFolderFiles(files)
            // One refused file (a duplicate) doesn't stop the rest.
            const refused: string[] = []
            for (const [i, file] of kept.entries()) {
              if (kept.length > 3) {
                setNotice(`Adding ${i + 1} of ${kept.length}…`)
              }
              await addProjectFile(projectId, file).catch((err: Error) =>
                refused.push(err.message),
              )
            }
            setNotice(
              skipped
                ? `Skipped ${skipped} of ${files.length} files: types projects can't read, or folders such as node_modules.`
                : null,
            )
            if (refused.length) {
              const shown = refused.slice(0, 3)
              if (refused.length > 3) {
                shown.push(`and ${refused.length - 3} more refused`)
              }
              throw new Error(shown.join('. '))
            }
          })
        }
        onRetry={(fileId) =>
          void act(() => reindexProjectFile(projectId, fileId))
        }
        onRemove={(fileId) =>
          void act(() => removeProjectFile(projectId, fileId))
        }
      />
      <Chats
        chats={contents.conversations}
        onUpdate={(id, patch) =>
          void act(() => updateConversation(id, patch)).then(onChatsChanged)
        }
        onRetitle={(id) =>
          void act(() => regenerateTitle(id)).then(onChatsChanged)
        }
        onDelete={(id) => void act(() => deleteConversation(id))}
      />
    </div>
  )
}

function Files({
  files,
  notice,
  onAdd,
  onRetry,
  onRemove,
}: {
  files: ProjectFile[]
  notice: string | null
  onAdd: (files: File[]) => void
  onRetry: (fileId: string) => void
  onRemove: (fileId: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [noting, setNoting] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    // Folders are read from the drop itself, so start before the handler ends.
    void droppedFiles(e.dataTransfer).then((dropped) => {
      if (dropped.length) onAdd(dropped)
    })
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
        <div className="project-card-actions">
          <button
            type="button"
            className="button"
            onClick={() => setNoting(true)}
          >
            <NotebookPen size={16} strokeWidth={1.5} aria-hidden />
            Add note
          </button>
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
                const picked = pickedFiles(e.target.files)
                e.target.value = ''
                if (picked.length) onAdd(picked)
              }}
            />
          </label>
          <label className="button">
            <FolderUp size={16} strokeWidth={1.5} aria-hidden />
            Add folder
            <input
              type="file"
              hidden
              aria-label="Add folder"
              // Not in React's types; Chrome, Edge, Firefox and Safari read it.
              {...{ webkitdirectory: '' }}
              onChange={(e) => {
                const picked = pickedFiles(e.target.files)
                e.target.value = ''
                if (picked.length) onAdd(picked)
              }}
            />
          </label>
        </div>
      </header>
      <NoteDialog
        key={String(noting)}
        open={noting}
        onConfirm={(note) => onAdd([note])}
        onClose={() => setNoting(false)}
      />
      {notice && <p className="project-hint">{notice}</p>}
      {files.length === 0 ? (
        <p className="project-hint">
          PDFs, Word documents and text files (notes, code, data) that chats in
          this project can search. Drop them here, or add a whole folder.
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
                    : (file.error ?? 'Ready')}
              </span>
              {file.status !== 'indexing' && file.error && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Index ${file.name} again`}
                  title="Index again"
                  onClick={() => onRetry(file.fileId)}
                >
                  <RefreshCw size={16} strokeWidth={1.5} />
                </button>
              )}
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

/**
 * What chats in the project are told. Shown as a preview with Edit (or a
 * prompt to add some), since they shape every answer; editing can start from
 * a draft written from the project's files.
 */
function Instructions({
  instructions,
  canSuggest,
  onSuggest,
  onSave,
}: {
  instructions: string
  canSuggest: boolean
  onSuggest: () => Promise<string>
  onSave: (instructions: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(instructions)
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function suggest() {
    setSuggesting(true)
    setError(null)
    onSuggest().then(
      (text) => {
        setDraft(text)
        setSuggested(true)
        setSuggesting(false)
      },
      (err: Error) => {
        setError(err.message)
        setSuggesting(false)
      },
    )
  }

  const long = instructions.length > 240 || instructions.split('\n').length > 3
  return (
    <section
      className="project-card instructions"
      aria-label="Project instructions"
    >
      <header>
        <h2>Instructions</h2>
        {!editing && (
          <button
            type="button"
            className="button"
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            {instructions ? 'Edit' : 'Add instructions'}
          </button>
        )}
      </header>
      {editing ? (
        <>
          <textarea
            aria-label="Instructions"
            placeholder="How chibot should work in this project, e.g. “Answer in British English. Prices in yen.”"
            maxLength={8000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSuggested(false)
            }}
            autoFocus
          />
          {suggested && (
            <p className="project-hint">
              Drafted from your files. Check it before saving.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="instructions-actions">
            <button
              type="button"
              className="button"
              disabled={!canSuggest || suggesting}
              title={
                canSuggest
                  ? 'Writes a draft with your chat model, from the start of each file (sent to it)'
                  : 'Add a file first: the draft is based on what is in the files'
              }
              onClick={suggest}
            >
              {suggesting ? (
                <LoaderCircle className="spin" size={16} aria-hidden />
              ) : (
                <Sparkles size={16} strokeWidth={1.5} aria-hidden />
              )}
              Suggest from files
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="button"
              onClick={() => {
                setEditing(false)
                setDraft(instructions)
                setSuggested(false)
                setError(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button primary"
              disabled={draft === instructions}
              onClick={() => onSave(draft)}
            >
              Save
            </button>
          </div>
        </>
      ) : instructions ? (
        <>
          <p
            className={
              expanded ? 'instructions-text' : 'instructions-text clamped'
            }
          >
            {instructions}
          </p>
          {long && (
            <button
              type="button"
              className="instructions-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((on) => !on)}
            >
              {expanded ? 'Show less' : 'Show all'}
            </button>
          )}
        </>
      ) : (
        <p className="project-hint">
          Tell chibot how to work in this project: the language, the tone, what
          the files are for. Every chat here follows them.
        </p>
      )}
    </section>
  )
}

function Chats({
  chats,
  onUpdate,
  onRetitle,
  onDelete,
}: {
  chats: ConversationListItem[]
  onUpdate: (id: string, patch: ConversationPatch) => void
  onRetitle: (id: string) => void
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
          onRetitle={() => onRetitle(item.id)}
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
