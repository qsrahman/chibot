import { expect, test } from '@playwright/test'
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
  await expect(page.getByRole('searchbox', { name: 'Search chats' })).toHaveCSS(
    'outline-style',
    'solid',
  )
})
