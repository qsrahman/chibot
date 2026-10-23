# chibot — Design Guide

chibot's UI follows the look and feel of ChatGPT's web app: a calm,
near-monochrome, content-first chat with one rounded composer and a single blue
accent. This guide records what was measured on chatgpt.com (22 Oct 2026,
logged out, 1024×768, one test conversation) and how chibot applies it. It borrows **aesthetics only**: no ChatGPT name, logo,
icons or copy.

All values live as CSS variables in [`src/web/styles.css`](src/web/styles.css).
Components use the variables, never raw colours.

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
  hover or focus, and always for the last answer.

## 2. Tokens

Measured on chatgpt.com: page, surfaces, text, muted text, borders, the blue
accent, bubble and inline-code colours, shadows, radii and sizes. Chosen by
chibot to fit: light-mode `--surface-muted` and `--chip`, and `--danger` in both
themes. The logged-out
dark theme uses a pure black page, which chibot follows. Changing `--bg` is
enough to switch to a dark-grey page.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#fcfcfc` | `#000000` | Page and sidebar (separated by `--border`) |
| `--surface` | `#ffffff` | `#212121` | Composer, cards |
| `--surface-raised` | `#ffffff` | `#303030` | Dialogs, menus, popovers |
| `--surface-muted` | `#f4f4f4` | `#303030` | Hover rows |
| `--bubble-bg` / `--bubble-fg` | `#edf3ff` / `#2451da` | `#020562` / `#d9e6ff` | User message bubble |
| `--code-chip` | `rgb(238 238 238 / 82%)` | `rgb(42 42 42 / 82%)` | Inline code |
| `--chip` | `#ececec` | `#414141` | Chips, switch track, and hover/selected rows inside menus and dialogs (where `--surface-muted` would match the raised background) |
| `--fg` | `#0d0d0d` | `#ffffff` | Text |
| `--fg-muted` | `#5d5d5d` | `#cdcdcd` | Descriptions, captions, footer, action icons, code labels |
| `--border` | `rgb(0 0 0 / 10%)` | `rgb(255 255 255 / 15%)` | Hairlines, composer outline |
| `--accent` / `--accent-fg` | `#3566f0` / `#fff` | `#3566f0` / `#fff` | Send button, switches (measured `oklch(0.56 0.21 265)`) |
| `--button` / `--button-fg` | `#0d0d0d` / `#fff` | `#fff` / `#0d0d0d` | Primary buttons in dialogs |
| `--danger` | `#d93025` | `#ff6b6b` | Errors, destructive buttons |


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
│ (Ph. 2)  │        ┌─ thread, max 48rem ─┐              │
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
- **Sidebar (Phase 2, built).** 260 px, with a hairline right border. Rows are 36 px
  tall, 8×10 px padding, 10 px radius, 6 px icon gap. The hover/active fill is
  `--surface-muted`. Groups have 12 px muted headings (Today, Yesterday, …).
  It collapses to a 56 px icon rail, and the collapsed state is remembered.
- **Header.** Model name with a chevron on the left: the model picker, a
  popover with a search box over the model list (a name field when the
  server can't list models). Page actions sit on the right.

## 4. Components

**Composer.** A 28 px-radius pill on `--surface` with a `--border` outline,
7×10 px padding and 52 px tall when one line. The textarea grows up to 40 vh.
A round 36 px icon button on the right is **send** (blue `--accent`, arrow-up icon),
dimmed while the input is empty, and becomes **stop** (square icon) while an
answer streams. Later phases add a "+" button on the left (attachments,
Phase 9) and a mic button (voice, Phase 9).

**Messages.**
- *User:* right-aligned bubble with `--bubble-bg` and `--bubble-fg` text,
  22 px radius, 10×16 px padding, max 70 % width, `white-space: pre-wrap`.
  On hover, **Copy**, **Edit** and (when edited) `< 2/3 >` appear below it,
  right-aligned. Edit opens an inline box (`--surface-muted`, bubble radius)
  with Cancel and a primary Send.
- *Assistant:* full-width Markdown with no background, 16/26 px text, 16 px
  between blocks.
- *Action rows (built).* 32 px icon buttons with 18 px icons, muted
  (`--fg-muted`), 2 px apart, 8 px radius hover fill, directly under the
  answer (ChatGPT uses a 44 px hit area and 20 px icons; chibot is a little
  denser):
  - Assistant: **Copy**, then **Regenerate**, version switcher `< 2/3 >` and
    token usage. These show on hover and always on the latest answer.
  - Measured logged out: Copy and Share. chibot has no sharing, so it omits
    Share.
- *Thinking:* a pulsing dot before the first token arrives.

**Code blocks.** No box: no background, border or radius, just like the text
around them.
- The language name sits above the code in a 12 px muted label.
- Code is 16/26 px monospace.
- **Copy code** sits at the right of the label row (ChatGPT floats it at the
  block's top right).

**Inline code.** `--code-chip` background, 4 px radius, 1×4 px padding,
0.93 em monospace, weight 500.

**Menus and popovers** (native Popover API). `--surface-raised`, 16 px radius,
6 px padding and the dialog shadow. Items are 36 px rows with an icon and a
label, 10 px radius, and a `--surface-muted` hover. Groups are separated by
hairlines, with optional 12 px muted section labels.

**Dialogs** (native `<dialog>`). `--surface-raised`, 20 px radius, width
`min(100% - 32px, 448px)`, dialog shadow and a dimmed backdrop. Layout:
title (18 px, 500), body (14 px muted), then right-aligned buttons. Buttons are
pill-shaped: primary is `--button`, secondary is outlined, destructive is
`--danger`. Used for confirmations such as "Delete chat?".

**Settings (built).** A large dialog (max 760 px) with a vertical tab list on
the left (General, Personalization, Model, Data; the current tab uses
`--chip`) and content on the right. Content is
grouped as section heading (16 px, 500) + card (`--surface`, 16 px radius,
hairline border). A card holds rows: 52 px tall, 0×16 px padding, a 14 px/500
label (with an optional 12 px muted description) on the left, and the control
on the right: a select showing its value and a chevron, or a 32×20 px switch
(`--accent` when on).
Hairline dividers separate rows.

**Thinking.** Above an answer, a native `<details>` in 14 px muted text:
"Thinking…" with a shimmer while the summary streams, "Thoughts" once the
answer starts. Opened, the summary sits behind a 2 px `--border` rule.

**Tool calls.** Like Thinking: a `<details>` in 14 px muted text above the
answer, "Running calculator…" with the shimmer while a tool runs, "Used
calculator" afterwards. Opened, it lists Arguments (indented JSON) and Result
in 13 px monospace blocks on `--surface-muted` (10 px radius).

**Approval card.** In place of the answer's actions while tool calls wait: a
card (`--surface`, hairline border, 16 px radius, 16 px padding) with a 15 px
title "chibot wants to use <tool>" and a `Wrench` icon, each call's arguments,
a 13 px muted hint that a new message denies it, and Deny (secondary) /
Approve (primary) at the bottom right.

**Composer tools.** A 24 px `Plus` button at the composer's left opens a menu
above it (Search the web, Create an image). The picked tool shows as a pill
chip (`--bubble-bg` / `--bubble-fg`, 36 px tall, icon + "Search"/"Image" +
`X`) before the text; it applies to one message.

**Images.** Generated images sit above the answer text, up to 400 px wide with
16 px radius; a square shimmer placeholder stands in while one is made. A
`Download` icon button appears over the top-right corner on hover.

**Sources.** Below the answer, a `<details>` in 14 px muted text, "Sources ·
n", listing each page as its title (`--fg`, one line, ellipsis) and a 12 px
host name.

**Memories dialog.** Like Archived chats: a short explanation, one row per
memory (14 px text, a `Trash2` delete button), and Delete all (danger, with a
confirm dialog).

**Compaction note.** A 12 px muted line between hairlines: "Earlier messages
were summarized to save context."

**Theme.** Every colour token is `light-dark(light, dark)`. `color-scheme`
follows the system unless `<meta name="color-scheme">` is set to `light` or
`dark` (the Theme setting, applied before first paint). Code highlighting
uses `--code-*` tokens with GitHub's light and dark palettes.

**Footer.** 12 px muted line under the composer: "chibot can make mistakes.
Check important info."

## 5. Icons

[`lucide-react`](https://lucide.dev), never hand-drawn SVG. ChatGPT uses thin
line icons: 20 px in action rows and the header, 16 px on code blocks, 24 px
for the composer's "+". The lucide equivalents use a 1.5 px stroke:

| Action | lucide icon |
|---|---|
| Send / Stop | `ArrowUp` / `Square` (filled) |
| New chat | `SquarePen` |
| Copy / copied | `Copy` / `Check` |
| Edit message | `Pencil` |
| Regenerate | `RefreshCw` |
| Versions | `ChevronLeft` / `ChevronRight` |
| Attach (Phase 9) / voice (Phase 9) | `Plus` / `Mic` |
| Sidebar toggle (Phase 2) | `PanelLeft` |
| Settings | `Settings` |
| Model picker | `ChevronDown`, `Check` |
| Export as Markdown / JSON | `FileText` / `FileJson` |
| Temporary chat / shortcuts | `MessageCircleDashed` / `Keyboard` |
| Tool approval / Settings → Tools | `Wrench` |
| Search the web / create an image / download | `Globe` / `ImagePlus` / `Download` |

## 6. Interaction

- Focus is visible: a 2 px `--fg` outline with 2 px offset on keyboard focus
  (`:focus-visible`) only.
- Motion is short and subtle (150 ms ease). The thinking dot pulses. Honour
  `prefers-reduced-motion`.
- The composer keeps focus after sending and after Stop.
