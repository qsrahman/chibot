/** `file` under the name `path` (the folder path it was found at). */
const named = (file: File, path: string) =>
  new File([file], path, { type: file.type, lastModified: file.lastModified })

/** The files of an `<input webkitdirectory>` or a plain pick, named by path. */
export const pickedFiles = (list: FileList | null): File[] =>
  [...(list ?? [])].map((file) =>
    file.webkitRelativePath ? named(file, file.webkitRelativePath) : file,
  )

/** The files of a drop, folders included, named by path. */
export async function droppedFiles(data: DataTransfer): Promise<File[]> {
  // The entries must be taken now: they are gone once the handler yields.
  const entries = [...data.items].flatMap((item) => {
    const entry = item.webkitGetAsEntry()
    return entry ? [entry] : []
  })
  if (entries.length === 0) return [...data.files]
  const found = await Promise.all(entries.map((entry) => walk(entry, '')))
  return found.flat()
}

async function walk(entry: FileSystemEntry, parent: string): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    return [parent ? named(file, `${parent}${entry.name}`) : file]
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  // A reader hands out its entries in batches, until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) break
    children.push(...batch)
  }
  const found = await Promise.all(
    children.map((child) => walk(child, `${parent}${entry.name}/`)),
  )
  return found.flat()
}
