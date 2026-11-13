// The fixture server, but only the first time it is started: later starts exit
// at once, as a server that comes back broken does. The marker file (first
// argument) is what remembers.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { existsSync, writeFileSync } from 'node:fs'
import { fixtureServer } from './mcp-server.ts'

const marker = process.argv[2]!
if (existsSync(marker)) process.exit(1)
writeFileSync(marker, '')
await fixtureServer().connect(new StdioServerTransport())
