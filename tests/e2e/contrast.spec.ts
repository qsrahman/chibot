import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, send } from './helpers.ts'

// Rendered colours, not just tokens: axe measures the text and background
// actually drawn (code tokens, maths, links, tables, the image viewer, menus,
// dialogs, toasts) in both colour schemes.

const RICH = [
  'A [link](https://example.com/) and `inline code`, ~~struck~~ and **bold**.',
  '> A quote, set apart.',
  '| Name | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |',
  '- [x] done\n- [ ] not yet',
  'Inline maths $E = mc^2$ and a block:\n\n$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$',
  '```ts\n// a comment\nexport const f = (n: number): string => `n=${n}` // template\nclass A<T> { private x = 1 }\n```',
  '```python\n# a comment\ndef f(n: int) -> str:\n    return f"{n}" + \'x\'\n```',
  '```css\n.a > .b:hover { color: #fa0; margin: 0 }\n```',
  '```json\n{ "a": [1, true, null], "b": "text" }\n```',
  '```diff\n- removed line\n+ added line\n  same\n```',
  '```bash\n$ echo "hi" | grep -i h # note\n```',
].join('\n\n')

async function richChat(page: Page) {
  const res = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      exportedAt: 0,
      conversation: { title: 'Rich chat', createdAt: 1, updatedAt: 2 },
      currentLeafId: 2,
      items: [
        {
          id: 1,
          parentId: null,
          data: { role: 'user', content: 'Show everything' },
          usage: null,
          model: null,
          createdAt: 1,
        },
        {
          id: 2,
          parentId: 1,
          data: {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            id: 'msg_2',
            content: [{ type: 'output_text', text: RICH, annotations: [] }],
          },
          usage: null,
          model: 'e2e-model',
          createdAt: 2,
        },
      ],
      files: [],
    },
  })
  return ((await res.json()) as { id: string }).id
}

/** The rules axe breaks, as short lines (empty when there are none). */
async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return violations.map(
    (v) =>
      `${v.id}: ${v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim()}`,
        )
        .join(' | ')}`,
  )
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.addInitScript((s) => {
        try {
          localStorage.setItem('chibot.colorScheme', s)
        } catch {}
      }, scheme)
    })

    test('the new chat and the chat list', async ({ page }) => {
      await page.goto('/')
      await appReady(page)
      expect(await violations(page)).toEqual([])
    })

    test('an answer with code, maths, a table and a link', async ({ page }) => {
      const id = await richChat(page)
      await page.goto(`/c/${id}`)
      await expect(page.locator('.katex').first()).toBeVisible()
      expect(await violations(page)).toEqual([])
    })

    test('menus, dialogs, the image viewer and a toast', async ({ page }) => {
      await page.goto('/')
      await appReady(page)
      await send(page, 'Please draw a robot')
      await answered(page)

      await page.getByRole('button', { name: 'Add files and more' }).click()
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')

      await page.locator('.turn .image img').first().click()
      await expect(
        page.getByRole('dialog', { name: 'Generated image' }),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')

      await page.keyboard.press('ControlOrMeta+k')
      await expect(
        page.getByRole('dialog', { name: 'Search chats' }),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')

      await page.keyboard.press('ControlOrMeta+/')
      await expect(
        page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')
    })

    test('the delete confirmation, and a toast', async ({ page }) => {
      const created = await page.request.post('/api/conversations', {
        data: {},
      })
      const { id } = (await created.json()) as { id: string }
      await page.request.patch(`/api/conversations/${id}`, {
        data: { title: `Contrast chat ${scheme}` },
      })
      await page.goto('/')
      await appReady(page)
      const row = page.locator('.conversation-row', {
        hasText: `Contrast chat ${scheme}`,
      })
      await row.hover()
      await row.getByRole('button', { name: /Options for/ }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await expect(
        page
          .getByRole('dialog', { name: 'Delete chat?' })
          .locator('.button.danger'),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      await page.getByRole('button', { name: 'Cancel' }).click()

      await row.hover()
      await row.getByRole('button', { name: /Options for/ }).click()
      await page.getByRole('menuitem', { name: 'Archive' }).click()
      await expect(page.locator('.toast')).toBeVisible()
      // Measured once it has faded in.
      await page
        .locator('.toast')
        .evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished)),
        )
      expect(await violations(page)).toEqual([])
      // Put it back for the other specs.
      await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
    })

    test('the approval card', async ({ page }) => {
      await page.goto('/')
      await appReady(page)
      await send(page, 'Please approve a note')
      await expect(
        page.getByRole('region', { name: 'Tool approval' }),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      // Deny, so the chat is free for the next spec.
      await page.getByRole('button', { name: 'Deny' }).click()
      await answered(page)
    })

    test('every Settings tab', async ({ page }) => {
      await page.goto('/')
      await appReady(page)
      await page.keyboard.press('ControlOrMeta+,')
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      for (const tab of [
        'General',
        'Personalization',
        'Model',
        'Other models',
        'Tools',
        'Data',
      ]) {
        await dialog.getByRole('button', { name: tab, exact: true }).click()
        const found = await violations(page)
        expect(found, tab).toEqual([])
      }
    })
  })
}
