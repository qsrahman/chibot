import { beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import {
  EditImageTool,
  GenerateImageTool,
} from '../../src/server/tools/images.ts'
import { testFiles } from './fakes.ts'

const PNG = Buffer.from([137, 80, 78, 71])

/** An images client that records its calls and returns `PNG`. */
function fakeImages(calls: Record<string, unknown>[]) {
  const answer = async (params: Record<string, unknown>) => {
    calls.push(params)
    return {
      data: [{ b64_json: PNG.toString('base64') }],
      output_format: 'png',
    }
  }
  return { images: { generate: answer, edit: answer } } as unknown as OpenAI
}

describe('image tools', () => {
  let files: FileStore
  let calls: Record<string, unknown>[]
  let deps: ConstructorParameters<typeof GenerateImageTool>[0]
  beforeEach(() => {
    files = testFiles(openDatabase(':memory:'))
    calls = []
    deps = { client: fakeImages(calls), model: 'img-1', files }
  })

  it('generates an image, keeps it with the chat and returns its id', async () => {
    const output = await new GenerateImageTool(deps).run(
      { prompt: 'a red robot', size: 'landscape' },
      { conversationId: 'chat-1' },
    )
    const { image_id } = JSON.parse(output) as { image_id: string }

    expect(calls).toEqual([
      {
        model: 'img-1',
        prompt: 'a red robot',
        size: '1536x1024',
        quality: 'medium',
      },
    ])
    expect(files.get(image_id)).toMatchObject({
      conversationId: 'chat-1',
      name: 'image.png',
      mime: 'image/png',
      size: 4,
    })
    expect(files.read(image_id)).toEqual(PNG)
  })

  it("edits one of the chat's images into a new one", async () => {
    const original = files.save('chat-1', 'image.png', 'image/png', PNG)
    const output = await new EditImageTool(deps).run(
      { image_id: original.id, prompt: 'make it bluer' },
      { conversationId: 'chat-1' },
    )

    const { image_id } = JSON.parse(output) as { image_id: string }
    expect(image_id).not.toBe(original.id)
    expect(calls[0]).toMatchObject({ model: 'img-1', prompt: 'make it bluer' })
    const image = calls[0]!.image as File
    expect(image.name).toBe('image.png')
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG)
  })

  it("refuses images that aren't in this chat", async () => {
    const elsewhere = files.save('chat-2', 'image.png', 'image/png', PNG)
    const tool = new EditImageTool(deps)
    for (const image_id of [elsewhere.id, 'nope']) {
      await expect(
        tool.run({ image_id, prompt: 'x' }, { conversationId: 'chat-1' }),
      ).rejects.toThrow(`there is no image ${image_id} in this chat`)
    }
    expect(calls).toEqual([])
  })

  it('says which image service failed, and how to set it up', async () => {
    const failing = (error: Error) =>
      ({
        baseURL: 'http://localhost:11434/v1',
        images: {
          generate: async () => {
            throw error
          },
        },
      }) as unknown as OpenAI
    const run = (error: Error) =>
      new GenerateImageTool({ ...deps, client: failing(error) }).run(
        { prompt: 'x', size: 'square' },
        { conversationId: 'chat-1' },
      )

    const notFound = new OpenAI.NotFoundError(
      404,
      { message: '404 page not found' },
      '404 page not found',
      new Headers(),
    )
    await expect(run(notFound)).rejects.toThrow(
      /^the image service at http:\/\/localhost:11434\/v1 \(model img-1\) failed: .*404 page not found\. Images need an image model .*OPENAI_IMAGE_MODEL/,
    )
    const refused = new OpenAI.BadRequestError(
      400,
      { message: 'Your request was rejected' },
      'Your request was rejected',
      new Headers(),
    )
    await expect(run(refused)).rejects.toThrow('Your request was rejected')
    await expect(run(refused)).rejects.not.toThrow('OPENAI_IMAGE_MODEL')
  })
})
