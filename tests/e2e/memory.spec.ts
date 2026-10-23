import { expect, test, type Page } from '@playwright/test'
import {
  FAKE_OPENAI,
  answer,
  answered,
  lastRequest,
  newChat,
  send,
  turns,
} from './helpers.ts'

// Phase 7: memory and search_chats, against tests/e2e/fake-openai.ts, where
// "remember <fact>" saves a memory and "earlier chats <words>" searches.

test.afterEach(async ({ page }) => {
  await page.request.delete('/api/memories')
})

const memories = async (page: Page) =>
  (
    (await (await page.request.get('/api/memories')).json()) as {
      text: string
    }[]
  ).map((m) => m.text)

test('remembers a fact in a new chat, and forgets it from Settings', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Please remember my cat is called Biscuit')
  await answered(page)
  await expect(page.getByText('Memory updated')).toBeVisible()
  await expect(answer(page, 0)).toContainText(
    'Saved memory 1: "my cat is called Biscuit"',
  )

  await newChat(page)
  await send(page, 'What is my cat called?')
  await answered(page)
  expect((await lastRequest(page)).instructions).toContain(
    '1: my cat is called Biscuit',
  )

  await page.keyboard.press('ControlOrMeta+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Personalization' }).click()
  await settings.getByRole('button', { name: 'Manage' }).click()
  const dialog = page.getByRole('dialog', { name: 'Memories' })
  await dialog
    .getByRole('button', { name: 'Delete memory: my cat is called Biscuit' })
    .click()
  await expect(dialog).toContainText('doesn’t remember anything yet')
  expect(await memories(page)).toEqual([])
})

test('a temporary chat neither sees nor saves memories', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please remember I like tea')
  await answered(page)

  await newChat(page)
  await page.getByRole('button', { name: 'Temporary chat' }).click()
  await send(page, 'Please remember I like coffee')
  await answered(page)
  const sent = await lastRequest(page)
  expect(sent.instructions).not.toContain('I like tea')
  expect(JSON.stringify(sent.tools ?? [])).not.toContain('"memory"')
  await expect(answer(page, 0)).toContainText('no tool named "memory"')
  expect(await memories(page)).toEqual(['I like tea'])
})

test('asks before a memory change in a chat that read the web', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, `Please read ${FAKE_OPENAI}/pages/robots`)
  await answered(page)
  await send(page, 'Please remember robots are great')
  const card = page.getByRole('region', { name: 'Tool approval' })
  await expect(card).toContainText('chibot wants to use memory')
  expect(await memories(page)).toEqual([])

  await card.getByRole('button', { name: 'Approve' }).click()
  await answered(page)
  expect(await memories(page)).toEqual(['robots are great'])
})

test('finds an earlier chat and links it in Sources', async ({ page }) => {
  await page.goto('/')
  await send(page, 'The launch codename is Kestrel')
  await answered(page)
  const earlier = page.url()

  await newChat(page)
  await send(page, 'Look in my earlier chats launch codename')
  await answered(page)
  await expect(answer(page, 0)).toContainText('The launch codename is Kestrel')
  await expect(page.getByText('Searched your chats')).toBeVisible()

  const sources = turns(page).first().locator('.sources')
  await sources.getByText('Sources · 1').click()
  await sources.getByRole('link').click()
  await expect(page).toHaveURL(earlier)
})
