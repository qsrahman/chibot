import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { basename } from 'node:path'
import { errorMessage } from '../../shared/errors.ts'
import type { Config } from '../config.ts'
import {
  mcpVariables,
  readConfigFile,
  readMcpServers,
  writeConfigFile,
} from '../config-file.ts'
import {
  loadMcpConfig,
  parseMcpConfig,
  type McpServerConfig,
} from './mcp-config.ts'
import { OAUTH_CALLBACK } from './routes.ts'
import { McpServerFile } from './server-file.ts'

// Where chibot's MCP servers are kept and how they are loaded; `main.ts` wires
// the result into `McpServers`.

/**
 * The MCP servers to use. `CHIBOT_MCP_CONFIG`, if given, names the file;
 * otherwise `mcpServers` in `config.json`, else the older standalone
 * `mcp.json`. `${VAR}` is filled from the environment, then `config.json`'s
 * `env`. Throws, saying what is wrong, so Reload can show it.
 */
export function loadMcpServers(
  config: Config,
): Record<string, McpServerConfig> {
  const { file } = readConfigFile(config.configDir)
  const variables = mcpVariables(config.configDir)
  if (file.mcpServers && !config.mcpConfigExplicit) {
    return parseMcpConfig(
      { mcpServers: file.mcpServers },
      variables,
      'config.json',
    )
  }
  return loadMcpConfig(config.mcpConfigPath, variables)
}

/**
 * Where Settings keeps MCP servers: the file `loadMcpServers` reads. Only
 * where chibot is not open to the network without a token, since a `local`
 * server is a command chibot runs.
 */
export function mcpServerFile(config: Config): McpServerFile {
  const inConfig =
    !config.mcpConfigExplicit &&
    (!!readConfigFile(config.configDir).file.mcpServers ||
      !existsSync(config.mcpConfigPath))
  const source = inConfig ? 'config.json' : basename(config.mcpConfigPath)
  return new McpServerFile({
    source,
    locked:
      config.isLoopback || config.token
        ? null
        : 'chibot is open to your network without a token, so anyone who can reach it could add a server that runs commands. Set CHIBOT_TOKEN, or edit the servers in the config file.',
    read: () =>
      (inConfig
        ? readConfigFile(config.configDir).file.mcpServers
        : readMcpServers(config.mcpConfigPath)) ?? {},
    write: (servers) => {
      if (inConfig) {
        const { file } = readConfigFile(config.configDir)
        writeConfigFile(config.configDir, { ...file, mcpServers: servers })
      } else {
        // Owner only, as config.json is: headers and env can hold keys.
        const json = JSON.parse(readFileSync(config.mcpConfigPath, 'utf8'))
        writeFileSync(
          config.mcpConfigPath,
          `${JSON.stringify({ ...json, mcpServers: servers }, null, 2)}\n`,
          { mode: 0o600 },
        )
      }
    },
    check: (servers) =>
      void parseMcpConfig(
        { mcpServers: servers },
        mcpVariables(config.configDir),
        source,
      ),
  })
}

/** The MCP servers at startup; none, with the error, if they are invalid. */
export function mcpServersAtStartup(
  config: Config,
): Record<string, McpServerConfig> {
  try {
    return loadMcpServers(config)
  } catch (err) {
    console.error(`MCP servers are off: ${errorMessage(err)}`)
    return {}
  }
}

/**
 * Where OAuth providers send the browser back after an MCP server's sign-in:
 * chibot's own address (loopback for all interfaces), so the sign-in is done
 * on the machine running it.
 */
export function oauthRedirectUrl({ host, port }: Config): string {
  const name = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host
  const origin = `http://${isIP(name) === 6 ? `[${name}]` : name}:${port}`
  return origin + OAUTH_CALLBACK
}
