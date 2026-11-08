import { useState, type DragEvent } from 'react'
import {
  FileText,
  FolderSync,
  FolderUp,
  NotebookPen,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import type { ProjectFile } from '../../shared/types.ts'
import { IconButton } from '../ui/IconButton.tsx'
import { FilePickerButton } from './FilePickerButton.tsx'
import { droppedFiles } from './folders.ts'
import { FolderDialog, NoteDialog } from './ProjectDialogs.tsx'

/**
 * The project's files: add (files, a folder, a note), mirror a folder, index
 * again, remove.
 */
export function ProjectFiles({
  files,
  folder,
  notice,
  onAdd,
  onLink,
  onSync,
  onUnlink,
  onRetry,
  onRemove,
}: {
  files: ProjectFile[]
  folder: string | null
  notice: string | null
  onAdd: (files: File[]) => void
  onLink: (path: string) => void
  onSync: () => void
  onUnlink: () => void
  onRetry: (fileId: string) => void
  onRemove: (fileId: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [noting, setNoting] = useState(false)
  const [linking, setLinking] = useState(false)
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
          <IconButton label="Add note" onClick={() => setNoting(true)}>
            <NotebookPen size={18} strokeWidth={1.5} />
          </IconButton>
          <FilePickerButton
            icon={<Upload size={18} strokeWidth={1.5} />}
            label="Add files"
            onPick={onAdd}
          />
          <FilePickerButton
            icon={<FolderUp size={18} strokeWidth={1.5} />}
            label="Add folder"
            folder
            onPick={onAdd}
          />
          <IconButton label="Mirror a folder" onClick={() => setLinking(true)}>
            <FolderSync size={18} strokeWidth={1.5} />
          </IconButton>
        </div>
      </header>
      <NoteDialog
        key={String(noting)}
        open={noting}
        onConfirm={(note) => onAdd([note])}
        onClose={() => setNoting(false)}
      />
      <FolderDialog
        key={String(linking)}
        open={linking}
        onConfirm={onLink}
        onClose={() => setLinking(false)}
      />
      {folder && (
        <p className="project-hint project-folder">
          Mirrors <code>{folder}</code>
          <button type="button" className="button" onClick={onSync}>
            Sync now
          </button>
          <button type="button" className="button" onClick={onUnlink}>
            Stop mirroring
          </button>
        </p>
      )}
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
