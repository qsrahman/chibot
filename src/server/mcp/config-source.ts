import { errorMessage } from '../../shared/errors.ts'
import type { Config } from '../config.ts'
import { localOrigin } from '../local-origin.ts'
import {
  mcpVariables,
  readConfigFile,
  writeConfigFile,
} from '../config-file.ts'
import { parseMcpConfig, type McpServerConfig } from './mcp-config.ts'
import { OAUTH_CALLBACK } from './routes.ts'
import { McpServerFile } from './server-file.ts'

// Where chibot's MCP servers are kept and how they are loaded; `main.ts` wires
// the result into `McpServers`.

/**
 * The MCP servers to use: `mcpServers` in `config.json`. `${VAR}` is filled
 * from the environment, then `config.json`'s `env`. Throws, saying what is
 * wrong, so Reload can show it.
 */
export function loadMcpServers(
  config: Config,
): Record<string, McpServerConfig> {
  const { file } = readConfigFile(config.configDir)
  return parseMcpConfig(
    { mcpServers: file.mcpServers ?? {} },
    mcpVariables(config.configDir),
    'config.json',
  )
}

/**
 * Where Settings keeps MCP servers: `config.json`. Only where chibot is not
 * open to the network without a token, since a `local` server is a command
 * chibot runs.
 */
export function mcpServerFile(config: Config): McpServerFile {
  return new McpServerFile({
    source: 'config.json',
    locked:
      config.isLoopback || config.token
        ? null
        : 'chibot is open to your network without a token, so anyone who can reach it could add a server that runs commands. Set CHIBOT_TOKEN, or edit the servers in the config file.',
    read: () => readConfigFile(config.configDir).file.mcpServers ?? {},
    write: (servers) => {
      const { file } = readConfigFile(config.configDir)
      writeConfigFile(config.configDir, { ...file, mcpServers: servers })
    },
    check: (servers) =>
      void parseMcpConfig(
        { mcpServers: servers },
        mcpVariables(config.configDir),
        'config.json',
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
export function oauthRedirectUrl(config: Config): string {
  return localOrigin(config) + OAUTH_CALLBACK
}
