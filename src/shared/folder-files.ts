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
const MAX_FILE_SIZE = 50 * 1024 * 1024

// Data and settings files named for what they hold, since their text would be
// sent to the model and embedding endpoints: secrets.yaml, aws-credentials.json,
// Google's client_secret_*.json and service account keys. Only these types, so a
// document or code about secrets (secrets.md, credentials.ts) is still taken.
const SECRET_NAME =
  /^(client_secret.*\.json|service[-_]?account.*\.json|([\w.-]*[-_.])?(secrets?|credentials?|passwords?)(\.[\w-]+)?\.(json|ya?ml|toml|ini|xml|properties|conf|cfg|txt|csv|tsv))$/i
// Written by tools: long, and no help in answering anything.
const GENERATED_NAME =
  /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml)$|\.min\.(js|mjs|cjs|css)$/i

/**
 * Why a file found in a folder is not taken, in words for the person who
 * wonders where it went, or `null` when it is: a type projects read, not
 * hidden, outside folders like node_modules (or hidden ones), not named as
 * secrets or generated, and not huge.
 * `path` is relative to the folder, with `/` between its parts.
 */
export function whyLeftOut(path: string, size: number): string | null {
  const parts = path.split('/')
  if (
    parts.slice(0, -1).some((dir) => isHidden(dir) || IGNORED_FOLDERS.has(dir))
  ) {
    return 'in a folder that is skipped'
  }
  const name = parts.at(-1)!
  if (isHidden(name)) return 'a hidden file'
  if (documentKind(path) === null) return "a type projects can't read"
  if (SECRET_NAME.test(name)) return 'its name says it may hold secrets'
  if (GENERATED_NAME.test(name)) return 'a lock or minified file'
  if (size > MAX_FILE_SIZE) return 'larger than 50 MB'
  return null
}

export const keepsFolderFile = (path: string, size: number): boolean =>
  whyLeftOut(path, size) === null
