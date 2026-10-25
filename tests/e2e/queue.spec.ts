import { expect, test } from '@playwright/test'
import { answer, appReady, send, turns } from './helpers.ts'

// Runs against tests/e2e/fake-openai.ts: "drip" streams a normal answer
// slowly, so a message can be queued while it arrives.

test('queues a message while an answer streams, then sends it', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'drip one')
  // The chat gets its URL (and the composer its own draft) before typing.
  await expect(page).toHaveURL(/\/c\//)

  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('what comes next')
  await box.press('Enter')
  await expect(page.locator('.composer-queued')).toContainText(
    'what comes next',
  )

  // The queued message becomes the next turn once the first answer is saved.
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: what comes next')
  await expect(page.locator('.composer-queued')).toHaveCount(0)
  // The first question is still the one it answers.
  await expect(answer(page, 0)).toContainText('to: drip one')
})

test('a queued message can be edited back out or cancelled', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow one')
  await expect(page).toHaveURL(/\/c\//)
  const box = page.getByRole('textbox', { name: 'Message' })
  const row = page.locator('.composer-queued')

  await box.fill('first queued')
  await box.press('Enter')
  await expect(row).toContainText('first queued')

  await page.getByRole('button', { name: 'Edit queued message' }).click()
  await expect(row).toHaveCount(0)
  await expect(box).toHaveValue('first queued')

  await box.press('Enter')
  await expect(row).toContainText('first queued')
  await page.getByRole('button', { name: 'Cancel queued message' }).click()
  await expect(row).toHaveCount(0)

  await page.getByRole('button', { name: 'Stop' }).click()
})

test('sends a queued message when the answer is stopped', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow two')
  await expect(page).toHaveURL(/\/c\//)
  const box = page.getByRole('textbox', { name: 'Message' })

  await box.fill('after the stop')
  await box.press('Enter')
  await expect(page.locator('.composer-queued')).toContainText('after the stop')

  await page.getByRole('button', { name: 'Stop' }).click()
  // The stopped answer is kept, and the queued message follows it.
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: after the stop')
})
