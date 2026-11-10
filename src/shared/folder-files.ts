import { documentKind } from './documents.ts'

// Folders that hold what a project's chats don't need: dependencies, builds,
// caches. (Hidden ones, with a name that starts with a dot, such as .git and
// .obsidian, are skipped whatever they are called: see `isHidden`.)
export const IGNORED_FOLDERS = new Set(
  `node_modules bower_components jspm_packages vendor Pods DerivedData
  site-packages __pycache__ __MACOSX venv dist build out target coverage`.split(
    /\s+/,
  ),
)

/** Hidden: a file or folder with a name that starts with a dot. */
export const isHidden = (name: string): boolean => name.startsWith('.')

/**
 * Whether a path inside a folder is, or is in, something a sync passes over
 * without a word: a hidden file or folder, or a folder such as node_modules.
 * Parts are split at `/` or `\`.
 */
export function skipsPath(path: string): boolean {
  return path
    .split(/[\\/]/)
    .some(
      (part) => part !== '' && (isHidden(part) || IGNORED_FOLDERS.has(part)),
    )
}

// Uploads are one request each; a folder bigger than this is probably a mistake.
export const MAX_FOLDER_FILES = 1000
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * Why a file found in a folder is not taken, in words for the person who
 * wonders where it went, or `null` when it is: a type projects read, not
 * hidden, outside folders like node_modules (or hidden ones), and not huge.
 * `path` is relative to the folder, with `/` between its parts.
 */
export function whyLeftOut(path: string, size: number): string | null {
  const parts = path.split('/')
  if (
    parts.slice(0, -1).some((dir) => isHidden(dir) || IGNORED_FOLDERS.has(dir))
  ) {
    return 'in a folder that is skipped'
  }
  if (isHidden(parts.at(-1)!)) return 'a hidden file'
  if (documentKind(path) === null) return "a type projects can't read"
  if (size > MAX_FILE_SIZE) return 'larger than 50 MB'
  return null
}

export const keepsFolderFile = (path: string, size: number): boolean =>
  whyLeftOut(path, size) === null
