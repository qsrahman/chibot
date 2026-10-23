import { expect, test, type Page } from '@playwright/test'
import {
  FAKE_OPENAI,
  answer,
  answered,
  appReady,
  lastRequest,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Phase 6: web search, reading pages, images and tool switches, against
// tests/e2e/fake-openai.ts (which also fakes Brave and the images API).

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

const sources = (page: Page, index: number) =>
  turns(page).nth(index).locator('.sources')

test('searches the web and lists the sources', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please search for robots')
  await answered(page)
  await expect(answer(page, 0)).toContainText('All about robots.')
  await expect(page.getByText('Searched the web')).toBeVisible()

  await sources(page, 0).getByText('Sources · 1').click()
  await expect(
    sources(page, 0).getByRole('link', { name: /Result for Please search/ }),
  ).toHaveAttribute('href', `${FAKE_OPENAI}/pages/robots`)
})

test('reads a pasted URL, but not a local address', async ({ page }) => {
  await page.goto('/')
  await send(page, `Please read ${FAKE_OPENAI}/pages/robots`)
  await answered(page)
  await expect(answer(page, 0)).toContainText('Robots are machines')
  await expect(answer(page, 0)).toContainText('untrusted page content')
  await expect(answer(page, 0)).not.toContainText('Home · About')

  await send(page, 'Please read http://localhost:4010/pages/robots')
  await answered(page)
  await expect(answer(page, 1)).toContainText('private or local address')
})

test('creates an image, keeps it, and edits it', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please draw a robot')
  await answered(page)
  const image = turns(page).first().locator('.image img')
  await expect(image).toHaveAttribute('src', /^\/api\/files\/[\w-]+$/)
  const first = await image.getAttribute('src')
  expect(
    await page.evaluate(
      (src) => fetch(src!).then((r) => r.headers.get('content-type')),
      first,
    ),
  ).toBe('image/png')

  await page.reload()
  await expect(turns(page).first().locator('.image img')).toHaveAttribute(
    'src',
    first!,
  )

  await send(page, 'Now make it bluer')
  await answered(page)
  const edited = turns(page).nth(1).locator('.image img')
  await expect(edited).toHaveAttribute('src', /^\/api\/files\//)
  expect(await edited.getAttribute('src')).not.toBe(first)
  const imageRequest = await page.request.get(
    `${FAKE_OPENAI}/debug/last-image-request`,
  )
  expect(await imageRequest.json()).toMatchObject({
    endpoint: 'edits',
    prompt: 'make it bluer',
    model: 'e2e-image',
  })
})

test('the composer menu forces a tool for one message', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  await page.getByRole('menuitem', { name: 'Search the web' }).click()
  await expect(
    page.getByRole('button', { name: 'Remove Search the web' }),
  ).toBeVisible()
  await send(page, 'Hello there')
  await answered(page)

  const requests = (await (
    await page.request.get(`${FAKE_OPENAI}/debug/requests`)
  ).json()) as { tool_choice?: unknown }[]
  expect(requests.at(-2)!.tool_choice).toEqual({
    type: 'function',
    name: 'web_search',
  })
  expect(requests.at(-1)).not.toHaveProperty('tool_choice')
  await expect(sources(page, 0)).toBeVisible()
  // The pick was for that message only.
  await expect(
    page.getByRole('button', { name: 'Remove Search the web' }),
  ).toHaveCount(0)
})

test('a tool switched off in Settings is not offered', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Tools' }).click()
  // Saved first, then shown: click and wait rather than uncheck().
  const webSearch = dialog.getByRole('switch', { name: 'Web search' })
  await webSearch.click()
  await expect(webSearch).not.toBeChecked()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Add files and more' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Search the web' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')

  await send(page, 'Hello')
  await answered(page)
  const names = ((await lastRequest(page)).tools as { name: string }[]).map(
    (tool) => tool.name,
  )
  expect(names).not.toContain('web_search')
  expect(names).toContain('generate_image')
})
