import { expect, type Page } from '@playwright/test'

// Shared steps for the specs in this folder.

export const FAKE_OPENAI = 'http://127.0.0.1:4010'

export async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill(text)
  await box.press('Enter')
}

export const turns = (page: Page) => page.locator('.turn')
export const answer = (page: Page, index: number) =>
  turns(page).nth(index).locator('.message.assistant')
export const clipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText())
// The toolbar link; conversation rows can also be titled "New chat".
export async function newChat(page: Page) {
  await page.locator('nav.sidebar > a[aria-label="New chat"]').click()
  await expect(page.locator('.greeting')).toBeVisible()
}

/**
 * The answer is complete: streamed text is visible before the turn is
 * saved, and copy actions only see saved answers.
 */
export const answered = (page: Page) =>
  expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)

/** Shortcut listeners attach after the first render; wait for the app. */
export const appReady = (page: Page) =>
  expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused()
export const openChat = (page: Page, url: string) =>
  page.locator(`.conversation-row a[href="${new URL(url).pathname}"]`).click()

/** What chibot last sent to the fake server's chat endpoint. */
export async function lastRequest(page: Page) {
  const res = await page.request.get(`${FAKE_OPENAI}/debug/last-request`)
  return (await res.json()) as Record<string, unknown> & {
    model: string
    instructions?: string
    reasoning?: { effort?: string; summary?: string }
    input: { type?: string; role?: string }[]
  }
}

/** Puts the user settings back, so specs don't affect each other. */
export async function resetSettings(page: Page) {
  const res = await page.request.patch('/api/settings', {
    data: {
      model: 'e2e-model',
      reasoningEffort: null,
      aboutUser: '',
      responseStyle: '',
      compactThreshold: 64_000,
      disabledTools: [],
      disabledMcpServers: [],
      askMcpServers: [],
    },
  })
  expect(res.ok()).toBe(true)
}
