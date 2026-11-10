import { existsSync } from 'node:fs'
import type { Config, readEnvFiles } from './config.ts'
import type { readConfigFile } from './config-file.ts'

/**
 * Says on the console what is out of date or too open in how chibot is set up:
 * settings read from places they no longer belong in, a config file others can
 * read. Nothing here stops chibot starting.
 */
export function reportConfig(
  read: ReturnType<typeof readConfigFile>,
  legacy: ReturnType<typeof readEnvFiles>,
  config: Config,
): void {
  if (read.exists) console.log(`Settings: ${read.path}`)
  for (const name of read.obsolete) {
    console.warn(
      `Note: ${name} in ${read.path} is no longer used (web search and reading pages come from MCP servers) and is left out the next time chibot saves it.`,
    )
  }
  if (read.tooOpen) {
    console.warn(
      `Warning: ${read.path} holds keys and others can read it. Run: chmod 600 "${read.path}"`,
    )
  }
  for (const path of legacy.files) {
    console.warn(
      `Note: reading ${path}, which is no longer the place for settings. Run \`chibot init\` to move them into ${read.path}, then delete it.`,
    )
  }
  config.legacyNotes.forEach((note) => console.warn(`Note: ${note}`))
  if (
    !config.mcpConfigExplicit &&
    !read.file.mcpServers &&
    existsSync(config.mcpConfigPath)
  ) {
    console.warn(
      `Note: reading MCP servers from ${config.mcpConfigPath}; they can live in ${read.path} under "mcpServers". Run \`chibot init\` to move them.`,
    )
  }
}
