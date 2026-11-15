/** A block with more lines than this starts collapsed. */
export const COLLAPSE_OVER = 30

/**
 * Lines of a collapsed block that show. The same number is the height in
 * `markdown.css` (`.code-body[data-collapsed]`), in 26 px lines.
 */
export const COLLAPSED_LINES = 18

/** The lines in a block's text, not counting the newline that ends it. */
export const countLines = (text: string) =>
  text.replace(/\n$/, '').split('\n').length

/** Whether a block this long is collapsible (the short ones never show the button). */
export const isCollapsible = (lines: number) => lines > COLLAPSE_OVER

// A Map, so a label like `constructor` or `__proto__` finds nothing.
const EXTENSIONS = new Map([
  ...[
    'ts',
    'tsx',
    'js',
    'jsx',
    'py',
    'sh',
    'json',
    'diff',
    'html',
    'css',
    'md',
    'yaml',
    'toml',
    'xml',
    'sql',
    'go',
    'rs',
    'c',
    'cpp',
    'java',
    'rb',
    'php',
    'swift',
    'kt',
    'cs',
  ].map((e) => [e, e] as const),
  ['typescript', 'ts'],
  ['javascript', 'js'],
  ['python', 'py'],
  ['bash', 'sh'],
  ['shell', 'sh'],
  ['zsh', 'sh'],
  ['patch', 'diff'],
  ['markdown', 'md'],
  ['yml', 'yaml'],
  ['rust', 'rs'],
  ['c++', 'cpp'],
  ['ruby', 'rb'],
  ['kotlin', 'kt'],
  ['csharp', 'cs'],
])

/**
 * The name to save a block under, from its language label. Only the lookup's
 * own extensions are used (plain `[a-z0-9]`), never the label itself, which a
 * model or a page could make into a path.
 */
export function fileName(language: string | undefined): string {
  return `code.${EXTENSIONS.get(language?.toLowerCase() ?? '') ?? 'txt'}`
}

/** Saves `text` as `name`, with the trailing newline a text file has. */
export function saveText(text: string, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new Blob([text.replace(/\n$/, ''), '\n'], { type: 'text/plain' }),
  )
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
