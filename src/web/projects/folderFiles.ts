import { documentKind } from '../../shared/documents.ts'

// Folders that hold what a project's chats don't need: dependencies, builds,
// caches, version control.
const IGNORED = new Set(
  `node_modules .git .svn dist build out target .next .nuxt .cache coverage
  __pycache__ .venv venv .idea .gradle`.split(/\s+/),
)
// Uploads are one request each; a folder bigger than this is probably a mistake.
export const MAX_FOLDER_FILES = 1000
const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * Splits files into those to upload and the number to skip. Files that were
 * picked one by one (no folder in their name) are all kept, for the server to
 * judge; those found in a folder are kept when they are a type projects read,
 * outside folders like node_modules, and at most `MAX_FOLDER_FILES`.
 */
export function keepFolderFiles(files: File[]): {
  kept: File[]
  skipped: number
} {
  const kept = files.filter((file) => {
    const parts = file.name.split('/')
    if (parts.length === 1) return true
    return (
      !parts.slice(0, -1).some((dir) => IGNORED.has(dir)) &&
      documentKind(file.name) !== null &&
      file.size <= MAX_FILE_SIZE
    )
  })
  const capped = kept.slice(0, MAX_FOLDER_FILES)
  return { kept: capped, skipped: files.length - capped.length }
}
