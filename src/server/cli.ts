#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CONFIG_FILE,
  readConfigFile,
  readMcpServers,
  redacted,
  withSetting,
  writeConfigFile,
} from './config-file.ts'
import { backup, restore } from './backup.ts'
import { readEnvFiles } from './config.ts'
import { offerMcpImport, runInit, terminalPrompts } from './init.ts'
import { locations, ROOT } from './locations.ts'
import { start } from './main.ts'
import { errorMessage } from '../shared/errors.ts'

const HELP = `chibot: a local chat app for the OpenAI Responses API and compatible servers

Usage:
  chibot [--port <n>] [--host <address>]   start it (default; a host beyond this machine
                                           needs a token, or --allow-open)
  chibot init                              set up the models and keys
  chibot config path                       where its settings and data live
  chibot config show                       the settings (keys shown as "set")
  chibot config set <setting> <value>      change one (an empty value removes it)
  chibot backup [folder]                   copy all chats, files and memories into a folder
  chibot restore <folder> [--replace]      put a backup back (chibot stopped; --replace sets the
                                           current chats aside first)
  chibot --version | --help

Settings: chat.baseURL, chat.apiKey, chat.model, image.*, embedding.*,
transcription.* (each baseURL, apiKey, model), server.host,
server.port, token, mcpServers (MCP servers: edit config.json or use Settings → Tools), and env.<NAME>:\na variable for \${NAME} in them.
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
      'allow-open': { type: 'boolean' },
      replace: { type: 'boolean' },
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
          ...(values['allow-open'] && { CHIBOT_ALLOW_OPEN: '1' }),
        },
      })
      return
    case 'init': {
      const { file, path } = readConfigFile(where.configDir)
      const legacy = readEnvFiles()
      const prompts = terminalPrompts()
      try {
        let next = await runInit(prompts, {
          existing: file,
          legacyEnv: legacy.values,
          legacyPath: legacy.files[0] ?? null,
        })
        // A named file (CHIBOT_MCP_CONFIG) is the user's choice: leave it.
        if (!where.mcpConfigExplicit) {
          next = await offerMcpImport(
            prompts,
            next,
            where.mcpConfigPath,
            readMcpServers(where.mcpConfigPath),
          )
        }
        writeConfigFile(where.configDir, next)
        console.log(`Saved to ${path} (readable by you only).`)
        if (legacy.files[0]) {
          console.log(`You can delete ${legacy.files[0]} now.`)
        }
        console.log('Start chibot with: chibot')
      } finally {
        prompts.close()
      }
      return
    }
    case 'config': {
      const [action, setting, value] = rest
      if (action === 'path') {
        // Works even when the file is broken: that is when you need to find it.
        const path = join(where.configDir, CONFIG_FILE)
        let inFile = false
        try {
          inFile = Boolean(readConfigFile(where.configDir).file.mcpServers)
        } catch {
          // Reported by whatever reads it next.
        }
        console.log(`Settings:    ${path}`)
        console.log(`Data:        ${where.dataDir}`)
        console.log(
          `MCP servers: ${inFile && !where.mcpConfigExplicit ? `in ${path}` : where.mcpConfigPath}`,
        )
        return
      }
      const { file } = readConfigFile(where.configDir)
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
    case 'backup': {
      const { version } = JSON.parse(
        readFileSync(join(ROOT, 'package.json'), 'utf8'),
      ) as { version: string }
      const target = resolve(
        rest[0] ?? `chibot-backup-${new Date().toISOString().slice(0, 10)}`,
      )
      const { chats, files } = backup(where.dataDir, target, version)
      console.log(`Backed up ${chats} chats and ${files} files to ${target}.`)
      console.log(
        'Settings (config.json, with your keys) and MCP sign-ins are not included.',
      )
      return
    }
    case 'restore': {
      if (!rest[0]) {
        console.error('Usage: chibot restore <folder> [--replace]')
        return 1
      }
      const { chats, files, movedTo } = restore(
        where.dataDir,
        resolve(rest[0]),
        {
          replace: values.replace,
        },
      )
      console.log(
        `Restored ${chats} chats and ${files} files into ${where.dataDir}.`,
      )
      if (movedTo) console.log(`The chats that were there are in ${movedTo}.`)
      return
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
    console.error(errorMessage(err))
    process.exitCode = 1
  }
}
