// What the interface says about chibot's own tools, by name: Settings →
// Tools and the composer's "+" menu. Tools not listed here (e.g. test-only
// ones) show the server's label alone.

export const TOOL_GROUPS = [
  'The web',
  'Images',
  'Your chats and files',
  'Calculation',
] as const

export interface ToolText {
  /** As in Settings (the server's own label for the same tool). */
  label: string
  group: (typeof TOOL_GROUPS)[number]
  /** What it does, and what (if anything) leaves this machine. */
  description: string
  /** What `.env` needs for the server to offer it (when it can be missing). */
  setup?: string
}

const IMAGE_SETUP = 'Needs an image model (OPENAI_IMAGE_MODEL)'

export const TOOL_TEXT: Record<string, ToolText> = {
  web_search: {
    label: 'Search the web',
    group: 'The web',
    description: 'Searches with Brave; your queries are sent to Brave.',
    setup: 'Needs BRAVE_API_KEY in .env',
  },
  fetch_url: {
    label: 'Read web pages',
    group: 'The web',
    description:
      'Reads pages you link or it finds. Never addresses on this machine or your network.',
  },
  generate_image: {
    label: 'Create images',
    group: 'Images',
    description: 'Creates images; the prompt goes to the image service.',
    setup: IMAGE_SETUP,
  },
  edit_image: {
    label: 'Edit images',
    group: 'Images',
    description: 'Changes images made earlier in the same chat.',
    setup: IMAGE_SETUP,
  },
  memory: {
    label: 'Memory',
    group: 'Your chats and files',
    description:
      'Remembers lasting facts and preferences across chats. Off, no memories are used.',
  },
  search_chats: {
    label: 'Search past chats',
    group: 'Your chats and files',
    description:
      'Finds your earlier chats on this machine when you refer to them.',
  },
  search_project_files: {
    label: 'Search project files',
    group: 'Your chats and files',
    description: "Searches a project's files, in that project's chats.",
  },
  calculator: {
    label: 'Calculator',
    group: 'Calculation',
    description: 'Exact arithmetic, functions and unit conversions.',
  },
}
