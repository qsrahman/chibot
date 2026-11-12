import type { readConfigFile } from './config-file.ts'

/**
 * Says on the console which settings file is used, and warns when it is too
 * open: a config file others can read. Nothing here stops chibot starting.
 */
export function reportConfig(read: ReturnType<typeof readConfigFile>): void {
  if (read.exists) console.log(`Settings: ${read.path}`)
  if (read.tooOpen) {
    console.warn(
      `Warning: ${read.path} holds keys and others can read it. Run: chmod 600 "${read.path}"`,
    )
  }
}
