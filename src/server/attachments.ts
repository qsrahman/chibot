import OpenAI, { toFile } from 'openai'
import type {
  ResponseInputContent,
  ResponseInputItem,
} from 'openai/resources/responses/responses'
import { fileKind } from '../shared/documents.ts'
import type { StoredFile } from '../shared/types.ts'
import type { FileStore } from './file-store.ts'
import { documentText } from './text.ts'

// Provider copies expire on their own; a lost copy is uploaded again.
const EXPIRES_AFTER = 30 * 24 * 60 * 60
// A document's text sent in place of the file (about 50k tokens).
const MAX_TEXT = 200_000

/** How a model takes documents: as files, or as their extracted text. */
type DocumentMode = 'file' | 'text'

/**
 * Attachments in messages, stored as `input_image` / `input_file` parts that
 * point at chibot's own file ids. Before each request they're resolved to
 * what the server takes: a Files API id (uploaded once), inline base64 when
 * there's no Files API, or (documents, for models that reject files) their
 * extracted text.
 */
export class Attachments {
  readonly #client: OpenAI
  readonly #files: FileStore
  /** `false` once the server answered 404 to an upload (no Files API). */
  #filesApi = true
  /** Models that rejected files, so get documents as text. */
  readonly #textModels = new Set<string>()
  readonly #texts = new Map<string, string>()

  constructor(client: OpenAI, files: FileStore) {
    this.#client = client
    this.#files = files
  }

  /**
   * Deletes the files of deleted conversations (see `FileStore.deleteOrphans`)
   * and, best effort in the background, their copies at the provider. (Those
   * also expire on their own.)
   */
  deleteOrphans(): void {
    for (const id of this.#files.deleteOrphans()) {
      this.#client.files.delete(id).catch((err: unknown) => {
        console.error(`Deleting the provider's copy ${id} failed:`, err)
      })
    }
  }

  /** The stored parts for files attached to a message. */
  parts(fileIds: string[]): ResponseInputContent[] {
    return fileIds.map((id) => {
      const file = this.#files.get(id)!
      return fileKind(file.name)?.kind === 'image'
        ? { type: 'input_image', file_id: id, detail: 'auto' }
        : { type: 'input_file', file_id: id, filename: file.name }
    })
  }

  /** Whether `input` attaches documents that `model` would get as files. */
  sendsFiles(input: ResponseInputItem[], model: string): boolean {
    return (
      !this.#textModels.has(model) &&
      attached(input).some((part) => part.type === 'input_file')
    )
  }

  /** Whether `input` attaches images (which some models can't see). */
  sendsImages(input: ResponseInputItem[]): boolean {
    return attached(input).some((part) => part.type === 'input_image')
  }

  /** From now on, `model` gets documents as their text. */
  useText(model: string) {
    this.#textModels.add(model)
  }

  /** Whether `input` attaches files the provider holds copies of. */
  uploaded(input: ResponseInputItem[]): boolean {
    return attached(input).some(
      ({ file_id }) => file_id && this.#files.get(file_id)?.providerFileId,
    )
  }

  /** Forgets the provider copies of `input`'s files (e.g. lost: 404). */
  forgetUploads(input: ResponseInputItem[]) {
    for (const { file_id } of attached(input)) {
      if (file_id) this.#files.setProviderId(file_id, null)
    }
  }

  /** `input` with chibot's file ids resolved for `model` (see the class). */
  async resolve(
    input: ResponseInputItem[],
    model: string,
  ): Promise<ResponseInputItem[]> {
    const mode: DocumentMode = this.#textModels.has(model) ? 'text' : 'file'
    return Promise.all(
      input.map(async (item) =>
        'role' in item && item.role === 'user' && Array.isArray(item.content)
          ? {
              ...item,
              content: await Promise.all(
                item.content.map((part) => this.#resolvePart(part, mode)),
              ),
            }
          : item,
      ),
    )
  }

  async #resolvePart(
    part: ResponseInputContent,
    mode: DocumentMode,
  ): Promise<ResponseInputContent> {
    if (part.type === 'input_text' || !part.file_id) return part
    const file = this.#files.get(part.file_id)
    if (!file) return part // not one of ours
    if (part.type === 'input_file' && mode === 'text') {
      return {
        type: 'input_text',
        text: `Attached file ${file.name}:\n\n${await this.#text(file)}`,
      }
    }
    const providerId = await this.#upload(file)
    if (providerId) {
      // OpenAI refuses `filename` beside `file_id` (mutually exclusive).
      return part.type === 'input_image'
        ? { ...part, file_id: providerId }
        : { type: 'input_file', file_id: providerId }
    }
    const data = `data:${file.mime};base64,${this.#files.read(file.id).toString('base64')}`
    return part.type === 'input_image'
      ? { type: 'input_image', image_url: data, detail: part.detail }
      : { type: 'input_file', filename: file.name, file_data: data }
  }

  /** The provider's id for `file`, uploading it once; `null`: no Files API. */
  async #upload(file: StoredFile): Promise<string | null> {
    if (file.providerFileId) return file.providerFileId
    if (!this.#filesApi) return null
    try {
      const uploaded = await this.#client.files.create({
        file: await toFile(this.#files.read(file.id), file.name, {
          type: file.mime,
        }),
        purpose: 'user_data',
        expires_after: { anchor: 'created_at', seconds: EXPIRES_AFTER },
      })
      this.#files.setProviderId(file.id, uploaded.id)
      return uploaded.id
    } catch (err) {
      if (!(err instanceof OpenAI.NotFoundError)) throw err
      this.#filesApi = false // e.g. Ollama: send files inline
      return null
    }
  }

  async #text(file: StoredFile): Promise<string> {
    let text = this.#texts.get(file.id)
    if (text === undefined) {
      const kind = fileKind(file.name)!.kind
      text =
        kind === 'image'
          ? ''
          : await documentText(kind, this.#files.read(file.id))
      if (text.length > MAX_TEXT)
        text = `${text.slice(0, MAX_TEXT)}\n\n[truncated]`
      this.#texts.set(file.id, text)
    }
    return text
  }
}

/** The file parts of `input`'s user messages. */
function attached(input: ResponseInputItem[]) {
  return input.flatMap((item) =>
    'role' in item && item.role === 'user' && Array.isArray(item.content)
      ? item.content.filter((part) => part.type !== 'input_text')
      : [],
  )
}
