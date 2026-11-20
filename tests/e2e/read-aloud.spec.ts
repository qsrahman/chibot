import { expect, test } from '@playwright/test'
import { answered, appReady, newChat, send, turns } from './helpers.ts'

// The browser's voice is stubbed: it records what it is asked to say and
// finishes each piece at once.
test('an answer can be read aloud', async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = []
    const w = window as unknown as Record<string, unknown>
    w.__spoken = spoken
    w.SpeechSynthesisUtterance = class {
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      lang = ''
      text: string
      constructor(text: string) {
        this.text = text
      }
    }
    // A plain assignment is ignored: `speechSynthesis` is a getter on window.
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(u: { text: string; onend: (() => void) | null }) {
          spoken.push(u.text)
          setTimeout(() => u.onend?.(), 50)
        },
        cancel() {},
      },
    })
  })
  await page.goto('/')
  await appReady(page)
  await newChat(page)
  await send(page, 'hello')
  await answered(page)
  const reply = turns(page).nth(0)
  await reply.hover()
  await reply.getByRole('button', { name: 'Read aloud' }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __spoken: string[] }).__spoken.length,
      ),
    )
    .toBeGreaterThan(0)
  // It finishes by itself and the button is back.
  await expect(reply.getByRole('button', { name: 'Read aloud' })).toBeVisible()
})

test('the model name says when the answer was written, and code has an icon', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await newChat(page)
  await send(page, 'rtl-markdown')
  await answered(page)
  await expect(page.locator('.model-name').first()).toHaveAttribute(
    'title',
    /^Written by .+, Today, /,
  )
  await expect(page.locator('.code-label svg').first()).toBeVisible()
})
