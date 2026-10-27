import { expect, test, type Page } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  lastRequest,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Phase 10: MCP servers (tests/e2e/server.ts): `fixture`, a local server,
// and `tracker`, a remote one behind a fake OAuth provider.

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

async function openTools(page: Page) {
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Tools' }).click()
  return dialog
}

const server = (page: Page, name: string) =>
  page.locator('.settings-section', { hasText: `MCP · ${name}` })

test('lists the servers and their tools, with switches', async ({ page }) => {
  await page.goto('/')
  const dialog = await openTools(page)
  const fixture = server(page, 'fixture')
  await expect(fixture).toContainText('Local server')
  await expect(fixture).toContainText('Connected · 6 tools')
  await expect(fixture.getByText('Repeats the text')).toBeVisible()
  await expect(server(page, 'tracker')).toContainText('Needs sign-in')
  // Not among chibot's own tools (Other holds the e2e test tool).
  await expect(
    dialog.locator('.settings-section', { hasText: 'Other' }),
  ).not.toContainText('Echo')

  // A tool switched off isn't offered.
  await dialog.getByRole('switch', { name: 'Echo' }).click()
  await page.keyboard.press('Escape')
  await send(page, 'Hello there')
  await answered(page)
  const offered = ((await lastRequest(page)).tools ?? []) as { name: string }[]
  expect(offered.map((t) => t.name)).not.toContain('fixture__echo')
  expect(offered.map((t) => t.name)).toContain('fixture__picture')

  // A server switched off stops, and comes back.
  await openTools(page)
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect(server(page, 'fixture')).toContainText('Off')
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect(server(page, 'fixture')).toContainText('Connected · 6 tools')
})

test('asks before a server’s tools when set to', async ({ page }) => {
  await page.goto('/')
  const dialog = await openTools(page)
  await dialog
    .getByRole('switch', { name: 'Ask before using its tools' })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await send(page, 'Please mcp echo hi')
  const card = page.getByRole('region', { name: 'Tool approval' })
  await expect(card).toContainText('fixture__echo')
  await card.getByRole('button', { name: 'Approve' }).click()
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: echo: hi')
})

test('signs in to a remote server and back out', async ({ page }) => {
  await page.goto('/')
  await openTools(page)
  const tracker = server(page, 'tracker')
  await tracker.getByRole('button', { name: 'Sign in' }).click()
  // The provider signs in at once and sends the browser back to Settings.
  await expect(page).toHaveURL('/')
  await expect(tracker).toContainText('Connected · 6 tools')

  await tracker.getByRole('button', { name: 'Sign out' }).click()
  await expect(tracker).toContainText('Needs sign-in')
  await expect(tracker.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})

test('calls an MCP tool in a chat and shows its images', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please mcp echo hi')
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: echo: hi')
  const tool = turns(page).first().locator('.tool-call')
  await tool.getByText('Used echo · fixture').click()
  await expect(tool.locator('.tool-input')).toHaveText('{"text":"hi"}')
  await expect(tool.locator('.tool-result')).toHaveText('echo: hi')
  // In plain terms first; the raw call is one click further.
  await expect(tool.locator('.tool-details')).toBeHidden()
  await tool.getByText('Raw').click()
  await expect(tool.locator('.tool-details')).toContainText('"text": "hi"')

  await send(page, 'Show an mcp picture')
  await expect(turns(page).nth(1).locator('.image img')).toBeVisible()
  await answered(page)
  expect((await lastRequest(page)).input.at(-1)).toMatchObject({
    type: 'function_call_output',
    output: expect.stringContaining('[An image, shown to the user]'),
  })
})
