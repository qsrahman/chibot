import { expect, test, type Page } from '@playwright/test'
import { answered, appReady, newChat, resetSettings, send } from './helpers.ts'

// The new-chat screen and voice input, as the Claude app's new-session screen
// suggested: a greeting with your name, a project to start in, and the
// language you speak.

test.afterEach(async ({ page }) => {
  await resetSettings(page)
})

async function openSettings(page: Page, tab: string) {
  await appReady(page)
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: tab, exact: true }).click()
  return dialog
}

test('the greeting uses your name once it is set, and the usual question without it', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  await expect(page.locator('.greeting h1')).toHaveText('What’s on your mind?')

  const dialog = await openSettings(page, 'Personalization')
  const name = dialog.getByLabel('Your name')
  await name.fill('Que')
  await name.press('Enter')
  await expect
    .poll(async () => {
      const { settings } = (await (
        await page.request.get('/api/settings')
      ).json()) as { settings: { userName: string } }
      return settings.userName
    })
    .toBe('Que')
  await page.keyboard.press('Escape')
  await expect(page.locator('.greeting h1')).toHaveText(
    /^(Good (morning|afternoon|evening)|Hello), Que$/,
  )

  // Emptied, the usual question comes back.
  const again = await openSettings(page, 'Personalization')
  await again.getByLabel('Your name').fill('')
  await again.getByLabel('Your name').press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator('.greeting h1')).toHaveText('What’s on your mind?')
})

test('a new chat can start in a project picked under the message box', async ({
  page,
}) => {
  const created = await page.request.post('/api/projects', {
    data: { name: 'Picker project' },
  })
  const { id: projectId } = (await created.json()) as { id: string }
  await page.goto('/')
  await appReady(page)

  const picker = page.locator('.project-picker')
  await expect(picker.getByRole('button')).toHaveAccessibleName('Project: none')
  await picker.getByRole('button').click()
  await page.getByRole('menuitemradio', { name: 'Picker project' }).click()
  await expect(picker.getByRole('button')).toHaveAccessibleName(
    'Project: Picker project',
  )

  await send(page, 'Start in the project')
  await answered(page)
  const chatId = new URL(page.url()).pathname.split('/').pop()!
  const { conversation } = (await (
    await page.request.get(`/api/conversations/${chatId}`)
  ).json()) as { conversation: { projectId: string | null } }
  expect(conversation.projectId).toBe(projectId)

  // The next new chat starts with none picked again.
  await newChat(page)
  await expect(
    page.locator('.project-picker').getByRole('button'),
  ).toHaveAccessibleName('Project: none')
  await page.request.delete(`/api/projects/${projectId}`)
})

test('a chat with no project picked starts in none, and no picker shows without projects', async ({
  page,
}) => {
  await page.goto('/')
  await appReady(page)
  const { projects } = await (async () => {
    const list = (await (await page.request.get('/api/projects')).json()) as
      { id: string }[] | { projects: { id: string }[] }
    return { projects: Array.isArray(list) ? list : list.projects }
  })()
  for (const project of projects) {
    await page.request.delete(`/api/projects/${project.id}`)
  }
  await page.reload()
  await appReady(page)
  await expect(page.locator('.project-picker')).toHaveCount(0)
  await send(page, 'No project here')
  await answered(page)
  const chatId = new URL(page.url()).pathname.split('/').pop()!
  const { conversation } = (await (
    await page.request.get(`/api/conversations/${chatId}`)
  ).json()) as { conversation: { projectId: string | null } }
  expect(conversation.projectId).toBeNull()
})

test('the spoken language is set under voice input and saved', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await openSettings(page, 'Other models')
  const language = dialog.getByLabel('Spoken language')
  await expect(language).toHaveValue('')
  await language.selectOption('ur')
  await expect
    .poll(async () => {
      const { settings } = (await (
        await page.request.get('/api/settings')
      ).json()) as { settings: { transcribeLanguage: string } }
      return settings.transcribeLanguage
    })
    .toBe('ur')
})

test('the + menu is narrow, its hints wrap', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.getByRole('button', { name: 'Add files and more' }).click()
  const box = await page.locator('.add-menu').boundingBox()
  expect(box?.width).toBeLessThanOrEqual(280)
})

test('the sidebar lists 200 chats and loads the older ones on request', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const made: string[] = []
  try {
    for (let i = 0; i < 205; i++) {
      const created = await request.post('/api/conversations')
      made.push(((await created.json()) as { id: string }).id)
    }
    await page.goto('/')
    await appReady(page)
    const rows = page.locator('.sidebar-list .sidebar-row')
    const more = page.getByRole('button', { name: 'Show more chats' })
    await expect(more).toBeVisible()
    const first = await rows.count()
    await more.click()
    await expect(more).toHaveCount(0)
    expect(await rows.count()).toBeGreaterThan(first)
  } finally {
    for (const id of made) await request.delete(`/api/conversations/${id}`)
  }
})
