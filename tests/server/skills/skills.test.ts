import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadSkillTool, SkillStore } from '../../../src/server/skills/index.ts'
import type { SkillsResponse } from '../../../src/shared/types.ts'
import { ToolRegistry } from '../../../src/server/tool-registry.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  testApp,
  testChat,
  testSettings,
  type FakeCall,
} from '../fakes.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chibot-skills-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Writes `folder/path` (making folders), and returns its path. */
const put = (path: string, text: string) => {
  const file = join(dir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}
const skill = (
  name: string,
  description = 'Does a thing. Use for things.',
  body = 'Do the thing.',
) =>
  put(
    `${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  )

describe('SkillStore', () => {
  it('lists the skills in a folder, by name', () => {
    skill('pdf-processing', 'Extracts PDF text. Use for PDFs.')
    skill('code-review')
    put('notes.txt', 'not a skill')
    put('.hidden/SKILL.md', 'ignored')
    const { skills, problems } = new SkillStore(dir).list()
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['code-review', 'Does a thing. Use for things.'],
      ['pdf-processing', 'Extracts PDF text. Use for PDFs.'],
    ])
    expect(problems).toEqual([])
  })

  it('has no skills where there is no folder yet', () => {
    expect(new SkillStore(join(dir, 'missing')).list()).toEqual({
      skills: [],
      problems: [],
    })
  })

  it('says why a folder is not a skill, and lists the others', () => {
    skill('good')
    put('no-file/readme.md', 'x')
    put('no-header/SKILL.md', 'just text')
    put(
      'bad-yaml/SKILL.md',
      '---\nname: bad-yaml\ndescription: use this: now\n---\nx',
    )
    put('Upper-Case/SKILL.md', '---\nname: Upper-Case\ndescription: d\n---\nx')
    put('wrong/SKILL.md', '---\nname: other\ndescription: d\n---\nx')
    put('no-description/SKILL.md', '---\nname: no-description\n---\nx')
    put(
      'long/SKILL.md',
      `---\nname: long\ndescription: ${'x'.repeat(1025)}\n---\nx`,
    )
    put(
      'double--hyphen/SKILL.md',
      '---\nname: double--hyphen\ndescription: d\n---\nx',
    )
    const { skills, problems } = new SkillStore(dir).list()
    expect(skills.map((s) => s.name)).toEqual(['good'])
    const reasons = Object.fromEntries(
      problems.map((p) => [p.folder, p.reason]),
    )
    expect(reasons['no-file']).toMatch(/no SKILL\.md/)
    expect(reasons['no-header']).toMatch(/--- header/)
    expect(reasons['bad-yaml']).toMatch(/not valid YAML/)
    expect(reasons['Upper-Case']).toMatch(/name: lowercase/)
    expect(reasons['wrong']).toMatch(/must match the folder name/)
    expect(reasons['no-description']).toMatch(/description/)
    expect(reasons['long']).toMatch(/description/)
    expect(reasons['double--hyphen']).toMatch(/name: lowercase/)
  })

  it('accepts a header with CRLF line ends, extra fields and a byte order mark', () => {
    put(
      'windows/SKILL.md',
      '﻿---\r\nname: windows\r\ndescription: From Windows.\r\nlicense: MIT\r\nmetadata:\r\n  author: me\r\n---\r\nBody\r\n',
    )
    const store = new SkillStore(dir)
    expect(store.list().skills.map((s) => s.name)).toEqual(['windows'])
    expect(store.load('windows').body).toBe('Body')
  })

  it('loads the instructions without the header, and names the other files', () => {
    skill('report', 'Writes reports.', '# Steps\n\nWrite it.')
    put('report/references/style.md', 'Be brief.')
    put('report/assets/logo.png', 'x')
    put('report/.git/config', 'hidden')
    const { body, files } = new SkillStore(dir).load('report')
    expect(body).toBe('# Steps\n\nWrite it.')
    expect(files).toEqual(['assets/logo.png', 'references/style.md'])
  })

  it('reads a file of a skill, and nothing outside it', () => {
    skill('report')
    put('report/references/style.md', 'Be brief.')
    put('secret.txt', 'outside')
    const store = new SkillStore(dir)
    expect(store.readFile('report', 'references/style.md')).toBe('Be brief.')
    expect(() => store.readFile('report', '../secret.txt')).toThrow(
      'outside the skill',
    )
    expect(() => store.readFile('report', join(dir, 'secret.txt'))).toThrow(
      'from the skill’s folder',
    )
    expect(() => store.readFile('report', 'references/none.md')).toThrow(
      'no file',
    )
    expect(() => store.readFile('report', 'references')).toThrow('not a file')
    // A link in a skill that leads out of it.
    symlinkSync(join(dir, 'secret.txt'), join(dir, 'report', 'link.txt'))
    expect(() => store.readFile('report', 'link.txt')).toThrow(
      'outside the skill',
    )
  })

  it('refuses large and binary files', () => {
    skill('report')
    put('report/big.md', 'x'.repeat(200_001))
    writeFileSync(join(dir, 'report', 'image.bin'), Buffer.from([1, 2, 0, 3]))
    const store = new SkillStore(dir)
    expect(() => store.readFile('report', 'big.md')).toThrow('too large')
    expect(() => store.readFile('report', 'image.bin')).toThrow(
      'not a text file',
    )
  })

  it('takes a skill folder that is a link, as shared skills are', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'chibot-skills-elsewhere-'))
    try {
      mkdirSync(join(elsewhere, 'shared'))
      writeFileSync(
        join(elsewhere, 'shared', 'SKILL.md'),
        '---\nname: shared\ndescription: Lives elsewhere.\n---\nHello',
      )
      writeFileSync(join(elsewhere, 'shared', 'extra.md'), 'more')
      symlinkSync(join(elsewhere, 'shared'), join(dir, 'shared'))
      const store = new SkillStore(dir)
      expect(store.list().skills.map((s) => s.name)).toEqual(['shared'])
      expect(store.readFile('shared', 'extra.md')).toBe('more')
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('names the skills there are when one is not found', () => {
    skill('alpha')
    skill('beta')
    expect(() => new SkillStore(dir).load('gamma')).toThrow(
      'no skill named "gamma"; the skills are alpha, beta',
    )
  })
})

describe('ReadSkillTool', () => {
  it('is unavailable without skills, and says where to add them', () => {
    const tool = new ReadSkillTool(new SkillStore(dir))
    expect(tool.unavailable()).toContain(dir)
    expect(tool.info.unavailable).toContain('SKILL.md')
    skill('one')
    expect(tool.unavailable()).toBeNull()
  })

  it('tells the model which skills there are, with when to use each', () => {
    skill('pdf-processing', 'Extracts PDF text. Use for PDFs.')
    skill('wordy', `${'word '.repeat(200)}end`)
    const text = new ReadSkillTool(new SkillStore(dir)).instructions()
    expect(text).toContain('read_skill')
    expect(text).toContain(
      '<skills>\npdf-processing: Extracts PDF text. Use for PDFs.\nwordy: word word',
    )
    // A long description is cut in the list.
    expect(text).not.toContain('end\n</skills>')
    expect(text).toContain('…\n</skills>')
    expect(text).toContain('cannot run a skill’s scripts')
  })

  it('returns the instructions, with the other files named, or a file', async () => {
    skill('report', 'Writes reports.', 'Read references/style.md first.')
    put('report/references/style.md', 'Be brief.')
    const tool = new ReadSkillTool(new SkillStore(dir))
    expect(await tool.run({ name: 'report', file: null })).toBe(
      'Skill: report\nOther files in this skill (read one with the file argument): references/style.md\n\nRead references/style.md first.',
    )
    expect(
      await tool.run({ name: 'report', file: 'references/style.md' }),
    ).toBe('Be brief.')
    await expect(tool.run({ name: 'nope', file: null })).rejects.toThrow(
      'no skill named',
    )
  })

  it('has strict parameters the model can fill', () => {
    const { declaration } = new ReadSkillTool(new SkillStore(dir))
    expect(declaration).toMatchObject({
      name: 'read_skill',
      strict: true,
      parameters: { required: ['name', 'file'] },
    })
  })
})

describe('GET /api/skills', () => {
  it('lists the skills and the folders left out, for Settings', async () => {
    skill('good', 'Is good.')
    put('bad/SKILL.md', 'nope')
    const app = testApp({ skills: new SkillStore(dir) })
    const body = (await (
      await app.request('/api/skills')
    ).json()) as SkillsResponse
    expect(body).toEqual({
      dir,
      skills: [{ name: 'good', description: 'Is good.' }],
      problems: [
        { folder: 'bad', reason: expect.stringContaining('--- header') },
      ],
    })
  })
})

describe('skills in chats', () => {
  async function firstRequest(disabledTools: string[] = []) {
    const store = memoryStore()
    const calls: FakeCall[] = []
    const chat = testChat(answerEvents('ok'), {
      store,
      calls,
      settings: testSettings('m', { disabledTools }),
      tools: new ToolRegistry([new ReadSkillTool(new SkillStore(dir))]),
    })
    const { id } = store.createConversation({})
    await drain(chat.runTurn(id, { text: 'Hi' }, undefined))
    return calls[0]!.params
  }

  it('sends the list of skills and the tool', async () => {
    skill('pdf-processing', 'Extracts PDF text. Use for PDFs.')
    const params = await firstRequest()
    expect(params.instructions).toContain('pdf-processing: Extracts PDF text.')
    expect(params.tools).toEqual([
      expect.objectContaining({ name: 'read_skill' }),
    ])
  })

  it('sends neither without skills, or with the tool switched off', async () => {
    for (const params of [await firstRequest()]) {
      expect(params.instructions).not.toContain('read_skill')
      expect(params).not.toHaveProperty('tools')
    }
    skill('pdf-processing')
    const off = await firstRequest(['read_skill'])
    expect(off.instructions).not.toContain('pdf-processing')
    expect(off).not.toHaveProperty('tools')
  })
})
