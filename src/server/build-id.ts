import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the built web app is (see `pnpm build`). */
export const WEB_ROOT = join(import.meta.dirname, '../../dist/web')

/**
 * Which build of the web app is served: the id the build wrote beside it, or
 * `null` (no build, as in development). A page opened before a rebuild can
 * compare it with its own, and say it is out of date.
 */
export function readBuildId(webRoot: string = WEB_ROOT): string | null {
  try {
    return readFileSync(join(webRoot, 'build-id.txt'), 'utf8').trim() || null
  } catch {
    return null
  }
}
