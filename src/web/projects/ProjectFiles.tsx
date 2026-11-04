import { useState, type DragEvent } from 'react'
import {
  FileText,
  FolderUp,
  NotebookPen,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import { DOCUMENT_ACCEPT } from '../../shared/documents.ts'
import type { ProjectFile } from '../../shared/types.ts'
import { droppedFiles, pickedFiles } from './folders.ts'
import { NoteDialog } from './ProjectDialogs.tsx'

/** The project's files: add (files, a folder, a note), index again, remove. */
export function ProjectFiles({
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
