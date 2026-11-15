import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, send } from './helpers.ts'

// chibot's own server going away: a banner (not the header), the draft kept,
// and the page coming back by itself or on Retry.

const banner = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Can’t reach chibot' })
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' })

/** Makes the API unreachable and has the page notice (it looks on focus). */
async function cutOff(page: Page) {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(banner(page)).toBeVisible()
}

test('says chibot cannot be reached, keeps the draft, and recovers by itself', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const model = await page.locator('.topbar .model-button').textContent()

  await cutOff(page)
  // The header keeps the model instead of the error.
  await expect(page.locator('.topbar')).not.toContainText('unreachable')
  await expect(page.locator('.topbar .model-button')).toHaveText(model!)
  await expect(
    banner(page).getByRole('button', { name: 'Retry' }),
  ).toBeVisible()

  // A send is explained, and nothing is lost.
  await message(page).fill('Do not lose me')
  await message(page).press('Enter')
  await expect(
    page.locator('.toast', { hasText: 'Your message is kept' }),
  ).toBeVisible()
  await expect(message(page)).toHaveValue('Do not lose me')
  await expect(page.locator('.turn')).toHaveCount(0)

  await page.unroute('**/api/**')
  await expect(banner(page)).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('.toast', { hasText: 'Reconnected' })).toBeVisible()
  await expect(message(page)).toHaveValue('Do not lose me')

  // Sent once, after it is back.
  await message(page).press('Enter')
  await answered(page)
  await expect(page.locator('.turn')).toHaveCount(1)
})

test('Retry looks at once', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await cutOff(page)

  const retry = banner(page).getByRole('button', { name: 'Retry' })
  await retry.click()
  await expect(banner(page)).toBeVisible()

  await page.unroute('**/api/**')
  await retry.click()
  await expect(banner(page)).toHaveCount(0, { timeout: 1500 })
  await expect(page.locator('.toast', { hasText: 'Reconnected' })).toBeVisible()
})

test('a send that fails before the server is known to be down gives the draft back', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'First question')
  await answered(page)

  await page.route('**/api/conversations/*/turns', (route) =>
    route.abort('connectionreset'),
  )
  await send(page, 'Second question')
  // Only that path failed, so chibot is still there and no banner stays: the
  // thread says why the send did not go.
  await expect(page.locator('.thread > .error')).toHaveCount(1)
  await expect(message(page)).toHaveValue('Second question')
  await expect(page.locator('.turn')).toHaveCount(1)
})

test('a page left open and in front notices chibot going away by itself', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/')
  await appReady(page)
  await expect(banner(page)).toHaveCount(0)

  // No focus event, no click: only time passing.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await page.clock.fastForward(31_000)
  await expect(banner(page)).toBeVisible()
})

test('a first send while chibot is gone shows the banner once, not the banner and a note', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  // Gone, and the page has not looked yet (no focus event, no wait).
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await send(page, 'Is anyone there')

  await expect(banner(page)).toBeVisible()
  await expect(page.locator('.thread > .error')).toHaveCount(0)
  await expect(message(page)).toHaveValue('Is anyone there')
})
