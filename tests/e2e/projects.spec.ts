import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { answer, answered, appReady, lastRequest, send } from './helpers.ts'

// Phase 8: projects, against tests/e2e/fake-openai.ts, where "in my files
// <words>" searches the project's files.

test.afterEach(async ({ page }) => {
  const projects = (await (await page.request.get('/api/projects')).json()) as {
    id: string
  }[]
  for (const { id } of projects)
    await page.request.delete(`/api/projects/${id}`)
})

async function newProject(page: Page, name: string) {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill(name)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

const sidebarChats = (page: Page) => page.locator('nav .conversation-row')

test('answers from project files, with its instructions', async ({ page }) => {
  await newProject(page, 'Japan trip')
  const files = page.getByRole('region', { name: 'Project files' })
  await files.getByLabel('Add files').setInputFiles([
    {
      name: 'itinerary.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        'Day 2: shinkansen to Kyoto.\n\nThe door code is 4417.',
      ),
    },
    {
      name: 'secret.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync(join(import.meta.dirname, '../fixtures/secret.pdf')),
    },
  ])
  await expect(files.getByText('Ready')).toHaveCount(2)

  const instructions = page.getByRole('region', {
    name: 'Project instructions',
  })
  await instructions.getByLabel('Instructions').fill('Prices in yen.')
  await instructions.getByRole('button', { name: 'Save' }).click()
  await expect(
    instructions.getByRole('button', { name: 'Save' }),
  ).toBeDisabled()

  await send(page, 'Look in my files door code')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  await expect(answer(page, 0)).toContainText('The door code is 4417.')
  await expect(page.getByRole('link', { name: 'Japan trip /' })).toBeVisible()
  const sent = await lastRequest(page)
  expect(sent.instructions).toContain('Prices in yen.')
  expect(sent.instructions).toContain('itinerary.md, secret.pdf')

  // Both files (vector search ranks every chunk; there are just two).
  await page.getByText('Sources · 2').click()
  await expect(page.getByRole('link', { name: /itinerary\.md/ })).toBeVisible()
  // Project chats aren't in the sidebar's list.
  const { pathname } = new URL(page.url())
  await expect(page.locator(`nav a[href="${pathname}"]`)).toHaveCount(0)

  await send(page, 'Look in my files KESTREL')
  await answered(page)
  await expect(answer(page, 1)).toContainText('The secret code is KESTREL.')
})

test('moves chats in and out, and deletes a project with them', async ({
  page,
}) => {
  await newProject(page, 'Work')
  await page.goto('/')
  await appReady(page)
  await send(page, 'A loose chat')
  await answered(page)
  const { pathname } = new URL(page.url())
  const loose = sidebarChats(page).filter({
    has: page.locator(`a[href="${pathname}"]`),
  })
  await expect(loose).toHaveCount(1)

  await loose.hover()
  await loose.getByRole('button', { name: /Options for/ }).click()
  await page.getByRole('button', { name: 'Move to project…' }).click()
  await page
    .getByRole('dialog', { name: 'Move to project' })
    .getByRole('button', { name: 'Work' })
    .click()
  await expect(loose).toHaveCount(0)
  // The open chat moved: its project's page shows it.
  await expect(page.getByRole('heading', { name: 'Work' })).toBeVisible()
  const chats = page.getByRole('region', { name: 'Project chats' })
  await expect(chats.locator(`a[href="${pathname}"]`)).toBeVisible()
  await chats.getByRole('button', { name: /Options for/ }).click()
  await page.getByRole('button', { name: 'Remove from project' }).click()
  await expect(chats).toHaveCount(0)
  await expect(loose).toHaveCount(1)

  // Back in, then delete the project: the chat goes with it.
  await loose.hover()
  await loose.getByRole('button', { name: /Options for/ }).click()
  await page.getByRole('button', { name: 'Move to project…' }).click()
  await page
    .getByRole('dialog', { name: 'Move to project' })
    .getByRole('button', { name: 'Work' })
    .click()
  await page.locator('nav').getByRole('link', { name: 'Work' }).click()
  await page.getByRole('button', { name: 'Delete project' }).click()
  await page
    .getByRole('dialog', { name: 'Delete project?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.locator('nav').getByRole('link', { name: 'Work' }),
  ).toHaveCount(0)
  const chat = pathname.replace('/c/', '/api/conversations/')
  expect((await page.request.get(chat)).status()).toBe(404)
})
