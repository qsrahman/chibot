import { z } from 'zod'
import type { Conversation } from '../../shared/types.ts'
import type { ProjectIndex } from '../project-index.ts'
import type { ProjectStore } from '../project-store.ts'
import { Tool, type ToolContext } from '../tool.ts'

/** Searches the files of the chat's project (local, hybrid search). */
export class SearchProjectFilesTool extends Tool {
  readonly name = 'search_project_files'
  readonly label = 'Search project files'
  readonly description =
    "Searches the files of this chat's project and returns the passages " +
    'that best match, with their file names. Use it whenever the question ' +
    'may be answered by the files. Cite the files you use, e.g. "(from ' +
    'notes.md)".'
  readonly parameters = z.object({
    query: z
      .string()
      .describe('What to look for: key words, names, or a short question'),
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
    const names = this.#searchable(projectId).map((f) => f.name)
    return (
      `The project's files, searchable with search_project_files: ${names.join(', ')}. ` +
      'When they cover a question, answer from them rather than from general ' +
      'knowledge, and cite them.'
    )
  }

  async run({ query }: { query: string }, { projectId, signal }: ToolContext) {
    if (!projectId) throw new Error('this chat is not in a project')
    const results = (await this.#index.search(projectId, query, signal)).map(
      ({ fileId, name, text }) => ({ file: name, file_id: fileId, text }),
    )
    return JSON.stringify({ query, results })
  }

  #searchable(projectId: string | null) {
    if (!projectId) return []
    return this.#projects.files(projectId).filter((f) => f.status !== 'failed')
  }
}
