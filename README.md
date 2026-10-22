# chibot

A local, single-user, ChatGPT-style chatbot built on the
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/responses-vs-chat-completions).

> **Status: Phase 0 (foundations).** The server and web shell run, but chat
> isn't wired up yet. See [PLAN.md](PLAN.md) for the roadmap.

## Requirements

- Node.js ≥ 26
- pnpm ≥ 12
- An OpenAI API key

## Setup

```bash
pnpm install
cp .env.example .env   # then set OPENAI_API_KEY
```

## Configuration

Set these in `.env` or the environment.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — (required) | Your API key |
| `OPENAI_MODEL` | `gpt-6-astra` | Chat model |
| `HOST` | `127.0.0.1` | Interface to listen on (see below) |
| `PORT` | `3000` | API server port |

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

## Other scripts

| Script | Does |
|---|---|
| `pnpm test` | Run the test suite |
| `pnpm typecheck` | Type-check server, tests and web |
| `pnpm format` | Format with prettier |

Developer conventions are in [AGENTS.md](AGENTS.md).

## License

MIT
