import type { ProjectFile } from '../../shared/types.ts'

/** A file in the tree, under the name it has in its folder. */
export interface FileLeaf {
  file: ProjectFile
  label: string
}

export interface FolderNode {
  /** Where the folder is, from the top with `/` between parts: its key. */
  path: string
  /** What the list calls it: one folder, or a chain of them with nothing else in each (`src/server`). */
  label: string
  folders: FolderNode[]
  files: FileLeaf[]
  /** The files below it at any depth, and how many of those failed or are still being indexed. */
  total: number
  failed: number
  indexing: number
}

export interface FileTree {
  folders: FolderNode[]
  files: FileLeaf[]
}

interface Draft {
  name: string
  path: string
  folders: Map<string, Draft>
  files: FileLeaf[]
}

const draft = (name: string, path: string): Draft => ({
  name,
  path,
  folders: new Map(),
  files: [],
})

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, undefined, { numeric: true })

/**
 * Groups project files by the folders in their names (a folder that was added
 * or mirrored has paths like `docs/guide/intro.md`), folders first, each sorted
 * by name. A folder that holds only one other folder is joined with it, so a
 * deep chain is one row. Files without a folder come back as they are, so a
 * list with no folders stays a plain list.
 */
export function fileTree(files: ProjectFile[]): FileTree {
  const root = draft('', '')
  for (const file of files) {
    const parts = file.name.split('/').filter(Boolean)
    const label = parts.pop() ?? file.name
    let at = root
    for (const part of parts) {
      const path = at.path ? `${at.path}/${part}` : part
      let next = at.folders.get(part)
      if (!next) at.folders.set(part, (next = draft(part, path)))
      at = next
    }
    at.files.push({ file, label })
  }
  const done = [...root.folders.values()].map(finish).sort(byLabel)
  return { folders: done, files: root.files.sort(byLabel) }
}

function finish(node: Draft): FolderNode {
  const folders = [...node.folders.values()].map(finish).sort(byLabel)
  const only =
    folders.length === 1 && node.files.length === 0 ? folders[0] : null
  if (only) return { ...only, label: `${node.name}/${only.label}` }
  const all = [
    ...node.files.map((f) => f.file),
    ...folders.flatMap(function below(f): ProjectFile[] {
      return [...f.files.map((x) => x.file), ...f.folders.flatMap(below)]
    }),
  ]
  return {
    path: node.path,
    label: node.name,
    folders,
    files: node.files.sort(byLabel),
    total: all.length,
    failed: all.filter((f) => f.status === 'failed').length,
    indexing: all.filter((f) => f.status === 'indexing').length,
  }
}

/** The path of every folder in the tree (to open them all). */
export function folderPaths(tree: Pick<FileTree, 'folders'>): string[] {
  return tree.folders.flatMap((f) => [f.path, ...folderPaths(f)])
}
