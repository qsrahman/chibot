import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import YAML from 'yaml'
import { z } from 'zod'
import type { SkillProblem } from '../../shared/types.ts'
import { errorMessage } from '../../shared/errors.ts'

// Skills are folders in the Agent Skills format (https://agentskills.io/specification):
// a SKILL.md with a YAML header naming and describing the skill, then its
// instructions, and any files they refer to.

// Lowercase letters and digits in words joined by single hyphens, as the spec
// says; the folder must be named the same.
const NAME = /^[\p{Ll}\p{Nd}]+(-[\p{Ll}\p{Nd}]+)*$/u
const header = z.looseObject({
  name: z
    .string()
    .max(64)
    .regex(NAME, 'lowercase letters, digits and single hyphens'),
  description: z.string().trim().min(1).max(1024),
  compatibility: z.string().min(1).max(500).optional(),
})

const MAX_SKILLS = 100
const MAX_FILE_BYTES = 200_000
const MAX_LISTED_FILES = 60
const MAX_DEPTH = 3

/** A skill that was read: what it is called and when to use it. */
export interface Skill {
  name: string
  description: string
  /** Where it is (resolved, so links in a skill can be kept inside it). */
  directory: string
}

/** The skills in a folder, read afresh at each use, so adding one needs no restart. */
export class SkillStore {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /**
   * Every valid skill, and why each folder that isn't one is left out;
   * `skipped` counts the folders past the most that are read.
   */
  list(): { skills: Skill[]; problems: SkillProblem[]; skipped: number } {
    const skills: Skill[] = []
    const problems: SkillProblem[] = []
    let entries
    try {
      entries = readdirSync(this.dir, { withFileTypes: true })
    } catch {
      return { skills, problems, skipped: 0 } // no folder yet: no skills
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const { name: folder } of entries.slice(0, MAX_SKILLS)) {
      const directory = join(this.dir, folder)
      // A link to a folder counts as one (skills are often shared that way).
      if (
        folder.startsWith('.') ||
        !statSync(directory, { throwIfNoEntry: false })?.isDirectory()
      ) {
        continue
      }
      const parsed = this.#read(directory, folder)
      if (typeof parsed === 'string') problems.push({ folder, reason: parsed })
      else skills.push(parsed.skill)
    }
    return {
      skills,
      problems,
      skipped: Math.max(0, entries.length - MAX_SKILLS),
    }
  }

  /** A skill's instructions, and the other files it has (to read with `file`). */
  load(name: string): { skill: Skill; body: string; files: string[] } {
    const skill = this.#find(name)
    const parsed = this.#read(skill.directory, name)
    if (typeof parsed === 'string') throw new Error(parsed)
    return {
      skill,
      body: parsed.body,
      files: filesIn(realpathSync(skill.directory)),
    }
  }

  /** The text of a file in the skill, by its path from the skill's folder. */
  readFile(name: string, file: string): string {
    const root = realpathSync(this.#find(name).directory)
    if (isAbsolute(file))
      throw new Error('give the file’s path from the skill’s folder')
    let real
    try {
      real = realpathSync(resolve(root, file))
    } catch {
      throw new Error(`the skill has no file "${file}"`)
    }
    // Links inside a skill may not lead out of it.
    if (real !== root && !real.startsWith(root + sep)) {
      throw new Error('that file is outside the skill')
    }
    const stat = statSync(real)
    if (!stat.isFile()) throw new Error(`"${file}" is not a file`)
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `"${file}" is too large (${Math.round(stat.size / 1000)} kB; at most ${MAX_FILE_BYTES / 1000} kB)`,
      )
    }
    const bytes = readFileSync(real)
    if (bytes.includes(0)) throw new Error(`"${file}" is not a text file`)
    return bytes.toString('utf8')
  }

  #find(name: string): Skill {
    const { skills } = this.list()
    const skill = skills.find((s) => s.name === name)
    if (!skill) {
      throw new Error(
        `there is no skill named "${name}"` +
          (skills.length
            ? `; the skills are ${skills.map((s) => s.name).join(', ')}`
            : ''),
      )
    }
    return skill
  }

  /** The skill in `directory`, or why it isn't one. */
  #read(
    directory: string,
    folder: string,
  ): { skill: Skill; body: string } | string {
    const file = join(directory, 'SKILL.md')
    if (!existsSync(file)) return 'has no SKILL.md'
    if (statSync(file).size > MAX_FILE_BYTES) return 'SKILL.md is too large'
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
      text,
    )
    if (!match) return 'SKILL.md does not start with a --- header'
    let data: unknown
    try {
      data = YAML.parse(match[1]!)
    } catch (err) {
      return `the header is not valid YAML: ${errorMessage(err).split('\n')[0]}`
    }
    const parsed = header.safeParse(data)
    if (!parsed.success) {
      const [issue] = parsed.error.issues
      return `${issue!.path.join('.') || 'header'}: ${issue!.message}`
    }
    if (parsed.data.name !== folder) {
      return `the name "${parsed.data.name}" must match the folder name`
    }
    return {
      skill: { name: folder, description: parsed.data.description, directory },
      body: text.slice(match[0].length).trim(),
    }
  }
}

/** The files in a skill besides SKILL.md, by path, a few levels deep. */
function filesIn(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, prefix: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : 1),
    )) {
      if (found.length >= MAX_LISTED_FILES) return
      if (entry.name.startsWith('.')) continue
      const path = prefix + entry.name
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH)
          walk(join(dir, entry.name), `${path}/`, depth + 1)
      } else if (entry.isFile() && path !== 'SKILL.md') {
        found.push(path)
      }
    }
  }
  walk(root, '', 1)
  return found
}
