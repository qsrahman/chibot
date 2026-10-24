# chibot

A local, single-user, ChatGPT-style chatbot built on the
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/responses-vs-chat-completions).
It works with OpenAI and with OpenAI-compatible servers that implement the
Responses API, such as [Ollama](https://docs.ollama.com/openai) and
[LM Studio](https://lmstudio.ai/).

> **Status: Phase 9 (attachments & voice input).** ChatGPT-style chat with a
> sidebar, versions, a model picker, visible reasoning, custom instructions,
> long-chat compaction, export/import, a theme setting, a Settings dialog,
> tools the model can call (web search with sources, reading web pages,
> creating and editing images, a calculator, memory across chats, searching
> past chats), projects with their own files and instructions, photo and file
> attachments, and voice input. See [PLAN.md](PLAN.md) for the roadmap.

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

Startup settings and keys go in `.env` or the environment; everything you can
change while chatting (model, instructions, reasoning, compaction, theme) lives
in **Settings**. `OPENAI_MODEL` is the model chibot starts with.

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
| `OPENAI_IMAGE_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Image generation; the model must be an image-generation model (not a chat model), and defaults to `gpt-image-2` on OpenAI |
| `OPENAI_EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Project file search by meaning; the model defaults to `text-embedding-3-small` on OpenAI, and must be named on other servers (without one, project files are searched by keywords) |
| `OPENAI_TRANSCRIBE_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Voice input; the model defaults to `gpt-transcribe` on OpenAI, and must be named on other servers (without one, the mic is off). With chat on Ollama, point this at OpenAI |
| `BRAVE_API_KEY` | — | Turns on web search ([Brave Search API](https://brave.com/search/api/)) |
| `CHIBOT_DATA_DIR` | `<repo>/data` | Where the database and generated images are kept |
| `CHIBOT_TOKEN` | — | Requires a token (16+ characters) to use chibot; set it when `HOST` exposes chibot |

For example, to chat with a local Ollama model, put this in `.env`:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=gemma4:cloud
```

Use any model Ollama can serve. `:cloud` models need `ollama signin` first.
Chat models (such as `gemma4` or `gpt-oss`) can't make images, so leave
`OPENAI_IMAGE_MODEL` unset (or set it to an image model) and point image
generation at OpenAI:

```bash
OPENAI_IMAGE_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_API_KEY=sk-…
```

(Ollama's own image generation was removed in Ollama 0.32.6, so pulled image
models such as `x/z-image-turbo` can't be used: its images endpoint answers
404.) If image generation is set up wrongly, the answer says which endpoint
and model failed, and what to set.

For project files, embeddings can stay local:
`ollama pull nomic-embed-text`, then `OPENAI_EMBEDDING_MODEL=nomic-embed-text`.

chibot has no login, and anyone who can reach it spends your API key. It
therefore listens only on this machine by default. To use it from another
device on your network, set `HOST=0.0.0.0` (this applies to both `pnpm dev`
and `pnpm start`) together with a token:

```bash
HOST=0.0.0.0
CHIBOT_TOKEN=…   # e.g. the output of: openssl rand -hex 16
```

Then open `http://<this machine's IP>:3000/?token=<CHIBOT_TOKEN>` once in each
browser; a cookie remembers it, and without it chibot answers 401. The server
prints a warning when it's exposed without a token.

Web pages you visit can't use chibot behind your back: it answers only to
this machine's names (`localhost`, IP addresses, and `HOST` if it's a name),
so a site can't point its own name at it, and it refuses uploads posted from
other sites. From another device, open it by IP address, or set `HOST` to
the name you use.

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
  On a phone or tablet, Enter adds a new line and the send button sends.
  An unsent message stays with its chat, so switching chats doesn't carry it
  along; its text is also kept in this browser across reloads (attached files
  only while the page is open).
- Answers stream in as Markdown, with tables, syntax-highlighted code and
  math (`$…$` / `$$…$$`, or LaTeX's `\(…\)` / `\[…\]`).
- **Stop** (■) ends an answer early. What arrived so far is kept, and the same
  happens if you close the tab mid-answer.
- Scroll up to read while an answer streams and the view stays put; the ↓
  button above the message box jumps back to the latest message.
- The first message gives the chat its own URL (`/c/…`). Reloading reopens it.
- **Sidebar:** chats are grouped as Pinned, Today, Yesterday, Previous 7 days,
  Previous 30 days, then by month. Each gets a short title once its first
  answer arrives. Hover a chat and click **…** to rename, pin, archive or
  delete it. The panel button collapses the sidebar to an icon rail, which is
  remembered. On a phone the sidebar slides over the chat: open it with the
  panel button at the top left.
- **Search chats** finds chats by title or message text, including archived
  ones. Press Enter to open the top result.
- **Model:** click the model name at the top to pick another chat model
  (searchable; embedding, image and speech models are left out; type a name
  if yours isn't listed or your server can't list its models). Each answer shows the
  model that wrote it, so switching models and regenerating compares them.
  The same menu's **Reasoning effort** row opens a sub-menu to set it (Auto, the model's
  default, or None to Max; also in Settings → Model), shown next to the model name
  when set.
- **Tools:** the model uses chibot's tools on its own when they help, and the
  answer shows what it did ("Searched the web", "Used calculator"; several
  calls share one row, which opens to each; open one to see the details):
  - **Web search** (with `BRAVE_API_KEY`): answers cite their sources, and a
    **Sources** list under the answer links every page found or read.
  - **Reading pages:** paste a URL and ask about it. chibot never reads
    addresses on this machine or your network.
  - **Images:** ask for a picture, then for changes ("make it bluer"). Click an
    image (or an attached photo) to see it full size over the chat, with
    Download; ⌘/Ctrl-click opens it in a new tab. They're kept with the chat, and
    deleted with it.
  - **Calculator:** exact arithmetic, functions and unit conversions.
  - **Memory:** chibot remembers lasting facts and preferences you share
    ("remember that…", or things like "I'm vegetarian") and uses them in new
    chats; the answer says "Memory updated". Ask it to change or forget
    something, or delete memories in Settings. In a chat that read web pages
    or search results, memory changes ask first, so a page can't plant one.
  - **Past chats:** ask about something you discussed before ("what did we
    decide about…?"). chibot searches your other chats (on this machine) and
    links the ones it used under **Sources**.

  The composer's **+** menu also makes the next message use **Search the web**
  or **Create an image**; one that isn't set up or is switched off shows
  greyed out with the reason. Tools with side effects (none ship yet) ask first:
  **Approve** or **Deny**, or send a new message to deny. Models also know
  today's date and time.
- **Projects** (sidebar → **New project**) group chats with their own files
  and instructions. On a project's page, add files (PDF, Word, text, notes,
  code, data; pick or drop them) and write instructions; chats started there
  search the files (by keywords, and by meaning with an embedding model), cite
  them under **Sources**, and follow the instructions. Project chats are listed
  on their project's page; a chat's **…** menu moves it into a project or out.
  Rename or delete a project from **…** next to its name; deleting it deletes
  its chats and files.
- **Voice input:** click the mic, speak, click again: the text appears at the
  cursor to check before sending. It needs a transcription model (see
  `OPENAI_TRANSCRIBE_*`); without one the mic is greyed out and says so.
- **Attachments:** **+** → **Add photos & files**, or paste or drop them onto
  the chat: images (PNG, JPEG, WebP, GIF) and the document types projects
  take. A message can be just files, with no text. Sending while they upload
  sends it once they're up; editing a message keeps them.
- **Thinking:** reasoning models show "Thinking…" while they think; afterwards
  the answer keeps a collapsed **Thoughts** section with their summary. The
  composer's mode chip picks **Auto** (the model's default), **Fast** (low
  reasoning effort) or **Thinking** (high); every level is in the header's
  model menu and in Settings.
- **Settings** (sidebar gear, or ⌘/Ctrl+,):
  - *General:* theme (System, Light or Dark).
  - *Personalization:* what chibot should know about you, and how it should
    respond. Sent with every message. **Memory**: turn it off, or manage
    (delete) what chibot remembers.
  - *Model:* reasoning effort, and compaction for long chats (on by default at
    64,000 tokens; earlier messages are summarized and a divider marks the
    spot).
  - *Tools:* switch each tool on or off, grouped (the web, images, your chats
    and files, calculation), each saying what it does and what leaves this
    machine. Tools that aren't set up are listed greyed out, with what to set
    in `.env`.
  - *Data:* import a chat from a JSON export, and archived chats to restore or
    delete.
- **Export** a chat from its **…** menu as Markdown (what's shown, with
  attachment names) or JSON (every version, with its attachments and images,
  for importing later; up to 200 MB).
- **Temporary chat:** on a new chat, turn on the dashed-bubble toggle (top
  right). That chat isn't listed, titled or searchable, doesn't use memory or
  past chats, and it's deleted as soon as you leave it.
- **Edit** a message (hover it, then the pencil) or **regenerate** an answer
  (the circular arrow). Either makes a new version; `< 2/3 >` switches
  between them, and each version keeps its own follow-up messages.
- **Copy** buttons sit under messages and answers, and on code blocks.
- **Token usage:** each answer shows its tokens; the top right shows the
  chat's total across all versions. Hover for the input/output breakdown.
- **Keyboard shortcuts:** ⌘/Ctrl+/ (or **Keyboard shortcuts** in the sidebar)
  lists them: new chat, search, toggle sidebar, focus the message box, copy
  the last answer, Esc to stop, and ↑ in an empty message box to edit your
  last message.
- If the model server reports an error (e.g. a bad API key), it's shown with
  its status and request id. Your message is kept.

## Other scripts

| Script | Does |
|---|---|
| `pnpm test` | Run the unit tests |
| `pnpm test:e2e` | Run the browser tests (first run: `pnpm exec playwright install chromium`) |
| `pnpm typecheck` | Type-check server, tests and web |
| `pnpm format` | Format with prettier |

Developer conventions are in [AGENTS.md](AGENTS.md).

## License

MIT
