import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// The import rules in .dependency-cruiser.cjs (server, web and shared stay
// apart; features import each other only downwards; projects through its
// index; no cycles). A failure names the file and the rule.
it('keeps to the import rules', () => {
  const root = join(import.meta.dirname, '..')
  let output = ''
  try {
    output = execFileSync(
      'pnpm',
      ['exec', 'depcruise', 'src', '--config', '.dependency-cruiser.cjs'],
      { cwd: root, encoding: 'utf8' },
    )
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: string; stderr?: string }
    expect.fail(`${stdout ?? ''}${stderr ?? ''}`)
  }
  expect(output).toContain('no dependency violations found')
}, 60_000)
