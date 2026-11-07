import { expect, test } from '@playwright/test'
import { appReady } from './helpers.ts'

// One tooltip element for everything with a `title`, sooner than the browser's.

test('shows a styled tooltip on hover and on keyboard focus, and puts the title back', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const plus = page.getByRole('button', { name: 'Add files and more' })
  const tip = page.getByRole('tooltip')

  await plus.hover()
  await expect(tip).toHaveText('Add files and more')
  // The browser's own tooltip is held back while ours shows.
  await expect(plus).not.toHaveAttribute('title', /.+/)
  await expect(plus).toHaveAttribute('aria-label', 'Add files and more')

  await page.mouse.move(600, 300)
  await expect(tip).toBeHidden()
  await expect(plus).toHaveAttribute('title', 'Add files and more')

  // From the keyboard: at once.
  await page.keyboard.press('Tab')
  await plus.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(tip).toHaveText(/./)
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
})

test('shows above a modal dialog, kept inside the window', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Data' }).click()
  await dialog.getByRole('button', { name: 'Copy command' }).hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toHaveText('Copy command')
  const box = (await tip.boundingBox())!
  const size = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  expect(box.y + box.height).toBeLessThanOrEqual(size.height)
  expect(await tip.evaluate((el) => el.matches(':popover-open'))).toBe(true)
})
