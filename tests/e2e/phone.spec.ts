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

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true })

  // Enter adds a line on touch screens, so messages go with the button.
  const sendByTap = async (page: Page, text: string) => {
    await page.getByRole('textbox', { name: 'Message' }).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

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
