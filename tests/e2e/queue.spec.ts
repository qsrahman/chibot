import { expect, test, type Page } from '@playwright/test'
import { FAKE_OPENAI, answer, appReady, send, turns } from './helpers.ts'

// Runs against tests/e2e/fake-openai.ts: "hold" streams the first word of a
// normal answer and waits there until the test lets it finish, so a message can
// be queued while it arrives however slow the machine is (a timer would race
// the test: the answer could end before the page got round to the queue).

// The address changes before the page does, and text typed in between goes to
// the draft of the "new chat" page and is gone when the chat's own draft takes
// over (a slow machine shows it). The sidebar marks the open chat once the
// page has moved.
const opened = (page: Page) =>
  expect(page.locator('a.sidebar-row[aria-current="page"]')).toBeAttached()

test('queues a message while an answer streams, then sends it', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'hold one')
  // The chat has its own page (and the composer its own draft) before typing.
  await opened(page)

  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('what comes next')
  await box.press('Enter')
  await expect(page.locator('.composer-queued')).toContainText(
    'what comes next',
  )

  // The queued message becomes the next turn once the first answer is saved.
  await page.request.post(`${FAKE_OPENAI}/debug/release`)
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: what comes next')
  await expect(page.locator('.composer-queued')).toHaveCount(0)
  // The first question is still the one it answers.
  await expect(answer(page, 0)).toContainText('to: hold one')
})

test('a queued message can be edited back out or cancelled', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow one')
  await opened(page)
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
  await opened(page)
  const box = page.getByRole('textbox', { name: 'Message' })

  await box.fill('after the stop')
  await box.press('Enter')
  await expect(page.locator('.composer-queued')).toContainText('after the stop')

  await page.getByRole('button', { name: 'Stop' }).click()
  // The stopped answer is kept, and the queued message follows it.
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: after the stop')
})
