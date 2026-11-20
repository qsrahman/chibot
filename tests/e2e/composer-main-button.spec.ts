import { expect, test } from '@playwright/test'
import { appReady, resetSettings } from './helpers.ts'

// The composer's main button, as ChatGPT's is voice when nothing is written:
// with an empty box it is the mic; writing or attaching turns it into Send.

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

const message = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Message' })

test('an empty box has the mic as its main button, and writing turns it into Send', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const send = page.getByRole('button', { name: 'Send', exact: true })
  const dictate = page.getByRole('button', { name: 'Dictate' })

  // Empty: no dead send arrow; the mic is the main (filled) button.
  await expect(send).toHaveCount(0)
  await expect(dictate).toHaveCount(1)
  await expect(dictate).toHaveClass(/primary/)

  // Writing: Send is the main button and the mic stays, plain, beside it.
  await message(page).fill('hello')
  await expect(send).toBeEnabled()
  await expect(send).toHaveClass(/primary/)
  await expect(dictate).toHaveCount(1)
  await expect(dictate).not.toHaveClass(/primary/)

  // Emptied again: back to the mic.
  await message(page).fill('')
  await expect(send).toHaveCount(0)
  await expect(dictate).toHaveClass(/primary/)
})

test('an attached file with no text is something to send', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('some notes'),
    })
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dictate' })).not.toHaveClass(
    /primary/,
  )
})

test('without a transcription model the send button stays, dimmed', async ({
  page,
}) => {
  await page.request.patch('/api/settings', { data: { transcribeModel: '' } })
  await page.goto('/')
  await appReady(page)
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: /Voice input needs a transcription model/,
    }),
  ).not.toHaveClass(/primary/)
})

test('the effort chip has a brain on a wide screen, and not on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await appReady(page)
  const icon = page.locator('.mode-button .effort-icon')
  await expect(icon).toBeVisible()
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(icon).toBeHidden()
})
