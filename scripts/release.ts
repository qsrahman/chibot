// Cuts a release: `pnpm release patch|minor|major|X.Y.Z [--e2e] [--no-commit]`.
// Bumps package.json, moves CHANGELOG.md's [Unreleased] entries under the new
// version, runs the checks (reverting both files if one fails) and commits
// `chore: release vX.Y.Z`. Needs a clean working tree, so the release commit
// holds only those two files.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const KINDS = ['patch', 'minor', 'major']

/** `kind` applied to `current`, or `kind` itself when it is a version. */
export function nextVersion(current: string, kind: string): string {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const [major, minor, patch] = current.split('.').map(Number) as [
    number,
    number,
    number,
  ]
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Expected ${KINDS.join(', ')} or X.Y.Z, got "${kind}"`)
}

/**
 * `changelog` with the [Unreleased] entries moved under a new version
 * heading (and an empty [Unreleased] left above).
 *
 * @throws Error if [Unreleased] is missing or holds no entries
 */
export function releaseChangelog(
  changelog: string,
  version: string,
  date: string,
): string {
  const heading = '## [Unreleased]'
  const start = changelog.indexOf(heading)
  if (start === -1) throw new Error('CHANGELOG.md has no [Unreleased] section')
  const bodyStart = start + heading.length
  const next = changelog.indexOf('\n## [', bodyStart)
  const end = next === -1 ? changelog.length : next + 1
  const body = changelog.slice(bodyStart, end).trim()
  if (!/^- /m.test(body)) throw new Error('Nothing under [Unreleased]')
  return (
    `${changelog.slice(0, start)}${heading}\n\n## [${version}] - ${date}\n\n` +
    `${body}\n\n${changelog.slice(end)}`
  )
}

function main(args: string[]) {
  const flags = args.filter((arg) => arg.startsWith('--'))
  const [kind] = args.filter((arg) => !arg.startsWith('--'))
  if (!kind) throw new Error(`Usage: pnpm release ${KINDS.join('|')}|X.Y.Z`)
  const run = (command: string, ...rest: string[]) =>
    execFileSync(command, rest, { encoding: 'utf8', stdio: 'inherit' })

  const dirty = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  })
  if (dirty.trim()) {
    throw new Error(`Commit or stash your changes first:\n${dirty}`)
  }

  const manifest = readFileSync('package.json', 'utf8')
  const current = /"version": "([^"]+)"/.exec(manifest)![1]!
  const version = nextVersion(current, kind)
  const date = new Date().toLocaleDateString('sv')
  const changelog = releaseChangelog(
    readFileSync('CHANGELOG.md', 'utf8'),
    version,
    date,
  )
  writeFileSync(
    'package.json',
    manifest.replace(`"version": "${current}"`, `"version": "${version}"`),
  )
  writeFileSync('CHANGELOG.md', changelog)

  try {
    run('pnpm', 'typecheck')
    run('pnpm', 'test')
    run('pnpm', 'format:check')
    if (flags.includes('--e2e')) run('pnpm', 'test:e2e')
  } catch (err) {
    run('git', 'checkout', 'package.json', 'CHANGELOG.md')
    throw err
  }
  if (flags.includes('--no-commit')) {
    console.log(`Prepared v${version} (not committed).`)
    return
  }
  run('git', 'add', 'package.json', 'CHANGELOG.md')
  run('git', 'commit', '-m', `chore: release v${version}`)
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error((err as Error).message)
    process.exitCode = 1
  }
}
