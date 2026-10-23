// Which files projects accept, by extension: shared by the server (to read
// them) and the web (for the file picker).

/** The document types project files may be, by file name extension. */
const KINDS: Record<string, { kind: DocumentKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  html: { kind: 'html', mime: 'text/html' },
  htm: { kind: 'html', mime: 'text/html' },
  md: { kind: 'text', mime: 'text/markdown' },
  markdown: { kind: 'text', mime: 'text/markdown' },
  csv: { kind: 'text', mime: 'text/csv' },
  json: { kind: 'text', mime: 'application/json' },
}
// Read as UTF-8 text and served as text/plain (browsers guess odd types for
// some, e.g. video/mp2t for .ts).
const TEXT = `txt log tsv yaml yml toml ini xml rst tex js mjs cjs ts tsx jsx py
  rb go rs java kt c h cc cpp hpp cs swift php sh bash zsh sql css scss vue
  svelte lua r dart scala`.split(/\s+/)

export type DocumentKind = 'pdf' | 'docx' | 'html' | 'text'

/** How to read a file called `name`, and its type; `null` if unsupported. */
export function documentKind(
  name: string,
): { kind: DocumentKind; mime: string } | null {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  if (KINDS[extension]) return KINDS[extension]
  return TEXT.includes(extension) ? { kind: 'text', mime: 'text/plain' } : null
}

/** For `<input type="file" accept>`: every supported extension. */
export const DOCUMENT_ACCEPT = [...Object.keys(KINDS), ...TEXT]
  .map((extension) => `.${extension}`)
  .join(',')
