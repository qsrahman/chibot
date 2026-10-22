# Changelog

All notable changes to the codebase are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/)

## [Unreleased]

## [0.1.0] - 2026-10-22

### Added

- Phase 0 foundations: `Config` (env validation), Hono server with `GET /api/health`, and a React + Vite web shell. `pnpm dev` runs both servers with an `/api` proxy, and `pnpm build && pnpm start` serves the built app from the API server.
- `README.md` with setup and usage, plus `.env.example`.
- `PLAN.md` (product requirements and phased roadmap), `AGENTS.md` (developer guide, imported by `CLAUDE.md`) and this changelog.
