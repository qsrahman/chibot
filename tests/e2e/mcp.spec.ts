import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  answer,
  answered,
  appReady,
  lastRequest,
  resetSettings,
  send,
  turns,
} from './helpers.ts'

// Phase 10: MCP servers (tests/e2e/server.ts): `fixture`, a local server,
// and `tracker`, a remote one behind a fake OAuth provider.

// What tests/e2e/server.ts wrote; the Reload test edits and restores it.
const MCP_JSON = '.e2e-data/mcp.json'

// Switches live in each server's entry in the file (not the settings): put
// every server back on, asking nothing, with all its tools on.
async function resetSwitches(page: Page) {
  const patch = (name: string, data: unknown) =>
    page.request.patch(`/api/mcp/servers/${name}`, { data })
  const { servers } = (await (await page.request.get('/api/mcp')).json()) as {
    servers: {
      name: string
      tools: { name: string; enabled: boolean }[]
    }[]
  }
  for (const { name, tools } of servers) {
    await patch(name, { enabled: true, ask: false })
    for (const tool of tools.filter((t) => !t.enabled)) {
      await patch(name, {
        tool: { name: tool.name.slice(name.length + 2), enabled: true },
      })
    }
  }
}

test.afterEach(async ({ page }) => {
  await resetSettings(page)
  await resetSwitches(page)
})

async function openTools(page: Page) {
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Tools' }).click()
  return dialog
}

const server = (page: Page, name: string) =>
  page.locator('.settings-section', { hasText: `MCP · ${name}` })

test('lists the servers and their tools, with switches', async ({ page }) => {
  await page.goto('/')
  const dialog = await openTools(page)
  const fixture = server(page, 'fixture')
  await expect(fixture).toContainText('Local server')
  await expect(fixture).toContainText('Connected · 6 tools')
  await expect(fixture.getByText('Repeats the text')).toBeVisible()
  await expect(server(page, 'tracker')).toContainText('Needs sign-in')
  // Not among chibot's own tools (Other holds the e2e test tool).
  await expect(
    dialog.locator('.settings-section', { hasText: 'Other' }),
  ).not.toContainText('Echo')

  // A tool switched off isn't offered.
  await dialog.getByRole('switch', { name: 'Echo' }).click()
  // The switch follows what the server saved.
  await expect(dialog.getByRole('switch', { name: 'Echo' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await send(page, 'Hello there')
  await answered(page)
  const offered = ((await lastRequest(page)).tools ?? []) as { name: string }[]
  expect(offered.map((t) => t.name)).not.toContain('fixture__echo')
  expect(offered.map((t) => t.name)).toContain('fixture__picture')

  // A server switched off stops, and comes back.
  await openTools(page)
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect(server(page, 'fixture')).toContainText('Off')
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect(server(page, 'fixture')).toContainText('Connected · 6 tools')
})

test('reloads mcp.json after it was edited', async ({ page }) => {
  const original = readFileSync(MCP_JSON, 'utf8')
  try {
    await page.goto('/')
    const dialog = await openTools(page)
    await expect(server(page, 'fixture')).toContainText('Connected')
    await expect(server(page, 'broken')).toHaveCount(0)

    const config = JSON.parse(original) as {
      mcpServers: Record<string, unknown>
    }
    config.mcpServers.broken = { type: 'local', command: 'chibot-no-such-cmd' }
    writeFileSync(MCP_JSON, JSON.stringify(config))
    await dialog.getByRole('button', { name: 'Reload' }).click()
    // The new server shows why it failed; the others stay connected.
    await expect(server(page, 'broken')).toContainText('Failed')
    await expect(server(page, 'fixture')).toContainText('Connected · 6 tools')

    // A file with mistakes is reported, and nothing changes.
    writeFileSync(MCP_JSON, '{ not json')
    await dialog.getByRole('button', { name: 'Reload' }).click()
    await expect(dialog.getByRole('alert')).toContainText('mcp.json')
    await expect(server(page, 'broken')).toContainText('Failed')

    writeFileSync(MCP_JSON, original)
    await dialog.getByRole('button', { name: 'Reload' }).click()
    await expect(server(page, 'broken')).toHaveCount(0)
    await expect(server(page, 'fixture')).toContainText('Connected · 6 tools')
  } finally {
    writeFileSync(MCP_JSON, original)
  }
})

test('asks before a server’s tools when set to', async ({ page }) => {
  await page.goto('/')
  const dialog = await openTools(page)
  await dialog
    .getByRole('switch', { name: 'Ask before using its tools' })
    .first()
    .click()
  await expect(
    dialog.getByRole('switch', { name: 'Ask before using its tools' }).first(),
  ).toBeChecked()
  await page.keyboard.press('Escape')
  await send(page, 'Please mcp echo hi')
  const card = page.getByRole('region', { name: 'Tool approval' })
  // Its name, and why it asks (this server was set to).
  await expect(card).toContainText('Echo')
  await expect(card).toContainText('MCP server “fixture”')
  await card.getByRole('button', { name: 'Approve' }).click()
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: echo: hi')
})

test('signs in to a remote server and back out', async ({ page }) => {
  await page.goto('/')
  await openTools(page)
  const tracker = server(page, 'tracker')
  await tracker.getByRole('button', { name: 'Sign in' }).click()
  // The provider signs in at once and sends the browser back to Settings.
  await expect(page).toHaveURL('/')
  await expect(tracker).toContainText('Connected · 6 tools')

  await tracker.getByRole('button', { name: 'Sign out' }).click()
  await expect(tracker).toContainText('Needs sign-in')
  await expect(tracker.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})

test('calls an MCP tool in a chat and shows its images', async ({ page }) => {
  await page.goto('/')
  await send(page, 'Please mcp echo hi')
  await answered(page)
  await expect(answer(page, 0)).toHaveText('Tool said: echo: hi')
  const tool = turns(page).first().locator('.tool-call')
  await tool.getByText('Used echo · fixture').click()
  await expect(tool.locator('.tool-input')).toHaveText('{"text":"hi"}')
  await expect(tool.locator('.tool-result')).toHaveText('echo: hi')
  // In plain terms first; the raw call is one click further.
  await expect(tool.locator('.tool-details')).toBeHidden()
  await tool.getByText('Raw').click()
  await expect(tool.locator('.tool-details')).toContainText('"text": "hi"')

  await send(page, 'Show an mcp picture')
  await expect(turns(page).nth(1).locator('.image img')).toBeVisible()
  await answered(page)
  expect((await lastRequest(page)).input.at(-1)).toMatchObject({
    type: 'function_call_output',
    output: expect.stringContaining('[An image, shown to the user]'),
  })
})

test('adds, edits and removes a server in Settings, keeping its key hidden', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await openTools(page)
  await dialog.getByRole('button', { name: 'Add server' }).click()
  const form = page.getByRole('dialog', { name: 'Add an MCP server' })
  await form.getByLabel('Start from').selectOption('Custom')
  await form.getByLabel('Name').fill('extra')
  await form.getByLabel('Kind').selectOption({ label: 'Remote: a URL' })
  await form
    .getByRole('textbox', { name: 'URL' })
    .fill('http://127.0.0.1:1/mcp')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await form.getByLabel('Headers name 1').fill('X-Key')
  await form.getByLabel('Headers value 1').fill('super-secret-value')
  await form.getByRole('button', { name: 'Add server' }).click()
  await expect(form).toBeHidden()
  await expect(server(page, 'extra')).toContainText('Remote server')

  // The saved value never comes back: the edit form shows only its name.
  await server(page, 'extra').getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit extra' })
  await expect(edit.getByLabel('Headers name 1')).toHaveValue('X-Key')
  await expect(edit.getByLabel('Headers value 1')).toHaveValue('')
  await expect(edit.getByLabel('Headers value 1')).toHaveAttribute(
    'placeholder',
    'Saved (hidden)',
  )
  const definitions = await page.request.get('/api/mcp/definitions')
  expect(await definitions.text()).not.toContain('super-secret-value')
  await edit
    .getByRole('textbox', { name: 'URL' })
    .fill('http://127.0.0.1:2/mcp')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()

  await server(page, 'extra').getByRole('button', { name: 'Remove' }).click()
  await page
    .getByRole('dialog', { name: 'Remove extra?' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(server(page, 'extra')).toHaveCount(0)
  // The ones from the file are still there.
  await expect(server(page, 'fixture')).toBeVisible()
})

test('keeps the switches in the server’s entry in the file', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await openTools(page)
  const entry = () =>
    (
      JSON.parse(readFileSync(MCP_JSON, 'utf8')) as {
        mcpServers: Record<string, Record<string, unknown>>
      }
    ).mcpServers.fixture!

  await dialog.getByRole('switch', { name: 'Echo' }).click()
  await expect.poll(() => entry().disabledTools).toEqual(['echo'])
  await dialog
    .getByRole('switch', { name: 'Ask before using its tools' })
    .first()
    .click()
  await expect.poll(() => entry().ask).toBe(true)
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect.poll(() => entry().enabled).toBe(false)
  // The server's definition is as it was.
  expect(entry()).toMatchObject({ type: 'local' })

  // Reloading the page shows the same: it comes from the file.
  await page.reload()
  const again = await openTools(page)
  await expect(server(page, 'fixture')).toContainText('Off')
  await page.getByRole('switch', { name: 'Use fixture' }).click()
  await expect.poll(() => entry().enabled).toBeUndefined()
  await expect(again.getByRole('switch', { name: 'Echo' })).not.toBeChecked()
  await again.getByRole('switch', { name: 'Echo' }).click()
  await expect.poll(() => entry().disabledTools).toBeUndefined()
})
