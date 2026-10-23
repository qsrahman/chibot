import { expect, test } from '@playwright/test'
import { answered, appReady, send } from './helpers.ts'

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
