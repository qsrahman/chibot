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
  await dialog.getByRole('button', { name: tab, exact: true }).click()
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
  await expect(row).toContainText('Auto')
  await row.click()
  const efforts = page.getByRole('menu', { name: 'Reasoning effort' })
  await expect(
    efforts.getByRole('menuitemradio', { name: 'Auto' }),
  ).toHaveAttribute('aria-checked', 'true')
  await efforts
    .getByRole('menuitemradio', { name: 'High', exact: true })
    .click()
  await expect(efforts).toBeHidden()
  await expect(row).toContainText('High')
  await page.keyboard.press('Escape')
  // The header shows it.
  await expect(page.locator('.model-button')).toHaveText('e2e-modelHigh')

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

test('the effort sub-menu opens on hover', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'e2e-model' }).click()
  const row = page.getByRole('button', { name: /Reasoning effort/ })
  const efforts = page.getByRole('menu', { name: 'Reasoning effort' })

  await row.hover()
  await expect(efforts).toBeVisible()
  // Moving into it keeps it open; a click on the row doesn't toggle it shut.
  await efforts.getByRole('menuitemradio', { name: 'Medium' }).hover()
  await page.waitForTimeout(400)
  await expect(efforts).toBeVisible()
  await row.click()
  await expect(efforts).toBeVisible()

  // Resting on another item closes it (the model menu stays).
  await page.getByRole('option', { name: /e2e-other/ }).hover()
  await expect(efforts).toBeHidden()
  await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible()

  await row.hover()
  await efforts.getByRole('menuitemradio', { name: 'Medium' }).click()
  await expect(row).toContainText('Medium')
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
    efforts.getByRole('menuitemradio', { name: 'Auto' }),
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
  await expect(page.locator('.model-button')).toContainText('High')
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
  await dialog.getByLabel('Chat file').setInputFiles({
    name: 'chat.json',
    mimeType: 'application/json',
    buffer: file,
  })
  await expect(page).not.toHaveURL(new RegExp(id))
  await expect(answer(page, 0)).toContainText('to: Keep this for later')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()

  // A broken file is rejected with a message.
  const data = await openSettings(page, 'Data')
  await data.getByLabel('Chat file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version": 2}'),
  })
  await expect(data.getByRole('alert')).toContainText('Import failed')
})

test('summarizes a long chat, shows the summary and undoes it', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'huge first question')
  await answered(page)
  await send(page, 'And then?')
  await answered(page)

  // The summary replaced the first turn in the request…
  const input = (await lastRequest(page)).input
  expect(JSON.stringify(input)).toContain('E2E summary')
  expect(JSON.stringify(input)).not.toContain('huge first question')
  expect(input.at(-1)).toMatchObject({ role: 'user', content: 'And then?' })

  // …and the chat shows where, opening to the summary.
  const note = page.locator('.compaction-note')
  await expect(note).toContainText('Earlier messages were summarized')
  await note.locator('summary').click()
  await expect(note).toContainText('E2E summary')
  await expect(note).toContainText('Written by e2e-model')

  // Undo brings the original messages back to the next request.
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toHaveCount(0)
  await send(page, 'After undo')
  await answered(page)
  const again = JSON.stringify((await lastRequest(page)).input)
  expect(again).toContain('huge first question')
  expect(again).not.toContain('E2E summary')
})

test('keeps chatting when the summary fails', async ({ page }) => {
  await page.goto('/')
  await send(page, 'huge fail-summary')
  await answered(page)
  await send(page, 'Still there?')
  await answered(page)

  await expect(page.locator('.status-note')).toContainText(
    'Couldn’t summarize earlier messages',
  )
  await expect(page.locator('.compaction-note')).toHaveCount(0)
  expect(JSON.stringify((await lastRequest(page)).input)).toContain(
    'huge fail-summary',
  )
})

test('summarizes on request, keeping a focus in mind', async ({ page }) => {
  await page.goto('/')
  await send(page, 'First')
  await answered(page)
  await send(page, 'Second')
  await answered(page)

  await page.getByRole('button', { name: 'Compact now' }).click()
  await page.getByLabel('What the summary should keep in mind').fill('the plan')
  await page.getByRole('button', { name: 'Summarize' }).click()
  await expect(page.locator('.compaction-note')).toContainText(
    'Earlier messages were summarized',
  )
})

test('sets the context window and when to summarize', async ({ page }) => {
  await page.goto('/')
  const model = await openSettings(page, 'Model')
  await model.getByLabel('Context window').fill('64000')
  await model.getByLabel('Context window').press('Enter')
  await expect(page.getByLabel('Context window')).toHaveValue('64000')
  await model.getByLabel('Summary model').fill('e2e-other')
  await model.getByLabel('Summary model').press('Enter')
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/settings')).json()).settings
          .summaryModel,
    )
    .toBe('e2e-other')
  await model.getByLabel('Summarize long chats').click()
  await expect(model.getByLabel('Summarize long chats')).not.toBeChecked()
  await expect(model.getByLabel('Keep recent')).toHaveCount(0)
})

test('chooses the models of images, search and voice input', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await openSettings(page, 'Other models')
  const image = dialog.getByLabel('Image model')
  const embedding = dialog.getByLabel('Embedding model')
  const voice = dialog.getByLabel('Transcription model')
  // Each shows what .env gives.
  await expect(image).toHaveValue('e2e-image')

  // A new image model is used by the next image.
  await image.fill('e2e-image-2')
  await image.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Reset' })).toBeVisible()
  await page.keyboard.press('Escape')
  await send(page, 'Please draw a robot')
  await answered(page)
  const imageRequest = await page.request.get(
    `${FAKE_OPENAI}/debug/last-image-request`,
  )
  expect(await imageRequest.json()).toMatchObject({ model: 'e2e-image-2' })

  // Emptying the voice model turns the microphone off, and says where to turn it on.
  await page.keyboard.press('ControlOrMeta+,')
  await voice.fill('')
  await voice.press('Enter')
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', {
      name: /Voice input needs a transcription model/,
    }),
  ).toHaveAttribute('aria-disabled', 'true')

  // Emptying the image model turns the image tools off, in Settings → Tools too.
  await page.keyboard.press('ControlOrMeta+,')
  await image.fill('')
  await image.press('Enter')
  await dialog.getByRole('button', { name: 'Tools' }).click()
  await expect(
    dialog.getByRole('switch', { name: 'Create images' }),
  ).toBeDisabled()
  await expect(
    dialog
      .getByText('Choose an image model in Settings → Other models')
      .first(),
  ).toBeVisible()

  await dialog.getByRole('button', { name: 'Other models' }).click()
  await expect(embedding).toBeEnabled()
  await dialog.getByRole('button', { name: 'Reset' }).first().click()
  await expect(image).toHaveValue('e2e-image')
})

test('a setting that saves at once says so for a moment', async ({ page }) => {
  await page.goto('/')
  const dialog = await openSettings(page, 'Model')
  const flash = dialog.locator('.settings-flash')
  await expect(flash).toHaveText('')
  await dialog.getByLabel('Reasoning effort').selectOption('low')
  await expect(flash).toHaveText('Saved')
  await expect(flash).toHaveText('', { timeout: 5000 })

  // A failed save says nothing of the sort.
  await page.route('**/api/settings', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { error: 'Disk full' } })
      : route.continue(),
  )
  await dialog.getByLabel('Reasoning effort').selectOption('high')
  await expect(dialog.getByRole('alert')).toContainText('Disk full')
  await expect(flash).toHaveText('')
  await page.unroute('**/api/settings')
})

test('Data shows how to back up, and copies the command', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Data' }).click()
  await expect(dialog).toContainText('Back up everything')
  await dialog.getByRole('button', { name: 'Copy command' }).click()
  await expect(
    page.locator('.toast-message', { hasText: 'Copied “chibot backup”' }),
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'chibot backup',
  )
})

test('warns when the server runs the model with less than the window set', async ({
  page,
}) => {
  await page.route('**/api/models/window*', (route) =>
    route.fulfill({ json: { window: 8000 } }),
  )
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Model', exact: true }).click()
  const row = dialog.locator('.settings-row').filter({
    has: page.locator('#setting-window'),
  })
  await expect(row).toContainText(
    'runs e2e-model with 8,000, below this setting',
  )
  await row.getByRole('button', { name: 'Use 8,000' }).click()
  await expect(page.locator('#setting-window')).toHaveValue('8000')
  await expect(row).not.toContainText('below this setting')
  await resetSettings(page)
})
