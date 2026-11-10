import { useCallback, useState } from 'react'
import { ArrowUp, Folder, House } from 'lucide-react'
import { IconButton } from '../ui/IconButton.tsx'
import { useLoad } from '../ui/useLoad.ts'
import { listFolders } from './api.ts'

// How many file names to show, as a taste of what is in the folder.
const SHOWN_FILES = 4

/**
 * Browses the folders of the machine chibot runs on, to choose the one a
 * project mirrors (the browser's own folder picker would hide where the folder
 * is). Starts at `start` (a path typed in the box), or at the home folder when
 * that isn't a folder.
 */
export function FolderBrowser({
  start,
  onChoose,
}: {
  start: string
  onChoose: (path: string) => void
}) {
  const [path, setPath] = useState(start.trim())
  const { data: listing, error } = useLoad(
    useCallback(() => listFolders(path), [path]),
  )
  const files = listing?.files ?? []
  return (
    <div className="folder-browser" role="group" aria-label="Choose a folder">
      <div className="folder-browser-bar">
        <IconButton
          label="Up one folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && setPath(listing.parent)}
        >
          <ArrowUp size={18} strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Home folder" onClick={() => setPath('')}>
          <House size={18} strokeWidth={1.5} />
        </IconButton>
        <code className="folder-browser-path" title={listing?.path}>
          {listing?.path ?? path}
        </code>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {listing && (
        <>
          <ul className="folder-browser-list">
            {listing.folders.map((folder) => (
              <li key={folder.path}>
                <button
                  type="button"
                  className="folder-browser-row"
                  onClick={() => setPath(folder.path)}
                >
                  <Folder size={18} strokeWidth={1.5} aria-hidden />
                  <span>{folder.name}</span>
                </button>
              </li>
            ))}
            {listing.folders.length === 0 && (
              <li className="project-hint folder-browser-empty">
                No folders here
              </li>
            )}
          </ul>
          <p className="project-hint">
            {files.length === 0
              ? 'No files here that a project can read.'
              : `${files.length} ${files.length === 1 ? 'file' : 'files'} here that a project can read: ${files.slice(0, SHOWN_FILES).join(', ')}${files.length > SHOWN_FILES ? ', …' : ''}`}
            {listing.more > 0 && ` (${listing.more} more not listed)`}
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => onChoose(listing.path)}
          >
            Use this folder
          </button>
        </>
      )}
    </div>
  )
}
