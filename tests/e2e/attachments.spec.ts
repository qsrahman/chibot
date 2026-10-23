import { expect, test, type Page } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  lastRequest,
  send,
  turns,
} from './helpers.ts'

// Phase 9: attachments. The fake server has no Files API, so chibot sends
// them inline.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
)

const userContent = async (page: Page) => {
  const { input } = await lastRequest(page)
  const message = input.findLast((item) => item.role === 'user') as {
    content: { type: string; image_url?: string; filename?: string }[]
  }
  return message.content
}

test('attaches a photo and a file, and an edit keeps them', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Add photos & files' }).click()
  await (
    await chooser
  ).setFiles([
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    {
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('The code is 4417.'),
    },
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
    {
      type: 'input_image',
      image_url: expect.stringMatching(/^data:image\/png/),
    },
    { type: 'input_file', filename: 'notes.md' },
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
  await send(page, 'Pasted')
  await answered(page)
  expect((await userContent(page))[0]).toMatchObject({ type: 'input_image' })
})
