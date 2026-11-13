import { expect, test, type Page } from '@playwright/test'
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
    turns(page).first().locator('.usage', { hasText: 'context' }),
  ).toHaveText('40 / 32K context')

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
  // As a person does: the wheel, not a script.
  await list.hover()
  await page.mouse.wheel(0, -5000)
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

test('the tab title names the chat on screen', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await expect(page).toHaveTitle('chibot')
  await send(page, 'Name this chat')
  await answered(page)
  // Screen readers hear that the answer arrived.
  await expect(page.getByRole('status')).toHaveText('Answer ready')
  // The fake server titles every chat "E2E Title".
  await expect(page).toHaveTitle('E2E Title – chibot')

  // A rename in the sidebar shows up too.
  const { pathname } = new URL(page.url())
  const row = page
    .locator('nav .conversation-row')
    .filter({ has: page.locator(`a[href="${pathname}"]`) })
  await row.hover()
  await row.getByRole('button', { name: /Options for/ }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Chat title' })
  await field.fill('Renamed chat')
  await field.press('Enter')
  await expect(page).toHaveTitle('Renamed chat – chibot')

  await newChat(page)
  await expect(page).toHaveTitle('chibot')
})

test('names a chat again from its menu', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Name me again')
  await answered(page)
  await expect(page).toHaveTitle('E2E Title – chibot')

  const { pathname } = new URL(page.url())
  const row = page
    .locator('nav .conversation-row')
    .filter({ has: page.locator(`a[href="${pathname}"]`) })
  const menu = async (item: string) => {
    await row.hover()
    await row.getByRole('button', { name: /Options for/ }).click()
    await page.getByRole('menuitem', { name: item, exact: true }).click()
  }
  await menu('Rename')
  const field = page.getByRole('textbox', { name: 'Chat title' })
  await field.fill('My own name')
  await field.press('Enter')
  await expect(page).toHaveTitle('My own name – chibot')

  // The fake server titles every chat "E2E Title".
  await menu('Regenerate title')
  await expect(page).toHaveTitle('E2E Title – chibot')
})

test('an unsent message survives a reload', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Keep my draft')
  await answered(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Half-written thought')
  await page.reload()
  await expect(box).toHaveValue('Half-written thought')

  // Sending it clears the saved draft.
  await box.press('Enter')
  await answered(page)
  await page.reload()
  await expect(box).toHaveValue('')
})

test('↑ in an empty message box edits your last message', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Frist try')
  await answered(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.press('ArrowUp')
  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Frist try')
  await editor.fill('First try')
  await editor.press('Enter')
  await answered(page)
  await expect(answer(page, 0)).toContainText('to: First try')

  // Not while there's text in the box: ↑ moves the cursor as usual.
  await box.fill('Something else')
  await box.press('ArrowUp')
  await expect(editor).toHaveCount(0)
})

test('says when chibot can’t be reached, and recovers when it can', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Before')
  await answered(page)

  // The server goes away: a message fails with words, and stays to be sent again.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await send(page, 'While down')
  await expect(page.getByRole('alert')).toContainText('Can’t reach chibot')
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'While down',
  )

  // The chat list says so too, and a button asks again.
  await page.reload().catch(() => {})
  await page.unroute('**/api/**')
  await page.route('**/api/conversations', (route) =>
    route.abort('connectionrefused'),
  )
  await page.reload()
  const note = page.getByRole('alert').filter({ hasText: 'Can’t reach chibot' })
  await expect(note).toBeVisible()
  await expect(note).toHaveCount(1)
  await page.unroute('**/api/conversations')
  await note.getByRole('button', { name: 'Try again' }).click()
  await expect(note).toHaveCount(0)
  await expect(
    page
      .locator('.conversation-row')
      .filter({ hasText: /Before|E2E Title/ })
      .first(),
  ).toBeVisible()
})

test('a message with other versions shows them without hovering', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Versions one')
  await answered(page)
  const first = turns(page).first()
  await first.hover()
  await first.getByRole('button', { name: 'Edit message' }).click()
  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await editor.fill('Versions two')
  await editor.press('Enter')
  await answered(page)
  await send(page, 'Follow-up')
  await answered(page)

  // Not the latest turn, and the pointer is elsewhere.
  await page.getByRole('textbox', { name: 'Message' }).hover()
  const opacity = (selector: string) =>
    first
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).opacity)
  expect(await opacity('.user-actions .versions')).toBe('1')
  expect(await opacity('.user-actions .versions .action')).toBe('1')
  // Copy and edit wait for the pointer.
  const copy = first.locator('.user-actions > .action').first()
  await expect
    .poll(() => copy.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0')
})

test('an empty chat offers ways to start, which fill the box', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await page.getByRole('button', { name: 'Draft an email' }).click()
  await expect(box).toHaveValue('Help me write an email to ')
  await expect(box).toBeFocused()
  // The caret is after the text, so typing carries on from it.
  await page.keyboard.type('my landlord')
  await expect(box).toHaveValue('Help me write an email to my landlord')
  // Another suggestion replaces it.
  await page.getByRole('button', { name: 'Explain a topic' }).click()
  await expect(box).toHaveValue('Explain step by step how ')

  await box.press('Enter')
  await answered(page)
  // Gone once there are messages.
  await expect(page.locator('.suggestions')).toHaveCount(0)
})

test('a temporary chat has no suggestions, and an empty history says so', async ({
  page,
}) => {
  await page.route('**/api/conversations', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: [] })
      : route.continue(),
  )
  await page.goto('/')
  await appReady(page)
  await expect(
    page.getByText('No chats yet. Your conversations appear here.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Temporary chat' }).click()
  await expect(
    page.getByRole('heading', { name: 'Temporary chat' }),
  ).toBeVisible()
  await expect(page.locator('.suggestions')).toHaveCount(0)
})

// A saved chat whose one answer is `answer`.
async function chatAnswering(page: Page, answer: string) {
  const res = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      exportedAt: 0,
      conversation: { title: 'Code chat', createdAt: 1, updatedAt: 2 },
      currentLeafId: 2,
      items: [
        {
          id: 1,
          parentId: null,
          data: { role: 'user', content: 'Show code' },
          usage: null,
          model: null,
          createdAt: 1,
        },
        {
          id: 2,
          parentId: 1,
          data: {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            id: 'msg_2',
            content: [{ type: 'output_text', text: answer, annotations: [] }],
          },
          usage: null,
          model: 'e2e-model',
          createdAt: 2,
        },
      ],
      files: [],
    },
  })
  return ((await res.json()) as { id: string }).id
}

test('code blocks: lines wrap on request, long ones are numbered, copying says so', async ({
  page,
}) => {
  const long = Array.from(
    { length: 14 },
    (_, i) => `const line${i + 1} = ${i + 1}`,
  )
  long[2] = `const wide = '${'x'.repeat(300)}'`
  const id = await chatAnswering(
    page,
    [
      'Short:',
      '```ts\nconst a = 1\n```',
      'Long:',
      '```ts\n' + long.join('\n') + '\n```',
    ].join('\n\n'),
  )
  await page.goto(`/c/${id}`)
  const short = page.locator('.code-block').nth(0)
  const tall = page.locator('.code-block').nth(1)

  // Only the long block is numbered, and the numbers are not in what is copied.
  await expect(short.locator('.code-lines')).toHaveCount(0)
  await expect(tall.locator('.code-lines')).toContainText('14')
  await expect(tall.locator('.code-lines')).toHaveAttribute(
    'aria-hidden',
    'true',
  )

  // A long line scrolls sideways until wrapping is asked for.
  const scrolls = () =>
    tall.locator('pre').evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(await scrolls()).toBe(true)
  const wrap = tall.getByRole('button', { name: 'Wrap lines' })
  await expect(wrap).toHaveAttribute('aria-pressed', 'false')
  await wrap.click()
  await expect(wrap).toHaveAttribute('aria-pressed', 'true')
  expect(await scrolls()).toBe(false)
  // Wrapped lines would not line up with numbers, so they go.
  await expect(tall.locator('.code-lines')).toHaveCount(0)
  await wrap.click()
  await expect(tall.locator('.code-lines')).toHaveCount(1)

  // Copying is said to screen readers as well as shown.
  await tall.getByRole('button', { name: 'Copy code' }).click()
  await expect(page.locator('.toast-live')).toHaveText('Copied')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('const line1 = 1')
  expect(copied).not.toMatch(/^1\n2\n/)
})

// While an answer streams the view follows its end, until the user scrolls
// up to read: then it stays put and offers a way back.
for (const motion of ['no-preference', 'reduce'] as const) {
  test(`stops following a streaming answer once scrolled up, and returns on request (${motion} motion)`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.emulateMedia({ reducedMotion: motion })
    await page.setViewportSize({ width: 560, height: 380 })
    await page.goto('/')
    await appReady(page)
    await send(page, 'slow essay')
    const list = page.locator('.messages')
    const fromBottom = () =>
      list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)

    // Long enough to scroll (judged by the words that have arrived: an offscreen
    // turn is given an estimated height at first, which can look like overflow
    // for a moment), and following it.
    await expect(page.locator('.message.assistant')).toContainText('word70', {
      timeout: 15_000,
    })
    expect(
      await list.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeGreaterThan(100)
    await expect.poll(fromBottom).toBeLessThan(40)

    // As a person does it: the wheel, whose scroll the page sees as the user's.
    await list.hover()
    await page.mouse.wheel(0, -10_000)
    const jump = page.getByRole('button', { name: 'Jump to latest' })
    await expect(jump).toBeVisible()
    // More arrives; the view is not pulled back down.
    const height = await list.evaluate((el) => el.scrollHeight)
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
      .toBeGreaterThan(height + 30)
    expect(await list.evaluate((el) => el.scrollTop)).toBeLessThan(5)

    await jump.click()
    await expect(jump).toHaveCount(0)
    await expect.poll(fromBottom).toBeLessThan(40)
    // …and it follows again.
    const was = await list.evaluate((el) => el.scrollHeight)
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
      .toBeGreaterThan(was + 30)
    await expect.poll(fromBottom).toBeLessThan(40)
    await page.getByRole('button', { name: 'Stop' }).click()
  })
}

test('a stopped answer offers Continue and Regenerate, also after a reload', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow story')
  await expect(page.locator('.message.assistant')).toContainText('word3')
  await page.getByRole('button', { name: 'Stop' }).click()
  const recovery = page.getByRole('group', { name: 'Answer interrupted' })
  await expect(recovery).toContainText('stopped before it was finished')
  // Just stopped, the chat has no ids to regenerate from yet; Continue works.
  await expect(recovery.getByRole('button', { name: 'Continue' })).toBeVisible()

  // Still there once the page has loaded the saved chat, now with Regenerate.
  await expect.poll(() => page.url()).toMatch(/\/c\//)
  await page.reload()
  await expect(
    recovery.getByRole('button', { name: 'Regenerate' }),
  ).toBeVisible()

  await recovery.getByRole('button', { name: 'Continue' }).click()
  await answered(page)
  await expect(turns(page)).toHaveCount(2)
  await expect(turns(page).nth(1).locator('.message.user')).toHaveText(
    'Please continue from where you stopped.',
  )
  // The new answer is whole, so only the latest turn is judged and it is fine.
  await expect(recovery).toHaveCount(0)
})

test('Regenerate on a stopped answer writes a new version', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow poem')
  await expect(page.locator('.message.assistant')).toContainText('word3')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect.poll(() => page.url()).toMatch(/\/c\//)
  await page.reload()
  const recovery = page.getByRole('group', { name: 'Answer interrupted' })
  await recovery.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.reload()
  await expect(
    turns(page).first().locator('.answer-actions .versions-count'),
  ).toHaveText('2/2')
})

test('links to an answer’s sources are numbered, and say which page they are', async ({
  page,
}) => {
  const item = (id: number, parentId: number | null, data: unknown) => ({
    id,
    parentId,
    data,
    usage: null,
    model: id === 1 ? null : 'e2e-model',
    createdAt: id,
  })
  const res = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      exportedAt: 0,
      conversation: { title: 'Cited chat', createdAt: 1, updatedAt: 2 },
      currentLeafId: 4,
      items: [
        item(1, null, { role: 'user', content: 'Robots?' }),
        item(2, 1, {
          type: 'function_call',
          call_id: 'c1',
          name: 'web_search',
          arguments: '{"query":"robots","freshness":null}',
        }),
        item(3, 2, {
          type: 'function_call_output',
          call_id: 'c1',
          output: JSON.stringify({
            results: [
              {
                title: 'Robots guide',
                url: 'https://example.com/robots',
                snippet: 's',
              },
              {
                title: 'History of robots',
                url: 'https://history.test/r',
                snippet: 's',
              },
            ],
          }),
        }),
        item(4, 3, {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          id: 'm4',
          content: [
            {
              type: 'output_text',
              text: 'See [the guide](https://example.com/robots), [the history](https://history.test/r#top) and [an unrelated page](https://elsewhere.test/).',
              annotations: [],
            },
          ],
        }),
      ],
      files: [],
    },
  })
  const { id } = (await res.json()) as { id: string }
  await page.goto(`/c/${id}`)
  const message = page.locator('.message.assistant')
  const guide = message.getByRole('link', { name: /the guide/ })
  const history = message.getByRole('link', { name: /the history/ })
  // Numbered as in the Sources list (the fragment makes no difference)…
  await expect(guide.locator('.cite-num')).toHaveText('1')
  await expect(history.locator('.cite-num')).toHaveText('2')
  // …but a link to anywhere else is left alone.
  await expect(
    message
      .getByRole('link', { name: 'an unrelated page' })
      .locator('.cite-num'),
  ).toHaveCount(0)

  // Hovering or focusing shows which page it is; Esc hides it.
  const cardOf = (link: typeof guide) =>
    link.locator('xpath=following-sibling::*[@role="tooltip"]')
  await expect(cardOf(guide)).toBeHidden()
  await guide.hover()
  await expect(cardOf(guide)).toContainText('Robots guide')
  await expect(cardOf(guide)).toContainText('example.com')
  await expect(cardOf(guide)).toContainText('Source 1 of 2')
  await page.keyboard.press('Escape')
  await expect(cardOf(guide)).toBeHidden()
  await page.mouse.move(5, 5)
  await history.focus()
  await expect(cardOf(history)).toContainText('History of robots')

  // The list under the answer is numbered the same way.
  await page.getByText('Sources · 2').click()
  await expect(page.locator('.sources .source-num').first()).toHaveText('1')
})

test('quotes selected text from an answer into the message box', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Quote me')
  await answered(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('My reply')

  await page.locator('.message.assistant p').first().click({ clickCount: 3 })
  await page.getByRole('button', { name: 'Quote' }).click()
  await expect(box).toHaveValue(/^My reply\n\n> Answer #\d+ to: Quote me\n\n$/)
  await expect(box).toBeFocused()
  // The selection is cleared with the button.
  await expect(page.getByRole('button', { name: 'Quote' })).toHaveCount(0)

  // Text selected in the message box itself is not offered.
  await box.selectText()
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Quote' })).toHaveCount(0)
})

test('branches a chat into a new one, leaving the original alone', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Branch me')
  await answered(page)
  await send(page, 'And then')
  await answered(page)
  const original = page.url()

  // The first turn: the copy ends at its answer.
  await turns(page)
    .nth(0)
    .getByRole('button', { name: 'Branch in new chat' })
    .click()
  await expect(page).not.toHaveURL(original)
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+$/)
  await expect(turns(page)).toHaveCount(1)
  await expect(answer(page, 0)).toContainText(/Answer #\d+ to: Branch me/)

  // Carrying on there does not touch the first chat.
  await send(page, 'Different way')
  await answered(page)
  await expect(turns(page)).toHaveCount(2)
  await openChat(page, original)
  await expect(turns(page)).toHaveCount(2)
  await expect(answer(page, 1)).toContainText('to: And then')
})

test('text in Urdu or Arabic runs right to left, English stays left to right', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  const direction = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => getComputedStyle(el).direction)

  await box.fill('مجھے ایک فہرست دیں')
  expect(await direction(box)).toBe('rtl')
  await box.fill('Give me a list')
  expect(await direction(box)).toBe('ltr')

  await send(page, 'مرحبا بالعالم')
  await answered(page)
  expect(await direction(page.locator('.message.user p').last())).toBe('rtl')

  // An answer chooses per block; code stays left to right.
  await send(page, 'rtl-markdown')
  // Once it is saved: the streamed answer is replaced by the saved one.
  await answered(page)
  await expect(page.locator('.markdown h1').last()).toHaveText('عنوان')
  const markdown = page.locator('.markdown').last()
  for (const tag of ['h1', 'p', 'ul'])
    expect(await direction(markdown.locator(tag).first())).toBe('rtl')
  expect(await direction(markdown.locator('pre'))).toBe('ltr')
})
