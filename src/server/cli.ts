#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  readConfigFile,
  redacted,
  withSetting,
  writeConfigFile,
} from './config-file.ts'
import { loadEnvFiles } from './config.ts'
import { runInit, terminalPrompts } from './init.ts'
import { locations, ROOT } from './locations.ts'
import { start } from './main.ts'

const HELP = `chibot: a local chat app for the OpenAI Responses API and compatible servers

Usage:
  chibot [--port <n>] [--host <address>]   start it (default)
  chibot init                              set up the models and keys
  chibot config path                       where its settings and data live
  chibot config show                       the settings (keys shown as "set")
  chibot config set <setting> <value>      change one (an empty value removes it)
  chibot --version | --help

Settings: chat.baseURL, chat.apiKey, chat.model, image.*, embedding.*,
transcription.* (each baseURL, apiKey, model), braveApiKey, server.host,
server.port, token, and env.<NAME>: a variable for \${NAME} in mcp.json.
Environment variables such as OPENAI_API_KEY override the settings.`

/** Runs the command line; resolves to the exit code (not returned while the server runs). */
export async function run(args: string[]): Promise<number | void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
    },
  })
  const [command = 'start', ...rest] = positionals

  if (values.help || command === 'help') return void console.log(HELP)
  if (values.version) {
    const { version } = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    ) as { version: string }
    return void console.log(version)
  }

  const where = locations(process.env)
  switch (command) {
    case 'start':
      start({
        env: {
          ...(values.port && { PORT: values.port }),
          ...(values.host && { HOST: values.host }),
        },
      })
      return
    case 'init': {
      const { file, path } = readConfigFile(where.configDir)
      const legacy = loadEnvFiles()[0] ?? null
      const prompts = terminalPrompts()
      try {
        const next = await runInit(prompts, {
          existing: file,
          legacyEnv: process.env,
          legacyPath: legacy,
        })
        writeConfigFile(where.configDir, next)
        console.log(`Saved to ${path} (readable by you only).`)
        if (legacy) console.log(`You can delete ${legacy} now.`)
        console.log('Start chibot with: chibot')
      } finally {
        prompts.close()
      }
      return
    }
    case 'config': {
      const [action, setting, value] = rest
      const { file, path } = readConfigFile(where.configDir)
      if (action === 'path') {
        console.log(`Settings:    ${path}`)
        console.log(`Data:        ${where.dataDir}`)
        console.log(`MCP servers: ${where.mcpConfigPath}`)
        return
      }
      if (action === 'show') {
        return void console.log(JSON.stringify(redacted(file), null, 2))
      }
      if (action === 'set' && setting && value !== undefined) {
        writeConfigFile(where.configDir, withSetting(file, setting, value))
        return void console.log(`Saved ${setting}.`)
      }
      console.error('Usage: chibot config path | show | set <setting> <value>')
      return 1
    }
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`)
      return 1
  }
}

if (import.meta.main) {
  try {
    process.exitCode = (await run(process.argv.slice(2))) ?? 0
  } catch (err) {
    console.error((err as Error).message)
    process.exitCode = 1
  }
}
