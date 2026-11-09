import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { sortTools, type ToolInfo } from '../../src/shared/tools.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationSearch } from '../../src/server/conversations/index.ts'
import { openDatabase } from '../../src/server/database.ts'
import { defaultTools } from '../../src/server/main.ts'
import { MemoryStore } from '../../src/server/memory-store.ts'
import { ProjectIndex } from '../../src/server/projects/index.ts'
import { SkillStore } from '../../src/server/skills/index.ts'
import { ProjectStore } from '../../src/server/projects/index.ts'
import {
  EditImageTool,
  GenerateImageTool,
} from '../../src/server/tools/images.ts'
import {
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import { MemoryTool } from '../../src/server/tools/memory.ts'
import { EchoTool, testFiles } from './fakes.ts'

const context = { conversationId: 'c' }

// A skills folder with one skill, so the tool that reads them is available.
const skillsDir = mkdtempSync(join(tmpdir(), 'chibot-skills-'))
mkdirSync(join(skillsDir, 'one'))
writeFileSync(
  join(skillsDir, 'one', 'SKILL.md'),
  '---\nname: one\ndescription: A skill.\n---\nDo it.',
)
afterAll(() => rmSync(skillsDir, { recursive: true, force: true }))

/** The shipped tools, built from `env` (whatever it sets up). */
function shipped(env: Record<string, string>) {
  const db = openDatabase(':memory:')
  const files = testFiles(db)
  const projects = new ProjectStore(db, files)
  const config = new Config(env)
  return defaultTools({
    config,
    settings: new SettingsStore(
      db,
      settingsDefaults(config.chat.model, {
        imageModel: config.image?.model,
      }),
    ),
    search: new ConversationSearch(db),
    files,
    memories: new MemoryStore(db),
    projects,
    index: new ProjectIndex(db, projects, files, null),
    skills: new SkillStore(skillsDir),
  })
}

describe('Tool.info', () => {
  it('falls back to words made from the label', () => {
    expect(new EchoTool().info).toEqual({
      name: 'echo',
      label: 'Echo',
      group: 'Other',
      summary: '',
      running: 'Running Echo…',
      done: 'Used Echo',
      chip: null,
      unavailable: null,
      approval: null,
    })
  })

  it('tells the approval card why a tool asks, in plain words', () => {
    expect(
      new MemoryTool(new MemoryStore(openDatabase(':memory:'))).info.approval,
    ).toMatch(/plant a memory/)
    // A tool that always asks has a general line; one that never asks has none.
    class Asks extends EchoTool {
      override readonly requiresApproval = true
    }
    expect(new Asks().info.approval).toMatch(/asks before it runs/)
    expect(new GenerateImageTool(null).info.approval).toBeNull()
  })

  it('carries the tool’s own wording and its setup hint', () => {
    expect(new GenerateImageTool(null).info).toMatchObject({
      name: 'generate_image',
      group: 'Images',
      running: 'Creating an image…',
      done: 'Created an image',
      chip: { action: 'Create an image', text: 'Image', icon: 'image' },
      unavailable: 'Needs an API key or server: run `chibot init`',
    })
  })
})

describe('shipped tools', () => {
  const infos = (env: Record<string, string>): ToolInfo[] =>
    shipped(env).map((tool) => tool.info)

  it('each describe themselves: a section, a summary and their own words', () => {
    const all = infos({ OPENAI_API_KEY: 'k' })
    expect(all.map((tool) => tool.name).sort()).toEqual([
      'edit_image',
      'generate_image',
      'memory',
      'read_project_file',
      'read_skill',
      'search_chats',
      'search_project_files',
    ])
    // A new tool that forgets this would show under "Other", unexplained, as
    // "Used <label>".
    for (const tool of all) {
      expect(tool.group, tool.name).not.toBe('Other')
      expect(tool.summary, tool.name).not.toBe('')
      expect(tool.running, tool.name).not.toBe(`Running ${tool.label}…`)
      expect(tool.done, tool.name).not.toBe(`Used ${tool.label}`)
      expect(tool.unavailable, tool.name).toBeNull()
    }
  })

  it('stay listed without their setup, saying what is missing', () => {
    const unconfigured = infos({
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'gemma4:cloud',
    })
    const hint = (name: string) =>
      unconfigured.find((tool) => tool.name === name)!.unavailable
    expect(hint('generate_image')).toMatch(/Choose an image model in Settings/)
    expect(hint('edit_image')).toMatch(/Choose an image model in Settings/)
    expect(new GenerateImageTool(null).unavailable()).toMatch(
      /Needs an API key or server/,
    )
    expect(hint('memory')).toBeNull()
  })

  it('refuse to run without their setup', async () => {
    await expect(
      new GenerateImageTool(null).run({ prompt: 'x', size: 'auto' }, context),
    ).rejects.toThrow('not set up')
    await expect(
      new EditImageTool(null).run({ image_id: 'i', prompt: 'x' }, context),
    ).rejects.toThrow('not set up')
  })
})

describe('sortTools', () => {
  const tool = (label: string, group: ToolInfo['group']): ToolInfo => ({
    ...new EchoTool().info,
    name: label,
    label,
    group,
  })

  it('puts the sections in their order, and a section by label', () => {
    const sorted = sortTools([
      tool('Zed', 'Other'),
      tool('Memory', 'Your chats and files'),
      tool('Edit images', 'Images'),
      tool('Create images', 'Images'),
    ])
    expect(sorted.map((t) => t.label)).toEqual([
      'Create images',
      'Edit images',
      'Memory',
      'Zed',
    ])
  })
})
