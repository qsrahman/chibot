import { expect, test, type Page } from '@playwright/test'
import { appReady } from './helpers.ts'

// Brief feedback: a toast per action, with Undo where it can be undone.

async function chatTitled(page: Page, title: string) {
  const created = await page.request.post('/api/conversations', { data: {} })
  const { id } = (await created.json()) as { id: string }
  await page.request.patch(`/api/conversations/${id}`, { data: { title } })
}

const row = (page: Page, title: string) =>
  page.locator('.conversation-row', { hasText: title })

async function optionsOf(page: Page, title: string) {
  await row(page, title).hover()
  await row(page, title)
    .getByRole('button', { name: /Options for/ })
    .click()
}

test('archiving says so and can be undone', async ({ page }) => {
  await chatTitled(page, 'Toast archive me')
  await page.goto('/')
  await appReady(page)

  await optionsOf(page, 'Toast archive me')
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await expect(row(page, 'Toast archive me')).toHaveCount(0)
  const toast = page.locator('.toast', { hasText: 'Chat archived' })
  await expect(toast).toBeVisible()
  // Said to screen readers too.
  await expect(
    page.locator('.toast-live', { hasText: 'Chat archived' }),
  ).toHaveCount(1)

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(toast).toHaveCount(0)
  await expect(row(page, 'Toast archive me')).toHaveCount(1)
})

test('a toast goes away by itself, but not under the pointer', async ({
  page,
}) => {
  await chatTitled(page, 'Toast timing')
  await page.goto('/')
  await appReady(page)
  await optionsOf(page, 'Toast timing')
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  const toast = page.locator('.toast', { hasText: 'Chat archived' })
  await expect(toast).toBeVisible()

  // Held while hovered…
  await toast.hover()
  await page.waitForTimeout(6500)
  await expect(toast).toBeVisible()
  // …and gone a few seconds after the pointer leaves.
  await page.mouse.move(5, 5)
  await expect(toast).toHaveCount(0, { timeout: 10_000 })
  // Put the chat back for the other specs.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Data', exact: true })
    .click()
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: /Restore Toast timing/ }).click()
  await expect(
    page.locator('.toast', { hasText: 'Chat restored' }),
  ).toBeVisible()
})

test('importing a chat says so, from the keyboard', async ({ page }) => {
  const created = await page.request.post('/api/conversations', { data: {} })
  const { id } = (await created.json()) as { id: string }
  const exported = await page.request.get(
    `/api/conversations/${id}/export?format=json`,
  )
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Data', exact: true }).click()
  // A real button, which a keyboard can reach (it used to be a label).
  const choose = dialog.getByRole('button', { name: 'Import a chat' })
  await choose.focus()
  await expect(choose).toBeFocused()

  await dialog.getByLabel('Chat file').setInputFiles({
    name: 'chat.json',
    mimeType: 'application/json',
    buffer: await exported.body(),
  })
  await expect(
    page.locator('.toast', { hasText: 'Chat imported' }),
  ).toBeVisible()
})
