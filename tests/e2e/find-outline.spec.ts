import { expect, test } from '@playwright/test'
import { appReady, longChat } from './helpers.ts'

// Finding in a chat, and jumping to one of its messages.

const TURNS = 30

test('finds text, steps through the matches and closes', async ({ page }) => {
  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  await page.getByRole('button', { name: 'Find in chat' }).click()
  const box = page.getByRole('searchbox', { name: 'Find in chat' })
  await expect(box).toBeFocused()

  await box.fill('question')
  const count = page.locator('.find-count')
  await expect(count).toHaveText(`1 of ${TURNS}`)
  // The first match is at the top of a long chat, so the view went there.
  await expect(
    page.locator('.thread').getByText('Question 1', { exact: true }),
  ).toBeInViewport()
  expect(
    await page.evaluate(() => CSS.highlights.get('find-current')?.size),
  ).toBe(1)
  expect(await page.evaluate(() => CSS.highlights.get('find')?.size)).toBe(
    TURNS,
  )

  await box.press('Enter')
  await expect(count).toHaveText(`2 of ${TURNS}`)
  await expect(
    page.locator('.thread').getByText('Question 2', { exact: true }),
  ).toBeInViewport()
  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(count).toHaveText(`1 of ${TURNS}`)
  await box.press('Shift+Enter')
  await expect(count).toHaveText(`${TURNS} of ${TURNS}`)
  await expect(
    page.locator('.thread').getByText(`Question ${TURNS}`, { exact: true }),
  ).toBeInViewport()

  await box.fill('no such words')
  await expect(count).toHaveText('No matches')
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled()

  await box.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Find in chat' })).toBeFocused()
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0)
})

test('does not look in closed Thoughts', async ({ page }) => {
  const id = await longChat(page, 2)
  await page.goto(`/c/${id}`)
  await appReady(page)
  await page.getByRole('button', { name: 'Find in chat' }).click()
  // The question's own action row and buttons are not text to find either.
  await page.getByRole('searchbox').fill('Copy')
  await expect(page.locator('.find-count')).toHaveText('No matches')
})

test('the outline jumps to a message, and only a longer chat has one', async ({
  page,
}) => {
  const short = await longChat(page, 3)
  await page.goto(`/c/${short}`)
  await appReady(page)
  await expect(page.getByRole('button', { name: 'Find in chat' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Message outline' }),
  ).toHaveCount(0)

  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  // Opened with the keyboard: Safari doesn't focus a button that is clicked,
  // so there would be nothing to give focus back to.
  await page.getByRole('button', { name: 'Message outline' }).press('Enter')
  const menu = page.getByRole('menu', { name: 'Your messages' })
  await expect(menu.getByRole('menuitem')).toHaveCount(TURNS)
  // It opens on the message in view: the newest, at the end of the chat.
  await expect(menu.getByRole('menuitem').last()).toBeFocused()
  await expect(menu.getByRole('menuitem').last()).toHaveAttribute(
    'aria-current',
    'true',
  )
  await menu.getByRole('menuitem', { name: '3 Question 3' }).press('Enter')
  await expect(menu).toBeHidden()
  await expect(
    page.locator('.thread').getByText('Question 3', { exact: true }),
  ).toBeInViewport()
  await expect(
    page.getByRole('button', { name: 'Message outline' }),
  ).toBeFocused()

  // Reopened, it marks the message now at the top.
  await page.getByRole('button', { name: 'Message outline' }).click()
  await expect(menu.locator('[aria-current]')).toContainText('Question 3')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
