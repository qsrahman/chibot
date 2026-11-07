import { expect, test } from '@playwright/test'
import { appReady } from './helpers.ts'

// A page left open across a rebuild: it says so, and reloads when a chunk it
// needs is gone.

test('says when the server serves a newer build, with a way to reload', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const served = await (await page.request.get('/api/health')).json()
  // The same build as this page: nothing to say.
  expect(served.build).toEqual(expect.any(String))
  await expect(page.locator('.toast')).toHaveCount(0)

  await page.route('**/api/health', async (route) => {
    const res = await route.fetch()
    await route.fulfill({
      json: { ...(await res.json()), build: 'a-newer-build' },
    })
  })
  // Coming back to the page looks again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const toast = page.locator('.toast', { hasText: 'chibot was updated' })
  await expect(toast).toBeVisible()

  // Said once per build, not on every focus.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(300)
  await expect(page.locator('.toast', { hasText: 'was updated' })).toHaveCount(
    1,
  )

  await page.unroute('**/api/health')
  await Promise.all([
    page.waitForEvent('load'),
    toast.getByRole('button', { name: 'Reload' }).click(),
  ])
  await appReady(page)
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('reloads once when a lazily loaded chunk is gone', async ({ page }) => {
  let blocked = 0
  // The renderer's chunk "disappears" for the first load only.
  await page.route('**/assets/MarkdownView-*.js', (route) => {
    if (blocked++ === 0) return route.abort()
    return route.continue()
  })
  const loads: string[] = []
  page.on('load', () => loads.push(page.url()))
  await page.goto('/')
  // The reload happens by itself; wait for the page it lands on.
  await expect.poll(() => loads.length).toBe(2)
  await appReady(page)
  // The second load got the chunk, so the app is whole again.
  await page.waitForTimeout(500)
  expect(blocked).toBeGreaterThanOrEqual(2)
})

test('shows a message as plain text when the renderer cannot load', async ({
  page,
}) => {
  // Gone for good (not just once): the page reloads once, then gives up.
  await page.route('**/assets/MarkdownView-*.js', (route) => route.abort())
  const loads: string[] = []
  page.on('load', () => loads.push(page.url()))
  await page.goto('/')
  await expect.poll(() => loads.length).toBe(2)
  await appReady(page)
  await page.getByRole('textbox', { name: 'Message' }).fill('Still readable')
  await page.keyboard.press('Enter')
  await expect(page.locator('.message.assistant')).toContainText(
    'to: Still readable',
  )
  await expect(page.locator('.message.assistant .markdown.plain')).toHaveCount(
    1,
  )
  // No second reload.
  expect(loads.length).toBe(2)
})

test('says so when a chat has something the page cannot read', async ({
  page,
}) => {
  const created = await page.request.post('/api/conversations', { data: {} })
  const { id } = (await created.json()) as { id: string }
  await page.route(`**/api/conversations/${id}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ json: { ...body, items: [null] } })
  })
  await page.goto(`/c/${id}`)
  await expect(page.getByRole('alert')).toContainText(
    'This chat could not be displayed',
  )
  // The rest of the page is there: the sidebar, the composer.
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search chats' })).toBeVisible()
})
