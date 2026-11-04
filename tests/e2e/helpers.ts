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
export async function appReady(page: Page) {
  const message = page.getByRole('textbox', { name: 'Message' })
  // On a touch screen the box is not focused by itself (that would raise the
  // keyboard over the page): just there.
  const touch = await page.evaluate(
    () => matchMedia('(hover: none) and (pointer: coarse)').matches,
  )
  if (touch) await expect(message).toBeVisible()
  else await expect(message).toBeFocused()
}
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

/** Puts the user settings back to the server's defaults, so specs don't affect each other. */
export async function resetSettings(page: Page) {
  const { defaults } = (await (
    await page.request.get('/api/settings')
  ).json()) as {
    defaults: Record<string, unknown>
  }
  const res = await page.request.patch('/api/settings', { data: defaults })
  expect(res.ok()).toBe(true)
}

const ANSWER = [
  'Here is a **summary** with code and a list.',
  '```ts\nexport const retry = (n: number) => n * 2\n```',
  '- First point\n- Second point\n- Third point',
].join('\n\n')

/** A saved chat of `turns` question-and-answer turns (answers have code and a list); its id. */
export async function longChat(page: Page, turns: number) {
  const items = []
  let id = 0
  for (let i = 1; i <= turns; i++) {
    items.push({
      id: ++id,
      parentId: id === 1 ? null : id - 1,
      data: { role: 'user', content: `Question ${i}` },
      usage: null,
      model: null,
      createdAt: id,
    })
    items.push({
      id: ++id,
      parentId: id - 1,
      data: {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: `msg_${id}`,
        content: [{ type: 'output_text', text: ANSWER, annotations: [] }],
      },
      usage: null,
      model: 'e2e-model',
      createdAt: id,
    })
  }
  const res = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      exportedAt: 0,
      conversation: { title: 'Long chat', createdAt: 1, updatedAt: 2 },
      currentLeafId: id,
      items,
      files: [],
    },
  })
  return ((await res.json()) as { id: string }).id
}
