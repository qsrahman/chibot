import { expect, test } from '@playwright/test'
import { appReady, resetSettings } from './helpers.ts'

// A recording added to the message is turned into text in the message box, not
// attached. The fake server transcribes any recording as "Hello from the
// microphone" (tests/e2e/fake-openai.ts).

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

const message = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Message' })
const recording = (name = 'notes.mp3') => ({
  name,
  mimeType: 'audio/mpeg',
  buffer: Buffer.from('not really audio'),
})

test('a picked recording becomes text in the box, the other files still attach', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  // The menu names what it takes, audio too now that the server transcribes.
  await expect(
    page.getByRole('menuitem', { name: /Add photos & files/ }),
  ).toContainText('Images, PDF, Word, text, code and audio')
  await page.keyboard.press('Escape')

  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([
      recording(),
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('some notes'),
      },
    ])
  await expect(message(page)).toHaveValue('Hello from the microphone')
  // Only the text file is an attachment.
  const attachments = page.getByRole('list', { name: 'Attachments' })
  await expect(attachments.getByRole('listitem')).toHaveCount(1)
  await expect(attachments).toContainText('notes.txt')
  await expect(attachments).not.toContainText('notes.mp3')
})

test('a second recording is added under what is written', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await message(page).fill('Please summarise:')
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([recording('one.mp3'), recording('two.m4a')])
  await expect(message(page)).toHaveValue(
    'Please summarise:\n\nHello from the microphone\n\nHello from the microphone',
  )
})

test('a dropped recording is transcribed too', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  const files = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(
      new File([new Uint8Array([1, 2, 3])], 'voice.ogg', { type: 'audio/ogg' }),
    )
    return data
  })
  const chat = page.locator('main.chat')
  await chat.dispatchEvent('dragover', { dataTransfer: files })
  await chat.dispatchEvent('drop', { dataTransfer: files })
  await expect(message(page)).toHaveValue('Hello from the microphone')
  await expect(page.getByRole('list', { name: 'Attachments' })).toHaveCount(0)
})

test('without a transcription model it says so, and attaches nothing', async ({
  page,
}) => {
  await page.request.patch('/api/settings', { data: { transcribeModel: '' } })
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  await expect(
    page.getByRole('menuitem', { name: /Add photos & files/ }),
  ).toContainText('Images, PDF, Word, text and code')
  await expect(
    page.getByRole('menuitem', { name: /Add photos & files/ }),
  ).not.toContainText('audio')
  await page.keyboard.press('Escape')

  await page.locator('input[type=file]').first().setInputFiles(recording())
  await expect(
    page.locator('.toast', { hasText: 'Audio needs a transcription model' }),
  ).toBeVisible()
  await expect(message(page)).toHaveValue('')
  await expect(page.getByRole('list', { name: 'Attachments' })).toHaveCount(0)
})

test('a recording over 25 MB is refused with its name', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'long-meeting.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
    })
  await expect(
    page.locator('.toast', {
      hasText: 'long-meeting.wav is larger than 25 MB',
    }),
  ).toBeVisible()
  await expect(message(page)).toHaveValue('')
})
