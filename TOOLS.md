# Adding a tool

How to add a function tool to chibot. Part of the developer guide ([AGENTS.md](AGENTS.md)).

1. Subclass `Tool` in `src/server/tools/<name>.ts`: a `name`, a `label` for
   Settings, a `description` that tells the model when to use it, zod
   `parameters` (sent as a strict JSON Schema, so every field is required;
   use `.nullable()` for optional ones), and `run(args, context)` returning
   the text the model sees. `context` has the `conversationId` (e.g. to keep
   files with the chat in `FileStore`) and the stop `signal`. Return JSON when
   the web app reads the output too (as for sources and images).
2. Say how the interface should present it; the web app keeps no per-tool
   text, it reads `Tool.info` from `GET /api/tools`: a `group` (Settings
   section, see `TOOL_GROUPS` in `src/shared/tools.ts`), a `summary` (what it
   does and what leaves the machine, in the user's words), `running` and
   `done` (what an answer says: "Searching the web…" / "Searched the web"),
   and, to offer it in the composer's "+" menu, a `chip`. A shipped tool that
   leaves these out fails `tests/server/tool-info.test.ts`.
3. Set `override readonly requiresApproval = true` if it has side effects
   (sends, writes, deletes, spends): the turn then waits for Approve / Deny.
   Use `'after-untrusted'` to ask only in chats that hold untrusted content
   (like `memory`), and mark tools whose output carries others' text
   (pages, search results, your old chats) `untrustedOutput = true`; an
   `'after-untrusted'` tool asks on every call once the chat holds such text. A tool that
   asks only for some calls (the MCP resource tools, for a server set to ask first)
   overrides `asksFor(args)`. Tools that read or keep
   the user's history override `offeredIn(conversation)` to leave out
   temporary chats, and a tool can add to the chat's instructions while
   offered by overriding `instructions()`.
4. Throw for errors: `ToolRegistry` returns `Error: …` to the model, as it
   does for invalid arguments. Honour `signal` for anything slow.
5. Add it to `defaultTools()` (`main.ts`). A tool that needs setup (keys,
   endpoints, from `Config`) is always added, given `null` for what's
   missing, and overrides `unavailable()` to say what to set: Settings lists
   it with that hint and it's never offered to the model (see `generate_image`).
   Take collaborators (clients, `FileStore`) in the constructor, and test
   `run` directly, like `tests/server/memory.test.ts`.
6. Anything that reaches the network on the model's behalf must refuse private
   addresses (`MediaProxy` does, for linked images and media; web search and
   reading pages are MCP servers' job, not chibot's, and run outside this
   guard).
