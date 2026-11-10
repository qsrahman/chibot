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
 * Why a file found in a folder is not taken, in words for the person who
 * wonders where it went, or `null` when it is: a type projects read, outside
 * folders like node_modules, and not huge. `path` is relative to the folder,
 * with `/` between its parts.
 */
export function whyLeftOut(path: string, size: number): string | null {
  if (
    path
      .split('/')
      .slice(0, -1)
      .some((dir) => IGNORED_FOLDERS.has(dir))
  ) {
    return 'in a folder that is skipped'
  }
  if (documentKind(path) === null) return "a type projects can't read"
  if (size > MAX_FILE_SIZE) return 'larger than 50 MB'
  return null
}

export const keepsFolderFile = (path: string, size: number): boolean =>
  whyLeftOut(path, size) === null
