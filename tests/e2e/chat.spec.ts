import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  clipboard,
  newChat,
  openChat,
  savedChat,
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
  // The sidebar's own note (the banner says it too, once it has noticed).
  const note = page
    .locator('nav.sidebar')
    .getByRole('alert')
    .filter({ hasText: 'Can’t reach chibot' })
  await expect(note).toBeVisible()
  await expect(note).toHaveCount(1)
  await page.unroute('**/api/conversations')
  // The page looks again by itself (see connection.spec.ts), or the button asks now.
  await note
    .getByRole('button', { name: 'Try again' })
    .click({ timeout: 1000 })
    .catch(() => {})
  await expect(note).toHaveCount(0, { timeout: 10_000 })
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
  // Starters are for a first visit: with chats to go back to, those show.
  await page.route('**/api/conversations', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: [] })
      : route.continue(),
  )
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }))
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

// 84 lines, the last one distinctive.
const LONG_CODE =
  '```py\n' +
  Array.from({ length: 83 }, (_, i) => `x${i + 1} = ${i + 1}`).join('\n') +
  '\nneedle_at_the_end = True\n```'

test('code blocks: wrapping is one preference for all blocks, and is kept', async ({
  page,
}) => {
  const wide = "```ts\nconst wide = '" + 'x'.repeat(300) + "'\n```"
  const id = await chatAnswering(page, [wide, wide].join('\n\n'))
  await page.goto(`/c/${id}`)
  const [first, second] = [0, 1].map((n) => page.locator('.code-block').nth(n))
  const whiteSpace = (block: typeof first) =>
    block.locator('pre').evaluate((el) => getComputedStyle(el).whiteSpace)
  expect(await whiteSpace(first)).toBe('pre')

  const wrap = first.getByRole('button', { name: 'Wrap lines' })
  await expect(wrap).toHaveAttribute('title', 'Wrap lines')
  await wrap.click()
  await expect(wrap).toHaveAttribute('title', "Don't wrap")
  expect(await whiteSpace(first)).toBe('pre-wrap')
  expect(await whiteSpace(second)).toBe('pre-wrap')

  await page.reload()
  await expect(
    page
      .locator('.code-block')
      .first()
      .getByRole('button', { name: 'Wrap lines' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Settings has the same switch.
  await page.getByRole('button', { name: 'Settings' }).click()
  const setting = page.getByRole('switch', { name: 'Wrap long lines in code' })
  await expect(setting).toBeChecked()
  await setting.uncheck()
  await page.keyboard.press('Escape')
  expect(await whiteSpace(page.locator('.code-block').first())).toBe('pre')
})

test('code blocks: download as a file named from the language', async ({
  page,
}) => {
  const id = await chatAnswering(
    page,
    '```py\nprint(1)\n```\n\n```klingon\nqapla\n```',
  )
  await page.goto(`/c/${id}`)
  const save = async (n: number) => {
    const download = page.waitForEvent('download')
    await page
      .locator('.code-block')
      .nth(n)
      .getByRole('button', { name: 'Download as file' })
      .click()
    const file = await download
    return [
      file.suggestedFilename(),
      await readFile((await file.path())!, 'utf8'),
    ]
  }
  expect(await save(0)).toEqual(['code.py', 'print(1)\n'])
  expect(await save(1)).toEqual(['code.txt', 'qapla\n'])
})

test('code blocks: a long one collapses, opens on request and when find reaches it', async ({
  page,
}) => {
  const id = await chatAnswering(
    page,
    ['```ts\nconst a = 1\n```', LONG_CODE].join('\n\n'),
  )
  await page.goto(`/c/${id}`)
  const [short, long] = [0, 1].map((n) => page.locator('.code-block').nth(n))
  await expect(short.locator('.code-more')).toHaveCount(0)

  const more = long.getByRole('button', { name: 'Show all 84 lines' })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  const body = long.locator('.code-body')
  expect((await body.boundingBox())!.height).toBeCloseTo(18 * 26, 0)
  // The fade sits over the bottom edge, and the text is still in the page.
  expect(
    await body.evaluate(
      (el) => getComputedStyle(el, '::after').backgroundImage,
    ),
  ).toContain('linear-gradient')
  await expect(long.locator('pre')).toContainText('needle_at_the_end')

  await more.click()
  const less = long.getByRole('button', { name: 'Show less' })
  await expect(less).toHaveAttribute('aria-expanded', 'true')
  expect((await body.boundingBox())!.height).toBeGreaterThan(18 * 26 * 3)
  await less.click()
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  // Finding a line in the folded part opens the block.
  await page.getByRole('button', { name: 'Find in chat' }).click()
  await page
    .getByRole('searchbox', { name: 'Find in chat' })
    .fill('needle_at_the_end')
  await expect(page.locator('.find-count')).toHaveText('1 of 1')
  await expect(less).toHaveAttribute('aria-expanded', 'true')
  await expect(long.getByText('needle_at_the_end')).toBeInViewport()
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

test('numbered citations are chips that open a card about their source', async ({
  page,
}) => {
  const id = await savedChat(page, {
    question: 'Robots?',
    answerText:
      'Robots move things [1](https://history.test/r) and are old [[2]](https://nowhere.test/x), see [1](https://example.com/robots).',
    searchResults: [
      {
        title: 'Robots guide',
        url: 'https://example.com/robots',
        snippet: 'Robots <b>move</b> things.',
      },
      {
        title: 'History of robots',
        url: 'https://history.test/r',
        snippet: 's',
      },
    ],
  })
  await page.goto(`/c/${id}`)
  const message = page.locator('.message.assistant')
  // The number is the source's place in the list; a number whose address is
  // not a source stays the plain link it was.
  const chips = message.locator('.cite-chip')
  await expect(chips).toHaveText(['2', '1'])
  await expect(message.getByRole('link', { name: '[2]' })).toHaveAttribute(
    'href',
    'https://nowhere.test/x',
  )
  // The cards under the answer are open, as the chips refer to them.
  await expect(page.locator('.sources .source-num').first()).toBeVisible()

  const chip = chips.nth(1)
  const card = message.locator('.cite-pop').nth(1)
  await expect(card).toBeHidden()
  await chip.hover()
  await expect(card).toBeVisible()
  await expect(card).toContainText('example.com')
  await expect(card).toContainText('Robots guide')
  // Text from a page is shown as text, not as markup.
  await expect(card).toContainText('Robots <b>move</b> things.')
  await expect(card).toContainText('1 of 2')
  await page.waitForTimeout(500)
  // (An open popover is in the top layer, so found from the page.)
  const open = page.getByRole('link', { name: 'Open page' })
  await expect(open).toHaveAttribute('href', 'https://example.com/robots')
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer')

  // Esc closes it and leaves focus where it was; focusing opens it again.
  await page.mouse.move(5, 5)
  await expect(card).toBeHidden()
  await chip.focus()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(chip).toBeFocused()

  // A tap opens it too.
  await chip.tap().catch(() => chip.click())
  await expect(card).toBeVisible()
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

test('a table keeps its words whole and turns <br> in a cell into a line break', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'table-markdown')
  await answered(page)
  const table = page.locator('.markdown table').last()
  await expect(table).toBeVisible()
  await expect(table).not.toContainText('<br>')
  // The cell's lines: "LLaMA 2-Chat", then the bullets under it.
  await expect(table.locator('td br')).toHaveCount(2)

  // No word is split over two lines (the column would be a letter wide): each has one box.
  const split = await table.evaluate((el) => {
    const broken: string[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      // A hyphen is a place to break a line, so its parts are the words.
      for (const word of text.matchAll(/[^\s-]+/g)) {
        const range = document.createRange()
        range.setStart(node, word.index!)
        range.setEnd(node, word.index! + word[0].length)
        if (range.getClientRects().length > 1) broken.push(word[0])
      }
    }
    return broken
  })
  expect(split).toEqual([])
})

test('a table copies as tab-separated text and downloads as CSV', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'table-markdown')
  await answered(page)
  const block = page.locator('.table-wrap').last()
  await block.getByRole('button', { name: 'Copy table' }).click()
  const copied = await clipboard(page)
  expect(copied).toMatch(/^Term\tWhat it means\tExamples\n/)
  // `<br>` in a cell is a line break, so the cell is quoted.
  expect(copied).toContain(
    '\t"LLaMA 2-Chat\n• Falcon 180B\n• Mistral-7B-Instruct"',
  )

  const download = page.waitForEvent('download')
  await block.getByRole('button', { name: 'Download CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('table.csv')
  const csv = await readFile((await file.path())!, 'utf8')
  expect(csv).toContain('Term,What it means,Examples\n')
  expect(csv).toContain('The weights are freely redistributable.')
})

test('a wide table scrolls inside its box, not the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  await appReady(page)
  await send(page, 'wide-table')
  await answered(page)
  const scroll = page.locator('.table-scroll').last()
  await expect(scroll).toBeVisible()
  const sizes = await scroll.evaluate((el) => ({
    inner: el.scrollWidth,
    box: el.clientWidth,
    page: document.documentElement.scrollWidth,
    window: innerWidth,
  }))
  expect(sizes.inner).toBeGreaterThan(sizes.box)
  expect(sizes.page).toBeLessThanOrEqual(sizes.window)
})

test('a failed answer says so with Retry, which answers it normally', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'fail-midway story')
  const banner = page.getByRole('alert')
  await expect(banner).toContainText('The answer stopped unexpectedly.')
  await expect(banner).toContainText('The model server lost its connection.')
  await banner.getByRole('button', { name: 'Retry' }).click()
  await answered(page)
  await expect(banner).toHaveCount(0)
  // The same question, answered again: one message, and a whole answer.
  await expect(turns(page)).toHaveCount(1)
  await expect(page.locator('.message.user')).toHaveCount(1)
  await expect(answer(page, 0)).toContainText('Answer #')
  await expect(
    page.getByRole('group', { name: 'Answer interrupted' }),
  ).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused()
})

test('a code block’s line numbers stay level with its lines', async ({
  page,
}) => {
  const code = Array.from(
    { length: 45 },
    (_, i) => `const value${i} = compute(${i})`,
  ).join('\n')
  const id = await savedChat(page, {
    question: 'Show code',
    answerText: `\`\`\`ts\n${code}\n\`\`\``,
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  const heights = await page.locator('.code-body').evaluate((el) => ({
    numbers: el.querySelector('.code-lines')!.getBoundingClientRect().height,
    code: el.querySelector('pre')!.getBoundingClientRect().height,
  }))
  // Each line box is exactly one line tall, so the two columns end together
  // (a trailing newline in the `pre` adds nothing visible).
  expect(Math.abs(heights.code - heights.numbers)).toBeLessThan(1)
})

test('task-list checkboxes take the accent colour', async ({ page }) => {
  const id = await savedChat(page, {
    question: 'A list',
    answerText: '- [x] done\n- [ ] not yet',
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  const boxes = page.locator('.markdown input[type=checkbox]')
  await expect(boxes).toHaveCount(2)
  const [done, open] = await boxes.evaluateAll((boxes) =>
    boxes.map((box) => getComputedStyle(box).backgroundColor),
  )
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
  expect(done).toBe(accent)
  expect(open).not.toBe(accent)
})

test('the find bar’s input keeps a usable width on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 })
  const id = await savedChat(page, {
    question: 'Find me',
    answerText: 'Some text to find',
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  await page.getByRole('button', { name: 'Find in chat' }).click()
  const box = page.getByRole('searchbox', { name: 'Find in chat' })
  await expect(box).toBeVisible()
  const { input, bar } = await page.evaluate(() => ({
    input: document.querySelector('.find-input')!.getBoundingClientRect().width,
    bar: document.querySelector('.find-bar')!.getBoundingClientRect().width,
  }))
  // The input fills its row; it used to be left about 90 px beside the buttons.
  expect(input).toBeGreaterThan(bar * 0.8)
  expect(bar).toBeLessThanOrEqual(375)
})

test('the message box’s hint is dimmer than muted text', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  const colours = await page.evaluate(() => {
    const read = (name: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }
    const box = document.querySelector('.composer textarea')!
    return {
      hint: getComputedStyle(box, '::placeholder').color,
      placeholder: read('--fg-placeholder'),
      muted: read('--fg-muted'),
    }
  })
  expect(colours.hint).toBe(colours.placeholder)
  expect(colours.hint).not.toBe(colours.muted)
})

test('a list written as HTML in a table cell shows as bullet lines, not as tags', async ({
  page,
}) => {
  const id = await savedChat(page, {
    question: 'Who was he?',
    answerText: [
      '| Item | Details |',
      '| --- | --- |',
      '| Born | 1881, Salonika |',
      '| Key achievements | <ul><li>Led the war of independence.</li><li>Founded the republic.</li></ul> |',
    ].join('\n'),
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  const cell = page.locator('.markdown td', { hasText: 'Led the war' })
  await expect(cell).toBeVisible()
  await expect(cell).not.toContainText('<ul>')
  await expect(cell).not.toContainText('<li>')
  await expect(cell).not.toContainText('</li>')
  // Each item on a line of its own.
  const lines = await cell.evaluate((el) =>
    (el as HTMLElement).innerText
      .split('\n')
      .map((line: string) => line.trim()),
  )
  expect(lines).toEqual([
    '• Led the war of independence.',
    '• Founded the republic.',
  ])
})

test('a new chat on a wide screen keeps the composer under the greeting, mid-page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await appReady(page)
  const composer = (await page.locator('.composer').boundingBox())!
  const greeting = (await page.locator('.greeting').boundingBox())!
  // Under the greeting and clear of the bottom edge (the phone layout docks
  // it there instead); earlier chats may add a "Pick up where you left off"
  // list under it, which moves it up.
  expect(composer.y).toBeGreaterThan(greeting.y + greeting.height)
  expect(composer.y + composer.height).toBeLessThan(768 - 150)
})

test('a table has no header bar; its actions sit under it and show on hover', async ({
  page,
}) => {
  const id = await savedChat(page, {
    question: 'A table',
    answerText: '| Item | Details |\n| --- | --- |\n| a | one |\n| b | two |',
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  const wrap = page.locator('.table-wrap').last()
  await expect(wrap.locator('table')).toBeVisible()
  await expect(page.locator('.table-header')).toHaveCount(0)
  await expect(wrap).not.toContainText('Table')

  const actions = wrap.locator('.table-actions')
  const table = (await wrap.locator('.table-block').boundingBox())!
  const row = (await actions.boundingBox())!
  expect(row.y).toBeGreaterThanOrEqual(table.y + table.height)
  // At the right, under the table's right edge.
  const download = (await actions
    .getByRole('button', { name: 'Download CSV' })
    .boundingBox())!
  expect(download.x + download.width).toBeGreaterThan(
    table.x + table.width - 16,
  )
  expect(download.x).toBeGreaterThan(table.x + table.width / 2)
  // Out of the way until the pointer is over the table, like a message's actions.
  await expect(actions).toHaveCSS('opacity', '0')
  await wrap.locator('table').hover()
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(
    actions.getByRole('button', { name: 'Copy table' }),
  ).toBeVisible()
  await expect(
    actions.getByRole('button', { name: 'Download CSV' }),
  ).toBeVisible()
  // The keyboard reaches them too.
  await page.mouse.move(0, 0)
  await expect(actions).toHaveCSS('opacity', '0')
  await actions.getByRole('button', { name: 'Copy table' }).focus()
  await expect(actions).toHaveCSS('opacity', '1')
})

test('a code block is a grey card with its actions inside, not bare text', async ({
  page,
}) => {
  const id = await savedChat(page, {
    question: 'Show code',
    answerText: '```ts\nconst a = 1\nconst b = 2\n```',
  })
  await page.goto(`/c/${id}`)
  await appReady(page)
  const block = page.locator('.code-block').first()
  await expect(block).toBeVisible()
  const look = await block.evaluate((el) => {
    const css = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = 'var(--surface-muted)'
    document.body.append(probe)
    const muted = getComputedStyle(probe).color
    probe.remove()
    return { background: css.backgroundColor, muted, radius: css.borderRadius }
  })
  expect(look.background).toBe(look.muted)
  expect(look.radius).toBe('16px')
  // The label and the actions sit inside the card.
  const box = (await block.boundingBox())!
  const copy = (await block
    .getByRole('button', { name: 'Copy code' })
    .boundingBox())!
  expect(copy.x + copy.width).toBeLessThanOrEqual(box.x + box.width)
  expect(copy.y).toBeGreaterThanOrEqual(box.y)
})

test('an unchanged message can be sent from the edit box, as a new version', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Again please')
  await answered(page)
  const first = turns(page).nth(0)
  await first.hover()
  await first.getByRole('button', { name: 'Edit message' }).click()
  const send2 = page.getByRole('button', { name: 'Send', exact: true })
  await expect(send2).toBeEnabled()
  await send2.click()
  await answered(page)
  await expect(
    turns(page).nth(0).locator('.user-actions .versions-count'),
  ).toHaveText('2/2')
})
