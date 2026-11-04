// What the interface knows about a tool. The server's tools describe
// themselves (`Tool.info`, sent by `GET /api/tools`), so the web app keeps no
// per-tool tables.

/** Settings' sections, in the order they're shown. */
export const TOOL_GROUPS = [
  'The web',
  'Images',
  'Your chats and files',
  'Other',
] as const
export type ToolGroup = (typeof TOOL_GROUPS)[number]

/** The icons the composer's menu can show for a tool. */
export type ToolIcon = 'globe' | 'image'

/** How the composer's "+" menu offers a tool for the next message. */
export interface ToolChip {
  /** The menu entry: "Search the web". */
  action: string
  /** The chip once picked: "Search". */
  text: string
  icon: ToolIcon
}

/** A tool in `GET /api/tools` (`{ tools: ToolInfo[] }`). */
export interface ToolInfo {
  name: string
  /** What the user sees, e.g. in Settings: "Search the web". */
  label: string
  group: ToolGroup
  /** What it does and what (if anything) leaves this machine. */
  summary: string
  /** What an answer says while it runs, and once it's done. */
  running: string
  done: string
  /** Set when the composer's menu offers it for the next message. */
  chip: ToolChip | null
  /** Why it can't be used (what to set up), or `null`. */
  unavailable: string | null
  /**
   * Why it may ask for the user's approval, in plain words for the card that
   * asks; `null` for a tool that never asks.
   */
  approval: string | null
}

/** By section, then by label. */
export function sortTools(tools: ToolInfo[]): ToolInfo[] {
  const rank = (tool: ToolInfo) => TOOL_GROUPS.indexOf(tool.group)
  return [...tools].sort(
    (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label),
  )
}
