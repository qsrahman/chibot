import { expect, test } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  clipboard,
  newChat,
  openChat,
  send,
  turns,
} from './helpers.ts'

// Runs against tests/e2e/fake-openai.ts, which answers
// "Answer #n to: <question>" and streams slowly when the question says "slow".

test('chats, titles the conversation, shows usage and copies', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Hello there')

  await expect(answer(page, 0)).toContainText('to: Hello there')
  await expect(page).toHaveURL(/\/c\//)
  await expect(
    page.locator('.conversation-row .sidebar-row.active'),
  ).toHaveText('E2E Title')
  await expect(
    turns(page).first().locator('.usage', { hasText: 'tokens' }),
  ).toHaveText('52 tokens')

  await answered(page)
  await turns(page).first().hover()
  await turns(page)
    .first()
    .locator('.answer-actions')
    .getByRole('button', { name: 'Copy' })
    .click()
  expect(await clipboard(page)).toContain('to: Hello there')
})

test('edits and regenerations are versions with their own follow-ups', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Q1')
  const first = turns(page).nth(0)
  await expect(answer(page, 0)).toContainText('to: Q1')
  const original = await answer(page, 0).innerText()

  await first.getByRole('button', { name: 'Regenerate' }).click()
  await expect(first.locator('.answer-actions .versions-count')).toHaveText(
    '2/2',
  )
  await expect(answer(page, 0)).not.toHaveText(original)

  await send(page, 'F1')
  await expect(answer(page, 1)).toContainText('to: F1')

  // Version 1 of the answer has no follow-up; version 2 keeps its own.
  await first
    .locator('.answer-actions')
    .getByRole('button', { name: 'Previous version' })
    .click()
  await expect(answer(page, 0)).toHaveText(original)
  await expect(turns(page)).toHaveCount(1)
  await first
    .locator('.answer-actions')
    .getByRole('button', { name: 'Next version' })
    .click()
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: F1')

  // Editing the follow-up makes a second version of that question.
  const second = turns(page).nth(1)
  await second.hover()
  await second.getByRole('button', { name: 'Edit message' }).click()
  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await editor.fill('F1 edited')
  await editor.press('Enter')
  await expect(answer(page, 1)).toContainText('to: F1 edited')
  await expect(second.locator('.user-actions .versions-count')).toHaveText(
    '2/2',
  )
  await second.hover()
  await second
    .locator('.user-actions')
    .getByRole('button', { name: 'Previous version' })
    .click()
  await expect(second.locator('.message.user')).toHaveText('F1')
  await expect(answer(page, 1)).toContainText('to: F1')
  await expect(answer(page, 1)).not.toContainText('edited')
})

// Regression: the old answer kept streaming into the other chat, then
// replaced it.
test('switching chats mid-answer stops it and keeps the partial', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Other chat')
  await expect(answer(page, 0)).toContainText('to: Other chat')
  const otherUrl = page.url()

  await newChat(page)
  await send(page, 'slow essay')
  await expect(page.locator('.message.assistant')).toContainText('word3')
  const slowUrl = page.url()

  await openChat(page, otherUrl)
  await expect(page).toHaveURL(otherUrl)
  await page.waitForTimeout(1500)
  await expect(page.locator('.thread')).not.toContainText('word')
  await expect(answer(page, 0)).toContainText('to: Other chat')
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)

  await page.goto(slowUrl)
  await expect(answer(page, 0)).toContainText('word0')
  await expect(answer(page, 0)).not.toContainText('word199')
})

// Regression: leaving a temporary chat deleted the chat navigated to next.
test('leaving a temporary chat does not delete the next chat', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Normal chat')
  await expect(answer(page, 0)).toContainText('to: Normal chat')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const normalUrl = page.url()

  await newChat(page)
  await page.getByRole('button', { name: 'Temporary chat' }).click()
  await send(page, 'Temporary chat')
  await expect(answer(page, 0)).toContainText('to: Temporary chat')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const temporaryUrl = page.url()

  await openChat(page, normalUrl)
  await expect(page).toHaveURL(normalUrl)
  await page.waitForTimeout(500)

  const normal = await page.request.get(
    `/api/conversations/${new URL(normalUrl).pathname.slice('/c/'.length)}`,
  )
  expect(normal.status()).toBe(200)
  const temporary = await page.request.get(
    `/api/conversations/${new URL(temporaryUrl).pathname.slice('/c/'.length)}`,
  )
  expect(temporary.status()).toBe(404)

  await page.reload()
  await expect(answer(page, 0)).toContainText('to: Normal chat')
})

// Regression: a failed load of the next chat used to leave the old chat's
// messages on screen.
test('a failed chat load clears the previous chat', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Alpha chat')
  await expect(answer(page, 0)).toContainText('to: Alpha chat')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const alphaUrl = page.url()

  await newChat(page)
  await send(page, 'Beta chat')
  await expect(answer(page, 0)).toContainText('to: Beta chat')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const betaUrl = page.url()

  await openChat(page, alphaUrl)
  await expect(answer(page, 0)).toContainText('to: Alpha chat')

  const betaId = new URL(betaUrl).pathname.slice('/c/'.length)
  await page.route(`**/api/conversations/${betaId}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'load failed' }),
        })
      : route.continue(),
  )
  await openChat(page, betaUrl)

  await expect(page.getByRole('alert')).toContainText('load failed')
  await expect(page.locator('.thread')).not.toContainText('to: Alpha chat')
})

// Regression: a history reload failure after an answer was silently ignored,
// dropping the answer from the screen.
test('keeps the answer when the history reload fails', async ({ page }) => {
  let fail = true
  await page.route('**/api/conversations/*', (route) => {
    if (route.request().method() !== 'GET' || !fail) return route.continue()
    fail = false
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'history unavailable' }),
    })
  })
  await page.goto('/')
  await send(page, 'Keep this answer')

  await expect(page.getByRole('alert')).toContainText('history unavailable')
  await expect(answer(page, 0)).toContainText('to: Keep this answer')
})

// Regression: revisiting the chat created by the first message showed it
// empty.
test('a just-created chat shows its messages when revisited', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Fresh chat')
  await expect(answer(page, 0)).toContainText('to: Fresh chat')
  const url = page.url()

  await newChat(page)
  await expect(page).toHaveURL(/\/$/)
  await openChat(page, url)
  await expect(answer(page, 0)).toContainText('to: Fresh chat')
})

test('keyboard shortcuts', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+/')
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await send(page, 'Shortcut chat')
  await expect(answer(page, 0)).toContainText('to: Shortcut chat')
  await answered(page)
  await page.keyboard.press('ControlOrMeta+Shift+C')
  await expect.poll(() => clipboard(page)).toContain('to: Shortcut chat')

  await page.keyboard.press('ControlOrMeta+Shift+O')
  await expect(page).toHaveURL(/\/$/)
  await page.keyboard.press('ControlOrMeta+K')
  await expect(page.getByRole('dialog', { name: 'Search chats' })).toBeVisible()
})

test('renders \\( \\) and \\[ \\] math, not raw LaTeX', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  // The fake answer repeats the question.
  await send(page, 'Area \\(x^2\\) and \\[y_1\\]')
  await answered(page)
  await expect(answer(page, 0).locator('.katex')).toHaveCount(2)
  await expect(answer(page, 0).locator('.katex-display')).toHaveCount(1)
  await expect(answer(page, 0)).not.toContainText('\\(')
})

test('jumps back to the latest message after scrolling up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 420 })
  await page.goto('/')
  await appReady(page)
  for (const text of ['First', 'Second', 'Third']) {
    await send(page, text)
    await answered(page)
  }
  const jump = page.getByRole('button', { name: 'Jump to latest' })
  await expect(jump).toHaveCount(0)

  const list = page.locator('.messages')
  await list.evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(jump).toBeVisible()
  await jump.click()
  await expect(jump).toHaveCount(0)
  expect(
    await list.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
    ),
  ).toBeLessThan(40)
})

test('opening a chat never flashes the new-chat greeting', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Gamma chat')
  await answered(page)
  const gammaUrl = page.url()
  await newChat(page)

  const gammaId = new URL(gammaUrl).pathname.slice('/c/'.length)
  await page.route(`**/api/conversations/${gammaId}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue()
  })
  await openChat(page, gammaUrl)
  // While it loads (the request is held 600 ms): not the empty page's
  // greeting. A snapshot, not a retrying assertion, which would wait it out.
  await expect(page).toHaveURL(gammaUrl)
  await page.waitForTimeout(200)
  expect(await page.locator('.greeting').count()).toBe(0)
  await expect(answer(page, 0)).toContainText('to: Gamma chat')
})
