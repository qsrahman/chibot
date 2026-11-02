import { z } from 'zod'
import type { Conversation } from '../../shared/types.ts'
import {
  DEFAULT_RESULTS,
  MAX_RESULTS,
  type ProjectIndex,
} from '../project-index.ts'
import type { ProjectStore } from '../project-store.ts'
import { Tool, type ToolContext } from '../tool.ts'

// Every project file's name goes into the instructions of every request.
const MAX_LISTED_FILES = 50

/** The project's file called `name`, or an error listing the files. */
export function projectFile(
  projects: ProjectStore,
  projectId: string,
  name: string,
) {
  const file = projects.fileNamed(projectId, name)
  if (file) return file
  const names = projects.files(projectId).map((f) => f.name)
  throw new Error(
    `the project has no file called ${name}; its files are: ${names.join(', ')}`,
  )
}

/** Searches the files of the chat's project (local, hybrid search). */
export class SearchProjectFilesTool extends Tool {
  readonly name = 'search_project_files'
  readonly label = 'Search project files'
  override readonly group = 'Your chats and files'
  override readonly summary =
    "Searches a project's files, in that project's chats."
  override readonly running = 'Searching project files…'
  override readonly done = 'Searched project files'
  readonly description =
    "Searches the files of this chat's project and returns the passages " +
    'that best match, with their file names and where in the file they are ' +
    '(part n of m; PDF pages are marked "[Page n]" in the text). Use it ' +
    'whenever the question may be answered by the files, and ' +
    'read_project_file when you need more of a file around a passage. ' +
    'Cite the files you use, e.g. "(from notes.md)".'
  readonly parameters = z.object({
    query: z
      .string()
      .describe('What to look for: key words, names, or a short question'),
    file: z
      .string()
      .nullable()
      .describe('Only search this file (its name), or null for all files'),
    limit: z
      .number()
      .int()
      .nullable()
      .describe(
        `How many passages to return (1 to ${MAX_RESULTS}), or null for ${DEFAULT_RESULTS}. ` +
          'Ask for more when the answer may be spread over many places, or for a broad question.',
      ),
  })
  readonly #projects: ProjectStore
  readonly #index: ProjectIndex

  constructor(projects: ProjectStore, index: ProjectIndex) {
    super()
    this.#projects = projects
    this.#index = index
  }

  /** Only in project chats with files that could be indexed. */
  override offeredIn({ projectId }: Conversation) {
    return this.#searchable(projectId).length > 0
  }

  override instructions({ projectId }: Conversation) {
    const files = this.#searchable(projectId)
    const names = files.slice(0, MAX_LISTED_FILES).map((f) => f.name)
    if (files.length > names.length) {
      names.push(`and ${files.length - names.length} more`)
    }
    return (
      `The project's files, searchable with search_project_files and readable ` +
      `with read_project_file: ${names.join(', ')}. ` +
      'When they cover a question, answer from them rather than from general ' +
      'knowledge, and cite them.'
    )
  }

  async run(
    { query, file, limit }: z.output<typeof this.parameters>,
    { projectId, signal }: ToolContext,
  ) {
    if (!projectId) throw new Error('this chat is not in a project')
    const fileId = file
      ? projectFile(this.#projects, projectId, file).fileId
      : undefined
    const results = (
      await this.#index.search(projectId, query, {
        signal,
        fileId,
        limit: limit ?? undefined,
      })
    ).map(({ fileId, name, text, part, parts }) => ({
      file: name,
      file_id: fileId,
      part,
      parts,
      text,
    }))
    return JSON.stringify({ query, results })
  }

  #searchable(projectId: string | null) {
    if (!projectId) return []
    return this.#projects.files(projectId).filter((f) => f.status !== 'failed')
  }
}
