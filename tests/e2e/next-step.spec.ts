import { expect, test } from '@playwright/test'
import { answer, answered, send, turns } from './helpers.ts'

// The next-step card under an answer. "offer-next-step" makes the fake end its
// answer with a suggest_next_step call (tests/e2e/fake-openai.ts).

const card = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Next step' })

test('shows the card under the latest answer and sends its prompt', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'offer-next-step please')
  await answered(page)
  await expect(card(page)).toContainText('Weekly learning plan')
  await expect(card(page)).toContainText(
    'Next step · turn these into a 16-week plan with milestones',
  )
  // The tool call itself is not listed as tool activity.
  await expect(page.getByText('Suggested a next step')).toHaveCount(0)

  // It is still there after a reload (it is saved with the answer).
  await page.reload()
  await expect(card(page)).toBeVisible()

  await card(page).getByRole('button', { name: 'Create plan' }).click()
  await answered(page)
  await expect(turns(page)).toHaveCount(2)
  await expect(turns(page).nth(1).locator('.message.user')).toHaveText(
    'Turn these into a 16-week plan with milestones',
  )
  await expect(answer(page, 1)).toContainText('Answer #')
  // Gone once another message follows.
  await expect(card(page)).toHaveCount(0)
})

test('is reachable by keyboard', async ({ page }) => {
  await page.goto('/')
  await send(page, 'offer-next-step please')
  await answered(page)
  const button = card(page).getByRole('button', { name: 'Create plan' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(turns(page)).toHaveCount(2)
})

test('answers without an offer show no card', async ({ page }) => {
  await page.goto('/')
  await send(page, 'plain question')
  await answered(page)
  await expect(answer(page, 0)).toContainText('Answer #')
  await expect(card(page)).toHaveCount(0)
})

test('is hidden while an answer streams, and on earlier answers', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'offer-next-step please')
  await answered(page)
  await send(page, 'plain question')
  await answered(page)
  await expect(turns(page)).toHaveCount(2)
  await expect(card(page)).toHaveCount(0)
})
