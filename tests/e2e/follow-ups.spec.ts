import { expect, test } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Runs against tests/e2e/fake-openai.ts, which suggests three prompts when
// asked with chibot's follow-up instructions.

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

test('suggests follow-ups after an answer, and a click sends one', async ({
  page,
}) => {
  await page.request.patch('/api/settings', {
    data: { suggestionModel: 'e2e-model' },
  })
  await page.goto('/')
  await appReady(page)
  await send(page, 'hello there')
  await answered(page)

  const group = page.getByRole('group', { name: 'Ask next' })
  await expect(group.getByRole('button')).toHaveText([
    'Tell me more',
    'Give an example',
    'Sum it up',
  ])

  await group.getByRole('button', { name: 'Give an example' }).click()
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: Give an example')
  // They belong to the answer they followed, and come again for the new one.
  await answered(page)
  await expect(group.getByRole('button')).toHaveCount(3)
})

test('shows none when the setting is off, or after reopening a chat', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'first')
  await answered(page)
  await expect(answer(page, 0)).toContainText('to: first')
  await expect(page.getByRole('group', { name: 'Ask next' })).toHaveCount(0)

  await page.request.patch('/api/settings', {
    data: { suggestionModel: 'e2e-model' },
  })
  await page.reload()
  await expect(answer(page, 0)).toContainText('to: first')
  await expect(page.getByRole('group', { name: 'Ask next' })).toHaveCount(0)
})

test('the setting switch turns them on and off', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Model', exact: true }).click()
  const toggle = dialog.getByRole('switch', { name: 'Suggest follow-ups' })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(dialog.getByLabel('Suggestion model')).toHaveValue('e2e-model')
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(dialog.getByLabel('Suggestion model')).toHaveCount(0)
  const { settings } = (await (
    await page.request.get('/api/settings')
  ).json()) as {
    settings: { suggestionModel: string }
  }
  expect(settings.suggestionModel).toBe('')
})

test('an answer with a next-step card gets the card, not suggestions', async ({
  page,
}) => {
  await page.request.patch('/api/settings', {
    data: { suggestionModel: 'e2e-model' },
  })
  await page.goto('/')
  await appReady(page)
  await send(page, 'offer-next-step please')
  await answered(page)
  await expect(page.getByRole('button', { name: 'Create plan' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Ask next' })).toHaveCount(0)

  // The plain answer after it gets its suggestions again.
  await send(page, 'and now a plain one')
  await answered(page)
  await expect(
    page.getByRole('group', { name: 'Ask next' }).getByRole('button'),
  ).toHaveCount(3)
})
