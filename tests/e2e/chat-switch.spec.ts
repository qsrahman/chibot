import { expect, test, type Page } from '@playwright/test'
import { answer, answered, newChat, openChat, send, turns } from './helpers.ts'

// What a request that was still running when the user opened another chat may
// do to the chat on screen: nothing. Each test holds the reload that follows a
// version switch, a summary or an Undo (a held request is deterministic, where
// a sleep is a guess), leaves the chat, then lets it arrive.

const chatId = (page: Page) => new URL(page.url()).pathname.slice('/c/'.length)

/** Holds the next load of chat `id` until `release()`; `arrived` says it is waiting. */
async function holdLoad(page: Page, id: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let arrive!: () => void
  const arrived = new Promise<void>((resolve) => (arrive = resolve))
  await page.route(`**/api/conversations/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    arrive()
    await gate
    await route.continue()
  })
  return {
    arrived,
    /** Lets the load through and waits until the page has had time to show it. */
    async release() {
      const done = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/conversations/${id}`) &&
          r.request().method() === 'GET',
      )
      release()
      await done
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
    },
  }
}

/** Two saved chats, the first with two answers; the page is left on the first. */
async function twoChats(page: Page) {
  await page.goto('/')
  await send(page, 'Alpha one')
  await answered(page)
  await send(page, 'Alpha two')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const alpha = page.url()

  await newChat(page)
  await send(page, 'Beta chat')
  await expect(answer(page, 0)).toContainText('to: Beta chat')
  await answered(page)
  await expect(page).toHaveURL(/\/c\//)
  const beta = page.url()

  await openChat(page, alpha)
  await expect(answer(page, 1)).toContainText('to: Alpha two')
  return { alpha, beta }
}

async function expectBeta(page: Page) {
  await expect(turns(page)).toHaveCount(1)
  await expect(answer(page, 0)).toContainText('to: Beta chat')
  await expect(page.locator('.compaction-note')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
}

test('a version switch finishing after leaving the chat does not change the next chat', async ({
  page,
}) => {
  const { alpha, beta } = await twoChats(page)
  const first = turns(page).nth(0)
  await first.getByRole('button', { name: 'Regenerate' }).click()
  await expect(first.locator('.answer-actions .versions-count')).toHaveText(
    '2/2',
  )

  const load = await holdLoad(page, chatId(page))
  await first
    .locator('.answer-actions')
    .getByRole('button', { name: 'Previous version' })
    .click()
  await load.arrived
  await openChat(page, beta)
  await expectBeta(page)

  await load.release()
  await expectBeta(page)
  // Back in the first chat, the version that was chosen is the one shown.
  await openChat(page, alpha)
  await expect(
    turns(page).nth(0).locator('.answer-actions .versions-count'),
  ).toHaveText('1/2')
})

test('a summary finishing after leaving the chat does not appear in the next chat', async ({
  page,
}) => {
  const { alpha, beta } = await twoChats(page)
  const load = await holdLoad(page, chatId(page))
  await page.getByRole('button', { name: 'Compact now' }).click()
  await page.getByRole('button', { name: 'Summarize' }).click()
  await load.arrived
  await openChat(page, beta)
  await expectBeta(page)

  await load.release()
  await expectBeta(page)
  await openChat(page, alpha)
  await expect(page.locator('.compaction-note')).toContainText(
    'Earlier messages were summarized',
  )
})

test('an Undo finishing after leaving the chat does not change the next chat', async ({
  page,
}) => {
  const { alpha, beta } = await twoChats(page)
  await page.getByRole('button', { name: 'Compact now' }).click()
  await page.getByRole('button', { name: 'Summarize' }).click()
  const note = page.locator('.compaction-note')
  await expect(note).toContainText('Earlier messages were summarized')
  await note.locator('summary').click()

  const load = await holdLoad(page, chatId(page))
  await note.getByRole('button', { name: 'Undo' }).click()
  await load.arrived
  await openChat(page, beta)
  await expectBeta(page)

  await load.release()
  await expectBeta(page)
  await openChat(page, alpha)
  await expect(page.locator('.compaction-note')).toHaveCount(0)
})

test('an Undo that fails after leaving the chat shows no error in the next chat', async ({
  page,
}) => {
  const { alpha, beta } = await twoChats(page)
  await page.getByRole('button', { name: 'Compact now' }).click()
  await page.getByRole('button', { name: 'Summarize' }).click()
  const note = page.locator('.compaction-note')
  await expect(note).toContainText('Earlier messages were summarized')
  await note.locator('summary').click()

  let fail!: () => void
  const gate = new Promise<void>((resolve) => (fail = resolve))
  let arrive!: () => void
  const arrived = new Promise<void>((resolve) => (arrive = resolve))
  await page.route('**/api/conversations/*/compactions/*', async (route) => {
    if (route.request().method() === 'GET') return route.fallback()
    arrive()
    await gate
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'undo failed' }),
    })
  })
  await note.getByRole('button', { name: 'Undo' }).click()
  await arrived
  await openChat(page, beta)
  await expectBeta(page)

  fail()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() => requestAnimationFrame(resolve), 300),
      ),
  )
  await expectBeta(page)
  // The Undo never happened: the summary is still in the first chat.
  await openChat(page, alpha)
  await expect(note).toContainText('Earlier messages were summarized')
})
