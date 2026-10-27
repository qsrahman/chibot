import { describe, expect, it } from 'vitest'
import { nextVersion, releaseChangelog } from '../scripts/release.ts'

describe('nextVersion', () => {
  it('bumps patch, minor and major, or takes a version', () => {
    expect(nextVersion('0.11.5', 'patch')).toBe('0.11.6')
    expect(nextVersion('0.11.5', 'minor')).toBe('0.12.0')
    expect(nextVersion('0.11.5', 'major')).toBe('1.0.0')
    expect(nextVersion('0.11.5', '2.0.1')).toBe('2.0.1')
    expect(() => nextVersion('0.11.5', 'big')).toThrow(/patch, minor, major/)
  })
})

describe('releaseChangelog', () => {
  const changelog = `# Changelog

Intro.

## [Unreleased]

### Added

- A thing.

### Fixed

- A bug.

## [0.1.0] - 2026-01-01

### Added

- Old.
`

  it('moves the unreleased entries under the new version', () => {
    expect(releaseChangelog(changelog, '0.1.1', '2026-02-02')).toBe(`# Changelog

Intro.

## [Unreleased]

## [0.1.1] - 2026-02-02

### Added

- A thing.

### Fixed

- A bug.

## [0.1.0] - 2026-01-01

### Added

- Old.
`)
  })

  it('works when [Unreleased] is the last section', () => {
    const only = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A bug.\n'
    expect(releaseChangelog(only, '1.0.0', '2026-02-02')).toBe(
      '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-02-02\n\n### Fixed\n\n- A bug.\n\n',
    )
  })

  it('refuses an empty or missing [Unreleased]', () => {
    expect(() =>
      releaseChangelog(
        '## [Unreleased]\n\n## [0.1.0] - x\n\n- Old.\n',
        '1',
        'd',
      ),
    ).toThrow('Nothing under [Unreleased]')
    expect(() => releaseChangelog('# Changelog\n', '1', 'd')).toThrow(
      'no [Unreleased]',
    )
  })
})
