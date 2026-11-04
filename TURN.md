# How a turn flows

What happens from pressing Send to the answer on screen. Read this with
[AGENTS.md](AGENTS.md) (conventions) and [PLAN.md](PLAN.md) §3 (the history
tree). Names below are the real ones; follow them with a search.

```
browser                         server
───────                         ──────
Composer.submit
 └ useChat.send / edit / …
    └ run()  ── POST /api/conversations/:id/turns ──▶ app.ts middleware
                                                      routes/conversations.ts
                                                       └ refuseTurn
                                                       └ ChatService.runTurn
                                                          ├ #startTurn  save the message
                                                          ├ #planTurn   settings, tools, instructions
                                                          └ loop (≤ MAX_STEPS):
                                                              #runCalls  run tools, save outputs
                                                              #respond   one streamed request, save it
                                                              approval needed? → chibot.approval, stop
                                                          title if new → chibot.title
    ◀──────────── SSE events (the SDK's, and chibot.*) ──────────────┘
 show pending turn, then re-read the chat (getConversation → toTurns)
```

## 1. The request

`useChat.run` (`src/web/useChat.ts`) posts a `TurnRequest` (`src/shared`,
`turnRequestSchema`) through `streamTurn` (`api.ts`) and reads the response as
server-sent events. One shape per intent:

| Intent | Body |
| --- | --- |
| New message | `{ text, fileIds?, tool? }` (follows the current leaf) |
| Edit a message | `{ text, parentId }` (a new sibling: a version) |
| Regenerate | `{ parentId }` (answers that user message again) |
| Approve or deny waiting tool calls | `{ approvals }` |

`parentId` is what makes the history a tree: every item has a parent, and the
chat's `currentLeafId` says which branch is on screen.

## 2. The door

`createApp` (`app.ts`) runs, in order: the host check (only this machine's
names, against DNS rebinding), the `CHIBOT_TOKEN` check when set, and CSRF for
browser form posts. Then `routes/conversations.ts` validates the body with zod
(`json(turnRequestSchema)`) and asks `refuseTurn` (`turn-request.ts`): files
that can be attached here, an approval with calls actually waiting, and a
`parentId` where a message or answer may follow. A refusal is a 4xx before
anything is saved. Otherwise the route links the uploads to the chat and
streams `chat.runTurn(...)` as SSE, passing the request's `AbortSignal`.

## 3. The turn (`ChatService`)

`runTurn` first waits (up to 5 s) for the chat's previous turn to finish
unwinding, so a message sent right after Stop follows the partial answer that
turn is about to save. Then `#runTurn`:

1. **`#startTurn`** saves the user's message as a child of `parentId` (or the
   current leaf). Any tool calls still waiting for approval get
   `TOOL_DENIED` outputs first: sending a new message denies them. For an
   approval request nothing is saved; the waiting calls are the work.
2. **`#planTurn`** reads the settings and tools *as they are now* and builds a
   `TurnPlan`: the model and effort; the offered tools (`unavailable()` is
   `null`, not switched off in Settings, `offeredIn(conversation)`); the
   instructions (`chatInstructions` in `prompts.ts`: identity, rules, user
   profile, style, project, what each tool adds, the time last, for prompt
   caching); and the tool the user picked, forced on the first request only.
3. **The loop**, at most `MAX_STEPS` (10) requests:
   - **`#runCalls`** runs the calls the last response made and saves their
     outputs (`chibot.tool_output`). A call that needs approval runs only if
     `approvals` says yes; otherwise its output is `TOOL_DENIED`.
   - **`#respond`** makes one streamed request (below), saves the response,
     and returns its output.
   - If the output has no tool calls, the turn is over. If some need approval
     (`ToolRegistry.needsApproval`), the turn ends with `chibot.approval`; the
     browser asks, and the answer comes back as a new `{ approvals }` turn.
     The pending approval is just the history ending in unanswered calls, so
     it survives a reload.
   - On the last step `tool_choice: 'none'` makes the model answer.
4. **Title.** Once everything is saved (`saved()` releases the next turn), a
   saved chat without a title gets one (`TitleWriter.ifNew`, `chibot.title`).

## 4. One request to the model (`#respond`)

- **Input** is the path from the root to the leaf (`#history`), starting at the
  last compaction item if there is one (`fromLastCompaction`). The history in
  SQLite is the source of truth: requests are `store: false`, with
  `include: ['reasoning.encrypted_content']` so reasoning can be replayed.
- **The request itself** goes through `ModelRequests.stream` (`model-requests.ts`),
  which makes it work with what the endpoint supports. Attachments are resolved
  just before sending: files as the provider's file ids, or as text for models
  that refuse them. Optional features (reasoning effort, compaction) are
  retried without where a server answers 400, and remembered.
- **Saved before relayed.** The response is appended to the tree *before*
  its `response.completed` is yielded, so a client that sees it can re-read the
  chat. If the stream ends any other way (Stop, disconnect, error), the text
  so far is saved as a partial assistant message, so the history stays valid.

## 5. Tools (`ToolRegistry`)

`ToolRegistry.run` never throws: an unknown or switched-off tool, bad
arguments, or an error in the tool become an `Error: …` output the model can
react to, and a stop becomes `TOOL_STOPPED`. Approval is a property of the
tool (`requiresApproval`: `true`, or `'after-untrusted'`, which asks only once
the chat holds output of a tool marked `untrustedOutput`). MCP servers' tools
join the registry per turn as `McpTool`s. See "Adding a tool" in AGENTS.md.

## 6. Events

The browser gets the SDK's `ResponseStreamEvent`s unchanged, plus ours
(`src/shared/types.ts`): `chibot.tool_output`, `chibot.approval`,
`chibot.title`, `chibot.error`. A failure becomes `chibot.error` with the
provider's message (`explainApiError` says what a 429 means).

## 7. Back in the browser

`useChat.run` builds a *pending* turn from the events (answer text, reasoning
summary, tool calls and their outputs), shown in place of the turns it
replaces. On `response.completed` (the answer is saved) or `chibot.approval` it
re-reads the chat (`getConversation`) and shows it as `toTurns(items)`
(`turns.ts`), which also finds sources and waiting calls. Then:

- a message queued while the answer streamed is sent (`useQueue`, `drain`);
- Stop aborts the request, and the server keeps the partial answer;
- leaving the chat mid-answer counts as Stop; a run still going for another
  chat can't touch the screen (`runRef`).

## Where to look

| To change… | Start in |
| --- | --- |
| What the model is told | `prompts.ts`, and each tool's `description` / `instructions()` |
| Which tools are offered, and approval | `ChatService.#planTurn`, `ToolRegistry`, the `Tool` subclass |
| What a request may do | `turn-request.ts`, `requests.ts` |
| History shape, versions, usage | `ConversationStore` |
| What to do when an endpoint rejects a feature or file | `ModelRequests` |
| How chats are titled | `TitleWriter`, `TITLE_INSTRUCTIONS` |
| How a turn shows on screen | `useChat.ts`, `turns.ts`, `TurnView.tsx` |

To see what chibot sent in a test run, `GET /debug/last-request` on the fake
OpenAI server (`tests/e2e/fake-openai.ts`); in unit tests, `testChat(...)`
records the calls (`tests/server/fakes.ts`).
