# chibot — Design Guide

chibot's UI follows the look and feel of ChatGPT's web app: a calm,
near-monochrome, content-first chat with one rounded composer and a single blue
accent. This guide records what was measured on chatgpt.com (22 Oct 2026,
logged out, 1024×768) and how chibot applies it. It borrows **aesthetics
only**: no ChatGPT name, logo, icons or copy.

The tokens are CSS variables in
[`src/web/styles/base.css`](src/web/styles/base.css); the other files in
`src/web/styles/` hold one area each. Components use the variables, never raw
colours.

## 1. Principles

- **Content first.** No chrome around assistant answers: they're plain text on
  the page. Only the user's messages sit in a bubble.
- **Near-monochrome.** Greys, plus one blue accent for what's *yours* or
  *actionable*: your message bubbles, the send button, switches. Primary
  buttons in dialogs stay black/white. Red is only for errors.
- **Soft geometry.** Large radii everywhere: composer pill 28 px, cards 16 px,
  dialogs 20 px, rows and menu items 10 px.
- **One column.** The thread and composer share a centred column of at most
  48 rem (768 px).
- **Quiet until needed.** Secondary actions (copy, edit, regenerate) appear on
  hover or focus, and always for the last answer. On touch screens (no hover)
  they, a chat's "…" and image downloads are always shown.

## 2. Tokens

Measured on chatgpt.com: page, surfaces, text, muted text, borders, the blue
accent, bubble and inline-code colours, shadows, radii and sizes. Chosen by
chibot to fit: light-mode `--surface-muted` and `--chip`, and `--danger` in
both themes. The logged-out dark theme uses a pure black page, which chibot
follows; changing `--bg` switches to a dark-grey page.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#fcfcfc` | `#000000` | Page and sidebar (separated by `--border`) |
| `--surface` | `#ffffff` | `#212121` | Composer, cards |
| `--surface-raised` | `#ffffff` | `#303030` | Dialogs, menus, popovers |
| `--surface-muted` | `#f4f4f4` | `#303030` | Hover rows |
| `--bubble-bg` / `--bubble-fg` | `#f4f4f4` / `#0d0d0d` | `#303030` / `#ffffff` | User message bubble |
| `--code-chip` | `rgb(238 238 238 / 82%)` | `rgb(42 42 42 / 82%)` | Inline code |
| `--chip` | `#ececec` | `#414141` | Chips, and hover/selected rows inside menus and dialogs (where `--surface-muted` would match the raised background) |
| `--switch-track` | `#8a8a8a` | `#414141` | A switch's track when off; its white thumb is 3:1 or more on it |
| `--fg` | `#0d0d0d` | `#ffffff` | Text |
| `--fg-muted` | `#5d5d5d` | `#cdcdcd` | Descriptions, captions, footer, action icons, code labels |
| `--border` | `rgb(0 0 0 / 10%)` | `rgb(255 255 255 / 15%)` | Hairlines, composer outline |
| `--accent` / `--accent-fg` | `#3566f0` / `#fff` | `#3566f0` / `#fff` | Send button, switches (measured `oklch(0.56 0.21 265)`) |
| `--cite-bg` / `--cite-fg` | `#eef2ff` / `#2c52c8` | `#1f2b52` / `#b4c6ff` | Citation chips (text 6:1 or more on the tint and on `--surface-raised`) |
| `--button` / `--button-fg` | `#0d0d0d` / `#fff` | `#e8e8e8` / `#0d0d0d` | Primary buttons in dialogs |
| `--danger` | `#d93025` | `#ff6b6b` | Errors, destructive buttons |
| `--scrim` | `rgb(0 0 0 / 50%)` | same | Behind dialogs and the phone sidebar |


**Shadows.** In light mode the composer floats on a layered shadow:
`0 0 0 1px rgb(0 0 0/4%), 0 2px 8px rgb(0 0 0/4%), 0 4px 80px 8px rgb(0 0 0/2.4%)`.
Dark mode uses an inset hairline instead: `inset 0 0 1px rgb(255 255 255/20%)`.
Dialogs use `0 24px 64px rgb(0 0 0/22%), 0 4px 16px rgb(0 0 0/12%)`.

**Typography.** The system stack,
`ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif`.
Code uses `"SF Mono", SFMono-Regular, ui-monospace, Consolas, "Liberation Mono", Menlo, monospace`.

| Role | Size / line height | Weight |
|---|---|---|
| Body, user messages | 16 / 24 px | 400 |
| Assistant answers | 16 / 26 px, 16 px between blocks | 400 (bold 600) |
| Code (blocks and inline) | 16 / 26 px blocks; inline 0.93 em | 400; inline 500 |
| Code language label | 12 px, `--fg-muted` | 400 |
| Composer input | 17 / 24 px | 400 |
| Sidebar rows, settings labels | 14 / 20 px | 400 (labels 500) |
| Section headings | 16 px | 500 |
| Descriptions, footer | 12 / 16 px | 400 |
| Empty-state heading | 28 px | 400 |

## 3. Layout

```
┌──────────┬─────────────────────────────────────────────┐
│ sidebar  │ header: model name ▾                  …     │
│ 260 px   │                                             │
│          │        ┌─ thread, max 48rem ─┐              │
│          │        │        user bubble ▸│              │
│ New chat │        │ assistant text …    │              │
│ Search   │        └─────────────────────┘              │
│ Chats    │        ( + ) Ask anything      (↑)          │  ← composer pill
│ …        │        chibot can make mistakes. …          │  ← 12 px footer
└──────────┴─────────────────────────────────────────────┘
```

- **Empty state.** A heading ("What's on your mind?") with the composer
  directly below it, both vertically centred. After the first message the
  composer docks to the bottom and the thread scrolls above it.
- **Sidebar.** 260 px, with a hairline right border. Rows are 36 px
  tall, 8×10 px padding, 10 px radius, 6 px icon gap. The hover/active fill is
  `--surface-muted`. Groups have 12 px muted headings (Today, Yesterday, …).
  It collapses to a 56 px icon rail, and the collapsed state is remembered.
  Below 768 px (phones) it's a drawer instead: hidden by default, opened by a
  panel button at the header's left, `min(300px, 85vw)` wide over the chat
  with `--dialog-shadow` and a `--scrim` behind it; tapping the scrim,
  pressing Escape or opening a chat closes it. While it is open it acts as a
  dialog: the chat behind is `inert`, focus moves into it, and returns to the
  panel button on closing. User bubbles may then take 85 % of the width. The
  header then also shows the chat's title (500 weight, one line, ellipsis)
  after the panel button and any project breadcrumb, with the model name in
  `--fg-muted`; the header's token total is left to each answer.
- **Header.** Model name with a chevron on the left: the model picker, a
  popover with a search box over the model list (a name field when the
  server can't list models). Page actions sit on the right.

## 4. Components

**Composer.** A 28 px-radius pill on `--surface` with a `--border` outline,
7×10 px padding and 52 px tall when one line. The textarea grows up to 40 vh.
A round 36 px icon button on the right is **send** (blue `--accent`, arrow-up icon),
dimmed while the input is empty, and shows a spinning `LoaderCircle` while a
message waits for its attachments to upload. While an answer streams it becomes
**stop** (square icon); once there is text to send, a muted stop button sits
left of it and the primary button turns back into an arrow-up that **queues**
the message for after the answer. A "+" button sits on the left (attachments
and tools, see *Composer tools*); a 36 px `Mic` icon button sits left of send.
While recording it shows a stop square in `--danger`, then a spinning
`LoaderCircle` while transcribing. Without transcription it's dimmed to 40 %
(`aria-disabled`, so its tooltip still says why). Errors show in `--danger`
14 px text under the composer's row.

*Layout.* Two groups share the row with the message box: on the left the "+"
button and a chosen tool's chip, on the right the mode chip, mic, stop and
send, 4 px apart. Both groups, and the box, align to the bottom of the pill, so
they stay on its last row as the text grows. The box has flex basis 0: it
shares the row and wraps its text inside, never onto a row of its own (which
would leave the "+" alone above it). Below 768 px a chosen tool's chip and the
"+" take a row above the box, like attachments, because beside the buttons the
chip would leave the box a few pixels wide.

*Effort chip.* A transparent 36 px pill (12 px left, 10 px right padding) with
14 px `--fg` text, the reasoning effort (Auto, Minimal … Max) and a 16 px
`ChevronDown`; `--surface-muted` on hover. It opens a menu above it and sits
left of the mic.

**Project files.** A project's files whose names have folders are a tree
inside the files card: a folder is a 40 px row (a chevron that turns when open,
an 18 px `Folder` icon, its name, and at the right its file count in
`--fg-muted` 12 px, with "· n failed" in `--danger` and "· n indexing"),
closed to begin with; what is inside is indented 22 px, with the same rows as a
plain list (file icon, name, status, retry, remove). **Expand all** / **Collapse
all** is a muted text button above the list, at its right. A long status is cut
with an ellipsis, never wider than the card.

**Folder browser.** In the Mirror a folder dialog, **Browse** (a button beside
the path box) opens it below: a bar with Up and Home icon buttons and the
current path (wrapping, never wider than the dialog), a list of the folders
there (36 px rows, `--surface-muted` on hover, scrolling past 240 px), a muted
line naming the readable files in it, and a primary **Use this folder** at the
right, which fills the path box and closes it.

**Follow-ups.** Above the composer, a 12 px `--fg-muted` "Ask next" label over
wrapping 40 px pills (`--surface`, `--border` outline, `--surface-muted` on
hover, a 15 px muted `CornerDownRight`, text `dir="auto"`, one line with an
ellipsis). They show only after the newest answer finishes and nothing is
streaming or queued, and not for an answer that has a next-step card.

**Queued message.** A row above the text, like attachments: a 15 px muted
`Clock`, the label **Queued** (500 weight), the text in `--fg` on one
ellipsized line, then 24 px muted **Edit** (`Pencil`) and **Cancel** (`X`)
buttons. `--surface-muted` on hover.

**Attachments.** In the composer, a row above the text: images as 56 px
thumbnails (12 px radius), documents as file cards. A file card is a
`--border`-outlined 12 px-radius card up to 260 px wide: a 40 px `--accent`
square with a `FileText` icon, then the name (500 weight, ellipsized) over the
type ("PDF") in `--fg-muted`, or the error in `--danger` with a `--danger`
outline. A spinning `LoaderCircle` covers a chip while it uploads (dimmed), and
a 20 px round `--button` × sits on its top-right corner. In a sent message the
same thumbnails (up to 240 px, 16 px radius) and cards sit right-aligned above
the bubble. Dragging files over the chat (not text or links) covers it with a
2 px dashed `--accent` outline inset 8 px and a centred 16 px-radius
`--surface-raised` card (`--border`, `--dialog-shadow`): an `Upload` icon in
`--accent`, "Add anything", and what's accepted in `--fg-muted`. It fades in
over 150 ms (not under reduced motion), ignores the pointer and is `aria-hidden`.
It clears on drop, leave and Escape.

**Effort switch.** Left of the mic: a 36 px pill showing the reasoning effort
("Auto", "Minimal" … "Max") in `--fg-muted` 14 px text with a chevron,
`--surface-muted` on hover. It opens an upward menu of Auto and the levels
(not None), each a name over a muted hint, with a check on the current one.
The model menu has no effort.

**Jump to latest.** While the message list is scrolled up, a 36 px round
`ArrowDown` button (`--surface-raised`, `--border` outline, `--composer-shadow`)
sticks 12 px above the list's bottom, centred over the composer.

**Messages.**
- *User:* right-aligned bubble with `--bubble-bg` and `--bubble-fg` text,
  22 px radius, 10×16 px padding, max 70 % width, `white-space: pre-wrap`.
  On hover, **Copy**, **Edit** and (when edited) `< 2/3 >` appear below it,
  right-aligned. Edit opens an inline box (`--surface-muted`, bubble radius)
  with Cancel and a primary Send.
- *Assistant:* full-width Markdown with no background, 16/26 px text, 16 px
  between blocks.
- *Action rows.* 32 px icon buttons with 18 px icons, muted
  (`--fg-muted`), 2 px apart, 8 px radius hover fill, directly under the
  answer (ChatGPT uses a 44 px hit area and 20 px icons; chibot is a little
  denser):
  - Assistant: **Copy**, then **Regenerate**, **Branch in new chat** (`GitBranch`), version switcher `< 2/3 >` and
    context usage. These show on hover and always on the latest answer. On a
    narrow screen (44 px touch buttons) the row wraps between items; a label
    never breaks inside its words, and a long model name is cut with an ellipsis.
    Context usage is 12 px tabular muted text (`12.4K / 64K context`, or
    `12.4K context` with compaction off), with the full input/output count in
    its tooltip. At 80 % of the compaction threshold it turns `--danger` at
    500 weight — the one place besides errors that colour is used — because
    older messages will be summarized next.
- *Failed answer:* under the turn, a 12 px-radius `--surface-muted` banner
  with a `--danger` alert icon, "The answer stopped unexpectedly." in body
  colour, the provider's message under it in 12 px `--fg-muted`, and a
  **Retry** button (the same request as Regenerate). It is a `role="alert"`
  region, and the composer takes focus back.
- *Thinking:* a pulsing dot before the first token arrives.

**Code blocks.** No box: no background, border or radius, just like the text
around them.
- The language name sits above the code in a 12 px muted label.
- Code is 16/26 px monospace.
- **Copy code** sits at the right of the label row (ChatGPT floats it at the
  block's top right).

**Tables.** A `--border` box with the 16 px card radius that scrolls sideways
and (past 28 rem) up and down on its own, never the page. A bar on top has a
12 px muted "Table" label and two 32 px icon buttons at the right: **Copy
table** (tab-separated, so it pastes into spreadsheet cells) and **Download
CSV**. The header row sticks under it on `--surface-muted`, in 12 px 600
`--fg-muted` labels; body rows are 14 px with hairline `--border` dividers and
`--row-stripe` on every second row. Cells keep `dir="auto"`.

**Quotes.** A 2 px `--border` rule on the left with 12 px padding (the same
rule as an opened Thoughts), body colour, 16 px block spacing.

**Inline code.** `--code-chip` background, 4 px radius, 1×4 px padding,
0.93 em monospace, weight 500.

**Menus and popovers** (native Popover API). `--surface-raised`, 16 px radius,
6 px padding and the dialog shadow. Items are 36 px rows with an icon and a
label, 10 px radius, and a `--surface-muted` hover. Groups are separated by
hairlines, with optional 12 px muted section labels. A menu opens with focus on
its first item; ↑ / ↓ move between items (wrapping), Home / End jump to the
ends, and Esc closes it, returning focus to its button.

**Dialogs** (native `<dialog>`). `--surface-raised`, 20 px radius, width
`min(100% - 32px, 448px)`, dialog shadow and a dimmed backdrop. Layout:
title (18 px, 500), body (14 px muted), then right-aligned buttons. Buttons are
pill-shaped: primary is `--button`, secondary is outlined, destructive is
`--danger`. Used for confirmations such as "Delete chat?".

**Settings.** A large dialog (max 760 px), anchored 10 vh from the top
with a panel of one height on every tab (`min(70vh, 560px)`, scrolling past
it), so switching tabs never resizes it. Below
768 px the tabs become a scrolling row above the content, scrolled to the
current tab. A vertical tab list on
the left (General, Personalization, Model, Tools, Data; the current tab
uses `--chip`) and content on the right. Content is
grouped as section heading (16 px, 500) + card (`--surface`, 16 px radius,
hairline border). A card holds rows: 52 px tall, 0×16 px padding, a 14 px/500
label (with an optional 12 px muted description) on the left, and the control
on the right: a select showing its value and a chevron, or a 32×20 px switch
(`--accent` when on).
Hairline dividers separate rows. The Tools tab groups tools into sections (The
web, Images, Your chats and files, then Other; the switch for skills heads the Skills section below them), each row with a
one-line description that says what leaves the machine; a tool that isn't set
up stays listed with its label in `--fg-muted`, its setup hint as the
description and its switch disabled at 40 % opacity. Below them, an "MCP
servers" section with one row, "Servers" with **Add** and **Reload** buttons, then a
section per server ("MCP · files"): a first row for the server ("Local server"
/ "Remote server", its status or error as the description, then Sign in
(primary), Sign out, Reconnect and its switch on the right), a row "Ask before
using its tools" with a switch, then a row per tool with its title, the
server's description (cut at three lines) and a switch.

**Disclosures** (Thinking, tool calls, Sources) replace the browser's
triangle with a 16 px `ChevronRight` before the label, turned 90° when open
(150 ms; none with reduced motion). The shimmer applies to the label only.

**Thinking.** Above an answer, a native `<details>` in 14 px muted text:
"Thinking…" with a shimmer while the summary streams, "Thoughts" once the
answer starts. Opened, the summary sits behind a 2 px `--border` rule.

**Tool calls.** Several calls in one answer sit in one collapsed group, a
`<details>` labelled with what they did ("Searched the web, Memory updated";
repeats listed once, so a memory change stays visible) or, while one runs, its
live label; opened, its body (behind the same 2 px rule) lists each call. A
single call isn't grouped. Each call is, like Thinking, a `<details>` in 14 px
muted text above the answer: "Reading a page…" with the shimmer while a tool
runs, "Read a page" afterwards. Opened, it says what the tool did in plain
terms: what it was asked (the query, page or prompt, in `--fg`), a short
result or error, and what it found as source links (title and domain, as in
Sources). A nested "Raw" disclosure holds Arguments (indented JSON) and Result
in 13 px monospace blocks on `--surface-muted` (10 px radius); tools without a
plain summary show those directly. An MCP server's tool reads "Used echo ·
fixture" (tool, then server).

**Approval card.** In place of the answer's actions while tool calls wait: a
card (`--surface`, hairline border, 16 px radius, 16 px padding) with a 15 px
title "chibot wants to use <tool>" and a `Wrench` icon, each call's arguments,
a 13 px muted hint that a new message denies it, and Deny (secondary) /
Approve (primary) at the bottom right.

**Next-step card.** Under the latest answer only, when nothing streams or waits
in the queue, and until the next message, edit, regenerate or branch switch: a
card like the approval card (`--surface`, hairline border, 16 px radius) in one
row, 12 px × 14 px padding and 14 px gaps: a 40 px icon tile (12 px radius,
`--accent-tile` with `--accent-tile-fg`, a `Sparkles` icon), a 15 px title in
weight 500 over a 13 px `--fg-muted` line "Next step · <what happens>", and
the primary pill button (`--button`) at the right. Everything is the model's
text and shown as text (`dir="auto"`, long words wrap). Under 480 px the button
drops under the text, full width.

**Composer tools.** A 24 px `Plus` button at the composer's left opens a menu
above it (Add photos & files, then Create an image).
"Add photos & files" has a muted hint line ("Images, PDF, Word, text and
code"); a tool that isn't set up or is switched off stays listed, disabled in
`--fg-muted`, with the reason as its hint line. The picked tool shows as a pill
chip (`--bubble-bg` / `--bubble-fg`, 36 px tall, icon + "Search"/"Image" +
`X`) before the text; it applies to one message.

**Toasts.** An inverted pill (`--button` background, `--button-fg` text, 22 px
radius, 44 px tall, dialog shadow, no border) at the bottom centre, 72 px up (12 px above the message box when that is
at the bottom of the window and has grown taller): an
18 px icon (`CircleCheck` for a confirmation, `CircleAlert` for a failure,
`Info` for a note), the message, an underlined semibold action such as Undo, and
a 28 px dismiss `X`. The layer is a `popover="manual"` element, so it is in the
top layer and shows above a modal dialog (a toast raised in Settings used to sit
behind the dialog's backdrop); it can't be clicked while a modal is open, so
such a toast has no action. Up to three stack; they stay six seconds, longer
under the pointer.

**Tooltips.** Any element with a `title` gets one (`ui/Tooltips.tsx`): a small
inverted bubble (`--button` / `--button-fg`, 8 px radius, 12 px text, up to 280 px
wide) in the top layer, 8 px below the control or above when there is no room,
kept inside the window. It shows after 350 ms of hovering (at once when another
was just up) and at once on keyboard focus, and goes on pressing, typing,
scrolling or leaving. Not on touch, and not for fields (their `title` is the
validation hint). While it shows, the element's `title` is set aside so the
browser's own doesn't appear too; an icon-only control keeps its name in
`aria-label`. So a control needs only `title` and an `aria-label`.

**Settings actions.** A row's actions (and the Projects cards' Add note, Add files, Add folder, Edit and Suggest) are round 32 px icon buttons
(`ui/IconButton.tsx`, 18 px icons, 1.5 stroke) whose label is both the
tooltip (`title`) and the accessible name: outlined in `--border`, filling
with `--chip` and `--border-control` on hover and a little darker when
pressed; the primary one (add, sign in, save an edit) is filled `--button`; the
destructive one (remove) turns `--danger` on hover. Actions that finish a form
(Save, Delete all, a dialog's Cancel and Add) stay labelled `.button` pills
(with a 16 px icon where it helps), and every `.button` has the same hover and
pressed fills (primary and danger mix their colour with the page).

**Take a photo.** A menu item under Add photos & files, shown only where the
browser offers a camera. It opens a dialog with a mirrored live preview
(`--surface-muted` while it loads), Cancel and a primary "Take photo" button
that is disabled until the first frame; the picture attaches as a JPEG like an
uploaded image. The camera runs only while the dialog is open.

**Quote.** Selecting text in the chat shows a 32 px pill button ("Quote",
`Quote` icon, `--surface-raised`, `--border`, dialog shadow) above the
selection, or below it on touch screens so it clears the phone's own menu. It
adds the text to the message box as a Markdown block quote and clears the
selection.

**MCP server form.** A dialog (560 px) from Settings → Tools: preset, name,
kind, then command, arguments (one per line) and working folder, or URL; a
list of name / value rows for environment variables or headers (values are
password fields that show "Saved (hidden)" when editing); a note that local
servers run with the user's rights; errors in a `role="alert"` line.

**Images.** Generated images sit above the answer text, up to 400 px wide with
16 px radius; a square shimmer placeholder stands in while one is made. A
`Download` icon button appears over the top-right corner on hover.

**Image viewer.** Clicking a generated or attached image opens it in a dialog
(up to 1000 px wide, 16 px padding) titled "Generated image" / "Attached
image", with `Download` and `X` icon buttons at the top right and the image
fitted to the window (16 px radius). Esc or a click outside closes it;
⌘/Ctrl/Shift/middle clicks still open the image in a new tab.

**Sources.** Below the answer, a `<details>` in 14 px muted text, "Sources ·
n", listing each page as a card (`--surface`, 1 px `--border`, 16 px radius, in
a grid of at least 192 px columns): its number in `--cite-fg`, its title
(`--fg`, two lines, ellipsis) and a 12 px host name. It is collapsed, except
when the answer cites with chips: then it starts open, as the list the numbers
refer to.

**Citations.** A link whose text is only a number to one of the answer's
sources is a chip: a 20 px pill, `--cite-bg` with `--cite-fg` text (12 px, 500,
about 6:1), `--accent` with `--accent-fg` while its card is open; it is a
real button. Hover (mouse), focus or a tap opens a native `popover="auto"`
card placed by anchor positioning above the chip (flipping), 300 px wide:
`--surface-raised`, 16 px radius, dialog shadow and 14 px padding. A 12 px
muted row (an icon for the kind, the host or "Your chats" / "Project file",
and "n of N"), the title (14 px, 500), up to four lines of the snippet in
`--fg-muted` (both `dir="auto"`, text only), and "Open page ↗" in `--cite-fg`.
Esc, a click elsewhere or the pointer leaving closes it (Esc is not also "stop
the answer"). No favicons: loading one would tell its site that the chat was read.

**Memory chip.** Above an answer written with saved memories: a 28 px pill
(`--chip` background, 13 px `--fg-muted` text, `Lightbulb` 15 px, 12 px right
padding) reading "Memory · n", a real button that opens the Memories dialog.
Shown like the answer's actions: always on the latest answer, on hover or focus
for older ones, always where there is no hover.

**Memories dialog.** Like Archived chats: a short explanation, then the count
("12 of 100 memories") in 12 px muted text, and one row per memory (14 px
text, `Pencil` edit and `Trash2` delete icon buttons). Editing swaps the row
for a text field with Save (primary) and Cancel, saved with Enter and
cancelled with Esc. Delete all (danger) sits below, with a confirm dialog.

**Projects.** The sidebar's Projects section ("New project", then a `Folder`
row each) sits above the chats. A project's page: the name as a 28 px heading
with a `Folder` icon and a "…" button whose menu holds Rename and Delete project
(in `--danger`), like a chat row's, the composer, then
cards (like Settings cards) for Files (rows with name, a 12 px status, remove;
the card takes drops) and Instructions (a textarea and Save), and the
project's chats as sidebar-style rows. In a project chat the header starts
with "Project name /" (muted, a link) before the model name.

**Menus** open below their button, or above it when the button is in the
lower 40% of the window.

**Compaction note.** A 12 px muted line between hairlines: "Earlier messages
were summarized to save context." **Compact now** is an action-row icon
(`ListCollapse`) under the latest answer with the tooltip "Compact now"; it
opens a one-line form for what the summary should keep in mind.

**Theme.** Every colour token is `light-dark(light, dark)`. `color-scheme`
follows the system unless `<meta name="color-scheme">` is set to `light` or
`dark` (the Theme setting, applied before first paint). Code highlighting
uses `--code-*` tokens with GitHub's light and dark palettes.

**Catppuccin Macchiato** is an optional fourth choice in Settings → General →
Theme (it never follows the system). It is a dark scheme, so `color-scheme` is
`dark` and `<html data-theme="macchiato">` (set with the saved choice before
first paint) makes `:root[data-theme='macchiato']` in `base.css` replace the
colour tokens, with no second set of component styles. It keeps the default
dark theme's steps: page `#181926` (crust), cards `#24273a` (base), raised
surfaces and hover rows `#363a4f` (surface0), chips `#494d64` (surface1); text
`#cad3f5`, muted text `#b8c0e0`, the blue accent `#8aadf4` (with crust `#181926`
on it, since white would be 2.3:1), danger `#ed8796`. Code uses the palette's
mauve, blue, peach, green, yellow and teal. The same contrast checks as the
other themes cover it (`tests/web/contrast.test.ts`, `tests/e2e/contrast.spec.ts`).

**Catppuccin Latte** is an optional fifth choice (it never follows the system
either). It is a light scheme: `color-scheme` is `light`, `data-theme="latte"`
and `:root[data-theme='latte']` replaces the tokens. Steps: page `#e6e9ef`
(mantle), cards and raised surfaces `#eff1f5` (base), hover rows and the user
bubble `#dce0e8` (crust), chips `#ccd0da` (surface0); text `#4c4f69`, field
edges and the off switch `#7c7f93` (overlay2), the blue accent `#1e66f5` with
white on it. The palette's own muted text, red, code colours and the green,
teal, peach and pink accents fell under the contrast checks on these surfaces,
so they are darkened until they pass (muted text `#55586e`, danger `#d00f38`,
code, and the accents' latte blocks); the thresholds are the same as for every
theme.

**Accent colour** is a browser preference in Settings → General → Appearance:
Blue (the default, no attribute), Violet, Teal, Green, Orange or Pink.
`<html data-accent="…">` (set before first paint, like the theme) makes the
blocks after the theme blocks in `base.css` replace every token built from the
accent: `--accent`, `--accent-fg`, `--switch-thumb-on`, `--cite-*` and
`--accent-tile*`. Each accent has a `light-dark()` set for Light and Dark
(a deeper colour with white on it, a lighter one with near-black on it) and
plain colours for Macchiato (the palette's mauve, teal, green, peach and pink,
with crust on them). The blocks are measured, not guessed: `accent-fg` on
`--accent` is 4.5:1, `--accent` on the page and cards 3:1, citation text 4.5:1,
for every accent in every theme (`tests/web/contrast.test.ts`; axe covers all
of them in `tests/e2e/contrast.spec.ts`). The favicon and app icons keep the
blue.

**Text size** is a browser preference in Settings → General → Appearance:
Small (87.5 %), Default (100 %), Large (112.5 %) or Extra large (125 %), set as
the root `font-size` before first paint, so every `rem` length scales (all type
is in `rem`). Lengths that hold text are `rem` too: the sidebar (`--sidebar-width`),
dialogs and the Settings tabs column. Controls with a fixed pixel height
(36 px buttons, the 52 px composer, which grows with its text) keep it; the type
inside them is sized to fit at 125 %. `tests/e2e/settings.spec.ts` checks that
the composer, sidebar and Settings dialog fit with no sideways page scroll at
Extra large, on a desktop and a phone.

**Reduce transparency** is a switch in Settings → General → Appearance
(`<html data-transparency="reduced">` or `full`, set before first paint). It
starts from the system's `prefers-reduced-transparency` and the choice here
overrides it. The tinted surfaces become opaque steps of the theme's own tokens:
`--code-chip` is `--surface-muted` and `--row-stripe` mixes `--surface-muted`
and `--surface`. There is little else to change: borders are hairlines, the
shadows aren't surfaces, and the modal scrim, which only dims the page behind a
dialog, stays translucent.

**Footer.** 12 px muted line under the composer: "chibot can make mistakes.
Check important info."

## 5. Icons

[`lucide-react`](https://lucide.dev), never hand-drawn SVG — the logo is the
one exception. ChatGPT uses thin line icons: 20 px in action rows and the
header, 16 px on code blocks, 24 px for the composer's "+". The lucide
equivalents use a 1.5 px stroke:

| Action | lucide icon |
|---|---|
| Send / Stop | `ArrowUp` / `Square` (filled) |
| Queued message / edit / cancel | `Clock` / `Pencil` / `X` |
| New chat | `SquarePen` |
| Copy / copied | `Copy` / `Check` |
| Edit message | `Pencil` |
| Regenerate / branch in new chat | `RefreshCw` / `GitBranch` |
| Versions | `ChevronLeft` / `ChevronRight` |
| Attach / voice | `Plus` / `Mic` |
| Take a photo / quote / compact now | `Camera` / `Quote` / `ListCollapse` |
| Settings row actions | `Upload` / `Archive` / `List` / `Copy` / `Plus` / `RefreshCw` / `LogIn` / `LogOut` / `Plug` / `Pencil` / `Trash2` / `RotateCcw` |
| Sidebar toggle | `PanelLeft` |
| Settings | `Settings` |
| Model picker | `ChevronDown`, `Check` |
| Export as Markdown / JSON | `FileText` / `FileJson` |
| Temporary chat / shortcuts | `MessageCircleDashed` / `Keyboard` |
| Tool approval / Settings → Tools | `Wrench` |
| Next-step card | `Sparkles` |
| Project / new project / move in / remove / add files | `Folder` / `FolderPlus` / `FolderInput` / `FolderMinus` / `Upload` |
| Create an image / download | `ImagePlus` / `Download` |
| Sync now / stop mirroring / use this folder | `RefreshCw` / `Unlink` / `Check` |
| Undo a summary / summarize now | `Undo2` / `ListCollapse` |

**Brand.** The mark is a forked path whose right arm ends in the accent dot:
drawn on a 32-unit grid with a 3.2-unit round stroke, the stem forks into two
curved arms and the dot (`#3566f0`) closes the right one. The path takes
`currentColor` — near-black in light mode, white in dark — and only the dot
carries colour. In the sidebar it sits at 20 px beside `chibot` (system sans,
18 px, 600, −0.01 em, 4 px apart). The favicon
(`src/web/public/favicon.svg`) is the same drawing at a 3.6-unit stroke on a
32 px `#0d0d0d` tile, so it holds up in a 16 px tab.

## 6. Interaction

- **Right-to-left text.** Text people write or read takes its direction from
  itself, not from the interface: `dir="auto"` on the message box, the edit
  box, instruction and note fields, a message, each block of an answer
  (paragraphs, headings, lists, quotes, tables) and the titles in the sidebar,
  search and top bar. An Urdu or Arabic paragraph runs right to left, with its
  bullets and alignment, beside an English one that doesn't; code blocks stay
  left to right. The interface's own layout (sidebar, buttons) stays as it is.
  Rules that sit on one side of text (a quote's bar) use logical properties
  (`border-inline-start`), not `left` or `right`.
- Focus is visible: a 2 px `--fg` outline with 2 px offset on keyboard focus
  (`:focus-visible`) only.
- Motion is short and subtle (150 ms ease). The thinking dot pulses. Honour
  `prefers-reduced-motion`.
- The composer keeps focus after sending and after Stop.
