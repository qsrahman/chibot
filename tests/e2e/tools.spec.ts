import { expect, test, type Page } from '@playwright/test'
import { answer, answered, lastRequest, send, turns } from './helpers.ts'

// Phase 5: tool calls and approvals, against tests/e2e/fake-openai.ts.
// "approve" makes the fake call the test-only e2e_note tool that needs
// approval (tests/e2e/server.ts).

const approvalCard = (page: Page) =>
  page.getByRole('region', { name: 'Tool approval' })

test('waits for approval, also across a reload, then runs the tool', async ({
  page,
}) => {
  await page.goto('/')
  await send(page, 'Please approve a note')
  await expect(approvalCard(page)).toContainText('chibot wants to use e2e_note')
  await expect(approvalCard(page)).toContainText('"text": "hello"')
  // Screen readers hear that it waits.
  await expect(page.getByRole('status')).toHaveText(
    'A tool is waiting for your approval',
  )

  await page.reload()
  await approvalCard(page).getByRole('button', { name: 'Approve' }).click()
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: Saved note: hello')
  await expect(approvalCard(page)).toHaveCount(0)
  await expect(page.getByText('Used e2e_note')).toBeVisible()
})

test('tells the model when the user denies a tool', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please approve a note')
  await approvalCard(page).getByRole('button', { name: 'Deny' }).click()
  await answered(page)
  await expect(answer(page, 0)).toHaveText(
    'Tool said: The user denied this tool call.',
  )
})

test('a new message denies the waiting tool call', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please approve a note')
  await expect(approvalCard(page)).toBeVisible()
  await send(page, 'Never mind')
  await answered(page)

  await expect(approvalCard(page)).toHaveCount(0)
  await expect(answer(page, 1)).toContainText('to: Never mind')
  const input = (await lastRequest(page)).input
  expect(input.at(-2)).toMatchObject({
    type: 'function_call_output',
    output: 'The user denied this tool call.',
  })
})

test('groups an answer’s tool calls under one row', async ({ page }) => {
  const now = Date.now()
  const item = (id: number, data: object) => ({
    id,
    parentId: id === 1 ? null : id - 1,
    data,
    usage: null,
    model: null,
    createdAt: now,
  })
  const call = (n: number, name: string, args: object, output: string) => [
    item(2 * n, {
      type: 'function_call',
      call_id: `c${n}`,
      name,
      arguments: JSON.stringify(args),
    }),
    item(2 * n + 1, {
      type: 'function_call_output',
      call_id: `c${n}`,
      output,
    }),
  ]
  const results = (url: string) =>
    JSON.stringify({ results: [{ title: url, url }] })
  const res = await page.request.post('/api/conversations/import', {
    data: {
      version: 2,
      conversation: { title: 'Grouped tools', createdAt: now, updatedAt: now },
      currentLeafId: 8,
      files: [],
      items: [
        item(1, { role: 'user', content: 'Compare two things' }),
        ...call(
          1,
          'web_search',
          { query: 'first' },
          results('https://a.example/'),
        ),
        ...call(
          2,
          'web_search',
          { query: 'second' },
          results('https://b.example/'),
        ),
        ...call(3, 'memory', { action: 'save' }, 'Saved memory 1: "Likes tea"'),
        item(8, { role: 'assistant', content: 'Here is the comparison.' }),
      ],
    },
  })
  const { id } = (await res.json()) as { id: string }
  await page.goto(`/c/${id}`)

  // One row, saying what was done (a memory change stays visible)…
  const group = turns(page).first().locator('.tool-calls')
  await expect(group.locator('> summary')).toHaveText(
    'Searched the web, Memory updated',
  )
  await expect(turns(page).first().locator('.tool-call').first()).toBeHidden()
  // …opening to each call, each with its own details.
  await group.locator('> summary').click()
  const calls = group.locator('.tool-call')
  await expect(calls).toHaveCount(3)
  await expect(calls.nth(0)).toContainText('Searched the web')
  await calls.nth(1).locator('> summary').click()
  await expect(calls.nth(1).locator('.tool-input')).toHaveText('second')
})
