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

// Phase 4: model picker, settings, thinking, theme, export/import and
// compaction, against tests/e2e/fake-openai.ts. Settings live on the shared
// server, so each test puts them back.

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

async function openSettings(page: Page, tab: string) {
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: tab }).click()
  return dialog
}

test('picks a model and labels answers with it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'e2e-model' }).click()
  await page.getByRole('textbox', { name: 'Search models' }).fill('other')
  await page.getByRole('option', { name: 'e2e-other' }).click()
  await expect(page.getByRole('button', { name: 'e2e-other' })).toBeVisible()

  await send(page, 'Which model?')
  await answered(page)
  expect((await lastRequest(page)).model).toBe('e2e-other')
  await expect(
    turns(page).first().locator('.usage', { hasText: 'e2e-other' }),
  ).toBeVisible()

  // The choice survives a reload (it's a saved setting).
  await page.reload()
  await expect(page.getByRole('button', { name: 'e2e-other' })).toBeVisible()
})

test('picks the reasoning effort in the model menu', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'e2e-model' }).click()
  // A row in the model menu opens a sub-menu beside it.
  const row = page.getByRole('button', { name: /Reasoning effort/ })
  await expect(row).toContainText('Default')
  await row.click()
  const efforts = page.getByRole('menu', { name: 'Reasoning effort' })
  await expect(
    efforts.getByRole('menuitemradio', { name: 'Default' }),
  ).toHaveAttribute('aria-checked', 'true')
  await efforts
    .getByRole('menuitemradio', { name: 'high', exact: true })
    .click()
  await expect(efforts).toBeHidden()
  await expect(row).toContainText('high')
  await page.keyboard.press('Escape')
  // The header shows it.
  await expect(page.locator('.model-button')).toHaveText('e2e-modelhigh')

  await send(page, 'Hello')
  await answered(page)
  expect((await lastRequest(page)).reasoning).toEqual({
    summary: 'auto',
    effort: 'high',
  })
  // It's the same setting as in Settings.
  const dialog = await openSettings(page, 'Model')
  await expect(dialog.getByLabel('Reasoning effort')).toHaveValue('high')
})

test('the effort sub-menu works from the keyboard', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'e2e-model' }).click()
  // The menu focuses its search box once open; then go to the row.
  await expect(
    page.getByRole('textbox', { name: 'Search models' }),
  ).toBeFocused()
  const row = page.getByRole('button', { name: /Reasoning effort/ })
  await row.focus()
  await page.keyboard.press('ArrowRight')
  const efforts = page.getByRole('menu', { name: 'Reasoning effort' })
  // Opens on its first item; ← goes back to the row, the model menu stays.
  await expect(
    efforts.getByRole('menuitemradio', { name: 'Default' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(efforts).toBeHidden()
  await expect(row).toBeFocused()
  await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible()
  // Esc in the sub-menu closes only the sub-menu.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(efforts).toBeHidden()
  await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible()
})

test('switches to Thinking mode in the composer', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Mode: Auto' }).click()
  await page.getByRole('menuitemradio', { name: /Thinking/ }).click()
  await expect(
    page.getByRole('button', { name: 'Mode: Thinking' }),
  ).toBeVisible()

  await send(page, 'Hello')
  await answered(page)
  expect((await lastRequest(page)).reasoning).toEqual({
    summary: 'auto',
    effort: 'high',
  })
  // One setting: the header's model menu shows it too.
  await expect(page.locator('.model-button')).toContainText('high')
})

test('applies reasoning effort and custom instructions', async ({ page }) => {
  await page.goto('/')
  let dialog = await openSettings(page, 'Model')
  await dialog.getByLabel('Reasoning effort').selectOption('high')
  await dialog.getByRole('button', { name: 'Personalization' }).click()
  await dialog.getByLabel('How should chibot respond?').fill('Be brief.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText('Saved')).toBeVisible()
  await page.keyboard.press('Escape')

  await send(page, 'Hello')
  await answered(page)
  const sent = await lastRequest(page)
  expect(sent.reasoning).toEqual({ summary: 'auto', effort: 'high' })
  expect(sent.instructions).toContain('Be brief.')

  // Settings show what was saved when reopened.
  dialog = await openSettings(page, 'Model')
  await expect(dialog.getByLabel('Reasoning effort')).toHaveValue('high')
})

test('shows the model thinking, live and after a reload', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please think first')
  await expect(page.getByText('Thinking…')).toBeVisible()
  await answered(page)

  const thoughts = turns(page).first().locator('.thoughts')
  await expect(thoughts.locator('summary')).toHaveText('Thoughts')
  await thoughts.locator('summary').click()
  await expect(thoughts).toContainText('Considering the question carefully.')

  await page.reload()
  await expect(turns(page).first().locator('.thoughts summary')).toHaveText(
    'Thoughts',
  )
})

test('switches and remembers the theme', async ({ page }) => {
  const background = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  expect(await background()).toBe('rgb(252, 252, 252)')

  const dialog = await openSettings(page, 'General')
  await dialog.getByLabel('Theme').selectOption('dark')
  expect(await background()).toBe('rgb(0, 0, 0)')

  // Applied before the app loads, so there's no flash of the light theme.
  await page.reload()
  expect(await background()).toBe('rgb(0, 0, 0)')

  const again = await openSettings(page, 'General')
  await again.getByLabel('Theme').selectOption('system')
  expect(await background()).toBe('rgb(252, 252, 252)')
  expect(
    await page.evaluate(() => localStorage.getItem('chibot.colorScheme')),
  ).toBeNull()
})

test('exports a chat and imports it back', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Keep this for later')
  await answered(page)
  const id = new URL(page.url()).pathname.split('/').pop()!

  const exported = await page.request.get(
    `/api/conversations/${id}/export?format=json`,
  )
  expect(exported.headers()['content-disposition']).toContain('attachment')
  const file = await exported.body()

  const dialog = await openSettings(page, 'Data')
  await dialog.getByLabel('Import a chat').setInputFiles({
    name: 'chat.json',
    mimeType: 'application/json',
    buffer: file,
  })
  await expect(page).not.toHaveURL(new RegExp(id))
  await expect(answer(page, 0)).toContainText('to: Keep this for later')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()

  // A broken file is rejected with a message.
  const data = await openSettings(page, 'Data')
  await data.getByLabel('Import a chat').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version": 2}'),
  })
  await expect(data.getByRole('alert')).toContainText('Import failed')
})

test('compacts long chats and continues from the compaction', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Please compact now')
  await answered(page)
  await expect(
    page.getByText('Earlier messages were summarized to save context.'),
  ).toBeVisible()
  expect((await lastRequest(page)).context_management).toEqual([
    { type: 'compaction', compact_threshold: 64_000 },
  ])

  await send(page, 'And then?')
  await answered(page)
  // The question before the compaction is dropped: the input starts at the
  // compaction item and ends with the new question.
  const input = (await lastRequest(page)).input
  expect(input.map((i) => i.type ?? i.role)).toEqual([
    'compaction',
    'message',
    'user',
  ])
})
