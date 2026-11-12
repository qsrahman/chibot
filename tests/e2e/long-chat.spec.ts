import { expect, test } from '@playwright/test'
import { appReady, longChat } from './helpers.ts'

// A long chat is mostly offscreen, so the browser is told it may skip laying
// out and painting the turns that are (`content-visibility: auto`): resizing
// the window or toggling the sidebar re-lays-out only what is on screen.

const TURNS = 80

// Whether what is inside a turn is laid out (it is not while the turn is
// skipped; the turn's own box always is).
const rendered = (turn: import('@playwright/test').Locator) =>
  turn
    .locator('.message.user')
    .evaluate((el) => el.checkVisibility({ contentVisibilityAuto: true }))

test('skips the turns that are offscreen, and starts at the end', async ({
  page,
}) => {
  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  const turns = page.locator('.turn')
  await expect(turns).toHaveCount(TURNS)
  await expect(turns.last()).toBeInViewport()
  expect(await rendered(turns.last())).toBe(true)
  // The first turn is far above the screen: its content is not laid out.
  await expect.poll(() => rendered(turns.first())).toBe(false)
  await expect(turns.first()).toHaveCSS('content-visibility', 'auto')
})

test('still jumps back to the latest message after scrolling to the top', async ({
  page,
}) => {
  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  const turns = page.locator('.turn')
  await expect(turns).toHaveCount(TURNS)
  const messages = page.locator('.messages')
  // As a person does (the wheel): the page tells that from its own layout moving.
  await messages.hover()
  await page.mouse.wheel(0, -1_000_000)
  await expect(turns.first()).toBeInViewport()
  await expect(turns.last()).not.toBeInViewport()

  const jump = page.getByRole('button', { name: 'Jump to latest' })
  await jump.click()
  await expect(turns.last()).toBeInViewport()
  await expect(jump).toHaveCount(0)
})

test('keeps its place while skipped turns are measured', async ({ page }) => {
  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  const messages = page.locator('.messages')
  const turns = page.locator('.turn')
  await expect(turns).toHaveCount(TURNS)
  // Scroll up through turns that have never been drawn, so their real heights
  // replace the estimate as they come into view.
  for (let i = 0; i < 6; i++) {
    await messages.evaluate((el) => (el.scrollTop -= 1500))
    await page.waitForTimeout(80)
  }
  // Whatever turn is at the top of the screen stays where it is.
  const top = await messages.evaluate((el) => {
    const edge = el.getBoundingClientRect().top
    const turn = [...el.querySelectorAll('.turn')].find(
      (t) => t.getBoundingClientRect().bottom > edge + 50,
    )!
    return {
      text: turn.querySelector('.message.user')!.textContent,
      offset: turn.getBoundingClientRect().top - edge,
    }
  })
  await page.waitForTimeout(400)
  const later = await messages.evaluate((el, text) => {
    const edge = el.getBoundingClientRect().top
    const turn = [...el.querySelectorAll('.turn')].find(
      (t) => t.querySelector('.message.user')!.textContent === text,
    )!
    return turn.getBoundingClientRect().top - edge
  }, top.text)
  expect(Math.abs(later - top.offset)).toBeLessThan(2)
})

test('leaves room for the focus ring of the first and last controls of a turn', async ({
  page,
}) => {
  const id = await longChat(page, TURNS)
  await page.goto(`/c/${id}`)
  await appReady(page)
  // Content-visibility clips what pokes out of a turn, rings included.
  const room = await page
    .locator('.turn')
    .last()
    .evaluate((turn) => {
      const box = turn.getBoundingClientRect()
      const edges = {
        top: Infinity,
        bottom: Infinity,
        left: Infinity,
        right: Infinity,
      }
      for (const control of turn.querySelectorAll('button, a[href]')) {
        const r = control.getBoundingClientRect()
        if (r.width === 0) continue
        edges.top = Math.min(edges.top, r.top - box.top)
        edges.bottom = Math.min(edges.bottom, box.bottom - r.bottom)
        edges.left = Math.min(edges.left, r.left - box.left)
        edges.right = Math.min(edges.right, box.right - r.right)
      }
      return edges
    })
  // The ring is 2px wide and 2px away.
  for (const [side, space] of Object.entries(room)) {
    expect(space, side).toBeGreaterThanOrEqual(4)
  }
})
