import { expect, test, type Page } from '@playwright/test'
import { answer, answered, lastRequest, send, turns } from './helpers.ts'

// Phase 5: tool calls and approvals, against tests/e2e/fake-openai.ts.
// "calculate" makes the fake call the calculator, "approve" the test-only
// e2e_note tool that needs approval (tests/e2e/server.ts).

const approvalCard = (page: Page) =>
  page.getByRole('region', { name: 'Tool approval' })

test('runs the calculator and shows what it did', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please calculate this')
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: 42')
  expect((await lastRequest(page)).input.at(-1)).toMatchObject({
    type: 'function_call_output',
    output: '42',
  })

  await page.reload()
  const tool = turns(page).first().locator('.tool-call')
  await tool.getByText('Used calculator').click()
  // In plain terms first; the raw call is one click further.
  await expect(tool.locator('.tool-input')).toHaveText('6 * 7')
  await expect(tool.locator('.tool-result')).toHaveText('42')
  await expect(tool.locator('.tool-details')).toBeHidden()
  await tool.getByText('Raw').click()
  await expect(tool.locator('.tool-details')).toContainText(
    '"expression": "6 * 7"',
  )
})

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
