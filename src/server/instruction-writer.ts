import type OpenAI from 'openai'
import {
  INSTRUCTION_WRITER_INSTRUCTIONS,
  instructionWriterInput,
} from './prompts.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'
import type { SettingsStore } from './settings-store.ts'

/** Thrown when there is nothing to base instructions on. */
export class NothingToSuggestFrom extends Error {}

/** Drafts a project's instructions from its files, with the chat model. */
export class InstructionWriter {
  readonly #client: OpenAI
  readonly #settings: SettingsStore
  readonly #projects: ProjectStore
  readonly #index: ProjectIndex

  constructor(
    client: OpenAI,
    settings: SettingsStore,
    projects: ProjectStore,
    index: ProjectIndex,
  ) {
    this.#client = client
    this.#settings = settings
    this.#projects = projects
    this.#index = index
  }

  /**
   * Instructions for the project, based on the start of each indexed file;
   * the user reviews them before they're saved.
   */
  async suggest(projectId: string, signal?: AbortSignal): Promise<string> {
    const project = this.#projects.get(projectId)
    if (!project) throw new Error('no such project')
    const excerpts = this.#index.excerpts(projectId)
    if (excerpts.length === 0) {
      throw new NothingToSuggestFrom(
        'Add a file first: suggestions are based on what is in the project’s files',
      )
    }
    const response = await this.#client.responses.create(
      {
        model: this.#settings.get().model,
        instructions: INSTRUCTION_WRITER_INSTRUCTIONS,
        input: instructionWriterInput(project, excerpts),
        store: false,
      },
      { signal },
    )
    const text = response.output_text.trim()
    if (!text) throw new Error('The model returned no instructions')
    return text.slice(0, 8000)
  }
}
