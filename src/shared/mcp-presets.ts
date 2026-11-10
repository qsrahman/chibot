// Starting points for adding an MCP server in Settings. Plain data, apart from
// mcp.ts (which imports zod) so the page can load them without all of zod: the
// web takes mcp.ts as types only.
import type { McpServerConfig } from './mcp.ts'

/** A server Settings offers to add: the user fills in what's blank. */
export interface McpPreset {
  id: string
  label: string
  description: string
  /** Suggested name. */
  name: string
  server: McpServerConfig
  /** What the user must supply (a folder, a key), shown under the form. */
  note?: string
}

/** Starting points for common servers (the user can change every field). */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'fetch',
    label: 'Web pages (fetch)',
    description: 'Reads a web page for the model. Needs uv (uvx).',
    name: 'fetch',
    server: { type: 'local', command: 'uvx', args: ['mcp-server-fetch'] },
  },
  {
    id: 'brave-search',
    label: 'Web search (Brave)',
    description: 'Searches the web with Brave Search. Needs Node (npx).',
    name: 'search',
    server: {
      type: 'local',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: { BRAVE_API_KEY: '' },
    },
    note: 'Paste your Brave Search API key as the BRAVE_API_KEY value.',
  },
  {
    id: 'filesystem',
    label: 'Files in a folder',
    description: 'Lets the model read and write files in one folder.',
    name: 'files',
    server: {
      type: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', ''],
    },
    note: 'Replace the last argument with the folder to share, as a full path. Switch on “Ask before using its tools” so writes wait for your approval.',
  },
]
