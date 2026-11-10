import { z } from 'zod'
import { MAX_LISTED_SKILLS, skillSwitch } from '../../shared/skills.ts'
import { section } from '../prompt-tags.ts'
import { Tool } from '../tool.ts'
import type { SkillStore } from './skill-store.ts'

// Each skill is listed in the instructions with when it applies. Every request
// carries the list, so the descriptions share a budget: a few skills get their
// whole description (up to the longest), many get a shorter one (down to the
// least that still says when to use it), and only so many are listed.
const LONGEST_DESCRIPTION = 400
const SHORTEST_DESCRIPTION = 120
const LIST_BUDGET = 8000

/** Loads the instructions of a skill the user added, when a request matches it. */
export class ReadSkillTool extends Tool {
  readonly name = 'read_skill'
  readonly label = 'Use skills'
  // Skills are files the user keeps, like memories and project files.
  override readonly group = 'Your chats and files'
  override readonly summary =
    'Reads the instructions of a skill you added (a folder with a SKILL.md) when a request matches it. Off, no skill is used.'
  override readonly running = 'Reading a skill…'
  override readonly done = 'Read a skill'
  readonly description =
    'Loads a skill: written instructions for a kind of task, and the other files they refer to.'
  readonly parameters = z.object({
    name: z.string().describe('The skill, as listed in the instructions'),
    file: z
      .string()
      .nullable()
      .describe(
        'A file the skill refers to, by its path from the skill’s folder; null for the skill’s own instructions',
      ),
  })
  readonly #skills: SkillStore

  /** The skills switched off in Settings (see `skillSwitch`). */
  readonly #off: () => readonly string[]

  constructor(skills: SkillStore, off: () => readonly string[] = () => []) {
    super()
    this.#skills = skills
    this.#off = off
  }

  #isOff(name: string) {
    return this.#off().includes(skillSwitch(name))
  }

  override unavailable() {
    const { skills } = this.#skills.list()
    if (skills.length === 0) {
      return `No skills yet: add a folder with a SKILL.md to ${this.#skills.dir}.`
    }
    return skills.some(({ name }) => !this.#isOff(name))
      ? null
      : 'Every skill is switched off.'
  }

  override instructions() {
    const skills = this.#skills
      .list()
      .skills.filter(({ name }) => !this.#isOff(name))
      .slice(0, MAX_LISTED_SKILLS)
    const cap = Math.min(
      LONGEST_DESCRIPTION,
      Math.max(SHORTEST_DESCRIPTION, Math.floor(LIST_BUDGET / skills.length)),
    )
    const listed = skills.map(({ name, description }) => {
      const text = description.replace(/\s+/g, ' ')
      return `${name}: ${text.length > cap ? `${text.slice(0, cap)}…` : text}`
    })
    return [
      'The user has added skills: written instructions for particular kinds of ' +
        'task. Each is listed below with when it applies. When a request matches ' +
        'one, call read_skill with its name before you answer, then follow what it ' +
        'says; it may refer to other files, which read_skill returns with the file ' +
        'argument. You cannot run a skill’s scripts here, so rely on its written ' +
        'steps and reference files. The skills (name: when to use it):',
      section('skills', listed.join('\n')),
    ].join('\n')
  }

  async run({ name, file }: z.output<typeof this.parameters>) {
    if (this.#isOff(name)) {
      throw new Error(`the skill "${name}" is switched off in Settings`)
    }
    if (file) return this.#skills.readFile(name, file)
    const { body, files } = this.#skills.load(name)
    return [
      `Skill: ${name}`,
      files.length
        ? `Other files in this skill (read one with the file argument): ${files.join(', ')}`
        : null,
      '',
      body,
    ]
      .filter((line) => line !== null)
      .join('\n')
  }
}
