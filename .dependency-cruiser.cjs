// Who may import whom, checked by `pnpm deps` and by `pnpm test`
// (tests/architecture.test.ts). The layers are described in AGENTS.md.
// Server features: a folder with an index.ts. From the bottom up: conversations
// (data), then mcp, projects and skills, then chat, which uses the others.
const SERVER_FEATURES = ['conversations', 'mcp', 'projects', 'skills', 'chat']
const WEB_FEATURES = 'chat|conversations|projects|settings'
const WEB_SHELL = 'App|Sidebar|ShortcutsDialog|main'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...SERVER_FEATURES.filter((f) => f !== 'projects').map((feature) => ({
      name: `${feature}-through-its-index`,
      comment: `Outside src/server/${feature}/, import from its index.ts only.`,
      severity: 'error',
      from: { pathNot: `^src/server/${feature}/` },
      to: {
        path: `^src/server/${feature}/`,
        pathNot: `^src/server/${feature}/index\\.ts$`,
      },
    })),
    {
      name: 'no-circular',
      comment:
        'A cycle makes its files impossible to understand one at a time.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },

    // The three source trees
    {
      name: 'server-not-web',
      comment: 'The server and the web app share only src/shared.',
      severity: 'error',
      from: { path: '^src/server/' },
      to: { path: '^src/web/' },
    },
    {
      name: 'web-not-server',
      severity: 'error',
      from: { path: '^src/web/' },
      to: { path: '^src/server/' },
    },
    {
      name: 'shared-stands-alone',
      comment: 'src/shared is imported by both sides, so it imports neither.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(server|web)/' },
    },

    // Server
    {
      name: 'routes-not-app',
      comment:
        'A route file names the collaborators it uses; it does not take the app’s whole bag (app.ts composes the routes).',
      severity: 'error',
      from: { path: '^src/server/(routes/|[a-z]+/routes\\.ts$)' },
      to: { path: '^src/server/app\\.ts$' },
    },
    {
      name: 'server-wiring-only-in-main-and-app',
      comment:
        'Only main.ts and app.ts put routes together (route files share routes/helpers.ts).',
      severity: 'error',
      from: {
        pathNot:
          '^src/server/(main|app)\\.ts$|^src/server/(routes/|[a-z]+/routes\\.ts$)',
      },
      to: { path: '^src/server/routes/' },
    },
    {
      name: 'stores-below-the-chat',
      comment:
        'Stores, search and the database serve the chat; they do not call up into it, the routes or the tools.',
      severity: 'error',
      from: {
        path: '^src/server/(database|conversations/|[a-z]+-(store|search)\\.ts$)',
      },
      to: {
        path: '^src/server/(chat/|app|main|tool-registry|routes/|tools/)',
      },
    },
    {
      name: 'tools-not-above-them',
      comment: 'A tool does not reach up into the chat, the routes or the app.',
      severity: 'error',
      from: { path: '^src/server/tools/' },
      to: { path: '^src/server/(chat/|app|main|routes/)' },
    },
    {
      name: 'projects-through-its-index',
      comment:
        'Outside src/server/projects/, import from its index.ts only (database.ts also takes schema.ts, see below).',
      severity: 'error',
      from: { pathNot: '^src/server/(projects/|database\\.ts$)' },
      to: {
        path: '^src/server/projects/',
        pathNot: '^src/server/projects/index\\.ts$',
      },
    },
    {
      name: 'conversations-stand-alone',
      comment:
        'Conversations are data (store, search, export): they know nothing of the chat, MCP or projects.',
      severity: 'error',
      from: { path: '^src/server/conversations/' },
      to: { path: '^src/server/(chat|mcp|projects)/' },
    },
    {
      name: 'mcp-stands-alone',
      comment: 'MCP knows nothing of the chat, conversations or projects.',
      severity: 'error',
      from: { path: '^src/server/mcp/' },
      to: { path: '^src/server/(chat|conversations|projects)/' },
    },
    {
      name: 'projects-below-the-chat',
      comment: 'Projects may use conversations, not the chat or MCP.',
      severity: 'error',
      from: { path: '^src/server/projects/' },
      to: { path: '^src/server/(chat|mcp)/' },
    },
    {
      name: 'skills-stand-alone',
      comment:
        'Skills are files the user adds: they know nothing of the chat, conversations, MCP or projects.',
      severity: 'error',
      from: { path: '^src/server/skills/' },
      to: { path: '^src/server/(chat|conversations|mcp|projects)/' },
    },
    {
      name: 'database-takes-only-the-projects-schema',
      comment:
        'Migrations run in one fixed order, so database.ts takes the SQL (and only the SQL) from the projects folder.',
      severity: 'error',
      from: { path: '^src/server/database\\.ts$' },
      to: {
        path: '^src/server/projects/',
        pathNot: '^src/server/projects/schema\\.ts$',
      },
    },

    // Web: ui at the bottom, then conversations, then settings and projects,
    // then chat; the shell (App, Sidebar, …) on top.
    {
      name: 'ui-knows-no-feature',
      severity: 'error',
      from: { path: '^src/web/ui/' },
      to: { path: '^src/web/', pathNot: '^src/web/ui/' },
    },
    {
      name: 'conversations-below-the-other-features',
      severity: 'error',
      from: { path: '^src/web/conversations/' },
      to: { path: '^src/web/(chat|projects|settings)/' },
    },
    {
      name: 'settings-and-projects-below-chat',
      comment: 'Settings and projects do not use each other or the chat.',
      severity: 'error',
      from: { path: '^src/web/(settings|projects)/' },
      to: { path: '^src/web/(chat)/' },
    },
    {
      name: 'projects-not-settings',
      severity: 'error',
      from: { path: '^src/web/projects/' },
      to: { path: '^src/web/settings/' },
    },
    {
      name: 'settings-not-projects',
      severity: 'error',
      from: { path: '^src/web/settings/' },
      to: { path: '^src/web/projects/' },
    },
    {
      name: 'features-not-the-shell',
      severity: 'error',
      from: { path: `^src/web/(${WEB_FEATURES}|ui)/` },
      to: { path: `^src/web/(${WEB_SHELL})\\.` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src',
    // Count `import type` too: the types are most of what the folders share.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.css$' },
  },
}
