# chibot — Developer Guide

Guide for humans and coding agents working on this repo. Product scope and the
phase roadmap live in [PLAN.md](PLAN.md). Usage lives in [README.md](README.md).
How a message becomes an answer lives in [TURN.md](TURN.md).

## Stack

- **Node ≥ 26** runs the server's TypeScript directly, with no build step.
- **pnpm** (version pinned in `package.json` → `devEngines`).
- **Server:** Hono + `@hono/node-server`, `openai` SDK, `node:sqlite`.
- **Web:** React 19 + Vite (`src/web`), built to `dist/web`.
- **Tests:** vitest. **Format:** prettier (no semicolons, single quotes,
  trailing commas).

## Layout

```
src/server/   main.ts (start(): wiring + listen, defaultTools()), app.ts (Hono
              app: access checks, health, mounts routes/*.ts, one file per
              area, each `xRoutes({ …what it uses })` returning a Hono app),
              database.ts (one SQLite connection + the ordered migrations),
              one class per file; tools/ holds the shipped Tool subclasses
src/server/<feature>/
              feature folders, each with an index.ts (what the rest of the
              server may import; see Design conventions): conversations/
              (history trees, search, export), chat/ (the turn loop, model
              requests, titles, prompts.ts: what chibot tells the model, and
              the /api/conversations routes), projects/ (store, search index,
              chunking, instruction writer, routes, tools, schema) and mcp/
              (config, connections, OAuth, routes, the tool)
src/shared/   used by both server and web: API record types, chibot's own SSE
              events, message text extraction, zod schemas (requests,
              settings, export) and reasoning efforts (zod-free, so the web
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
              (starts chibot with a fake web search, a page reader allowed on
              127.0.0.1, a test-only tool that needs approval, and the MCP
              fixtures as `fixture` and `tracker`)
scripts/      release.ts (`pnpm release`)
data/         local SQLite database (with sqlite-vec loaded), files/ and
              mcp-auth.json (MCP servers' OAuth tokens, mode 0600)
              (git-ignored)
```

## Commands

```bash
pnpm dev          # API server (watch) + Vite dev server, in parallel
pnpm test         # vitest run
pnpm test:e2e     # Playwright: builds, starts a fake OpenAI server + chibot
pnpm typecheck    # server/tests, web and e2e tsconfigs
pnpm deps         # import rules (dependency-cruiser; also part of pnpm test)
pnpm format       # prettier --write
pnpm build        # build the web app into dist/web
pnpm start        # production: serves the API and dist/web
pnpm release      # patch|minor|major|X.Y.Z: bump, CHANGELOG, checks, commit
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
  upwards only: `conversations/` (data) ← `mcp/` and `projects/` ← `chat/`,
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
  out of the browser bundle.
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
- **Configuration layers** (PLAN.md §6): secrets and startup settings in the
  environment / `.env` (via `Config`), MCP servers in `mcp.json`
  (`loadMcpConfig`, with `${VAR}` from the environment) and their OAuth
  tokens in `data/mcp-auth.json` (`McpAuthStore`), user preferences in SQLite
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

1. Subclass `Tool` in `src/server/tools/<name>.ts`: a `name`, a `label` for
   Settings, a `description` that tells the model when to use it, zod
   `parameters` (sent as a strict JSON Schema, so every field is required;
   use `.nullable()` for optional ones), and `run(args, context)` returning
   the text the model sees. `context` has the `conversationId` (e.g. to keep
   files with the chat in `FileStore`) and the stop `signal`. Return JSON when
   the web app reads the output too (as for sources and images).
2. Say how the interface should present it; the web app keeps no per-tool
   text, it reads `Tool.info` from `GET /api/tools`: a `group` (Settings
   section, see `TOOL_GROUPS` in `src/shared/tools.ts`), a `summary` (what it
   does and what leaves the machine, in the user's words), `running` and
   `done` (what an answer says: "Searching the web…" / "Searched the web"),
   and, to offer it in the composer's "+" menu, a `chip`. A shipped tool that
   leaves these out fails `tests/server/tool-info.test.ts`.
3. Set `override readonly requiresApproval = true` if it has side effects
   (sends, writes, deletes, spends): the turn then waits for Approve / Deny.
   Use `'after-untrusted'` to ask only in chats that hold untrusted content
   (like `memory`), and mark tools whose output carries others' text
   (pages, search results, your old chats) `untrustedOutput = true`; an
   `'after-untrusted'` tool that can vouch for a call (`fetch_url` for an
   address the user or a search gave) overrides `askAfterUntrusted`. Tools that read or keep
   the user's history override `offeredIn(conversation)` to leave out
   temporary chats, and a tool can add to the chat's instructions while
   offered by overriding `instructions()`.
4. Throw for errors: `ToolRegistry` returns `Error: …` to the model, as it
   does for invalid arguments. Honour `signal` for anything slow.
5. Add it to `defaultTools()` (`main.ts`). A tool that needs setup (keys,
   endpoints, from `Config`) is always added, given `null` for what's
   missing, and overrides `unavailable()` to say what to set: Settings lists
   it with that hint and it's never offered to the model (see `web_search`).
   Take collaborators (clients, `FileStore`) in the constructor, and test
   `run` directly, like `tests/server/memory.test.ts`.
6. Anything that reaches the network on the model's behalf must refuse private
   addresses, like `fetch_url` (`tools/fetch-url.ts`).

## Comments

Comment only where the *why* isn't obvious: constraints, workarounds,
invariants, API quirks. No line-by-line narration.

## Testing

- Every phase adds tests for what it adds. Run `pnpm test` before committing.
- Routes: test through `testApp(deps).request(...)` (`tests/server/fakes.ts`),
  which builds `createApp` with fakes for every dependency you don't pass.
- OpenAI: pass a fake client whose `responses.create` returns an async
  generator of `ResponseStreamEvent`s. Tests never hit the network.
  `testChat(events, { store, calls, tools, … })` builds a `ChatService` on
  such a fake with default stores and settings.
- Retrieval: `tests/server/retrieval.test.ts` scores project search on a
  small corpus (`tests/fixtures/retrieval`); run it before and after changing
  chunking or ranking, and add a question when search misses one. With an
  embedding endpoint (`RETRIEVAL_EMBEDDING_URL`, `RETRIEVAL_EMBEDDING_MODEL`,
  e.g. Ollama's `nomic-embed-text-v2-moe`) it also scores keyword against
  hybrid search, on questions that repeat the passage's words, on paraphrases
  and on a held-out set of paraphrases, and compares ways of merging the two
  searches (`RETRIEVAL_QUERY_PREFIX` and `RETRIEVAL_DOCUMENT_PREFIX` add a
  model's task prefixes); that part is skipped otherwise. Choose on the first
  two sets and confirm on the held-out one: they have 41 questions between
  them, so a difference of one or two is noise.
- Prompt injection: `tests/server/chat/injection.test.ts` asks a real model to
  summarize a poisoned page with chibot's own instructions and tools, and
  counts how often it obeys; run it when changing the untrusted-content
  wording (`INJECTION_URL`, `INJECTION_MODELS`; skipped otherwise).
- SQLite: use `':memory:'` databases.
- Web: no component unit tests; pure helpers (e.g. `chat/turns.ts`, `chat/usage.ts`)
  get vitest tests. UI behaviour is covered by Playwright specs in
  `tests/e2e/`, which drive a production build with the real SDK pointed at
  `tests/e2e/fake-openai.ts` via `OPENAI_BASE_URL`. The fake answers
  `Answer #n to: <question>`; a question containing "slow" streams a long
  answer slowly, "drip" a normal one slowly (to queue a message while it
  streams), "think" adds a reasoning summary, "compact" a compaction item,
  and a question's words call a tool ("approve", "search", "read <url>", …:
  the `TRIGGERS` table in the file lists them, and a new tool needs one row
  there). It also fakes Brave, the images API, embeddings, transcription
  (`/debug/last-transcription`) and a Files API (`/debug/files`,
  `/debug/forget-files`; unknown file ids get a 404), and serves a test page;
  the model `e2e-other` refuses `input_file` parts, as Ollama does. Chromium
  runs with a fake microphone. `/debug/last-request` and `/debug/requests`
  show what chibot sent. Shared steps live in `tests/e2e/helpers.ts` (`send`,
  `answered`, `appReady`, `lastRequest`, `resetSettings`, …). Wait for the app
  (e.g. a focused composer, or the empty new-chat page) before typing or
  pressing shortcuts, and for `answered` before copying. Specs that change
  settings reset them afterwards (`resetSettings` restores the server's
  defaults, so a new setting needs no change there). `contrast.spec.ts` runs
  axe over the main screens in both colour schemes; a new screen, dialog or
  colour belongs in it. First run:
  `pnpm exec playwright install chromium`.

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
   Playwright specs) and makes the commit; it needs a clean working tree
   (`--no-commit` leaves the commit to you).
5. **Stop after each phase.** Report what works and how it was verified, then
   wait for the owner's go-ahead before starting the next phase.
