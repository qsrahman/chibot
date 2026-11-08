# Testing

How chibot is tested and how to add tests. Part of the developer guide ([AGENTS.md](AGENTS.md)).

- Every phase adds tests for what it adds. Run `pnpm test` before committing.
- Routes: test through `testApp(deps).request(...)` (`tests/server/fakes.ts`),
  which builds `createApp` with fakes for every dependency you don't pass.
- OpenAI: pass a fake client whose `responses.create` returns an async
  generator of `ResponseStreamEvent`s. Tests never hit the network.
  `testChat(events, { store, calls, tools, … })` builds a `ChatService` on
  such a fake with default stores and settings.
- Retrieval: `tests/server/retrieval.test.ts` scores project search on a
  small corpus (`tests/fixtures/retrieval`); run it before and after changing
  chunking or ranking, and add a question when search misses one. With an
  embedding endpoint (`RETRIEVAL_EMBEDDING_URL`, `RETRIEVAL_EMBEDDING_MODEL`,
  e.g. Ollama's `nomic-embed-text-v2-moe`) it also scores keyword against
  hybrid search, on questions that repeat the passage's words, on paraphrases
  and on a held-out set of paraphrases, and compares ways of merging the two
  searches (`RETRIEVAL_QUERY_PREFIX` and `RETRIEVAL_DOCUMENT_PREFIX` add a
  model's task prefixes); that part is skipped otherwise. Choose on the first
  two sets and confirm on the held-out one: they have 41 questions between
  them, so a difference of one or two is noise.
- Prompt injection: `tests/server/chat/injection.test.ts` asks a real model to
  summarize a poisoned page with chibot's own instructions and tools, and
  counts how often it obeys; run it when changing the untrusted-content
  wording (`INJECTION_URL`, `INJECTION_MODELS`; skipped otherwise).
- SQLite: use `':memory:'` databases.
- Web: no component unit tests; pure helpers (e.g. `chat/turns.ts`, `chat/usage.ts`)
  get vitest tests. UI behaviour is covered by Playwright specs in
  `tests/e2e/`, which drive a production build with the real SDK pointed at
  `tests/e2e/fake-openai.ts` via `OPENAI_BASE_URL`. The fake answers
  `Answer #n to: <question>`; a question containing "slow" streams a long
  answer slowly, "drip" a normal one slowly (to queue a message while it
  streams), "think" adds a reasoning summary, "huge" a reported context past the trigger (so the next message is
  summarized first, and "fail-summary" makes that summary fail),
  and a question's words call a tool ("approve", "draw", "mcp echo <text>", …:
  the `TRIGGERS` table in the file lists them, and a new tool needs one row
  there). It also fakes the images API, embeddings, transcription
  (`/debug/last-transcription`) and a Files API (`/debug/files`,
  `/debug/forget-files`; unknown file ids get a 404), and serves a test page;
  the model `e2e-other` refuses `input_file` parts, as Ollama does. Chromium
  runs with a fake microphone and camera. `/debug/last-request` and `/debug/requests`
  show what chibot sent. Shared steps live in `tests/e2e/helpers.ts` (`send`,
  `answered`, `appReady`, `lastRequest`, `resetSettings`, …). Wait for the app
  (e.g. a focused composer, or the empty new-chat page) before typing or
  pressing shortcuts, and for `answered` before copying. Specs that change
  settings reset them afterwards (`resetSettings` restores the server's
  defaults, so a new setting needs no change there). `contrast.spec.ts` runs
  axe over the main screens in both colour schemes; a new screen, dialog or
  colour belongs in it. First run:
  `pnpm exec playwright install chromium`.

## Performance

Measure before optimizing. `pnpm seed:perf --data <folder>` fills a scratch data
folder with 300 small chats and one long chat (500 turns, each with a tool
result of 20,000 characters, by default; it refuses your real data folder).
Start chibot on it (`CHIBOT_DATA_DIR=<folder> OPENAI_API_KEY=x chibot --port
4177`), then `pnpm measure:chat --port 4177 --turns 500 [--throttle 6]` opens the
chat in Chromium and prints the time to open it, DOM size, heap, how smooth
scrolling is and what a keystroke costs. `--throttle 6` makes the CPU six times
slower, about a low-end phone.

Baseline (2026-11, an Apple Silicon laptop, Chromium):

| | 300 turns, 800-character results | 500 turns, 20,000-character results (10.5 MB) |
|---|---|---|
| Open, last turn on screen | 252 ms (891 ms at 6× slower) | 326 ms (1,163 ms at 6× slower) |
| DOM nodes · JS heap | 64k · 38 MB | 97k · 137 MB |
| Scrolling, worst frame | 36 ms (146 ms at 6×) | 58 ms (223 ms at 6×) |
| A keystroke to the next frame | 33 ms (nothing slower than the display) | 33 ms |

So windowing, paging older turns or `content-visibility` are not needed at these
sizes; revisit them if a chat past a couple of thousand turns, or a slower
device, shows long frames here. The sidebar lists the 200 newest chats; older
ones are reached by search.

