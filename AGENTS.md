# chibot — Developer Guide

Guide for humans and coding agents working on this repo. Product scope and the
phase roadmap live in [PLAN.md](PLAN.md). Usage lives in [README.md](README.md).

## Stack

- **Node ≥ 26** runs the server's TypeScript directly, with no build step.
- **pnpm** (version pinned in `package.json` → `devEngines`).
- **Server:** Hono + `@hono/node-server`, `openai` SDK, `node:sqlite`.
- **Web:** React 19 + Vite (`src/web`), built to `dist/web`.
- **Tests:** vitest. **Format:** prettier (no semicolons, single quotes,
  trailing commas).

## Layout

```
src/server/   main.ts (wiring + listen), app.ts (Hono routes), one class per file
src/web/      Vite root: index.html, main.tsx, components
tests/        mirrors src/ (tests/server/*.test.ts, …)
data/         local SQLite database (git-ignored)
```

## Commands

```bash
pnpm dev          # API server (watch) + Vite dev server, in parallel
pnpm test         # vitest run
pnpm typecheck    # server/tests and web tsconfigs
pnpm format       # prettier --write
pnpm build        # build the web app into dist/web
pnpm start        # production: serves the API and dist/web
```

## TypeScript constraints

The server runs through Node's type stripping, so `tsconfig.json` sets
`erasableSyntaxOnly`. That means:

- No `enum`. Use string-literal unions or `as const` objects.
- No constructor parameter properties. Declare fields explicitly:

  ```ts
  class ChatService {
    readonly #client: OpenAI
    constructor(client: OpenAI) {
      this.#client = client
    }
  }
  ```
- No `namespace`. Use type-only imports (`import type`) for types
  (`verbatimModuleSyntax`).
- Relative imports include the `.ts` extension.

The web code has its own `src/web/tsconfig.json` (DOM lib, JSX). Vite
transpiles it.

## Design conventions

- **OOP, not over-modular.** Use one class per real responsibility (`Config`,
  `ConversationStore`, `ChatService`, `ToolRegistry`, `Tool`). Don't add
  interfaces or base classes until a second implementation actually exists.
  `Tool` is the planned exception, because many tools are expected.
- **Constructor injection.** Classes receive their collaborators (OpenAI
  client, store, config). Only `main.ts` constructs real ones. Tests pass
  fakes.
- **Private state** uses `#fields`.
- **Use the SDK's types.** Persisted items are `ResponseInputItem`. Streamed
  events are `ResponseStreamEvent`. The web imports them with
  `import type … from 'openai/resources/responses/responses'`. Never write
  mirror types.
- **Don't hand-roll** what Node, the `openai` SDK or an existing dependency
  already does: `process.loadEnvFile`, `crypto.randomUUID`, `node:sqlite`,
  `OpenAI.APIError`, `AbortSignal`, Hono's `streamSSE` and `serveStatic`, etc.
  Check those first, then consider adding a small, well-known dependency, and
  only then write a utility.
- **Stateless chat.** Always `store: false` +
  `include: ['reasoning.encrypted_content']`. The SQLite history is the source
  of truth. History is a tree (`parent_id`). A turn's input is the root→leaf
  path (see PLAN.md §3).
- **Models come from config**, never string literals in logic.
- **Provider-agnostic.** chibot talks to OpenAI or any OpenAI-compatible
  Responses API server. Build clients from `Config` endpoints
  (`config.chat`, …), never `new OpenAI()` with implicit env. Don't assume
  OpenAI-only extras (Files API, `models.list()`, reasoning items, usage
  details) exist: degrade gracefully when they're missing.
- **Tools are our own function tools** (`Tool` subclasses). Don't put
  OpenAI-hosted tools (`web_search`, `file_search`, `image_generation`,
  `code_interpreter`, remote MCP) in a request's `tools`.
- **Styling** is plain CSS with CSS variables for colours and spacing. Build
  menus and dialogs on native `<dialog>` and the Popover API, not a UI library.

## Comments

Comment only where the *why* isn't obvious: constraints, workarounds,
invariants, API quirks. No line-by-line narration.

## Testing

- Every phase adds tests for what it adds. Run `pnpm test` before committing.
- Routes: test through `createApp(deps).request(...)`.
- OpenAI: pass a fake client whose `responses.create` returns an async
  generator of `ResponseStreamEvent`s. Tests never hit the network.
- SQLite: use `':memory:'` databases.
- Web: no component unit tests. From Phase 3, a Playwright smoke test drives
  the real app with the real SDK pointed at a local fake server through
  `OPENAI_BASE_URL`.

## Workflow

1. Work in small, self-contained changes. **Commit after every change**, using
   [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
   `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
2. Before each commit: `pnpm typecheck && pnpm test && pnpm format:check`.
3. After any change that affects features, architecture or conventions, update
   **PLAN.md**, **README.md** and this guide as needed, and add an entry under
   `[Unreleased]` in **CHANGELOG.md**
   ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
4. Each completed phase bumps the minor version
   ([SemVer](https://semver.org/)) and moves its CHANGELOG entries under that
   version.
