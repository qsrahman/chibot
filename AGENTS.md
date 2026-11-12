# chibot — Developer Guide

Guide for humans and coding agents working on this repo. Product scope and the
phase roadmap live in [PLAN.md](PLAN.md). Usage lives in [README.md](README.md).
How a message becomes an answer lives in [TURN.md](TURN.md); adding a tool in
[TOOLS.md](TOOLS.md); how to test in [TESTING.md](TESTING.md).

## Stack

- **Node ≥ 26** runs the server's TypeScript directly, with no build step
  (which also means it can't be installed from a registry: Node won't strip
  types under `node_modules`; `pnpm add -g .` links it to the checkout, which runs it from there).
- **pnpm** (version pinned in `package.json` → `devEngines`).
- **Server:** Hono + `@hono/node-server`, `openai` SDK, `node:sqlite`.
- **Web:** React 19 + Vite (`src/web`), built to `dist/web`.
- **Tests:** vitest. **Format:** prettier (no semicolons, single quotes,
  trailing commas).

## Layout

```
src/server/   cli.ts (the `chibot` command: start, init, config, backup, restore;
              backup.ts does the copying), main.ts
              (start(): wiring + listen, defaultTools()), config.ts (env →
              typed settings), config-file.ts (config.json), locations.ts
              (where files live), init.ts (the setup prompts), app.ts (Hono
              app: access checks, health, mounts routes/*.ts, one file per
              area, each `xRoutes({ …what it uses })` returning a Hono app),
              database.ts (one SQLite connection + the ordered migrations),
              one class per file; tools/ holds the shipped Tool subclasses
src/server/<feature>/
              feature folders, each with an index.ts (what the rest of the
              server may import; see Design conventions): conversations/
              (history trees, search, export), chat/ (the turn loop, model
              requests, titles, long-chat summaries (context.ts: the budget, pruning
              and cut maths; context-fit.ts: what a request carries, pruned or
              summarized to fit; compactor.ts: the summarizer), prompts.ts: what
              chibot tells the model, and
              the /api/conversations routes), projects/ (store, search index,
              chunking, instruction writer, routes, tools, schema) and mcp/
              (config, connections, OAuth, routes, the tool) and skills/
              (the skills folder, the read_skill tool, its route)
src/shared/   used by both server and web: API record types, chibot's own SSE
              events, message text extraction, zod schemas (requests,
              settings, export, MCP server shape and presets) and reasoning efforts (zod-free, so the web
              can import it)
src/web/      Vite root: index.html, main.tsx, App.tsx and the shell
              (Sidebar, ShortcutsDialog), http.ts (fetch helpers, uploads),
              and feature folders, each with its components, hooks and its
              own api.ts: chat/ (ChatPage, Composer, TurnView, useChat, turns),
              conversations/ (the chat list, search, archive), projects/,
              settings/ (one component per Settings tab) and ui/ (dialogs,
              popovers, shared hooks). styles.css imports styles/*.css, one
              file per area (order matters)
tests/        mirrors src/ (tests/server/*.test.ts, tests/web/*.test.ts);
              tests/fixtures/ holds small documents (PDF, .docx) and MCP
              servers: mcp-server.ts (stdio) and mcp-oauth-server.ts (HTTP
              behind a fake OAuth provider)
              tests/server/fakes.ts: fake OpenAI client + stream events
tests/e2e/    Playwright specs (*.spec.ts), fake-openai.ts, and server.ts
              (starts chibot with a test-only tool that needs approval and the
              MCP fixtures as `fixture` and `tracker`)
scripts/      release.ts (`pnpm release`)
(data)        chibot keeps the SQLite database (with sqlite-vec loaded),
              files/ and mcp-auth.json (MCP servers' OAuth tokens, mode 0600)
              in the platform's data folder (`chibot config path`), not here
```

## Commands

```bash
pnpm dev          # API server (watch, port 3000) + Vite dev server (5173), in parallel
pnpm test         # vitest run
pnpm test:e2e     # Playwright: builds, starts a fake OpenAI server + chibot
pnpm typecheck    # server/tests, web and e2e tsconfigs
pnpm deps         # import rules (dependency-cruiser; also part of pnpm test)
pnpm format       # prettier --write
pnpm build        # build the web app into dist/web
pnpm start        # production: serves the API and dist/web (= `chibot`)
pnpm add -g .     # puts `chibot` on your PATH, linked to the checkout (run `pnpm build` first)
pnpm seed:perf    # fill a scratch data folder with many chats (see TESTING.md)
pnpm measure:chat # time opening a long chat, scrolling, typing (see TESTING.md)
pnpm release      # patch|minor|major|X.Y.Z: bump, CHANGELOG, checks, commit, tag
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
- **Features own their files.** Code that belongs to one feature (a store, its
  routes and tools, its schema) lives in `src/server/<feature>/`, with an
  `index.ts` listing what the rest of the server may use; import from the
  index, not from files inside, so the feature can change inside. They depend
  upwards only: `conversations/` (data) ← `mcp/`, `projects/` and `skills/` ← `chat/`,
  and `pnpm deps` fails otherwise. Routes name the collaborators they use (`xRoutes({ store, files })`)
  and never import `app.ts`. The one exception: `database.ts` imports
  `projects/schema.ts` (SQL only) because migrations run in one fixed order.
  Tests mirror the folders (`tests/server/projects/`).
- **Web features** depend downwards only: `ui/` knows no feature;
  `conversations/` uses `ui/`; `settings/` and `projects/` use those (and
  not each other or `chat/`); `chat/` may use all of them; the shell (`App`,
  `Sidebar`, …) uses any, and no feature imports it. The server and the web app
  never import each other (only `src/shared`), and there are no import
  cycles. `pnpm deps` checks all of this (rules in `.dependency-cruiser.cjs`,
  also run by `pnpm test`); change the rules there when the design changes,
  not by working around them.
- **Private state** uses `#fields`.
- **Validation** uses zod schemas in `src/shared` (`requests.ts`, `settings.ts`),
  applied to routes with `json(schema)` (`@hono/zod-validator`). Shared types
  are inferred from them; the web imports them as types only, which keeps zod
  out of the browser bundle (`tests/web/bundle.test.ts` builds the page and fails if it is back, so what the web needs at run time, such as the MCP presets, lives in files that don't import zod).
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
- **Prompts** (`chat/prompts.ts`, tool descriptions and `instructions()`) follow
  OpenAI's and Anthropic's guidance: say what to do rather than what to avoid,
  and why (models generalize from the reason); no all-caps emphasis, which
  makes models over-trigger; no contradicting rules (say what overrides what);
  put user-written or retrieved text in named tags (`<user_profile>`,
  `<memories>`) so it reads as data; and keep the static text first and the
  changing text (memories, time) last, so OpenAI's prompt cache can reuse the
  longest prefix.
- **Models come from config**, never string literals in logic (the chat model and
  the image, embedding and transcription models start from `Config`; the user
  changes them in Settings, so code reads the setting when it runs, through a
  `() => string`, and treats `''` as the feature being off).
- **Configuration layers** (PLAN.md §6): secrets and startup settings in
  `config.json` (`config-file.ts`, mode 0600) under the environment (via
  `Config`; flags beat the environment, which beats the file), MCP servers in
  that file's `mcpServers` (`loadMcpServers`, checked when loaded so a mistake
  never stops chibot starting; a server's own switches (`enabled`, `ask`,
  `disabledTools`) are in its entry, written by Settings; `${VAR}` from the environment, then its `env`) and their OAuth tokens in
  `mcp-auth.json` in the data folder (`McpAuthStore`); where
  these folders are comes from `locations()`, never from `ROOT` directly. User
  preferences in SQLite
  (`SettingsStore`, Phase 4), and browser preferences in `localStorage`. Never
  put secrets in SQLite, `localStorage` or API responses.
- **Provider-agnostic.** chibot talks to OpenAI or any OpenAI-compatible
  Responses API server. Build clients from `Config` endpoints
  (`config.chat`, …), never `new OpenAI()` with implicit env. Don't assume
  OpenAI-only extras (Files API, `models.list()`, reasoning items, usage
  details) exist: degrade gracefully when they're missing.
- **Browser support:** current versions of Chrome, Edge, Firefox and Safari.
  Baseline features (Popover API, `<dialog>`, anchor positioning for menus)
  are used without polyfills. Anything not yet Baseline gets a small fallback
  rather than a polyfill (e.g. scripted light-dismiss where `closedby` is
  missing).
- **Tools are our own function tools** (`Tool` subclasses). Don't put
  OpenAI-hosted tools (`web_search`, `file_search`, `image_generation`,
  `code_interpreter`, remote MCP) in a request's `tools`. MCP servers' tools
  come through chibot's own client (`McpServers`) as `McpTool`s
  (`mcp/mcp-tool.ts`), which `ToolRegistry` asks for on each turn.
- **Web data** comes through each feature's `api.ts`, built on `http.ts`
  (`request` / `send` / `remove`, which turn failures into `Error`s with the
  server's message). Lists and dialogs
  load it with `useLoad`, whose `act` runs an action and reloads, putting
  failures in `error`; don't hand-write that again.
- **Store rows** come back as the shared types directly: select with column
  aliases (`created_at AS createdAt`) and use `RETURNING` for inserts and
  updates, rather than row interfaces and mapping functions.
- **Styling** is plain CSS following [DESIGN.md](DESIGN.md), which sets out
  ChatGPT-like aesthetics, tokens and component specs. Use its CSS variables,
  never raw colours. Build menus and dialogs on native `<dialog>` and the
  Popover API, not a UI library: menus use `useAnchoredPopover` (`ui/popover.ts`)
  and spread its `menuProps` for keyboard use. Icons come from `lucide-react`.

## Adding a tool

Tools are `Tool` subclasses in `src/server/tools/` (or a feature folder), added
to `defaultTools()` in `main.ts`, with `Tool.info` saying how the interface
presents them. Read [TOOLS.md](TOOLS.md) before adding one: the steps, the
approval and untrusted-output flags, and the network rule.

## Comments

Comment only where the *why* isn't obvious: constraints, workarounds,
invariants, API quirks. No line-by-line narration.

## Testing

- Every change adds tests for what it adds; run `pnpm test` before committing.
- vitest for the server and pure web helpers (`tests/server`, `tests/web`,
  fakes in `tests/server/fakes.ts`, `:memory:` SQLite); Playwright for UI
  behaviour (`tests/e2e`, against a production build and a fake OpenAI server).
  Tests never hit the network.
- [TESTING.md](TESTING.md) has the details: routes, the fake OpenAI client and
  the fake server's magic words, retrieval and prompt-injection evaluations,
  and the e2e conventions. Read it before writing or changing tests.

## Workflow

1. Work in small, self-contained changes. **Commit after every change**, using
   [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
   `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Within a phase, commit
   each step (e.g. store → service → route → UI) with its own tests and docs.
2. Before each commit: `pnpm typecheck && pnpm test && pnpm format:check`,
   plus `pnpm test:e2e` when the web app changes.
3. After any change that affects features, architecture or conventions, update
   **PLAN.md**, **README.md** and this guide as needed, and add an entry under
   `[Unreleased]` in **CHANGELOG.md**
   ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
4. Each completed phase ends with a release commit (`chore: release vX.Y.0`).
   It bumps the minor version in `package.json` ([SemVer](https://semver.org/))
   and moves the phase's CHANGELOG entries under that version.
   Fixes released between phases bump the patch version instead
   (`chore: release vX.Y.Z`). `pnpm release patch|minor|X.Y.Z` does the
   bump, moves the CHANGELOG entries, runs the checks (`--e2e` adds the
   Playwright specs), makes the commit and tags it `vX.Y.Z`; it needs a clean
   working tree (`--no-commit` leaves the commit to you). Push with
   `git push --follow-tags`. GitHub runs the fast checks on each push (CI).
5. **Stop after each phase.** Report what works and how it was verified, then
   wait for the owner's go-ahead before starting the next phase.
