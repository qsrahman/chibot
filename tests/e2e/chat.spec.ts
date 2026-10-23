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
