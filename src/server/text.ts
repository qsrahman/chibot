// Plain text from documents, for fetch_url and project files.
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import type { DocumentKind } from '../shared/documents.ts'

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
const pdfToText = async (data: Uint8Array) =>
  tidy(
    (
      await extractText(await getDocumentProxy(new Uint8Array(data)), {
        mergePages: true,
      })
    ).text,
  )

const docxToText = async (data: Uint8Array) =>
  tidy((await mammoth.extractRawText({ buffer: Buffer.from(data) })).value)

/** Collapses runs of spaces, and of blank lines into one. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .trim()
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
