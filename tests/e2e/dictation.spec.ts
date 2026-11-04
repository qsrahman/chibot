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

for (const [device, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 375, height: 812 }],
] as const) {
  test(`shows how long it has recorded and how loud (${device})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await appReady(page)
    await expect(page.locator('.dictation-meter')).toHaveCount(0)
    await page.getByRole('button', { name: 'Dictate' }).click()
    const meter = page.locator('.dictation-meter')
    await expect(meter).toBeVisible()
    // The clock runs…
    await expect(meter.locator('.dictation-time')).toHaveText('0:00')
    await expect(meter.locator('.dictation-time')).toHaveText('0:01', {
      timeout: 4000,
    })
    // …and the fake microphone's tone moves the bar.
    await expect
      .poll(() =>
        meter
          .locator('.dictation-level-bar')
          .evaluate((el) => Number(el.style.getPropertyValue('--level'))),
      )
      .toBeGreaterThan(0)
    // It is for the eyes: a screen reader is told once, not every second.
    await expect(meter).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.toast-live')).toHaveText('Recording')

    // The buttons stay on the composer's bottom row, and the page doesn't overflow.
    const rows = await page.evaluate(() => {
      const bottom = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().bottom
      return {
        plus: bottom('.composer-left .icon-button'),
        mic: bottom('.composer-actions .icon-button.recording'),
        meter: bottom('.dictation-meter'),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
    expect(rows.overflow).toBe(false)
    expect(Math.abs(rows.mic - rows.plus)).toBeLessThan(2)
    expect(rows.meter).toBeLessThanOrEqual(rows.plus + 2)

    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(meter).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Hello from the microphone',
    )
  })
}
