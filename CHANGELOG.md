# Changelog

All notable changes to the codebase are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/)

## [Unreleased]

### Changed

- Internal simplifications: one shared helper finds a message's attachments (web turns, Markdown export and sending used three); upload routes validate their multipart body with zod like every JSON route (`form()` beside `json()`); JSON export reuses the stored-item mapping; `FileCard` has its own module; `useChat` shows a loaded chat through one helper.

- Roadmap: Phase 10 planned, a sandboxed Python code runner (`run_python` on Pyodide in a locked-down child process, files in `/mnt/data/` kept with the chat, a fixed package set cached locally, `.xlsx` attachments). The MCP client becomes Phase 11.

### Fixed

- A turn refused after its attachments were checked (e.g. an unknown `parentId`) no longer links them to the chat; they stay unsent uploads and are swept as usual.
- Documents' extracted text (sent to models that refuse files) was cached in memory for good, even after their chat was deleted; the cache now keeps the last 20.

## [0.10.0] - 2026-10-23

### Added

- Sending attachments: turns take `fileIds` (uploads from `POST /api/files`, which now also takes PNG, JPEG, WebP and GIF images), stored as `input_image` / `input_file` parts naming chibot's own file ids. Each request uploads them once to the provider's Files API (30-day expiry; the id is kept in `files.provider_file_id`), sends them inline where there's no Files API (Ollama), and sends documents as their extracted text to models that refuse files; a provider that lost an upload (404) gets it again. An image sent to a model that can't see images says so and suggests one that can. Deleting a chat deletes its provider copies too.
- `POST /api/transcriptions` and `OPENAI_TRANSCRIBE_BASE_URL` / `_API_KEY` / `_MODEL` (default `gpt-transcribe` on OpenAI); `GET /api/health` reports `features.transcription`. Failures name the endpoint and model and what to set.
- Attachments: "Add photos & files" heads the composer's "+" menu (always shown now), and pasting or dropping files onto the chat attaches them too. Chips above the text show a thumbnail or file card, a spinner while uploading, the error if a file is refused, and × to remove; Send waits for uploads. Sent messages show image thumbnails (opening full size) and file cards, and editing a message keeps its attachments.
- Voice input: a mic button in the composer records (`MediaRecorder`, the browser's own format) and inserts the transcript at the cursor, through `POST /api/transcriptions`. Without a transcription model it's greyed out and its tooltip says what to set. `.env.example` and README document `OPENAI_TRANSCRIBE_*`.
- JSON export version 2 embeds the chat's attachments and generated images (base64); import gives them new ids and still accepts version 1. Imports may be up to 200 MB (was 20 MB). Markdown export lists each message's attachments.

### Changed

- Roadmap: Phase 9 revised. Documents go as their extracted text to models that reject files (Ollama), so PDFs and Word files work there; attachments accept images plus the project document types; attaching joins the composer's "+" menu; JSON export also embeds generated images; images and transcription get clear setup errors.
- The model picker lists only chat models: on Ollama by each model's capabilities (`/api/show`, which also catches image models with plain names), elsewhere by leaving out embedding, speech, transcription, image, video, moderation, realtime, Chat-Completions-only search and legacy completion models.

### Fixed

- Image generation that can't work (e.g. `OPENAI_IMAGE_MODEL` set to a chat model, or an endpoint without images) now says which endpoint and model failed and what to set, instead of a bare 404 or "Connection error". README and `.env.example` say the image model must be an image-generation model.

## [0.9.1] - 2026-10-23

### Fixed

- Stored files (project uploads, generated images) are served with `nosniff`, and all but PDFs with `Content-Security-Policy: sandbox`: an uploaded HTML file opened from a project could otherwise run scripts with access to chibot's API.
- Removing a project file (or its project) while it was being indexed left its chunks and vectors behind.
- Renaming or deleting a project showed nothing when it failed.
- 404s name what's missing; projects, files, memories and items all said "Conversation not found".

### Changed

- `GET /api/tools` no longer returns `enabled` (the web reads the `disabledTools` setting); the `Health` type is shared.
- Internal simplifications: ChatService finds waiting tool calls itself; ProjectStore, MemoryStore and FileStore return shared types straight from SQL (aliases, `RETURNING`); the web API client has one request, JSON and delete helper each; lists and dialogs load through one `useLoad` hook; `TurnView` is split out of `ChatPage`; `REASONING_EFFORTS` is checked against the SDK's type.

### Removed

- The unused `highlight.js` dependency (`rehype-highlight` brings its own).

## [0.9.0] - 2026-10-23

### Added

- Projects: chats grouped with their own files and instructions. The sidebar lists projects ("New project"); a project's page has its name (rename, delete), a composer that starts chats in it, its files, instructions and chats. Chats move in with "Move to project…" and out with "Remove from project"; project chats are listed only in their project and show "Project /" in the header. Deleting a project deletes its chats and files.
- Project files: `POST /api/files` takes PDF, Word (`.docx`) and text files (≤ 50 MB); in a project they're indexed in the background (text via `unpdf`, `mammoth` and Readability, overlapping chunks, FTS5, and with `OPENAI_EMBEDDING_*` vectors in `sqlite-vec`), with their status shown. Indexing resumes after a restart and re-embeds when the embedding model changes.
- `search_project_files`: in project chats with files, keyword and vector hits merged by reciprocal rank fusion; the project's instructions and file names go into the chat's instructions, and Sources lists the files used.
- End-to-end tests for answering from project files with project instructions, and for moving chats in and out and deleting a project. The fake server embeds text.

### Changed

- SQLite opens with `sqlite-vec` loaded (extension loading is then switched off).
- Tools decide where they're offered (`offeredIn(conversation)`, replacing `inTemporaryChats`) and get the chat's project in their context.
- The model's searches (`search_chats`, project files) match words under 4 letters only whole, so "do" no longer finds "door".
- Menus low in the window open upward. Route tests build the app with `testApp()`.
- Roadmap: Phase 8 detailed. Project files are searched by keywords always and by meaning when an embedding model is set (`sqlite-vec`, verified in `node:sqlite`); Word files are supported; projects get no model override (one global model); project chats are listed only in their project, and deleting a project deletes them.

## [0.8.0] - 2026-10-23

### Added

- Memory: a `memory` tool saves, updates and deletes what chibot remembers about the user (at most 100 memories of 300 characters, stored in SQLite), and chat instructions list the memories while the tool is offered. Answers say "Memory updated".
- Memory changes ask first in chats whose history holds web content (`requiresApproval: 'after-untrusted'`, with `untrustedOutput` on `web_search` and `fetch_url`), so a page can't plant a memory; a probe showed `gpt-oss` doing exactly that.
- `search_chats`: searches the user's other chats (any word, ranked by relevance, optional date range) and returns each chat's best few messages in order; Sources links the chats found.
- Settings → Personalization → Memory: the memory switch (the memory tool's) and Manage memories, to delete one or all (`GET /api/memories`, `DELETE /api/memories[/:id]`).
- Tools can add to the instructions while offered (`instructions()`) and opt out of temporary chats (`inTemporaryChats`); memory and chat search do.
- End-to-end tests for remembering across chats and deleting from Settings, temporary chats, asking after web content, and finding an earlier chat.

### Changed

- Roadmap: Phase 7 detailed. Memory changes ask first in chats that read web content (a probe showed `gpt-oss` saving a memory planted in a page); the memory tool's switch is the memory switch; `search_chats` matches any word by relevance with an optional date range.

## [0.7.0] - 2026-10-23

### Added

- Web search (`web_search`, Brave Search API with `BRAVE_API_KEY`): top results with snippets; answers cite sources, and a Sources list under the answer links every page searched or read.
- Reading pages (`fetch_url`): main text through Readability (plain text, Markdown and JSON as is), capped and marked as untrusted. It refuses this machine and private networks (including IPv4-mapped IPv6), checked at connect time for every connection and redirect.
- Images (`generate_image`, `edit_image`) through the image endpoint (`OPENAI_IMAGE_BASE_URL` / `_API_KEY` / `_MODEL`, defaulting to the chat endpoint and `gpt-image-2` on OpenAI), at medium quality. Images are stored in `data/files/`, served by `GET /api/files/:id`, shown in the answer (with a placeholder while made, full size and download) and deleted with their chat.
- Settings → Tools switches each tool on or off (`disabledTools`; `GET /api/tools`), and the composer's "+" menu makes the next message search the web or create an image (`tool` in the turn request forces it on the first request).
- Tools get a `ToolContext` (chat id, stop signal) and a `label`; `defaultTools()` builds the ones whose setup exists.
- End-to-end tests for search and sources, reading a page and refusing a local one, creating and editing an image, the composer menu and switching a tool off. The fake server fakes Brave and the images API and serves a test page.

### Changed

- `Config` validates the environment with zod, naming the variable in each error.
- Tool activity has friendlier labels ("Searched the web", "Created an image").
- Roadmap: Phase 6 detailed. Tools are used automatically, forced from a composer "+" menu and switched off in Settings (instead of per-chat toggles); `edit_image` joins `generate_image`, without streamed partial images; `fetch_url` guards addresses in an undici connector; generated images get `files.conversation_id` now.

## [0.6.0] - 2026-10-23

### Added

- Function tools: the model can call chibot's own tools mid-answer (`Tool` subclasses in a `ToolRegistry`). Calls run in order, their outputs are saved in the history and streamed as `chibot.tool_output`, and the model is asked again, up to 10 requests per answer. Tool errors and invalid arguments go back to the model instead of ending the turn, and a stopped answer still records an output for every call.
- Approval: a tool with `requiresApproval` ends the turn with `chibot.approval`; `POST /turns` with `{ approvals }` runs or denies the waiting calls and continues the answer. Sending a new message instead denies them. Waiting approvals survive a reload.
- Calculator tool (mathjs, exact BigNumber arithmetic, functions and unit conversions; expressions can't reach the parser itself).
- The instructions tell the model the current date, time and timezone.
- Answers show each tool call ("Running …", then a collapsed "Used …" with arguments and result), and an approval card with Approve / Deny. Markdown exports quote tool calls with their results.
- End-to-end tests for the calculator and for approving, denying and implicitly denying a tool, through a test-only tool that needs approval.

### Changed

- An answer's token count now sums all its responses (one per tool round).
- Roadmap: phases reordered to tools (5), web search & image generation (6), memory (7), projects (8), then attachments & voice input (9). Generated images now introduce file storage (`FileStore`, `GET /api/files/:id`) and project files introduce `POST /api/files`, which attachments build on; `Config` moves to zod with the image endpoint in Phase 6.
- Roadmap: the current date goes into the instructions (Phase 5), a `fetch_url` tool joins web search (Phase 6) and a `search_chats` tool joins memory (Phase 7). A sandboxed code runner and an MCP client are noted as future tools.

## [0.5.0] - 2026-10-22

### Added

- Settings stored in SQLite with `GET`/`PATCH /api/settings` (validated with zod; secrets are never included). The chat model is now a setting that defaults to `OPENAI_MODEL`.
- Model picker in the header: searches the server's model list (`GET /api/models`), or takes a typed name when the server can't list models. The choice applies to new turns, edits and regenerations, and each answer shows the model that wrote it.
- Reasoning: chat requests ask for a reasoning summary, plus the effort when set (the `reasoningEffort` setting). A collapsible "Thinking…" shows the summary while the model thinks, and answers keep it as "Thoughts". Models that reject reasoning parameters are retried without them, and remembered.
- Custom instructions (`aboutUser`, `responseStyle` settings) are sent as `instructions` with every chat turn (not titles), after a built-in line asking for `$…$` / `$$…$$` math so formulas render.
- Long chats: requests ask the server to compact the context past `compactThreshold` tokens (default 64,000; `null` turns it off). Compaction items are kept in the history, a turn's input starts at the last one, and the chat shows "Earlier messages were summarized to save context" where it happened. Servers that reject the option are retried without it.
- Export a chat from its menu as Markdown (what's shown) or JSON (the whole tree: every version, usage and models; `{ version: 1 }`). `POST /api/conversations/import` adds an exported JSON chat back, validated, with new ids and the same version shown (up to 20 MB).
- End-to-end tests for the model picker, reasoning effort and custom instructions, thinking, theme, export/import and compaction. The fake server gained a model list, reasoning and compaction output, and `/debug/last-request`.
- Settings dialog (sidebar gear or ⌘/Ctrl+,): theme (System / Light / Dark), custom instructions, reasoning effort, compaction on/off and threshold, importing a chat, and archived chats (moved here from the sidebar).

### Changed

- Colours are defined once with `light-dark()` and follow `color-scheme`, so a theme setting can override the system (applied before first paint via `<meta name="color-scheme">`). Code highlighting uses chibot's own GitHub-style tokens instead of highlight.js's media-query theme files.

## [0.4.0] - 2026-10-22

### Added

- Edit a sent message (inline, Enter to send, Esc to cancel) and regenerate an answer, each creating a new version. `< 2/3 >` switches between versions, and each version keeps its own follow-up messages. A failed answer shows Retry.
- Token usage: each answer shows its token count, and the header shows the chat's total across all versions. Hover either for input (cached) and output (reasoning) tokens.
- Keyboard shortcuts (ChatGPT's core set): new chat ⌘/Ctrl+⇧+O, search ⌘/Ctrl+K, toggle sidebar ⌘/Ctrl+⇧+S, focus the message box ⇧+Esc, copy the last answer ⌘/Ctrl+⇧+C, stop Esc, and ⌘/Ctrl+/ (or the sidebar's Keyboard shortcuts) for the list.
- Copy buttons on messages, answers and code blocks. Code blocks get a header with the language and Copy code.
- End-to-end tests (`pnpm test:e2e`, Playwright) against a fake OpenAI-compatible server: chat, titles, usage and copy; edit and regenerate versions with their own follow-ups; switching chats mid-answer; revisiting a just-created chat; keyboard shortcuts.
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
