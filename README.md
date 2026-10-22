# chibot

A local, single-user, ChatGPT-style chatbot built on the
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/responses-vs-chat-completions).
It works with OpenAI and with OpenAI-compatible servers that implement the
Responses API, such as [Ollama](https://docs.ollama.com/openai) and
[LM Studio](https://lmstudio.ai/).

> **Status: Phase 2 (conversations).** Streamed chat with a ChatGPT-style
> sidebar of saved conversations. Editing and message versions arrive in
> Phase 3. See [PLAN.md](PLAN.md) for the roadmap.

## Requirements

- Node.js ≥ 26
- pnpm ≥ 12
- An OpenAI API key, or a local or hosted OpenAI-compatible server with a
  `/v1/responses` endpoint

## Setup

```bash
pnpm install
cp .env.example .env   # then set OPENAI_API_KEY
```

## Configuration

Set these in `.env` or the environment. chibot reads the real environment
first, then a `.env` in the folder you start it from, then the `.env` in the
chibot folder, so it finds its settings wherever you run it.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_BASE_URL` | OpenAI | Any server with a Responses API |
| `OPENAI_API_KEY` | — | Required for OpenAI; optional with `OPENAI_BASE_URL` |
| `OPENAI_MODEL` | `gpt-6-astra` | Chat model; required with `OPENAI_BASE_URL` |
| `HOST` | `127.0.0.1` | Interface to listen on (see below) |
| `PORT` | `3000` | API server port |
| `CHIBOT_DATA_DIR` | `<repo>/data` | Where the conversation database is kept |

For example, to chat with a local Ollama model, put this in `.env`:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=gemma4:cloud
```

Use any model Ollama can serve. `:cloud` models need `ollama signin` first.

chibot has no login, and anyone who can reach it spends your API key. It
therefore listens only on this machine by default. To use it from another
device on your network, set `HOST=0.0.0.0` (this applies to both `pnpm dev`
and `pnpm start`). The server prints a warning when it's exposed.

## Running

**Development** runs the API server (restarts on change) and the Vite dev
server (hot reload) together:

```bash
pnpm dev
```

Then open http://127.0.0.1:5173.

**Production** builds the web app once and serves everything from one port:

```bash
pnpm build
```

```bash
pnpm start
```

Then open http://127.0.0.1:3000.

## Using it

- Type a message and press **Enter** to send. **Shift+Enter** adds a new line.
- Answers stream in as Markdown, with tables, syntax-highlighted code and
  `$…$` / `$$…$$` math.
- **Stop** (■) ends an answer early. What arrived so far is kept, and the same
  happens if you close the tab mid-answer.
- The first message gives the chat its own URL (`/c/…`). Reloading reopens it.
- **Sidebar:** chats are grouped as Pinned, Today, Yesterday, Previous 7 days,
  Previous 30 days, then by month. Each gets a short title once its first
  answer arrives. Hover a chat and click **…** to rename, pin, archive or
  delete it. The panel button collapses the sidebar to an icon rail, which is
  remembered.
- **Search chats** finds chats by title or message text, including archived
  ones. Press Enter to open the top result.
- **Archived chats** (bottom of the sidebar) lists archived chats to restore or
  delete.
- **Temporary chat:** on a new chat, turn on the dashed-bubble toggle (top
  right). That chat isn't listed, titled or searchable, and it's deleted as
  soon as you leave it.
- If the model server reports an error (e.g. a bad API key), it's shown with
  its status and request id. Your message is kept.

## Other scripts

| Script | Does |
|---|---|
| `pnpm test` | Run the test suite |
| `pnpm typecheck` | Type-check server, tests and web |
| `pnpm format` | Format with prettier |

Developer conventions are in [AGENTS.md](AGENTS.md).

## License

MIT
