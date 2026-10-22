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
src/server/   main.ts (wiring + listen), app.ts (Hono routes), database.ts (one
              SQLite connection + migrations), one class per file
src/shared/   used by both server and web: API record types, chibot's own SSE events,
              message text extraction, zod schemas (requests, settings, export)
              and reasoning efforts (zod-free, so the web can import it)
src/web/      Vite root: index.html, main.tsx, components, api.ts (fetch + SSE), hooks
tests/        mirrors src/ (tests/server/*.test.ts, tests/web/*.test.ts)
tests/e2e/    Playwright specs (*.spec.ts) and fake-openai.ts
              tests/server/fakes.ts: fake OpenAI client + stream events
data/         local SQLite database (git-ignored)
```

## Commands

```bash
pnpm dev          # API server (watch) + Vite dev server, in parallel
pnpm test         # vitest run
pnpm test:e2e     # Playwright: builds, starts a fake OpenAI server + chibot
pnpm typecheck    # server/tests, web and e2e tsconfigs
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
- **Models come from config**, never string literals in logic.
- **Configuration layers** (PLAN.md §6): secrets and startup settings in the
  environment / `.env` (via `Config`), user preferences in SQLite
  (`SettingsStore`, Phase 4), and browser preferences in `localStorage`. Never
  put secrets in the other two layers or in API responses.
- **Provider-agnostic.** chibot talks to OpenAI or any OpenAI-compatible
  Responses API server. Build clients from `Config` endpoints
  (`config.chat`, …), never `new OpenAI()` with implicit env. Don't assume
  OpenAI-only extras (Files API, `models.list()`, reasoning items, usage
  details) exist: degrade gracefully when they're missing.
- **Browser support:** current versions of Chrome, Edge, Firefox and Safari.
  Baseline features (Popover API, `<dialog>`) are used without polyfills.
  Anything not yet Baseline gets a small fallback rather than a polyfill
  (e.g. menus placed by script instead of anchor positioning, scripted
  light-dismiss where `closedby` is missing).
- **Tools are our own function tools** (`Tool` subclasses). Don't put
  OpenAI-hosted tools (`web_search`, `file_search`, `image_generation`,
  `code_interpreter`, remote MCP) in a request's `tools`.
- **Styling** is plain CSS following [DESIGN.md](DESIGN.md), which sets out
  ChatGPT-like aesthetics, tokens and component specs. Use its CSS variables,
  never raw colours. Build menus and dialogs on native `<dialog>` and the
  Popover API, not a UI library. Icons come from `lucide-react`.

## Comments

Comment only where the *why* isn't obvious: constraints, workarounds,
invariants, API quirks. No line-by-line narration.

## Testing

- Every phase adds tests for what it adds. Run `pnpm test` before committing.
- Routes: test through `createApp(deps).request(...)`.
- OpenAI: pass a fake client whose `responses.create` returns an async
  generator of `ResponseStreamEvent`s. Tests never hit the network.
- SQLite: use `':memory:'` databases.
- Web: no component unit tests; pure helpers (e.g. `turns.ts`, `usage.ts`)
  get vitest tests. UI behaviour is covered by Playwright specs in
  `tests/e2e/`, which drive a production build with the real SDK pointed at
  `tests/e2e/fake-openai.ts` via `OPENAI_BASE_URL`. The fake answers
  `Answer #n to: <question>`; a question containing "slow" streams slowly,
  "think" adds a reasoning summary, "compact" a compaction item. Its
  `/debug/last-request` shows what chibot sent. Shared steps live in
  `tests/e2e/helpers.ts` (`send`, `answered`, `appReady`, `lastRequest`,
  `resetSettings`, …). Wait for the app (e.g. a focused composer, or the empty
  new-chat page) before typing or pressing shortcuts, and for `answered` before
  copying. Specs that change settings reset them afterwards. First run:
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
   (`chore: release vX.Y.Z`).
5. **Stop after each phase.** Report what works and how it was verified, then
   wait for the owner's go-ahead before starting the next phase.
