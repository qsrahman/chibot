import { expect, test, type Page } from '@playwright/test'
import { answer, answered, appReady, lastRequest, send } from './helpers.ts'

// Phones: the sidebar is a drawer over a full-width chat.

test.use({ viewport: { width: 375, height: 812 } })

test('the chat fills a phone, and the sidebar is a drawer', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const sidebar = page.locator('nav.sidebar')
  await expect(sidebar).toBeHidden()
  const chat = await page.locator('main.chat').boundingBox()
  expect(chat!.width).toBe(375)

  await send(page, 'Hello from a phone')
  await answered(page)
  // With the sidebar hidden, the header says which chat this is.
  await expect(page.locator('.topbar-title')).toHaveText('E2E Title')

  // Opened from the header; a tap beside it closes it.
  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await expect(sidebar).toBeVisible()
  await page.locator('.drawer-backdrop').click({ position: { x: 360, y: 400 } })
  await expect(sidebar).toBeHidden()

  // Opening a chat from it closes it too.
  await page.getByRole('button', { name: 'Open sidebar' }).click()
  // The toolbar link; untitled chats are called "New chat" too.
  await page.locator('nav.sidebar > a[aria-label="New chat"]').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(sidebar).toBeHidden()
})

// The drawer covers the chat like a dialog, so it behaves like one: the page
// behind can't be reached, focus moves in, Escape closes it, and focus goes
// back to the button that opened it.
test('the drawer takes focus, shuts out the page behind it, and closes on Escape', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const open = page.getByRole('button', { name: 'Open sidebar' })
  const drawer = page.locator('nav.sidebar')
  await expect(page.locator('main')).toHaveJSProperty('inert', false)

  await open.click()
  await expect(drawer).toBeVisible()
  await expect(page.locator('main')).toHaveJSProperty('inert', true)
  await expect(drawer.locator(':focus')).toHaveCount(1)

  // Tab goes round the drawer and never into the chat behind it.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const behind = await page.evaluate(
      () => document.activeElement?.closest('main') !== null,
    )
    expect(behind, `after ${i + 1} Tab presses`).toBe(false)
  }

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(page.locator('main')).toHaveJSProperty('inert', false)
  await expect(open).toBeFocused()
})

test('Escape in the drawer closes it without stopping the answer behind it', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'slow one')
  await expect(page.getByRole('button', { name: 'Stop' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await expect(page.locator('nav.sidebar')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('nav.sidebar')).toBeHidden()

  // Escape is also the shortcut for Stop; it must not have been taken twice.
  await expect(page.getByRole('button', { name: 'Stop' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).first().click()
  await answered(page)
})

test('Escape closes a menu in the drawer first, then the drawer', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Hello')
  await answered(page)

  await page.getByRole('button', { name: 'Open sidebar' }).click()
  const drawer = page.locator('nav.sidebar')
  const row = drawer.locator('.conversation-row').first()
  await row.hover()
  await row.getByRole('button', { name: /Options for/ }).click()
  const menu = page.locator('.menu:popover-open')
  await expect(menu).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(drawer).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
})

test('a chosen tool’s chip leaves room to type', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  await page.getByRole('menuitem', { name: /Create an image/ }).click()
  await expect(page.locator('.composer-chip')).toBeVisible()

  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('latest news')
  // Beside the + and the buttons the chip would leave the box a few pixels
  // wide, and the text would run one letter to a line.
  const { width, height, overflows } = await page.evaluate(() => {
    const field = document.querySelector('.composer textarea')!
    const composer = document
      .querySelector('.composer')!
      .getBoundingClientRect()
    return {
      width: field.getBoundingClientRect().width,
      height: composer.height,
      overflows: document.documentElement.scrollWidth > innerWidth,
    }
  })
  expect(width).toBeGreaterThan(100)
  expect(height).toBeLessThan(150)
  expect(overflows).toBe(false)
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true })

  // Enter adds a line on touch screens, so messages go with the button.
  const sendByTap = async (page: Page, text: string) => {
    await page.getByRole('textbox', { name: 'Message' }).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

  // Controls are at least 44px square for a finger (the drawn icon may be
  // smaller): 2.5.8 asks 24px, phones' own guidelines 44 to 48.
  const small = (page: Page) =>
    page.evaluate(() => {
      return [
        ...document.querySelectorAll<HTMLElement>(
          'button, [role=switch], select, summary, a.sidebar-row, a.search-result, textarea',
        ),
      ]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => getComputedStyle(el).visibility !== 'hidden')
        .map((el) => {
          const r = el.getBoundingClientRect()
          const label = el.getAttribute('aria-label') ?? el.textContent ?? ''
          return {
            what: `${el.tagName.toLowerCase()} "${label.trim().slice(0, 28)}"`,
            width: Math.round(r.width),
            height: Math.round(r.height),
          }
        })
        .filter(({ width, height }) => width < 44 || height < 44)
        .map(({ what, width, height }) => `${what} ${width}x${height}`)
    })

  test('does not raise the keyboard until the message box is tapped', async ({
    page,
  }) => {
    await page.goto('/')
    const message = page.getByRole('textbox', { name: 'Message' })
    await expect(message).toBeVisible()
    // Long enough for an autofocus to have happened.
    await page.waitForTimeout(400)
    await expect(message).not.toBeFocused()
    await message.tap()
    await expect(message).toBeFocused()
  })

  test('has controls a finger can hit, in the chat and in the drawer', async ({
    page,
  }) => {
    await page.goto('/')
    await appReady(page)
    await sendByTap(page, 'Hello there')
    await answered(page)
    expect(await small(page), 'in the chat').toEqual([])

    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(page.locator('nav.sidebar')).toBeVisible()
    expect(await small(page), 'in the drawer').toEqual([])
  })

  test('shows controls that wait for a hover elsewhere', async ({ page }) => {
    await page.goto('/')
    await appReady(page)
    await sendByTap(page, 'First question')
    await answered(page)
    await sendByTap(page, 'Second question')
    await answered(page)

    const opacity = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).opacity)
    // Copy, edit and regenerate on an earlier turn, not just the latest.
    expect(await opacity('.turn:first-child .answer-actions')).toBe('1')
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    expect(await opacity('.row-menu-button')).toBe('1')
  })

  test('Enter adds a line; the send button sends', async ({ page }) => {
    await page.goto('/')
    await appReady(page)
    const box = page.getByRole('textbox', { name: 'Message' })
    await expect(box).toHaveAttribute('enterkeyhint', 'enter')
    await box.fill('First line')
    await box.press('Enter')
    await box.pressSequentially('Second line')
    await expect(box).toHaveValue('First line\nSecond line')
    await page.getByRole('button', { name: 'Send' }).click()
    await answered(page)
    await expect(answer(page, 0)).toContainText('First line')
    expect(
      (await lastRequest(page)).input.findLast((i) => i.role === 'user'),
    ).toMatchObject({ content: 'First line\nSecond line' })
  })

  test('hides keyboard shortcuts and keeps the Settings tab in view', async ({
    page,
  }) => {
    await page.goto('/')
    await appReady(page)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(
      page.getByRole('button', { name: 'Keyboard shortcuts' }),
    ).toBeHidden()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const tabs = page.getByRole('navigation', { name: 'Settings sections' })
    await tabs.getByRole('button', { name: 'Data' }).click()
    await page.keyboard.press('Escape')
    // The drawer is still open behind it.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    // The row scrolled to the selected tab, which is last.
    const inView = await tabs.evaluate((row) => {
      const current = row.querySelector('[aria-current="page"]')!
      const a = row.getBoundingClientRect()
      const b = current.getBoundingClientRect()
      return b.left >= a.left - 1 && b.right <= a.right + 1
    })
    expect(inView).toBe(true)
  })
})
