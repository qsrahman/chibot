import { z } from 'zod'
import type { Conversation } from '../../shared/types.ts'
import type { ProjectIndex } from '../project-index.ts'
import type { ProjectStore } from '../project-store.ts'
import { Tool, type ToolContext } from '../tool.ts'
import { projectFile } from './project-files.ts'

/** Reads a project file in order, for questions about the whole of it. */
export class ReadProjectFileTool extends Tool {
  readonly name = 'read_project_file'
  readonly label = 'Read project files'
  override readonly group = 'Your chats and files'
  override readonly summary =
    "Reads a project's files in full, in that project's chats."
  override readonly running = 'Reading a project file…'
  override readonly done = 'Read a project file'
  readonly description =
    "Reads a file of this chat's project in order, a few parts at a time " +
    '(about 10,000 characters). Use it when the question is about the ' +
    'whole file (summaries, comparisons, lists of everything in it) or ' +
    'needs the text around a passage that search_project_files found. ' +
    'The result says how many parts the file has; ask for the next ones ' +
    'with from_part. Neighbouring parts overlap a little.'
  readonly parameters = z.object({
    file: z.string().describe("The file's name"),
    from_part: z
      .number()
      .int()
      .nullable()
      .describe('The part to start at (1 is the first), or null for the start'),
  })
  readonly #projects: ProjectStore
  readonly #index: ProjectIndex

  constructor(projects: ProjectStore, index: ProjectIndex) {
    super()
    this.#projects = projects
    this.#index = index
  }

  /** Where search is: project chats with files that were indexed. */
  override offeredIn({ projectId }: Conversation) {
    return (
      projectId !== null &&
      this.#projects.files(projectId).some((f) => f.status !== 'failed')
    )
  }

  async run(
    { file, from_part }: z.output<typeof this.parameters>,
    { projectId }: ToolContext,
  ) {
    if (!projectId) throw new Error('this chat is not in a project')
    const { fileId, name, status } = projectFile(
      this.#projects,
      projectId,
      file,
    )
    if (status === 'indexing') throw new Error(`${name} is still being indexed`)
    if (status === 'failed') throw new Error(`${name} could not be read`)
    return JSON.stringify({
      file: name,
      file_id: fileId,
      ...this.#index.read(projectId, fileId, from_part ?? 1),
    })
  }
}
