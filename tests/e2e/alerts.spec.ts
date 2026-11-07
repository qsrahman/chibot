import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, send } from './helpers.ts'

// Telling you an answer is done while the page is in the background: the page
// title always, a notification if you turned them on.

const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
  })

const show = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })

test('marks the title when an answer finishes in the background, until you are back', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'Warm up')
  await answered(page)
  // In the foreground: nothing to say.
  await expect(page).not.toHaveTitle(/^•/)

  await hide(page)
  await send(page, 'While you were away')
  await answered(page)
  await expect(page).toHaveTitle(/^• /)

  await show(page)
  await expect(page).not.toHaveTitle(/^•/)
})

test('raises a notification, when turned on, saying what happened', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const raised: [string, string | undefined][] = []
    ;(window as unknown as { raised: typeof raised }).raised = raised
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      onclick: (() => void) | null = null
      constructor(title: string, options?: { body?: string }) {
        raised.push([title, options?.body])
      }
      close() {}
    }
    ;(window as unknown as { Notification: unknown }).Notification =
      FakeNotification
  })
  await page.goto('/')
  await appReady(page)
  const raised = () =>
    page.evaluate(
      () => (window as unknown as { raised: [string, string][] }).raised.length,
    )

  // Off by default.
  await hide(page)
  await send(page, 'Quietly')
  await answered(page)
  expect(await raised()).toBe(0)
  await show(page)

  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog
    .getByRole('switch', { name: 'Notify me about finished answers' })
    .check()
  await page.keyboard.press('Escape')

  await hide(page)
  await send(page, 'Please approve this')
  await answered(page)
  await expect.poll(raised).toBe(1)
  const [, body] = await page.evaluate(
    () => (window as unknown as { raised: [string, string][] }).raised[0]!,
  )
  expect(body).toBe('A tool is waiting for your approval')
  await show(page)
  await page.evaluate(() => localStorage.removeItem('chibot.notify'))
})
