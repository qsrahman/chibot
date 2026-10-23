import OpenAI, { toFile } from 'openai'
import type { ImagesResponse } from 'openai/resources/images'
import { z } from 'zod'
import type { FileStore } from '../file-store.ts'
import { Tool, type ToolContext } from '../tool.ts'

const SIZES = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
  auto: 'auto',
} as const

// Fixed: `high` is slower and about 4× the cost, `low` visibly rough.
const QUALITY = 'medium'

const SHOWN =
  'The image is shown to the user automatically: don’t link to it or ' +
  'describe the file, just say briefly what you made.'

/** The image endpoint's client and model, and where images are kept. */
export interface ImageDeps {
  client: OpenAI
  model: string
  files: FileStore
}

/** Creates an image with `images.generate`; the model gets its id only. */
export class GenerateImageTool extends Tool {
  readonly name = 'generate_image'
  readonly label = 'Create images'
  readonly description = `Creates an image from a description. ${SHOWN} To change an image made earlier, use edit_image.`
  readonly parameters = z.object({
    prompt: z
      .string()
      .describe(
        'A detailed description: subject, style, composition, colours, text to include',
      ),
    size: z.enum(['square', 'portrait', 'landscape', 'auto']),
  })
  readonly #deps: ImageDeps

  constructor(deps: ImageDeps) {
    super()
    this.#deps = deps
  }

  async run(
    { prompt, size }: z.output<typeof this.parameters>,
    { conversationId, signal }: ToolContext,
  ) {
    const { client, model } = this.#deps
    const response = await fromImageService(this.#deps, () =>
      client.images.generate(
        { model, prompt, size: SIZES[size], quality: QUALITY },
        { signal },
      ),
    )
    return saveImage(this.#deps.files, conversationId, response)
  }
}

/** Changes an image from this chat with `images.edit`. */
export class EditImageTool extends Tool {
  readonly name = 'edit_image'
  readonly label = 'Edit images'
  readonly description = `Changes an image made earlier in this chat (by generate_image or edit_image), e.g. "make it bluer". ${SHOWN}`
  readonly parameters = z.object({
    image_id: z.string().describe('The image_id returned for the image'),
    prompt: z.string().describe('What to change, and what to keep'),
  })
  readonly #deps: ImageDeps

  constructor(deps: ImageDeps) {
    super()
    this.#deps = deps
  }

  async run(
    { image_id, prompt }: z.output<typeof this.parameters>,
    { conversationId, signal }: ToolContext,
  ) {
    const { client, model, files } = this.#deps
    const file = files.get(image_id)
    // Only this chat's images: ids from other chats aren't the model's to use.
    if (file?.conversationId !== conversationId) {
      throw new Error(`there is no image ${image_id} in this chat`)
    }
    const image = await toFile(files.read(file.id), file.name, {
      type: file.mime,
    })
    const response = await fromImageService(this.#deps, () =>
      client.images.edit(
        { model, image, prompt, quality: QUALITY },
        { signal },
      ),
    )
    return saveImage(files, conversationId, response)
  }
}

/**
 * Runs an image API call; failures say which endpoint and model failed, so
 * the model (and the user) can tell a setup problem from a refused prompt.
 * Not found and unreachable usually mean the endpoint can't make images
 * (e.g. a chat model on Ollama), so those also say what to set.
 */
async function fromImageService<T>(
  { client, model }: ImageDeps,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!(err instanceof OpenAI.APIError)) throw err
    console.error('Image request failed:', err)
    const setup =
      err instanceof OpenAI.NotFoundError ||
      err instanceof OpenAI.APIConnectionError
    throw new Error(
      `the image service at ${client.baseURL} (model ${model}) failed: ` +
        err.message.replace(/\.$/, '') +
        (setup
          ? '. Images need an image model (e.g. gpt-image-2) on a server ' +
            'that makes images: tell the user to check OPENAI_IMAGE_MODEL ' +
            'and OPENAI_IMAGE_BASE_URL in .env.'
          : ''),
      { cause: err },
    )
  }
}

function saveImage(
  files: FileStore,
  conversationId: string,
  response: ImagesResponse,
): string {
  const image = response.data?.[0]?.b64_json
  if (!image) throw new Error('the image service returned no image')
  const format = response.output_format ?? 'png'
  const file = files.save(
    conversationId,
    `image.${format}`,
    `image/${format}`,
    Buffer.from(image, 'base64'),
  )
  return JSON.stringify({ image_id: file.id })
}
