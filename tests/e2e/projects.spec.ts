import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  await files.getByLabel('Add files (file input)').setInputFiles([
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
  await instructions.getByRole('button', { name: 'Add instructions' }).click()
  await instructions.getByLabel('Instructions').fill('Prices in yen.')
  await instructions.getByRole('button', { name: 'Save' }).click()
  // Saved: shown as a preview, above the files.
  await expect(instructions.getByText('Prices in yen.')).toBeVisible()
  await expect(
    instructions.getByRole('button', { name: 'Edit', exact: true }),
  ).toBeVisible()

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

test('adds a note, reads a whole file, and indexes a failed file again', async ({
  page,
}) => {
  await newProject(page, 'Notes')
  const files = page.getByRole('region', { name: 'Project files' })
  await files.getByRole('button', { name: 'Add note' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a note' })
  await dialog.getByLabel('Note title').fill('Codes')
  await dialog
    .getByLabel('Note', { exact: true })
    .fill('The garage code is 9027.')
  await dialog.getByRole('button', { name: 'Add note' }).click()
  await expect(files.getByText('Codes.md')).toBeVisible()
  await expect(files.getByText('Ready')).toHaveCount(1)

  // A file with no text fails, and can be tried again.
  await files.getByLabel('Add files (file input)').setInputFiles({
    name: 'empty.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('   '),
  })
  await expect(files.getByText(/Failed: found no text/)).toBeVisible()
  await files.getByRole('button', { name: 'Index empty.md again' }).click()
  await expect(files.getByText(/Failed: found no text/)).toBeVisible()

  await send(page, 'Read the whole file Codes.md')
  await answered(page)
  await expect(answer(page, 0)).toContainText('The garage code is 9027.')
})

test('adds files and folders with the keyboard alone', async ({ page }) => {
  await newProject(page, 'Keyboard')
  const files = page.getByRole('region', { name: 'Project files' })
  const note = files.getByRole('button', { name: 'Add note' })
  const addFiles = files.getByRole('button', { name: 'Add files' })
  const addFolder = files.getByRole('button', { name: 'Add folder' })

  // Tab reaches all three, in the order they are drawn.
  await note.focus()
  await page.keyboard.press('Tab')
  await expect(addFiles).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(addFolder).toBeFocused()

  // Enter opens the pickers, one for files and one for a folder.
  const files$ = page.waitForEvent('filechooser')
  await addFiles.focus()
  await page.keyboard.press('Enter')
  expect((await files$).isMultiple()).toBe(true)
  const folder$ = page.waitForEvent('filechooser')
  await addFolder.focus()
  await page.keyboard.press('Enter')
  await folder$
})

test('refuses a file that is already in the project', async ({ page }) => {
  await newProject(page, 'Dupes')
  const files = page.getByRole('region', { name: 'Project files' })
  const note = (name: string) => ({
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from('The same text.'),
  })
  await files.getByLabel('Add files (file input)').setInputFiles(note('a.md'))
  await expect(files.getByText('Ready')).toHaveCount(1)
  await files
    .getByLabel('Add files (file input)')
    .setInputFiles([note('b.md'), note('c.md')])
  await expect(page.getByRole('alert')).toContainText(
    'b.md is already in this project as a.md',
  )
  await expect(files.getByRole('listitem')).toHaveCount(1)
})

test('describes a project, and drafts its instructions from the files', async ({
  page,
}) => {
  await newProject(page, 'Trip')
  await page.getByRole('button', { name: 'Project options' }).click()
  await page
    .getByRole('menuitem', { name: 'Edit name and description' })
    .click()
  const edit = page.getByRole('dialog', { name: 'Edit project' })
  await edit.getByLabel('Description').fill('Two weeks in April')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(
    page.getByRole('main').getByText('Two weeks in April'),
  ).toBeVisible()
  await expect(
    page.locator('nav a', { hasText: 'Trip' }).first(),
  ).toHaveAttribute('title', 'Trip: Two weeks in April')

  const instructions = page.getByRole('region', {
    name: 'Project instructions',
  })
  await instructions.getByRole('button', { name: 'Add instructions' }).click()
  // The draft is based on the files, so there has to be one.
  const suggest = instructions.getByRole('button', {
    name: 'Suggest from files',
  })
  await expect(suggest).toBeDisabled()
  await page
    .getByRole('region', { name: 'Project files' })
    .getByLabel('Add files (file input)')
    .setInputFiles({
      name: 'plan.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Day 2: Kyoto.'),
    })
  await expect(page.getByText('Ready')).toBeVisible()
  await suggest.click()
  await expect(instructions.getByLabel('Instructions')).toHaveValue('E2E Title')
  await expect(instructions.getByText('Drafted from your files')).toBeVisible()
  // Nothing is saved until the user says so.
  await instructions.getByRole('button', { name: 'Cancel' }).click()
  await expect(instructions.getByText('E2E Title')).toHaveCount(0)
})

test('adds a folder, keeping paths and skipping what projects cannot use', async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'chibot-folder-'))
  try {
    for (const [path, text] of Object.entries({
      'app/docs/readme.md': '# App\n\nThe launch code is 4417.',
      'app/src/main.ts': 'export const answer = 42',
      'app/node_modules/dep/index.js': 'module.exports = 1',
      'app/logo.png': 'not really a png',
    })) {
      mkdirSync(join(dir, dirname(path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    await newProject(page, 'Code')
    const files = page.getByRole('region', { name: 'Project files' })
    await files
      .getByLabel('Add folder (file input)')
      .setInputFiles(join(dir, 'app'))
    await expect(files.getByText('app/docs/readme.md')).toBeVisible()
    await expect(files.getByText('app/src/main.ts')).toBeVisible()
    await expect(files.getByText('Ready')).toHaveCount(2)
    await expect(files.getByText('dep/index.js')).toHaveCount(0)
    await expect(files.getByText(/Skipped 2 of 4 files/)).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('adds a file dropped on the files card', async ({ page }) => {
  await newProject(page, 'Dropped')
  const files = page.getByRole('region', { name: 'Project files' })
  await files.evaluate((card) => {
    const data = new DataTransfer()
    data.items.add(
      new File(['Dropped text.'], 'drop.md', { type: 'text/markdown' }),
    )
    card.dispatchEvent(
      new DragEvent('drop', { dataTransfer: data, bubbles: true }),
    )
  })
  await expect(files.getByText('drop.md')).toBeVisible()
  await expect(files.getByText('Ready')).toBeVisible()
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
  await page.getByRole('menuitem', { name: 'Move to project…' }).click()
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
  await page.getByRole('menuitem', { name: 'Remove from project' }).click()
  await expect(chats).toHaveCount(0)
  await expect(loose).toHaveCount(1)

  // Back in, then delete the project: the chat goes with it.
  await loose.hover()
  await loose.getByRole('button', { name: /Options for/ }).click()
  await page.getByRole('menuitem', { name: 'Move to project…' }).click()
  await page
    .getByRole('dialog', { name: 'Move to project' })
    .getByRole('button', { name: 'Work' })
    .click()
  await page.locator('nav').getByRole('link', { name: 'Work' }).click()
  await page.getByRole('button', { name: 'Project options' }).click()
  await page.getByRole('menuitem', { name: 'Delete project' }).click()
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
