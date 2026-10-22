# Changelog

All notable changes to the codebase are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/)

## [Unreleased]

### Added

- `HOST` setting. The server and the Vite dev server now listen on `127.0.0.1` by default, and the server warns when `HOST` exposes it beyond this machine.

### Changed

- Roadmap: browser disconnects are handled like Stop; LaTeX math rendering and `/c/:id` URLs move into Phase 1.
- Roadmap: React Router for routing; titles come from the chat model (the separate title model is dropped); Phase 2 adds date grouping, FTS5 search, pin and archive; Phase 5 keeps a local copy of each attachment and re-uploads it if OpenAI no longer has it.

- Roadmap revised after review: history is stored as a tree from Phase 1 to support ChatGPT-style message versions; the old Phase 3 is split into "Edit & versions" (with token usage) and "Models & settings" (with export/import); Phase 8 projects is kept. Styling is plain CSS, and Playwright tests start in Phase 3.

## [0.1.0] - 2026-10-22

### Added

- Phase 0 foundations: `Config` (env validation), Hono server with `GET /api/health`, and a React + Vite web shell. `pnpm dev` runs both servers with an `/api` proxy, and `pnpm build && pnpm start` serves the built app from the API server.
- `README.md` with setup and usage, plus `.env.example`.
- `PLAN.md` (product requirements and phased roadmap), `AGENTS.md` (developer guide, imported by `CLAUDE.md`) and this changelog.
