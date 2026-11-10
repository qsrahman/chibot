import { useState } from 'react'
import { FileText, Folder, RefreshCw, X } from 'lucide-react'
import type { ProjectFile } from '../../shared/types.ts'
import { Summary } from '../ui/Summary.tsx'
import {
  fileTree,
  folderPaths,
  type FileLeaf,
  type FolderNode,
} from './fileTree.ts'

interface Actions {
  onRetry: (fileId: string) => void
  onRemove: (fileId: string) => void
}

/**
 * The project's files: a plain list, or when their names have folders (a
 * folder that was added or mirrored) folders that open and close, all closed
 * to begin with so a long list stays short. What was opened stays open while
 * the list changes.
 */
export function ProjectFileTree({
  files,
  onRetry,
  onRemove,
}: { files: ProjectFile[] } & Actions) {
  const tree = fileTree(files)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const set = (path: string, on: boolean) =>
    setOpen((now) => {
      if (now.has(path) === on) return now
      const next = new Set(now)
      if (on) next.add(path)
      else next.delete(path)
      return next
    })
  const all = folderPaths(tree)
  const allOpen = all.length > 0 && all.every((path) => open.has(path))
  return (
    <>
      {all.length > 0 && (
        <button
          type="button"
          className="tree-toggle"
          onClick={() => setOpen(allOpen ? new Set() : new Set(all))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      )}
      <Branch
        folders={tree.folders}
        files={tree.files}
        open={open}
        onToggle={set}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    </>
  )
}

function Branch({
  folders,
  files,
  open,
  onToggle,
  onRetry,
  onRemove,
  nested = false,
}: {
  folders: FolderNode[]
  files: FileLeaf[]
  open: ReadonlySet<string>
  onToggle: (path: string, on: boolean) => void
  nested?: boolean
} & Actions) {
  return (
    <ul className={nested ? 'project-files nested' : 'project-files'}>
      {folders.map((folder) => (
        <li key={folder.path} className="tree-folder">
          <details
            open={open.has(folder.path)}
            onToggle={(e) => onToggle(folder.path, e.currentTarget.open)}
          >
            <Summary>
              <Folder size={18} strokeWidth={1.5} aria-hidden />
              <span className="tree-folder-name">{folder.label}</span>
              <FolderMeta folder={folder} />
            </Summary>
            <Branch
              nested
              folders={folder.folders}
              files={folder.files}
              open={open}
              onToggle={onToggle}
              onRetry={onRetry}
              onRemove={onRemove}
            />
          </details>
        </li>
      ))}
      {files.map(({ file, label }) => (
        <FileRow
          key={file.fileId}
          file={file}
          label={label}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}

/** How many files a folder holds, and whether any failed or are being indexed. */
function FolderMeta({ folder }: { folder: FolderNode }) {
  const parts = [`${folder.total} ${folder.total === 1 ? 'file' : 'files'}`]
  if (folder.indexing > 0) parts.push(`${folder.indexing} indexing`)
  return (
    <span className="tree-folder-meta">
      {parts.join(' · ')}
      {folder.failed > 0 && (
        <span className="file-status failed"> · {folder.failed} failed</span>
      )}
    </span>
  )
}

function FileRow({
  file,
  label,
  onRetry,
  onRemove,
}: { file: ProjectFile; label: string } & Actions) {
  return (
    <li>
      <FileText size={18} strokeWidth={1.5} aria-hidden />
      <a
        className="project-file-name"
        href={`/api/files/${file.fileId}`}
        target="_blank"
        rel="noreferrer"
        title={file.name}
      >
        {label}
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
  )
}
