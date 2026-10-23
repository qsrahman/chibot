import { expect, test, type Page } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  FAKE_OPENAI,
  lastRequest,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Phase 9: attachments, uploaded to the fake server's Files API.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
)
const NOTES = {
  name: 'notes.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('The code is 4417.'),
}

test.afterEach(({ page }) => resetSettings(page))

async function attach(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  { wait = true } = {},
) {
  await page.getByRole('button', { name: 'Add files and more' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Add photos & files' }).click()
  await (await chooser).setFiles(files)
  if (wait) await uploaded(page)
}

/** Send waits for uploads (Enter does nothing meanwhile). */
const uploaded = (page: Page) =>
  expect(page.getByLabel('Uploading')).toHaveCount(0)

const userContent = async (page: Page) => {
  const { input } = await lastRequest(page)
  const message = input.findLast((item) => item.role === 'user') as {
    content: { type: string; file_id?: string; text?: string }[]
  }
  return message.content
}

const uploadCount = async (page: Page) =>
  (
    (await (await page.request.get(`${FAKE_OPENAI}/debug/files`)).json()) as {
      count: number
    }
  ).count

test('attaches a photo and a file, and an edit keeps them', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const before = await uploadCount(page)
  await attach(page, [
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    NOTES,
    {
      name: 'archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('x'),
    },
  ])
  // Messages list their attachments too.
  const chips = page
    .locator('.composer')
    .getByRole('list', { name: 'Attachments' })
  await expect(chips.getByText(/only images/)).toBeVisible()
  // A failed upload holds Send until it's removed.
  await page.getByRole('textbox', { name: 'Message' }).fill('What are these?')
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove archive.zip' }).click()

  await page.getByRole('textbox', { name: 'Message' }).press('Enter')
  await answered(page)
  await expect(answer(page, 0)).toContainText('to: What are these?')
  expect(await userContent(page)).toMatchObject([
    { type: 'input_image', file_id: expect.stringMatching(/^file-/) },
    { type: 'input_file', file_id: expect.stringMatching(/^file-/) },
    { type: 'input_text', text: 'What are these?' },
  ])
  const bubble = turns(page).nth(0).locator('.message.user')
  await expect(
    bubble.getByRole('img', { name: 'Attached image' }),
  ).toBeVisible()
  await expect(bubble.getByText('notes.md')).toBeVisible()
  await expect(chips).toHaveCount(0)

  await turns(page).nth(0).hover()
  await page.getByRole('button', { name: 'Edit message' }).click()
  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await editor.fill('And now?')
  await editor.press('Enter')
  await answered(page)
  await expect(answer(page, 0)).toContainText('to: And now?')
  expect((await userContent(page)).map((part) => part.type)).toEqual([
    'input_image',
    'input_file',
    'input_text',
  ])
  await expect(bubble.getByText('notes.md')).toBeVisible()
  // Uploaded once, then reused.
  expect((await uploadCount(page)) - before).toBe(2)
})

test('attaches pasted images', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('textbox', { name: 'Message' }).evaluate(
    (box, bytes) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }),
      )
      box.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
      )
    },
    [...PNG],
  )
  await expect(
    page
      .getByRole('list', { name: 'Attachments' })
      .getByRole('img', { name: 'image.png' }),
  ).toBeVisible()
  await uploaded(page)
  await send(page, 'Pasted')
  await answered(page)
  expect((await userContent(page))[0]).toMatchObject({ type: 'input_image' })
})

test('uploads again when the provider lost the files', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await attach(page, [NOTES])
  await send(page, 'Read this')
  await answered(page)
  const before = await uploadCount(page)

  await page.request.post(`${FAKE_OPENAI}/debug/forget-files`)
  await send(page, 'Once more')
  await answered(page)
  await expect(answer(page, 1)).toContainText('to: Once more')
  expect((await uploadCount(page)) - before).toBe(1)
})

test('sends documents as text to models that refuse files', async ({
  page,
}) => {
  await page.request.patch('/api/settings', { data: { model: 'e2e-other' } })
  await page.goto('/')
  await appReady(page)
  await attach(page, [NOTES])
  await send(page, 'Summarize')
  await answered(page)
  // The fake quotes every text part: the model got the document's text.
  await expect(answer(page, 0)).toContainText('The code is 4417.')
  expect(await userContent(page)).toEqual([
    {
      type: 'input_text',
      text: 'Attached file notes.md:\n\nThe code is 4417.',
    },
    { type: 'input_text', text: 'Summarize' },
  ])
})

test('drops files onto the chat; they survive a reload, export and import', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const dropped = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], 'dot.png', { type: 'image/png' }),
      )
      return data
    },
    [...PNG],
  )
  await page.locator('main.chat').dispatchEvent('dragover', {
    dataTransfer: dropped,
  })
  await expect(page.locator('main.chat.dragging')).toHaveCount(1)
  await page.locator('main.chat').dispatchEvent('drop', {
    dataTransfer: dropped,
  })
  await expect(
    page.locator('.composer').getByRole('img', { name: 'dot.png' }),
  ).toBeVisible()
  await expect(page.locator('main.chat.dragging')).toHaveCount(0)
  await uploaded(page)
  await send(page, 'Dropped')
  await answered(page)

  await page.reload()
  const image = turns(page).nth(0).getByRole('img', { name: 'Attached image' })
  await expect(image).toBeVisible()

  const id = new URL(page.url()).pathname.split('/').pop()!
  const exported = await (
    await page.request.get(`/api/conversations/${id}/export?format=json`)
  ).json()
  expect(exported).toMatchObject({
    version: 2,
    files: [{ name: 'dot.png', data: PNG.toString('base64') }],
  })
  const imported = (await (
    await page.request.post('/api/conversations/import', { data: exported })
  ).json()) as { id: string }
  await page.goto(`/c/${imported.id}`)
  await expect(image).toBeVisible()
  // A copy, not the original.
  const src = await image.getAttribute('src')
  expect(src).not.toContain(exported.files[0].id)
  expect((await page.request.get(src!)).headers()['content-type']).toBe(
    'image/png',
  )
})

test('sends files without text', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await attach(page, [{ name: 'dot.png', mimeType: 'image/png', buffer: PNG }])
  await page.getByRole('button', { name: 'Send' }).click()
  await answered(page)
  expect(await userContent(page)).toEqual([
    expect.objectContaining({ type: 'input_image' }),
  ])
  const bubble = turns(page).nth(0).locator('.message.user')
  await expect(
    bubble.getByRole('img', { name: 'Attached image' }),
  ).toBeVisible()
  await expect(bubble.locator('p')).toHaveCount(0)
})

test('sends once the files are uploaded', async ({ page }) => {
  await page.route('/api/files', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.continue()
  })
  await page.goto('/')
  await appReady(page)
  await attach(page, [NOTES], { wait: false })
  await send(page, 'Queued')
  await expect(
    page.getByRole('button', { name: 'Sending when the files are uploaded' }),
  ).toBeVisible()
  await answered(page)
  await expect(answer(page, 0)).toContainText('to: Queued')
  expect((await userContent(page)).map((part) => part.type)).toEqual([
    'input_file',
    'input_text',
  ])
})
