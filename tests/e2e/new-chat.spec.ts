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
  await page.goto('/')
  await appReady(page)
  await expect(page.locator('.suggestions')).toBeVisible()
  await expect(page.locator('.recents')).toHaveCount(0)
})
