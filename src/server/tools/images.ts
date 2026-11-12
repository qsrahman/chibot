import OpenAI, { toFile } from 'openai'
import type { ImagesResponse } from 'openai/resources/images'
import { z } from 'zod'
import type { FileStore } from '../file-store.ts'
import { logFailure } from '../api-errors.ts'
import { Tool, type ToolContext } from '../tool.ts'

const SIZES = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
  auto: 'auto',
} as const

// Fixed: `high` is slower and about 4× the cost, `low` visibly rough.
const QUALITY = 'medium'

// The formats chibot serves back (as in mcp-tool's SHOWN_IMAGES). The
// endpoint's `output_format` isn't trusted as a MIME type.
const FORMATS: Record<string, { extension: string; mime: string }> = {
  png: { extension: 'png', mime: 'image/png' },
  jpeg: { extension: 'jpg', mime: 'image/jpeg' },
  webp: { extension: 'webp', mime: 'image/webp' },
}
const DEFAULT_FORMAT = FORMATS.png!

const SETUP = 'Needs an API key or server: run `chibot init`'
const NO_MODEL = 'Choose an image model in Settings → Other models'

/** Why the tools can't run, or `null`. */
function missing(deps: ImageDeps | null) {
  return !deps ? SETUP : deps.model() ? null : NO_MODEL
}

const SHOWN =
  'The image is shown to the user automatically: don’t link to it or ' +
  'describe the file, just say briefly what you made.'

/**
 * The image endpoint's client. It never retries by itself (the SDK default is
 * two retries): a request that timed out or failed on the server's side may
 * still have made, and billed, an image, so the model decides whether to ask
 * again, after seeing the error.
 */
export function imageClient({
  baseURL,
  apiKey,
}: {
  baseURL?: string
  apiKey: string
}) {
  return new OpenAI({ baseURL, apiKey, maxRetries: 0 })
}

/** The image endpoint's client and model, and where images are kept. */
export interface ImageDeps {
  client: OpenAI
  /** Read at each call, since Settings can change it; `''` is off. */
  model: () => string
  files: FileStore
}

/** Creates an image with `images.generate`; the model gets its id only. */
export class GenerateImageTool extends Tool {
  readonly name = 'generate_image'
  readonly label = 'Create images'
  override readonly group = 'Images'
  override readonly summary =
    'Creates images; the prompt goes to the image service.'
  override readonly running = 'Creating an image…'
  override readonly done = 'Created an image'
  override readonly chip = {
    action: 'Create an image',
    text: 'Image',
    icon: 'image',
  } as const
  readonly description = `Creates an image from a description. ${SHOWN} To change an image made earlier, use edit_image.`
  readonly parameters = z.object({
    prompt: z
      .string()
      .describe(
        'A detailed description: subject, style, composition, colours, text to include',
      ),
    size: z.enum(['square', 'portrait', 'landscape', 'auto']),
  })
  readonly #deps: ImageDeps | null

  /** @param deps `null` without an image server or key: listed, but not offered */
  constructor(deps: ImageDeps | null) {
    super()
    this.#deps = deps
  }

  override unavailable() {
    return missing(this.#deps)
  }

  async run(
    { prompt, size }: z.output<typeof this.parameters>,
    { conversationId, signal }: ToolContext,
  ) {
    const deps = this.#deps
    if (!deps) throw new Error('image generation is not set up')
    const { client } = deps
    const model = deps.model()
    const response = await fromImageService(deps, model, () =>
      client.images.generate(
        { model, prompt, size: SIZES[size], quality: QUALITY },
        { signal },
      ),
    )
    return saveImage(deps.files, conversationId, response)
  }
}

/** Changes an image from this chat with `images.edit`. */
export class EditImageTool extends Tool {
  readonly name = 'edit_image'
  readonly label = 'Edit images'
  override readonly group = 'Images'
  override readonly summary = 'Changes images made earlier in the same chat.'
  override readonly running = 'Editing the image…'
  override readonly done = 'Edited the image'
  readonly description = `Changes an image made earlier in this chat (by generate_image or edit_image), e.g. "make it bluer". ${SHOWN}`
  readonly parameters = z.object({
    image_id: z.string().describe('The image_id returned for the image'),
    prompt: z.string().describe('What to change, and what to keep'),
  })
  readonly #deps: ImageDeps | null

  /** @param deps `null` without an image server or key: listed, but not offered */
  constructor(deps: ImageDeps | null) {
    super()
    this.#deps = deps
  }

  override unavailable() {
    return missing(this.#deps)
  }

  async run(
    { image_id, prompt }: z.output<typeof this.parameters>,
    { conversationId, signal }: ToolContext,
  ) {
    const deps = this.#deps
    if (!deps) throw new Error('image generation is not set up')
    const { client, files } = deps
    const model = deps.model()
    const file = files.get(image_id)
    // Only this chat's images: ids from other chats aren't the model's to use.
    if (file?.conversationId !== conversationId) {
      throw new Error(`there is no image ${image_id} in this chat`)
    }
    const image = await toFile(files.read(file.id), file.name, {
      type: file.mime,
    })
    const response = await fromImageService(deps, model, () =>
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
 * Not found usually means the server has no images endpoint at all (Ollama
 * removed image generation in 0.32.6) and unreachable a wrong address, so
 * those also say what to set.
 */
async function fromImageService<T>(
  { client }: ImageDeps,
  model: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!(err instanceof OpenAI.APIError)) throw err
    logFailure('Image request failed', err)
    const hint =
      err instanceof OpenAI.NotFoundError
        ? '. This server has no images endpoint (e.g. Ollama removed image ' +
          'generation in 0.32.6), or doesn’t know this model: tell the user ' +
          'to run `chibot config set image.baseURL https://api.openai.com/v1` ' +
          'and `chibot config set image.apiKey <key>`, and choose an image ' +
          'model such as gpt-image-2 in Settings → Other models.'
        : err instanceof OpenAI.APIConnectionError
          ? '. Images need an image model (e.g. gpt-image-2) on a server ' +
            'that makes images: tell the user to check the image model in ' +
            'Settings → Other models and image.baseURL (`chibot config path` ' +
            'shows where the settings are).'
          : ''
    throw new Error(
      `the image service at ${client.baseURL} (model ${model}) failed: ` +
        err.message.replace(/\.$/, '') +
        hint,
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
  const { extension, mime } =
    FORMATS[response.output_format ?? 'png'] ?? DEFAULT_FORMAT
  const file = files.save(
    conversationId,
    `image.${extension}`,
    mime,
    Buffer.from(image, 'base64'),
  )
  return JSON.stringify({ image_id: file.id })
}
