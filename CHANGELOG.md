# Changelog

All notable changes to the codebase are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/)

## [Unreleased]

### Added

- Edit a sent message (inline, Enter to send, Esc to cancel) and regenerate an answer, each creating a new version. `< 2/3 >` switches between versions, and each version keeps its own follow-up messages. A failed answer shows Retry.
- Copy buttons on messages, answers and code blocks. Code blocks get a header with the language and Copy code.
- API: `POST /api/conversations/:id/turns` accepts `parentId` (edit or regenerate), `PUT /api/conversations/:id/leaf` switches versions, and `GET /api/conversations/:id` reports each item's `siblingIds` and the chat's token totals.

### Fixed

- Starting chibot from another folder ignored its `.env` (it was read from the current folder only), so it failed with "OPENAI_API_KEY is not set". It now reads the real environment, then `.env` in the current folder, then the chibot folder's `.env`.

## [0.3.1] - 2026-10-22

### Changed

- `POST /api/conversations` now answers malformed JSON with a 400 instead of ignoring it. An empty body still creates a normal chat.

### Fixed

- Switching to another chat while an answer was streaming kept writing the old answer into the new chat and, once done, showed the old conversation under the new chat's URL. Leaving a chat mid-answer now stops it (the partial answer is kept), as closing the tab does.
- Returning to a chat you had just started (via New chat, then the sidebar) showed an empty view.
- While an answer streamed, the chat kept jumping to the bottom, so you couldn't scroll up to read. It now follows the answer only while you're at the bottom.
- Renaming, pinning, archiving, restoring or deleting a chat failed silently. Errors now show in the sidebar or the Archived chats dialog, and the list resyncs.
- Links in answers opened in the same tab, leaving chibot (and stopping an answer in progress). They now open in a new tab; footnote links stay on the page.

## [0.3.0] - 2026-10-22

### Added

- Phase 2 conversations sidebar: Pinned and date groups, inline rename, pin, archive and delete (with confirmation) from a per-chat menu, and collapse to an icon rail that's remembered.
- Search chats: a dialog that searches titles and message text (SQLite FTS5, word prefixes) and shows matching snippets.
- Archived chats dialog to restore or delete archived conversations.
- Temporary chat: a toggle on a new chat. It's never listed, titled or indexed, and is deleted when you leave it. The server also sweeps leftovers at startup.
- Automatic titles: after the first answer the chat model writes a 3-6 word title, which streams to the sidebar as a `chibot.title` event.
- API: `GET /api/conversations` (`archived=1`, `q=`), `PATCH` and `DELETE /api/conversations/:id`, and `POST /api/conversations` with `{ temporary: true }`.
- `DESIGN.md`: ChatGPT-inspired design guide with measured tokens, layout and component specs for current and upcoming UI.

### Changed

- UI restyled to the design guide: centred empty state that docks the composer after the first message, pill composer with icon send/stop buttons (`lucide-react`), ChatGPT-like palette and type scale in both themes, and a disclaimer under the composer.
- Chat window matches ChatGPT's measured styles: blue user bubbles (22 px radius), a blue send button, 16/26 px answers, code blocks without a box under a language label, and SF Mono inline-code chips.

## [0.2.0] - 2026-10-22

### Added

- Phase 1 minimal chatbot: streamed answers rendered as Markdown (GFM tables, syntax-highlighted code, KaTeX math), Enter to send, Shift+Enter for a newline, and a Stop button.
- Stateless chat (`store: false`, encrypted reasoning replayed) with history kept as a tree of SDK items in SQLite (`node:sqlite`) under `CHIBOT_DATA_DIR`.
- A stopped answer or a mid-answer disconnect keeps the partial text.
- `/c/:id` URLs: a reload reopens the chat, and the production server serves client routes.
- Errors from the model server are shown with their HTTP status and request id.
- API: `POST /api/conversations`, `GET /api/conversations/:id`, `POST /api/conversations/:id/turns` (SSE of the SDK's `ResponseStreamEvent`s plus `chibot.error`).
- OpenAI-compatible providers: `OPENAI_BASE_URL` points chat at any Responses API server (e.g. Ollama, LM Studio). `OPENAI_API_KEY` becomes optional there, and `OPENAI_MODEL` becomes required. `GET /api/health` reports the base URL.
- `HOST` setting. The server and the Vite dev server now listen on `127.0.0.1` by default, and the server warns when `HOST` exposes it beyond this machine.

### Changed

- Roadmap: browser disconnects are handled like Stop; LaTeX math rendering and `/c/:id` URLs move into Phase 1.
- Roadmap: React Router for routing; titles come from the chat model (the separate title model is dropped); Phase 2 adds date grouping, FTS5 search, pin and archive; Phase 5 keeps a local copy of each attachment and re-uploads it if OpenAI no longer has it.
- Roadmap: `CHIBOT_DATA_DIR` (default `<repo>/data`) replaces `CHIBOT_DB_PATH`; Phase 7 adds per-tool approval and ships a calculator sample tool; no git remote or CI.
- Roadmap: temporary chat (Phase 2), keyboard shortcuts (Phase 3), theme toggle (Phase 4), voice input (Phase 5), project instructions and default model/settings (Phase 8), and a new Phase 9 for memory.
- Roadmap: no OpenAI-hosted tools. Custom function tools move to Phase 6. Phase 7 rebuilds web search (Brave Search API) and image generation (`images.generate`) as our own tools. Phase 8 project files use local RAG (embeddings + `sqlite-vec`) instead of `file_search`.
- Roadmap: one Responses-API chat provider at a time; transcription, image and embedding endpoints can each be overridden; attachments fall back to inline base64 where there's no Files API.
- Workflow: small commits per step, a release commit per phase, and a review stop after each phase. Compatibility is checked against Ollama with `gemma4:cloud`.
- Roadmap revised after review: history is stored as a tree from Phase 1 to support ChatGPT-style message versions; the old Phase 3 is split into "Edit & versions" (with token usage) and "Models & settings" (with export/import); Phase 8 projects is kept. Styling is plain CSS, and Playwright tests start in Phase 3.

## [0.1.0] - 2026-10-22

### Added

- Phase 0 foundations: `Config` (env validation), Hono server with `GET /api/health`, and a React + Vite web shell. `pnpm dev` runs both servers with an `/api` proxy, and `pnpm build && pnpm start` serves the built app from the API server.
- `README.md` with setup and usage, plus `.env.example`.
- `PLAN.md` (product requirements and phased roadmap), `AGENTS.md` (developer guide, imported by `CLAUDE.md`) and this changelog.
