import { documentKind } from './documents.ts'

// Folders that hold what a project's chats don't need: dependencies, builds,
// caches, version control.
export const IGNORED_FOLDERS = new Set(
  `node_modules .git .svn dist build out target .next .nuxt .cache coverage
  __pycache__ .venv venv .idea .gradle`.split(/\s+/),
)
// Uploads are one request each; a folder bigger than this is probably a mistake.
export const MAX_FOLDER_FILES = 1000
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * Whether a file found in a folder is worth adding to a project: a type
 * projects read, outside folders like node_modules, and not huge. `path` is
 * relative to the folder, with `/` between its parts.
 */
export function keepsFolderFile(path: string, size: number): boolean {
  return (
    !path
      .split('/')
      .slice(0, -1)
      .some((dir) => IGNORED_FOLDERS.has(dir)) &&
    documentKind(path) !== null &&
    size <= MAX_FILE_SIZE
  )
}
