import type { FolderSync } from '../../shared/types.ts'
import { keepsFolderFile, MAX_FOLDER_FILES } from '../../shared/folder-files.ts'

export { MAX_FOLDER_FILES }

/**
 * Splits files into those to upload and the number to skip. Files that were
 * picked one by one (no folder in their name) are all kept, for the server to
 * judge; those found in a folder are kept when `keepsFolderFile` says so, and
 * at most `MAX_FOLDER_FILES`.
 */
export function keepFolderFiles(files: File[]): {
  kept: File[]
  skipped: number
} {
  const kept = files.filter(
    (file) => !file.name.includes('/') || keepsFolderFile(file.name, file.size),
  )
  const capped = kept.slice(0, MAX_FOLDER_FILES)
  return { kept: capped, skipped: files.length - capped.length }
}

/** What a sync did, in a line; `null` when it changed nothing. */
export function syncNotice({ added, updated, removed }: FolderSync) {
  const parts = [
    added && `${added} added`,
    updated && `${updated} updated`,
    removed && `${removed} removed`,
  ].filter(Boolean)
  return parts.length ? `Folder synced: ${parts.join(', ')}.` : null
}
