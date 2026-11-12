# chibot

A local, single-user, ChatGPT-style chatbot built on the
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/responses-vs-chat-completions).
It works with OpenAI and with OpenAI-compatible servers that implement the
Responses API, such as [Ollama](https://docs.ollama.com/openai) and
[LM Studio](https://lmstudio.ai/).

> **Status: v0.13, phases 0–10 complete.** Chat with a sidebar, message
> versions, a model picker, visible reasoning, custom instructions, long-chat
> compaction, export/import, themes, tools the model can call (creating and
> editing images, memory, searching past chats and project files, plus any MCP
> server's, such as web search), projects with their own files, attachments, voice input, and MCP
> servers' tools, summaries that keep long chats going on any server, a
> camera, quoting, and backup and restore. Next: multiple providers and a code
> runner. See
> [PLAN.md](PLAN.md) for the roadmap and [CHANGELOG.md](CHANGELOG.md) for what
> changed.

## Requirements

- Node.js ≥ 26
- pnpm ≥ 12
- An OpenAI API key, or a local or hosted OpenAI-compatible server with a
  `/v1/responses` endpoint

## Setup

```bash
pnpm install
pnpm build        # the web app, once (and again after pulling changes)
pnpm add -g .     # puts the `chibot` command on your PATH (a link to this folder)
chibot init       # asks where your models are, and for the key
chibot            # starts it and opens http://127.0.0.1:3000 in your browser
```

`pnpm add -g .` links the command to this folder (pnpm 12 no longer accepts
`pnpm link -g`; the global bin folder must be on your PATH, which `pnpm setup`
arranges), so it keeps working from any folder and picks up changes you pull
(rebuild the web app after them). `pnpm remove -g chibot` takes it off again.
`chibot --help` lists the commands. To work on chibot itself, `pnpm dev` (see
[Running](#running)) reads the same settings.

## Configuration

Startup settings and keys are kept in `config.json`, which `chibot init`
writes (readable only by you; it holds your keys). Everything you can change
while chatting (model, instructions, reasoning, compaction, theme) lives in
**Settings**; the chat model you pick there starts from `chat.model`.

```bash
chibot config path                        # where everything is kept
chibot config show                        # the settings, keys shown as "set"
chibot config set chat.model gpt-6-astra  # change one (an empty value removes it)
```

chibot keeps its files in your system's usual folders:

| | macOS and Linux | Windows |
|---|---|---|
| Settings (`config.json`: keys, MCP servers) | `~/.config/chibot` | `%APPDATA%\chibot\Config` |
| Data (chats, files, sign-ins) | `~/.local/share/chibot` | `%LOCALAPPDATA%\chibot\Data` |

(`XDG_CONFIG_HOME` and `XDG_DATA_HOME` move them, as for other command-line
tools; a Mac uses these too, not `~/Library`.)

When an update changes the database's layout, chibot first copies the old
database to `chibot.db.before-upgrade` beside it (readable only by you, and
replaced by the next upgrade's copy), and says so at startup. To go back, stop
chibot, run an older version, and put that file in place of `chibot.db`.

**Precedence**, highest first: command-line flags (`--port`, `--host`), real
environment variables, `config.json`, defaults. So a variable such as
`OPENAI_API_KEY` always overrides the file, which is how a deployment, a test
or a one-off run changes a value. A `.env` file is not read.

| Setting (`chibot config set …`) | Variable | Default | Purpose |
|---|---|---|---|
| `chat.baseURL` | `OPENAI_BASE_URL` | OpenAI | Any server with a Responses API |
| `chat.apiKey` | `OPENAI_API_KEY` | — | Required for OpenAI; optional with `chat.baseURL` |
| `chat.model` | `OPENAI_MODEL` | `gpt-6-astra` | Chat model; required with `chat.baseURL` |
| `server.host` | `HOST` | `127.0.0.1` | Interface to listen on (see below) |
| `server.port` | `PORT` | `3000` | API server port |
| `image.baseURL` / `.apiKey` / `.model` | `OPENAI_IMAGE_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Image generation; the model must be an image-generation model (not a chat model), and defaults to `gpt-image-2` on OpenAI |
| `embedding.baseURL` / `.apiKey` / `.model` | `OPENAI_EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Project file search by meaning; the model defaults to `text-embedding-3-small` on OpenAI, and must be named on other servers (without one, project files are searched by keywords) |
| `rerank.baseURL` / `.apiKey` / `.model` | `OPENAI_RERANK_BASE_URL` / `_API_KEY` / `_MODEL` | none (the API key is the chat one) | Project search reordered by a reranking model, on a server with a `/rerank` route (llama.cpp's `llama-server`, vLLM, Jina, Cohere); `baseURL` is the address up to `/rerank`, e.g. `http://localhost:8080/v1`. Without it, or with the model emptied in Settings, passages keep the order keywords and meaning give |
| `transcription.baseURL` / `.apiKey` / `.model` | `OPENAI_TRANSCRIBE_BASE_URL` / `_API_KEY` / `_MODEL` | the chat endpoint's | Voice input; the model defaults to `gpt-transcribe` on OpenAI, and must be named on other servers (without one, the mic is off). With chat on Ollama, point this at OpenAI |
| `token` | `CHIBOT_TOKEN` | — | Requires a token (16+ characters) to use chibot; set it when `server.host` exposes chibot |
| `server.allowOpen` | `CHIBOT_ALLOW_OPEN` | `false` | `true` (or `1` in the variable, or `chibot --allow-open`) lets chibot listen beyond this machine without a token, e.g. behind a firewall or proxy that restricts who can reach it |
| — | `CHIBOT_CONFIG_DIR` | see above | Where `config.json` is |
| `dataDir` | `CHIBOT_DATA_DIR` | see above | Where the database, generated images and MCP sign-ins are kept (a full path) |

For example, to chat with a local Ollama model:

```bash
chibot config set chat.baseURL http://localhost:11434/v1
chibot config set chat.model gemma4:cloud
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
`ollama pull nomic-embed-text`, then
`chibot config set embedding.model nomic-embed-text`. Some embedding models
(nomic-embed-text, embeddinggemma, the e5 family, mxbai-embed-large) are trained
to expect a short instruction before each text: in **Settings → Other models**,
**Use what <model> expects** fills the **Text before a question** and **Text
before each file part** boxes for the ones chibot knows (type them by hand for
others; leave them empty for OpenAI's, which take plain text). Changing the
chunk one indexes the files again; the question one changes nothing stored.

A reranking model is optional: it reads the 20 best passages next to the
question and puts the one that answers it first, which helps when the right
passage is found but ranked low. It needs a server with a `/rerank` route
(Ollama has none); set `rerank.baseURL` and `rerank.model`, and the model can
then be changed or emptied under **Settings → Other models → Project search**.
If the server fails, search keeps its own order.

The `image.model`, `embedding.model` and `transcription.model` settings only
give the starting models: the image, embedding and transcription models can be
changed (or emptied, to turn the feature off) in **Settings → Other models**,
without a restart. The servers and keys behind them stay in `config.json`.

chibot has no login, and anyone who can reach it spends your API key. It
therefore listens only on this machine by default. To use it from another
device on your network, set `server.host` to `0.0.0.0` (or run `chibot --host
0.0.0.0`) together with a token:

```bash
chibot config set server.host 0.0.0.0
chibot config set token "$(openssl rand -hex 16)"
```

Then open `http://<this machine's IP>:3000/?token=<token>` once in each
browser; a cookie remembers it, and without it chibot answers 401. The server
refuses to start when `server.host` is beyond this machine and there is no
token, since anyone who could reach it would spend your API key and, in
Settings, add MCP servers that run commands. If a firewall or proxy in front
already restricts who can reach it, `chibot --allow-open` (or
`chibot config set server.allowOpen true`, or `CHIBOT_ALLOW_OPEN=1`) starts it
anyway, with a warning.

Web pages you visit can't use chibot behind your back: it answers only to
this machine's names (`localhost`, IP addresses, and `server.host` if it's a name),
so a site can't point its own name at it, and it refuses uploads posted from
other sites. From another device, open it by IP address, or set `server.host`
to the name you use.

### MCP servers

chibot can use the tools of [MCP](https://modelcontextprotocol.io) servers.
List them under `mcpServers` in `config.json` (`chibot config path` shows
where it is; [mcp.example.json](mcp.example.json) shows the format, which is
the usual one, so a snippet from an MCP server's docs fits as it is), then
**Reload** in Settings → Tools (or restart chibot). The file is readable only by
you, so a server's token or header can sit in it directly:

```json
{
  "mcpServers": {
    "files": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/Documents"]
    },
    "tracker": { "type": "remote", "url": "https://tracker.example/mcp" }
  }
}
```

In `config.json`, the `mcpServers` entry sits beside the other settings.

- A **`local`** server is a command chibot runs (`command`, `args`, `env`,
  `cwd`, by default your home folder) with your rights. It gets only a safe
  environment (`PATH`, `HOME`, …) plus its own `env`, never chibot's keys.
- A **`remote`** server is a URL (`url`, optional `headers`). If it needs
  signing in, Settings → Tools shows **Sign in**, which opens its provider's
  page and comes back to chibot (sign in on the machine running chibot).
  Tokens are kept in `mcp-auth.json` in the data folder, readable only by you; **Sign out**
  removes them. A server with its own `Authorization` header doesn't sign in.
- `${VAR}` anywhere is filled from the environment, then from the `env` block of
  `config.json`, to keep a token out of a server's definition. Set one with
  `chibot config set env.GITHUB_TOKEN <token>` (an empty value removes it;
  `chibot config show` lists the names, not the values). **Reload** re-reads
  `config.json`, so a changed block or server list applies; a variable
  exported in your shell needs a restart. Variable names use letters, digits and
  `_`.

**Settings → Tools → Add server** does the same without editing the file: start
from a preset (web pages, Brave web search, files in a folder) or fill in a
command or URL, and **Edit** or **Remove** a server later. Keys go in the
*Environment variables* (local) or *Headers* (remote) rows: they are written to the
file and never shown again, and a blank value keeps the saved one (so keep keys
out of the arguments and URL, which are shown). A server's definition is saved
to `config.json`. This is on
only while chibot listens on this machine or `CHIBOT_TOKEN` is set, since a
`local` server runs a command; otherwise Settings says why and the file is
the only way.

**The switches in Settings → Tools are written to the server's entry in the
file:** a server is on unless its entry says `"enabled": false`, which switching it off adds; **Ask before using its
tools** adds `"ask": true`, and switching off a tool adds its name (as the
server gives it, without the `<server>__` prefix) to `"disabledTools"`. An
entry holds only what differs from the default, so switching back removes the
key, and you can set the same keys by hand, then **Reload**. Switches work
whether or not Settings may add servers, since nothing there runs a command.

**chibot's own tools** (image creation, memory, search in chats and files) are
switched the same way: the names of those that are off are the top-level
`"disabledTools"` list in `config.json`, written by Settings → Tools and by
Settings → Personalization's memory switch, and read again at each use, so a
hand edit applies without a restart. The rest of Settings (models, instructions, long chats) stays
in chibot's database, since it isn't about how chibot starts.

Their tools are offered
as `<server>__<tool>` and run without asking first, so add only servers you
trust, or switch on **Ask before using its tools** for a server in Settings →
Tools (worth it for one that can run commands or change files). Like web
pages, a server's output can't change memories without asking. A file with
mistakes is reported at startup, and chibot runs without MCP.

## Running

**Development** runs the API server (restarts on change) and the Vite dev
server (hot reload) together:

```bash
pnpm dev
```

Then open http://127.0.0.1:5173. The API runs on port 3000 in development,
whatever `PORT` is set to.

**Production** builds the web app once and serves everything from one port:

```bash
pnpm build
```

```bash
pnpm start
```

It opens http://127.0.0.1:3000 in your default browser. With `chibot` linked
(see [Setup](#setup)), `chibot` does the same from any folder, and
`chibot --port 8080` picks another port. `chibot --no-open` leaves the browser
alone. It also stays closed when chibot isn't started from a terminal (a
service, CI, output sent to a file), over SSH, and when a token is set (the
address needs it, and a secret doesn't belong in a command line or the browser's
history: open `?token=…` once yourself, as chibot says).

**As an app:** chibot has a web manifest and icons, so a browser can install
it (Chrome and Edge: the install button in the address bar; Safari: Share →
Add to Dock or Home Screen). It then opens in a window of its own. It still
needs the server running: there is no offline mode, since the server is local.

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
- While an answer streams, type the next message and press **Enter** to
  **queue** it (text only, no attachments): it appears in a **Queued** row
  above the message box and is sent once the answer is saved — or as soon as
  you **Stop** it. Edit or cancel it from that row. Switching chats drops it.
- Scroll up to read while an answer streams and the view stays put; the ↓
  button above the message box jumps back to the latest message.
- The first message gives the chat its own URL (`/c/…`). Reloading reopens it.
- **Sidebar:** chats are grouped as Pinned, Today, Yesterday, Previous 7 days,
  Previous 30 days, then by month. Each gets a short title once its first
  answer arrives. Hover a chat and click **…** to rename it, have the model
  **regenerate its title** (replacing any name you typed), pin, archive or
  delete it. The panel button collapses the sidebar to an icon rail, which is
  remembered. On a phone the sidebar slides over the chat: open it with the
  panel button at the top left.
- **Search chats** finds chats by title or message text, including archived
  ones. Press Enter to open the top result.
- **Model:** click the model name at the top to pick another chat model
  (searchable; embedding, image and speech models are left out; type a name
  if yours isn't listed or your server can't list its models). Each answer shows the
  model that wrote it, so switching models and regenerating compares them.
- **Skills:** add a folder with a `SKILL.md` (the [Agent Skills](https://agentskills.io/specification)
  format: a YAML header with a `name` that matches the folder and a
  `description` saying what it does and when to use it, then the
  instructions) to the `skills` folder beside `config.json`
  (`~/.config/chibot/skills`; Settings → Tools shows the exact path, lists
  the skills with a switch each and their whole description when opened, and
  says why a folder was left out; the folder's row has buttons to copy its
  path and to refresh). The model sees each skill's description (every request
  carries the list, so the descriptions share a budget: 400 characters each
  for a few skills, down to 120 for many, and at most 50 skills are listed;
  switch off the ones you don't need) and, when a request matches one, reads it with the
  **Use skills** tool, plus any reference files it names. A skill found
  elsewhere can be used with a link, for example
  `ln -s ~/.claude/skills/<name> ~/.config/chibot/skills/<name>`. Skills are
  read at each use, so adding one needs no restart. chibot can't run a
  skill's scripts, so only skills that work from their written steps do.
- **Tools:** the model uses chibot's tools on its own when they help, and the
  answer shows what it did ("Created an image", "Memory updated"; several
  calls share one row, which opens to each; open one to see the details):
  - **Web search and reading pages** come from an MCP server (chibot ships
    neither): add one, such as a search server and a page-reading one, under
    `mcpServers` (see [MCP servers](#mcp-servers)). They run outside chibot, so
    its refusal of addresses on this machine or your network does not apply to
    them; switch on **Ask before using its tools** for such a server, which
    also covers a page telling the model to fetch an address that carries your
    data.
  - **Images:** ask for a picture, then for changes ("make it bluer"). Click an
    image (or an attached photo) to see it full size over the chat, with
    Download; ⌘/Ctrl-click opens it in a new tab. They're kept with the chat, and
    deleted with it.
  - **Memory:** chibot remembers lasting facts and preferences you share
    ("remember that…", or things like "I'm vegetarian") and uses them in new
    chats; the answer says "Memory updated". Ask it to change or forget
    something, or edit or delete memories in Settings → Personalization →
    Memory (which shows how many of the 100 are used). It won't save the same
    fact twice, and merges related ones when the list is nearly full. In a
    chat that used an MCP tool or searched your chats (text from others),
    memory changes ask first, so it can't plant one.
  - **Images and media from other sites** in an answer (`![](https://…)`, or a
    link to a sound or video) are fetched by chibot's server, never by your
    browser. One whose address you wrote or a tool returned, exactly, shows by
    itself (a sound or video gets a player with seeking). Any other shows a line
    with the site's name and **Load** (or **Open**), because the model could
    have added your data to its address (`…/c?d=<your chat>`), which a planted
    page can make it do. Only PNG, JPEG, GIF and WebP images, common audio and
    MP4/WebM/Ogg video are shown (never SVG), up to 20 MB (images), 100 MB
    (sound) or 500 MB (video), and never addresses on this machine or your
    network.
  - **Past chats:** ask about something you discussed before ("what did we
    decide about…?"). chibot searches your other chats (on this machine) and
    links the ones it used under **Sources**.
  - **MCP servers' tools** (see [MCP servers](#mcp-servers)): shown as
    "Used read_file · files", with the arguments and result. Images they
    return appear in the answer and are kept with the chat. **Stop** cancels
    a call; calls time out after a minute.

  The composer's **+** menu also makes the next message use **Create an image**; one that isn't set up or is switched off shows
  greyed out with the reason. Tools with side effects (none ship yet) ask first:
  **Approve** or **Deny**, or send a new message to deny. Models also know
  today's date and the time to the quarter hour.
- **Projects** (sidebar → **New project**) group chats with their own files
  and instructions. On a project's page, add files (PDF, Word, text, notes,
  code, data, including `Dockerfile`-style names; pick or drop them) or a whole folder, or write a note, or **mirror a folder** (files that come from folders are listed as a tree: folders open and close, **Expand all** and **Collapse all** do every one at once; the **Files** heading opens and closes the whole list, which starts closed) on this machine by its path (`~/notes` works, or **Browse** in the dialog to walk this machine's folders and pick one): the project's files then follow it, indexing only what changed, while chibot runs, and also when the page opens or you press **Sync now**, for folders that can't be watched, such as some network drives (files added by hand stay; **Stop mirroring** keeps the files; **Sync now** says which files it left out and why, such as types a project can't read, files over 50 MB, links or a file it can't read; hidden files and folders such as `.git` or `.obsidian`, and folders such as `node_modules`, `vendor` or `dist`, are always skipped without comment), retry a file that failed (a file already in the project is refused), and write instructions (preview first; **Suggest from files** drafts them with your chat model from the start of each file, for you to check); chats started there
  search the files (by keywords, and by meaning with an embedding model),
  read a whole file when asked about all of it, cite them under **Sources**,
  and follow the instructions. Their "search past chats" looks in the
  project's chats only. Project chats are listed
  on their project's page; a chat's **…** menu moves it into a project or out.
  Edit a project's name and one-line description, or delete it, from **…** next to its name; deleting it deletes
  its chats and files.
- **Voice input:** click the mic, speak, click again: the text appears at the
  cursor to check before sending. It needs a transcription model (see
  `OPENAI_TRANSCRIBE_*`); without one the mic is greyed out and says so.
- **Attachments:** **+** → **Add photos & files**, or paste or drop them onto
  the chat: images (PNG, JPEG, WebP, GIF) and the document types projects
  take. **+** → **Take a photo** opens the device's camera in a preview;
  nothing is captured until you click **Take photo**, and the picture is
  attached like any other image (the browser allows cameras on localhost and
  HTTPS only). A message can be just files, with no text. Sending while they upload
  sends it once they're up; editing a message keeps them.
- **Thinking:** reasoning models show "Thinking…" while they think; afterwards
  the answer keeps a collapsed **Thoughts** section with their summary. The
  composer's reasoning effort chip picks **Auto** (the model's default) or a
  level from Minimal to Max (also in Settings → Model).
- **Settings** (sidebar gear, or ⌘/Ctrl+,):
  - *General:* theme (System, Light or Dark), and **Notify me about
    finished answers**: a browser notification when an answer finishes or a tool needs your
    approval while chibot is in the background. Either way the page title gets a
    "•" until you are back.
  - *Personalization:* what chibot should know about you, and how it should
    respond. Sent with every message. **Memory**: turn it off, or edit and
    delete what chibot remembers.
  - *Model:* reasoning effort, and long chats: the context window of your
    model (32,000 tokens unless you set it; **Use N** appears when the server
    reports one; for Ollama no more than its
    `num_ctx`), when to summarize (75 % of it), the reserve kept free and how
    much of the newest messages stays word for word, and optionally a smaller
    model on the same server to write the summaries. The chat's own model
    writes the summary, on any server; a divider marks the spot and opens to
    it, with **Undo**.
  - *Tools:* switch each tool on or off, grouped (the web, images, your chats
    and files), each saying what it does and what leaves this machine. Tools that aren't set up are listed greyed out, with what to set. Below, **Reload** re-reads `mcp.json`, then each MCP server: a
    switch (off stops it), its status or error, **Reconnect**, **Sign in** /
    **Sign out**, **Ask before using its tools**, and a switch per tool.
  - *Data:* import a chat from a JSON export, and archived chats to restore or
    delete.
- **Export** a chat from its **…** menu as Markdown (what's shown, with
  attachment names) or JSON (every version, with its attachments and images,
  for importing later; up to 200 MB).
- **Backup and restore:** `chibot backup [folder]` copies every chat, file,
  memory and project (the database, as a consistent snapshot, so chibot may
  be running, plus the stored files) into a new folder, and `chibot restore
  <folder>` puts it back while chibot is stopped. Data already there is an
  error unless you add `--replace`, which moves it into a `before-restore-…`
  folder instead of deleting it. `config.json` (keys, MCP servers) and MCP
  sign-ins are not copied, so a backup carries no secrets; back up
  `chibot config path`'s settings file yourself if you want it. A backup from
  a newer chibot is refused. Settings → Data shows the command.
- **Temporary chat:** on a new chat, turn on the dashed-bubble toggle (top
  right). That chat isn't listed, titled or searchable, doesn't use memory or
  past chats, and it's deleted as soon as you leave it.
- **Edit** a message (hover it, then the pencil) or **regenerate** an answer
  (the circular arrow). Either makes a new version; `< 2/3 >` switches
  between them, and each version keeps its own follow-up messages.
- **Branch in new chat** (the branching arrows under an answer) copies the chat
  up to the end of that turn into a new chat, titled "Branch · …", to try
  another direction without touching the original. Summaries and the files its
  messages use are copied too, so deleting either chat leaves the other whole.
  Not offered in a temporary chat.
- **Quote:** select text in an answer or message and click **Quote** beside it:
  it is added to the message box as a block quote, under what you have
  written, to ask about that part.
- **Copy** buttons sit under messages and answers, and on code blocks.
- **Context usage:** each answer shows the context it sent against the
  window (e.g. `12.4K / 32K context`), turning red once it reaches where
  earlier messages are summarized; hover for the input/output breakdown.
  The **Compact now** icon under the latest answer summarizes at once, optionally
  keeping something in mind. The top right shows the chat's token total across
  all versions.
- **Right to left:** Urdu, Arabic, Hebrew and other right-to-left text is
  laid out right to left, per paragraph and per title, as you type and in
  answers, with English and code beside it left to right.
- **Keyboard shortcuts:** ⌘/Ctrl+/ (or **Keyboard shortcuts** in the sidebar)
  lists them: new chat, search, toggle sidebar, focus the message box, copy
  the last answer, ⌘/Ctrl+Shift+M to start and stop dictation, Esc to stop,
  and ↑ in an empty message box to edit your last message.
- If the model server reports an error (e.g. a bad API key), it's shown with
  its status and request id. Your message is kept. A 429 says which kind it
  is: you've used up the provider's plan (pick another model, or add credits),
  or the server is only limiting requests for now (wait, with the time the
  server gave).

## Other scripts

| Script | Does |
|---|---|
| `pnpm test` | Run the unit tests |
| `pnpm test:e2e` | Run the browser tests (first run: `pnpm exec playwright install chromium`) |
| `pnpm typecheck` | Type-check server, tests and web |
| `pnpm format` | Format with prettier |
| `pnpm release patch` | Bump the version, move the CHANGELOG's Unreleased entries, run the checks, commit and tag it (`minor`, `major` or `X.Y.Z` too; `--e2e` adds the browser tests) |

Developer conventions are in [AGENTS.md](AGENTS.md), with [TOOLS.md](TOOLS.md)
for adding a tool and [TESTING.md](TESTING.md) for tests.

## License

MIT
