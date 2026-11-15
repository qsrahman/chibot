import { expect, test } from '@playwright/test'
import { appReady } from './helpers.ts'

// What a new chat shows besides the greeting: where to carry on, or starters.

const TITLE =
  'Planning the <b>Lisbon</b> trip, with a very long title that has to be cut off by an ellipsis before it reaches the edge'

test('a new chat offers recent chats and projects, not the starters', async ({
  page,
}) => {
  const imported = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      exportedAt: 0,
      conversation: { title: TITLE, createdAt: 1, updatedAt: Date.now() },
      currentLeafId: 1,
      items: [
        {
          id: 1,
          parentId: null,
          data: { role: 'user', content: 'Hello' },
          usage: null,
          model: null,
          createdAt: 1,
        },
      ],
      files: [],
    },
  })
  const { id } = (await imported.json()) as { id: string }
  const created = await page.request.post('/api/projects', {
    data: { name: 'Recent project' },
  })
  const project = (await created.json()) as { id: string }

  await page.goto('/')
  await appReady(page)
  await expect(page.locator('.suggestions')).toHaveCount(0)
  const row = page.locator('.recents .recent-row', { hasText: 'Lisbon' })
  // User text is text, on one line, cut with an ellipsis.
  await expect(row.locator('b')).toHaveCount(0)
  await expect(row.locator('.recent-label')).toHaveAttribute('dir', 'auto')
  const label = row.locator('.recent-label')
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  )
  await expect(row.locator('time')).toHaveText('just now')
  const projectRow = page.locator(
    '.recents a[href="/projects/' + project.id + '"]',
  )
  await expect(projectRow).toContainText('Recent project')
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(36)

  await row.click()
  await expect(page).toHaveURL(`/c/${id}`)
  await page.request.delete(`/api/conversations/${id}`)
  await page.request.delete(`/api/projects/${project.id}`)
})

test('without chats the starters stay', async ({ page }) => {
  await page.route('**/api/conversations', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: [] })
      : route.continue(),
  )
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }))
  await page.goto('/')
  await appReady(page)
  await expect(page.locator('.suggestions')).toBeVisible()
  await expect(page.locator('.recents')).toHaveCount(0)
})

// The server's own refusal and health flag are covered by tests/server; here
// the page is given an unconfigured health (the e2e server has a key).
test('without a model or key, a new chat shows how to set one up', async ({
  page,
}) => {
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch()
    await route.fulfill({
      response: res,
      json: { ...(await res.json()), configured: false },
    })
  })
  let turns = 0
  await page.route('**/api/conversations/*/turns', (route) => {
    turns++
    return route.continue()
  })
  await page.goto('/')
  await appReady(page)
  const card = page.getByRole('region', { name: 'Set up a model' })
  await expect(card).toContainText('needs a model before it can answer')
  await expect(page.locator('.suggestions')).toHaveCount(0)
  await expect(page.locator('.recents')).toHaveCount(0)
  await expect(card.getByText('chibot init', { exact: true })).toBeVisible()
  await expect(card.getByText('chibot config set chat.apiKey')).toBeVisible()
  await card.getByRole('button', { name: 'Copy chibot init' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'chibot init',
  )

  // Sending explains instead of failing, and keeps what was typed.
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Hello there')
  await box.press('Enter')
  await expect(page.locator('.toast-message')).toBeVisible()
  await expect(box).toHaveValue('Hello there')
  expect(turns).toBe(0)
})

for (const [name, event, words] of [
  ['refuses the key', { status: 401 }, 'refused the API key'],
  ['is unreachable', { unreachable: true }, 'could not reach the model server'],
] as const) {
  test(`a server that ${name} is explained in the setup card`, async ({
    page,
  }) => {
    await page.route('**/api/conversations/*/turns', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: `event: chibot.error\ndata: ${JSON.stringify({
          type: 'chibot.error',
          message: 'Something provider-specific',
          ...event,
        })}\n\n`,
      }),
    )
    await page.goto('/')
    await appReady(page)
    await page.getByRole('textbox', { name: 'Message' }).fill('Hello')
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('region', { name: 'Set up a model' }),
    ).toContainText(words)
    await expect(page.getByText('Something provider-specific')).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').pop()!
    await page.request.delete(`/api/conversations/${id}`)
  })
}
