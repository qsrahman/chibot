import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, send } from './helpers.ts'

// What a keyboard or screen-reader user needs from the app's own controls.
// (The project page's pickers are in projects.spec.ts, the phone drawer in
// phone.spec.ts.)

test('a text field that has no outline of its own shows that it has focus', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)

  // The composer: its textarea is borderless, so the box shows the focus.
  const box = page.locator('form.composer')
  const message = page.getByRole('textbox', { name: 'Message' })
  await page.getByRole('button', { name: 'Search chats' }).first().focus()
  await expect(box).toHaveCSS('outline-style', 'none')
  await message.focus()
  await expect(box).toHaveCSS('outline-style', 'solid')
  await expect(box).toHaveCSS('outline-width', '2px')

  // The edit box of a sent message.
  await send(page, 'Hello')
  await answered(page)
  await page.getByRole('button', { name: 'Edit message' }).click()
  await expect(page.locator('.edit-box')).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')

  // The search box in its dialog.
  await page.getByRole('button', { name: 'Search chats' }).first().click()
  await expect(page.getByRole('combobox', { name: 'Search chats' })).toHaveCSS(
    'outline-style',
    'solid',
  )
})

// Chats to search for, newest first: Alpha notes, Alpha plan, then one that
// does not match "Alpha".
async function chatsTitled(page: Page, ...titles: string[]) {
  for (const title of titles) {
    const created = await page.request.post('/api/conversations', { data: {} })
    const { id } = (await created.json()) as { id: string }
    await page.request.patch(`/api/conversations/${id}`, { data: { title } })
  }
}

test('the search dialog is a combobox: arrow keys, a marked result, announcements', async ({
  page,
}) => {
  await chatsTitled(page, 'Beta report', 'Alpha plan', 'Alpha notes')
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Search chats' }).first().click()

  const search = page.getByRole('combobox', { name: 'Search chats' })
  const options = page.getByRole('option')
  const status = page
    .getByRole('dialog', { name: 'Search chats' })
    .getByRole('status')
  await search.fill('Alpha')
  await expect(options).toHaveCount(2)
  await expect(status).toHaveText('2 chats found')

  // The result Enter would open is marked, and named by the field.
  const marked = async () =>
    (await options.evaluateAll((all) =>
      all.map((o) => o.getAttribute('aria-selected') === 'true'),
    )) as boolean[]
  const active = () => search.getAttribute('aria-activedescendant')
  const idOf = (index: number) => options.nth(index).getAttribute('id')
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(search).toHaveAttribute('aria-controls', /.+/)
  expect(await marked()).toEqual([true, false])
  expect(await active()).toBe(await idOf(0))
  await expect(page.getByRole('listbox')).toHaveAttribute(
    'id',
    (await search.getAttribute('aria-controls'))!,
  )

  // Arrow keys move it, round the ends; the caret stays in the field.
  await search.press('ArrowDown')
  expect(await marked()).toEqual([false, true])
  expect(await active()).toBe(await idOf(1))
  await search.press('ArrowDown')
  expect(await marked()).toEqual([true, false])
  await search.press('ArrowUp')
  expect(await marked()).toEqual([false, true])
  await expect(search).toBeFocused()

  // Enter opens the marked one: Alpha plan, the older of the two.
  await search.press('Enter')
  await expect(page).toHaveTitle('Alpha plan – chibot')
})

test('the search dialog says when nothing matches', async ({ page }) => {
  await chatsTitled(page, 'Alpha plan')
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Search chats' }).first().click()
  const search = page.getByRole('combobox', { name: 'Search chats' })
  await search.fill('zzzz')
  await expect(
    page.getByRole('dialog', { name: 'Search chats' }).getByRole('status'),
  ).toHaveText('No chats match “zzzz”.')
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/)
})

test('text follows the browser’s font size setting', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Hello there')
  await answered(page)

  // Sizes of text that has its own size (not just inherited), and the line
  // height of answers.
  const measure = () =>
    page.evaluate(() => {
      const size = (selector: string) =>
        parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize)
      const line = (selector: string) =>
        parseFloat(
          getComputedStyle(document.querySelector(selector)!).lineHeight,
        )
      return {
        composer: size('textarea[aria-label="Message"]'),
        sidebarRow: size('nav.sidebar .sidebar-row'),
        disclaimer: size('.disclaimer'),
        userMessage: size('.message.user p'),
        answerLine: line('.message.assistant'),
        rootLine: line('body'),
      }
    })
  const normal = await measure()
  // Unchanged at the default size.
  expect(normal.composer).toBe(17)
  expect(normal.rootLine).toBe(24)

  // A browser whose default size is 150% of the usual, as a user may set it:
  // everything is sized from it.
  await page.addStyleTag({ content: ':root { font-size: 150% !important }' })
  const large = await measure()
  for (const [name, size] of Object.entries(large)) {
    expect(size / normal[name as keyof typeof normal], name).toBeCloseTo(1.5, 2)
  }
})
