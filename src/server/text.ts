// Plain text from documents, for fetch_url and project files.
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'

/** A page's main text (Readability), or all of its text as a fallback. */
export function htmlToText(html: string): { title: string; text: string } {
  const { document } = parseHTML(html)
  const article = new Readability(document).parse()
  return {
    title: (article?.title ?? document.title ?? '').trim(),
    // Readability finds nothing in very short pages; then take all text.
    text: tidy(article?.textContent || document.body?.textContent || ''),
  }
}

// unpdf refuses Node's Buffer (a Uint8Array subclass), so copy into a plain one.
export const pdfToText = async (data: Uint8Array) =>
  tidy(
    (
      await extractText(await getDocumentProxy(new Uint8Array(data)), {
        mergePages: true,
      })
    ).text,
  )

export const docxToText = async (data: Uint8Array) =>
  tidy((await mammoth.extractRawText({ buffer: Buffer.from(data) })).value)

/** Collapses runs of spaces, and of blank lines into one. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .trim()
}

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

/** A document's text. */
export async function documentText(
  kind: DocumentKind,
  data: Uint8Array,
): Promise<string> {
  switch (kind) {
    case 'pdf':
      return pdfToText(data)
    case 'docx':
      return docxToText(data)
    case 'html':
      return htmlToText(new TextDecoder().decode(data)).text
    case 'text':
      return tidy(new TextDecoder().decode(data))
  }
}
