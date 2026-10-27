import type { McpServerStatus } from '../shared/types.ts'

const STATE_TEXT: Record<McpServerStatus['state'], string> = {
  disabled: 'Off',
  connecting: 'Connecting…',
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in',
  failed: 'Failed',
}

/** What Settings → Tools says about an MCP server's kind and state. */
export function describeMcpServer(server: McpServerStatus) {
  const { state, tools, error } = server
  const status =
    state === 'connected'
      ? `Connected · ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
      : state === 'failed' && error
        ? `Failed: ${error}`
        : STATE_TEXT[state]
  return {
    kind: server.type === 'local' ? 'Local server' : 'Remote server',
    status,
  }
}

/** Whether a server is still connecting, so the list should be checked again. */
export const isConnecting = (servers: McpServerStatus[] | undefined) =>
  servers?.some((server) => server.state === 'connecting') ?? false

/** `list` with `name` in it (`member`) or not, for the settings that list names. */
export const withMember = (
  list: readonly string[],
  name: string,
  member: boolean,
): string[] => {
  const rest = list.filter((entry) => entry !== name)
  return member ? [...rest, name] : rest
}
