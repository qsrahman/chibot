import { describe, expect, it } from 'vitest'
import { sortTools, type ToolInfo } from '../../src/shared/tools.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationSearch } from '../../src/server/conversations/index.ts'
import { openDatabase } from '../../src/server/database.ts'
import { defaultTools } from '../../src/server/main.ts'
import { MemoryStore } from '../../src/server/memory-store.ts'
import { ProjectIndex } from '../../src/server/projects/index.ts'
import { ProjectStore } from '../../src/server/projects/index.ts'
import {
  EditImageTool,
  GenerateImageTool,
} from '../../src/server/tools/images.ts'
import {
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import { WebSearchTool } from '../../src/server/tools/web-search.ts'
import { FetchUrlTool } from '../../src/server/tools/fetch-url.ts'
import { MemoryTool } from '../../src/server/tools/memory.ts'
import { EchoTool, testFiles } from './fakes.ts'

const context = { conversationId: 'c' }

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
    const shipped = new FetchUrlTool().info.approval
    expect(shipped).toMatch(
      /nothing you wrote or searched for gave this address/,
    )
    expect(
      new MemoryTool(new MemoryStore(openDatabase(':memory:'))).info.approval,
    ).toMatch(/plant a memory/)
    // A tool that always asks has a general line; one that never asks has none.
    class Asks extends EchoTool {
      override readonly requiresApproval = true
    }
    expect(new Asks().info.approval).toMatch(/asks before it runs/)
    expect(new WebSearchTool('k').info.approval).toBeNull()
  })

  it('carries the tool’s own wording and its setup hint', () => {
    expect(new WebSearchTool(null).info).toMatchObject({
      name: 'web_search',
      group: 'The web',
      running: 'Searching the web…',
      done: 'Searched the web',
      chip: null,
      unavailable: 'Needs BRAVE_API_KEY in .env',
    })
    expect(new WebSearchTool('key').info.unavailable).toBeNull()
  })
})

describe('shipped tools', () => {
  const infos = (env: Record<string, string>): ToolInfo[] =>
    shipped(env).map((tool) => tool.info)

  it('each describe themselves: a section, a summary and their own words', () => {
    const all = infos({ OPENAI_API_KEY: 'k', BRAVE_API_KEY: 'b' })
    expect(all.map((tool) => tool.name).sort()).toEqual([
      'edit_image',
      'fetch_url',
      'generate_image',
      'memory',
      'read_project_file',
      'search_chats',
      'search_project_files',
      'web_search',
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
    expect(hint('web_search')).toBe('Needs BRAVE_API_KEY in .env')
    expect(hint('generate_image')).toMatch(/Choose an image model in Settings/)
    expect(hint('edit_image')).toMatch(/Choose an image model in Settings/)
    expect(new GenerateImageTool(null).unavailable()).toMatch(
      /image server or key/,
    )
    expect(hint('fetch_url')).toBeNull()
  })

  it('refuse to run without their setup', async () => {
    await expect(
      new WebSearchTool(null).run({ query: 'x', freshness: null }, context),
    ).rejects.toThrow('not set up')
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
      tool('Search the web', 'The web'),
      tool('Edit images', 'Images'),
      tool('Read web pages', 'The web'),
    ])
    expect(sorted.map((t) => t.label)).toEqual([
      'Read web pages',
      'Search the web',
      'Edit images',
      'Memory',
      'Zed',
    ])
  })
})
