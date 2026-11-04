import { expect, test, type Page } from '@playwright/test'
import {
  FAKE_OPENAI,
  answer,
  answered,
  appReady,
  lastRequest,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Phase 6: web search, reading pages, images and tool switches, against
// tests/e2e/fake-openai.ts (which also fakes Brave and the images API).

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

const sources = (page: Page, index: number) =>
  turns(page).nth(index).locator('.sources')

test('searches the web and lists the sources', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please search for robots')
  await answered(page)
  await expect(answer(page, 0)).toContainText('All about robots.')
  await expect(page.getByText('Searched the web')).toBeVisible()

  await sources(page, 0).getByText('Sources · 1').click()
  await expect(
    sources(page, 0).getByRole('link', { name: /Result for Please search/ }),
  ).toHaveAttribute('href', `${FAKE_OPENAI}/pages/robots`)
})

test('reads a pasted URL, but not a local address', async ({ page }) => {
  await page.goto('/')
  await send(page, `Please read ${FAKE_OPENAI}/pages/robots`)
  await answered(page)
  await expect(answer(page, 0)).toContainText('Robots are machines')
  await expect(answer(page, 0)).toContainText('untrusted page content')
  await expect(answer(page, 0)).not.toContainText('Home · About')

  await send(page, 'Please read http://localhost:4010/pages/robots')
  await answered(page)
  await expect(answer(page, 1)).toContainText('private or local address')
})

test('creates an image, keeps it, and edits it', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please draw a robot')
  await answered(page)
  const image = turns(page).first().locator('.image img')
  await expect(image).toHaveAttribute('src', /^\/api\/files\/[\w-]+$/)
  const first = await image.getAttribute('src')
  // Described by its prompt, loaded when near, and its space was held (square).
  await expect(image).toHaveAttribute(
    'alt',
    'Generated image: Please draw a robot',
  )
  await expect(image).toHaveAttribute('loading', 'lazy')
  const box = await image.boundingBox()
  expect(box!.width).toBeCloseTo(box!.height, 0)
  expect(
    await page.evaluate(
      (src) => fetch(src!).then((r) => r.headers.get('content-type')),
      first,
    ),
  ).toBe('image/png')

  // Opens full size over the chat, without leaving it.
  await image.click()
  const viewer = page.getByRole('dialog', { name: 'Generated image' })
  await expect(viewer.getByRole('img')).toHaveAttribute('src', first!)
  await expect(page).toHaveURL(/\/c\//)
  expect(page.context().pages()).toHaveLength(1)
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toBeHidden()

  await page.reload()
  await expect(turns(page).first().locator('.image img')).toHaveAttribute(
    'src',
    first!,
  )

  await send(page, 'Now make it bluer')
  await answered(page)
  const edited = turns(page).nth(1).locator('.image img')
  await expect(edited).toHaveAttribute('src', /^\/api\/files\//)
  expect(await edited.getAttribute('src')).not.toBe(first)
  const imageRequest = await page.request.get(
    `${FAKE_OPENAI}/debug/last-image-request`,
  )
  expect(await imageRequest.json()).toMatchObject({
    endpoint: 'edits',
    prompt: 'make it bluer',
    model: 'e2e-image',
  })
})

test('the composer menu forces a tool for one message', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  await page.getByRole('menuitem', { name: 'Create an image' }).click()
  await expect(
    page.getByRole('button', { name: 'Remove Create an image' }),
  ).toBeVisible()
  await send(page, 'Hello there')
  await answered(page)

  const requests = (await (
    await page.request.get(`${FAKE_OPENAI}/debug/requests`)
  ).json()) as { tool_choice?: unknown }[]
  expect(requests.at(-2)!.tool_choice).toEqual({
    type: 'function',
    name: 'generate_image',
  })
  expect(requests.at(-1)).not.toHaveProperty('tool_choice')
  await expect(turns(page).first().locator('.image img')).toBeVisible()
  // The pick was for that message only.
  await expect(
    page.getByRole('button', { name: 'Remove Create an image' }),
  ).toHaveCount(0)
})

test('a tool switched off in Settings is greyed out and not sent', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Tools' }).click()
  // Saved first, then shown: click and wait rather than uncheck().
  const webSearch = dialog.getByRole('switch', { name: 'Create images' })
  await webSearch.click()
  await expect(webSearch).not.toBeChecked()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Add files and more' }).click()
  // Still listed, so it can be found, but greyed out with the reason.
  const item = page.getByRole('menuitem', { name: /Create an image/ })
  await expect(item).toBeDisabled()
  await expect(item).toContainText('Off in Settings → Tools')
  await page.keyboard.press('Escape')

  await send(page, 'Hello')
  await answered(page)
  const names = ((await lastRequest(page)).tools as { name: string }[]).map(
    (tool) => tool.name,
  )
  expect(names).not.toContain('generate_image')
  expect(names).toContain('web_search')
})

test('menus move with the arrow keys', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  const plus = page.getByRole('button', { name: 'Add files and more' })
  await plus.focus()
  await page.keyboard.press('Enter')
  const item = (name: string | RegExp) => page.getByRole('menuitem', { name })
  // Opens on its first item.
  await expect(item(/Add photos & files/)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item(/Create an image/)).toBeFocused()
  await page.keyboard.press('End')
  await expect(item(/Create an image/)).toBeFocused()
  await page.keyboard.press('ArrowDown') // wraps around
  await expect(item(/Add photos & files/)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(item(/Create an image/)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(item(/Add photos & files/)).toBeFocused()
  // Esc closes it and returns to the button.
  await page.keyboard.press('Escape')
  await expect(plus).toBeFocused()
})

// A phone's composer is narrow: text that needs more than the free width must
// wrap inside the box, not push the + button onto a row of its own.
for (const [device, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 375, height: 812 }],
] as const) {
  test(`the composer’s buttons stay on its bottom row as it grows (${device})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await appReady(page)
    const box = page.getByRole('textbox', { name: 'Message' })
    const bottoms = () =>
      page.evaluate(() => {
        const bottom = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect().bottom
        return {
          plus: bottom('.composer-left .icon-button'),
          mode: bottom('.mode-button'),
          mic: bottom('.composer-actions .icon-button'),
          send: bottom('.icon-button.primary'),
        }
      })
    const sentence = 'hello world how are you today my friend, '
    for (const text of [
      'Hi',
      sentence,
      sentence.repeat(6),
      'one\ntwo\nthree\nfour\nfive',
    ]) {
      await box.fill(text)
      const { plus, mode, mic, send } = await bottoms()
      expect({ text, mode, mic, send }).toEqual({
        text,
        mode: plus,
        mic: plus,
        send: plus,
      })
    }
  })
}
