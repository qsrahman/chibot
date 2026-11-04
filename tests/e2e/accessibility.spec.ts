import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, longChat, send } from './helpers.ts'

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

// What each animated part of the app is told to do, read from elements that
// carry its classes.
const motion = (page: Page) =>
  page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="probe">
         <span class="spin"></span><span class="attachment-spinner"></span>
         <div class="thinking"></div><div class="image-placeholder"></div>
         <details class="thoughts"><summary><span class="live">x</span>
           <span class="disclosure-chevron"></span></summary></details>
         <input type="checkbox" class="switch">
       </div>`,
    )
    const style = (selector: string) =>
      getComputedStyle(document.querySelector(`#probe ${selector}`)!)
    const result = {
      spin: style('.spin').animationName,
      attachmentSpinner: style('.attachment-spinner').animationName,
      thinking: style('.thinking').animationName,
      placeholder: style('.image-placeholder').animationName,
      shimmer: style('.live').animationName,
      chevron: style('.disclosure-chevron').transitionDuration,
      switchTrack: style('.switch').transitionDuration,
    }
    document.querySelector('#probe')!.remove()
    return result
  })

test('animates as usual, and under reduced motion only fades and stands still', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  expect(await motion(page)).toEqual({
    spin: 'spin',
    attachmentSpinner: 'spin',
    thinking: 'pulse',
    placeholder: 'shimmer',
    shimmer: 'shimmer',
    chevron: '0.15s',
    switchTrack: '0.15s',
  })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Progress still shows (a fade, not a turn or a shrink); decoration stops.
  expect(await motion(page)).toEqual({
    spin: 'fade',
    attachmentSpinner: 'fade',
    thinking: 'fade',
    placeholder: 'none',
    shimmer: 'none',
    chevron: '0s',
    switchTrack: '0s',
  })
})

test('jumps to the latest message at once under reduced motion, and glides otherwise', async ({
  page,
}) => {
  const id = await longChat(page, 40)
  await page.goto(`/c/${id}`)
  await appReady(page)
  await expect(page.locator('.turn')).toHaveCount(40)
  const jumpAndCheck = () =>
    page.evaluate(async () => {
      const list = document.querySelector('.messages')!
      list.scrollTop = 0
      // The button comes once the scroll has been noticed.
      let jump: HTMLButtonElement | null = null
      for (let i = 0; i < 50 && !jump; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        jump = document.querySelector<HTMLButtonElement>('button.jump-latest')
      }
      jump!.click()
      // Right after the click: is the latest turn on screen, or still on its way?
      const last = [...document.querySelectorAll('.turn')]
        .at(-1)!
        .getBoundingClientRect()
      const view = list.getBoundingClientRect()
      return last.bottom > view.top && last.top < view.bottom
    })

  expect(await jumpAndCheck()).toBe(false)
  // Let that glide finish before the next one.
  await expect(page.locator('button.jump-latest')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await jumpAndCheck()).toBe(true)
})

// A screen reader's list of headings is an outline of the page: it starts at
// the page's heading and never skips a level on the way down.
const outline = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((h) => h.getClientRects().length > 0)
      .map((h) => ({
        level: Number(h.tagName[1]),
        text: h.textContent!.trim(),
      })),
  )

function expectOutline(headings: { level: number; text: string }[]) {
  expect(headings.length).toBeGreaterThan(0)
  expect(headings[0], 'the first heading').toMatchObject({ level: 1 })
  let previous = 0
  for (const { level, text } of headings) {
    expect(level, `"${text}" after a level ${previous}`).toBeLessThanOrEqual(
      previous + 1,
    )
    previous = level
  }
}

test('the page’s headings form an outline, in the sidebar’s presence', async ({
  page,
}) => {
  await chatsTitled(page, 'Plan a trip')
  const created = await page.request.post('/api/projects', {
    data: { name: 'Japan' },
  })
  const { id } = (await created.json()) as { id: string }

  // A new chat, with groups of chats and a Projects section in the sidebar…
  await page.goto('/')
  await appReady(page)
  await expect(page.getByText('Plan a trip').first()).toBeVisible()
  expectOutline(await outline(page))

  // …and a project's page.
  await page.goto(`/projects/${id}`)
  await expect(page.getByRole('heading', { name: 'Japan' })).toBeVisible()
  expectOutline(await outline(page))
})

test('the menus on a chat row and on a project are menus', async ({ page }) => {
  await chatsTitled(page, 'Plan a trip')
  const created = await page.request.post('/api/projects', {
    data: { name: 'Japan' },
  })
  const { id } = (await created.json()) as { id: string }
  await page.goto(`/projects/${id}`)
  await expect(page.getByRole('heading', { name: 'Japan' })).toBeVisible()

  const row = page
    .locator('.conversation-row', { hasText: 'Plan a trip' })
    .first()
  await row.hover()
  await row.getByRole('button', { name: /Options for/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Project options' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Delete project' }),
  ).toBeVisible()
})

test('in forced colours the open chat and a switch’s state still show', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await chatsTitled(page, 'High contrast chat', 'Another')
  await page.goto('/')
  await appReady(page)
  await page.getByRole('link', { name: 'High contrast chat' }).click()
  await expect(page).toHaveURL(/\/c\//)
  const background = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  // The open chat's row is not drawn like the others (it has system colours).
  const plain = await page
    .locator('.sidebar-row:not(.active)')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await background('.sidebar-row.active')).not.toBe(plain)

  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Tools' }).click()
  const toggle = dialog.getByRole('switch').first()
  const before = await toggle.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  )
  await toggle.click()
  await expect
    .poll(() => toggle.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(before)
  await toggle.click() // as it was
})

test('the browser’s bars follow the theme chosen in Settings', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const bars = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLMetaElement>(
          'meta[name="theme-color"]',
        ),
      ].map((m) => m.content),
    )
  expect(await bars()).toEqual(['#fcfcfc', '#000000'])
  await page.evaluate(() => localStorage.setItem('chibot.colorScheme', 'dark'))
  await page.reload()
  await appReady(page)
  expect(await bars()).toEqual(['#000000', '#000000'])
  await page.evaluate(() => localStorage.removeItem('chibot.colorScheme'))
})
