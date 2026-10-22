# chibot — Product Requirements & Plan

A local, single-user, ChatGPT-style web chatbot built directly on the
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/responses-vs-chat-completions)
via the official `openai` Node SDK.

## 1. Goals

- A chat experience that feels like ChatGPT: streaming answers, Markdown and
  code rendering, a conversation sidebar, stop/regenerate/edit, attachments and
  tools.
- Built **incrementally**: every phase ships working code, tests, docs and a
  commit.
- A codebase that is simple to read and easy to extend: a handful of
  well-named classes, constructor-injected dependencies, no speculative
  abstractions.
- Lean on the platform: Node built-ins (`node:sqlite`, `process.loadEnvFile`,
  `crypto.randomUUID`) and the `openai` SDK's own types instead of hand-rolled
  equivalents.

## 2. Non-goals

- Multi-user support, accounts or authentication (it's a local, single-user app).
- Hosted deployment (serverless platforms are not a target).
- Branching message versions ("< 2/3 >"). Edit and regenerate replace the tail
  of the conversation. The data model doesn't rule branching out later.
- Voice, realtime audio, mobile apps.

## 3. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite | Mature Markdown/highlighting/streaming ecosystem; Vite gives fast dev + a static build. Next.js was considered and rejected: its server/client split, caching and router add concepts a local, client-interactive app doesn't use. |
| Server | Hono on `@hono/node-server` | Small, Web-standard `Request`/`Response`, built-in `streamSSE` and static serving, trivially testable with `app.request()`. |
| Server runtime | Node ≥ 26 running `.ts` directly | No server build step. Requires `erasableSyntaxOnly` (no `enum`, no constructor parameter properties). |
| Conversation state | **Stateless**: `store: false`; full history kept in local SQLite and sent on every request | The app owns its data, so nothing depends on OpenAI-side retention, and editing or deleting history is a local operation. |
| Storage | `node:sqlite` (built-in) | Zero dependencies, synchronous, transactional. |
| Wire protocol | Server relays the SDK's own `ResponseStreamEvent`s over SSE | The browser reuses the SDK's types (type-only import), so there are no hand-written mirror types. |
| SSE parsing in browser | `eventsource-parser` | `EventSource` can't `POST`. |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` | Standard, safe by default (no raw HTML). |

### Stateless details

- Requests use `store: false` and `include: ['reasoning.encrypted_content']` so
  reasoning items can be replayed on later turns without server-side storage.
- Each stored item **is** a `ResponseInputItem` (JSON). User turns are stored as
  `EasyInputMessage`; assistant output items (`message`, `reasoning`,
  tool calls, …) come verbatim from `response.completed` → `response.output`.
- When a request is **stopped**, the partial assistant text is stored as an
  `EasyInputMessage` with `role: 'assistant'`, which is valid input and needs no
  server-side id.
- When a request **fails**, the user message is kept and the UI offers *Retry*
  (that's a regenerate from that message).
- **Context growth:** long chats will eventually exceed the context window.
  The SDK marks `truncation` as deprecated in favour of
  `context_management: [{ type: 'compaction', compact_threshold }]`. Whether
  that works with `store: false` gets verified in Phase 3; if it doesn't, the
  fallback is `responses.compact`.

## 4. Architecture

```
Browser (React + Vite)                        Node server (Hono)
┌──────────────────────────┐   HTTP + SSE   ┌──────────────────────────────────────┐
│ App / Sidebar / ChatView │ ─────────────▶ │ createApp(deps)          routes      │
│ Composer / Markdown      │ ◀───────────── │ ChatService     builds request,      │
│ useChat (stream client)  │                │                 streams, tool loop   │
└──────────────────────────┘                │ ConversationStore  node:sqlite       │
                                            │ ToolRegistry + Tool (Phase 5/6)      │
                                            │ Config          env → typed settings │
                                            └──────────────┬───────────────────────┘
                                                           ▼
                                                 OpenAI Responses API
```

- **Config:** reads `.env` with `process.loadEnvFile`, validates it and exposes
  typed settings.
- **ConversationStore:** CRUD over conversations and their items, in SQLite.
- **ChatService:** turns (history + new input + settings) into a
  `responses.create({ stream: true })` call. It yields the SDK events and
  persists the outcome. Later phases add the function-calling loop here.
- **`createApp(deps)`:** the Hono app. It's a factory so tests can inject fakes.
- **`main.ts`:** wires the real dependencies together and starts the server.

Dependencies go in through constructors, so tests pass a fake `OpenAI` client
whose `responses.create` returns an async generator of events.

### Data model (SQLite)

```sql
conversations(id TEXT PK, title TEXT, created_at INTEGER, updated_at INTEGER)
items(id INTEGER PK AUTOINCREMENT, conversation_id TEXT FK → conversations ON DELETE CASCADE,
      data TEXT /* JSON ResponseInputItem */, created_at INTEGER)
```

Item order is `items.id`. Editing or regenerating from a message deletes it
(if edited) and every item after it, then runs a new turn.

### HTTP API (grows per phase)

| Method & path | Phase | Purpose |
|---|---|---|
| `GET /api/health` | 0 | Liveness + configured model |
| `POST /api/conversations` | 1 | Create a conversation |
| `GET /api/conversations/:id/items` | 1 | Full history (`ResponseInputItem[]`) |
| `POST /api/conversations/:id/turns` | 1 | Send a message; SSE stream of `ResponseStreamEvent`s |
| `GET /api/conversations` | 2 | List conversations for the sidebar |
| `PATCH/DELETE /api/conversations/:id` | 2 | Rename / delete |

## 5. Phases

Every phase ends with: tests green, `pnpm typecheck` clean, docs + CHANGELOG
updated, and a commit.

### Phase 0 — Foundations
- Dependencies, `Config`, Hono app with `GET /api/health`, `main.ts`.
- Vite + React shell served by Vite in dev and by Hono in production.
- `pnpm dev` runs both servers; Vite proxies `/api`.
- **Done when:** `pnpm dev` shows the shell, which displays `/api/health`, and
  the tests for Config and the health route pass.

### Phase 1 — Minimal chatbot
- `ConversationStore` (SQLite) and `ChatService` (streaming, stateless).
- Single-conversation UI: message list, composer (Enter to send, Shift+Enter
  for a newline), streamed tokens, **Stop** (aborts the upstream request through
  `AbortSignal`), Markdown with syntax highlighting.
- Readable errors that surface `APIError` status and request id.
- **Done when:** a multi-turn chat streams and remembers earlier turns; Stop
  keeps the partial answer; a bad API key shows a readable error; unit tests
  cover the store, the service (fake client) and the routes.

### Phase 2 — Conversations
- Sidebar: list, new chat, select, rename, delete; URL `/c/:id`.
- Automatic title after the first exchange, from a cheap model call
  (`OPENAI_TITLE_MODEL`).
- **Done when:** conversations survive a server restart and can be reopened,
  renamed and deleted.

### Phase 3 — Chat UX
- Regenerate the last answer, edit a user message, copy message/code buttons.
- Model picker (from `models.list()`), custom instructions (`instructions`),
  reasoning effort, collapsible "Thinking…" view of the reasoning summary.
- Context-growth strategy (compaction, see §3).
- Playwright end-to-end smoke test.
- **Done when:** these work end to end and the e2e test passes.

### Phase 4 — Attachments
- Images and PDFs added by paste, drag-drop or picker. They upload through the
  Files API and are sent as `input_image` / `input_file`.
- **Done when:** the model can answer questions about an attached image and an
  attached PDF.

### Phase 5 — Built-in tools
- `ToolRegistry`; toggles for `web_search` (inline citations from
  `url_citation` annotations) and `image_generation` (partial-image previews,
  saved images).
- **Done when:** a web-search answer shows clickable sources and a generated
  image renders and persists.

### Phase 6 — Custom function tools
- Abstract `Tool` class (name, description, JSON-schema parameters, `run()`).
  The function-calling loop in `ChatService` streams tool activity to the UI.
- One or two sample tools; AGENTS.md documents how to add more.
- **Done when:** the model calls a sample tool mid-answer and uses its result.

### Phase 7 — Projects (optional)
- Per-project files indexed in a vector store and searched with `file_search`.

## 6. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — (required) | API key |
| `OPENAI_MODEL` | `gpt-6-astra` | Chat model |
| `OPENAI_TITLE_MODEL` | `gpt-6-luna` | Cheap model for titles (Phase 2) |
| `PORT` | `3000` | API server port |
| `CHIBOT_DB_PATH` | `data/chibot.db` | SQLite file (Phase 1) |

## 7. Risks & open items

- **Model names change.** Models are configured through env, never hard-coded
  in logic. Defaults are checked against `models.list()` when the model picker
  arrives in Phase 3.
- **Stateless + compaction compatibility** gets verified in Phase 3.
- **`node:sqlite` stability:** it's built into Node 26. If its API shifts, the
  `ConversationStore` is the only place to change.
