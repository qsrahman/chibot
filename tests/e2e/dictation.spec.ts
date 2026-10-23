import { expect, test } from '@playwright/test'
import { appReady, FAKE_OPENAI } from './helpers.ts'

// Phase 9: voice input, with Chromium's fake microphone and the fake
// server's transcription.

test('dictates into the message box at the cursor', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Say: ')
  await page.getByRole('button', { name: 'Dictate' }).click()
  const stop = page.getByRole('button', { name: 'Stop recording' })
  await expect(stop).toBeVisible()
  await page.waitForTimeout(500)
  await stop.click()
  await expect(box).toHaveValue('Say: Hello from the microphone')
  await expect(box).toBeFocused()

  const sent = await page.request.get(`${FAKE_OPENAI}/debug/last-transcription`)
  expect(await sent.json()).toMatchObject({
    model: 'e2e-transcribe',
    name: 'recording.webm',
    size: expect.any(Number),
  })
})

test('says why voice input is off without transcription', async ({ page }) => {
  await page.route('/api/health', async (route) => {
    const res = await route.fetch()
    const health = (await res.json()) as Record<string, unknown>
    await route.fulfill({
      json: { ...health, features: { transcription: false } },
    })
  })
  await page.goto('/')
  await appReady(page)
  const mic = page.getByRole('button', { name: /needs a transcription model/ })
  await expect(mic).toHaveAttribute('aria-disabled', 'true')
  // Playwright waits for aria-disabled buttons; the point is it does nothing.
  await mic.click({ force: true })
  await expect(
    page.getByRole('button', { name: 'Stop recording' }),
  ).toHaveCount(0)
})

test('ignores a second dictation click while recording starts', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  const dictate = page.getByRole('button', { name: 'Dictate' })
  // Both in one tick, before the first start has opened the microphone (a
  // second Playwright click would wait for the button to read "Dictate").
  await dictate.evaluate((button: HTMLElement) => {
    button.click()
    button.click()
  })
  const stop = page.getByRole('button', { name: 'Stop recording' })
  await expect(stop).toBeVisible()
  await page.waitForTimeout(500)
  await stop.click()
  await expect(box).toHaveValue('Hello from the microphone')
})
