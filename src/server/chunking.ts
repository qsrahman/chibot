// Splits a document into chunks for search, at the seams it has: markdown
// sections, top-level code units, paragraphs, and only then lines, sentences
// or words, so a chunk reads as a unit rather than as a slice.
const CHUNK_SIZE = 3200
const CHUNK_OVERLAP = 480

// Raise when chunking changes: project files chunked by an older version are
// indexed again at startup.
export const CHUNKER_VERSION = 2

export type ChunkStyle = 'prose' | 'markdown' | 'code'

const MARKDOWN = new Set(['md', 'markdown', 'mdx', 'rmd'])
const CODE = new Set(
  `js mjs cjs ts tsx jsx py rb go rs java kt c h cc cpp hpp cs swift php sh bash
  zsh sql lua dart scala ex exs erl hrl hs ml mli fs clj cljs zig nim pl pm jl
  m mm vb ps1 gradle kts groovy css scss sass less vue svelte`.split(/\s+/),
)

/** How to split the file called `name`. */
export function chunkStyle(name: string): ChunkStyle {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  if (MARKDOWN.has(extension)) return 'markdown'
  return CODE.has(extension) ? 'code' : 'prose'
}

/**
 * The PDF page each chunk starts on, from the `[Page n]` lines in the text;
 * `null` where there are none (not a PDF, or a single page).
 */
export function chunkPages(chunks: string[]): (number | null)[] {
  let current: number | null = null // the page the previous chunk ended on
  return chunks.map((chunk) => {
    const marks = [...chunk.matchAll(/^\[Page (\d+)\]$/gm)]
    const first = marks[0]
    const last = marks.at(-1)
    // Text before the first line belongs to the page before it.
    const page = !first
      ? current
      : first.index < 20
        ? Number(first[1])
        : Math.max(Number(first[1]) - 1, 1)
    if (last) current = Number(last[1])
    return page
  })
}

/** A paragraph, section heading or code unit, with the headings above it. */
interface Block {
  text: string
  /** The headings it sits under (markdown), outermost first. */
  path: string[]
  /** 1 to 6 for a heading, else 0. */
  level: number
}

const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/**
 * Chunks of about `size` characters made of whole blocks, each starting with
 * the end (about `overlap` characters) of the one before, so a passage cut in
 * two is still found whole in one of them. A markdown chunk that doesn't
 * start at its heading is prefixed with the headings it is under, and a new
 * top-level section starts a new chunk (without overlap) once the current one
 * has some substance. Blocks longer than `size` are cut (see `cut`).
 */
export function chunkText(
  text: string,
  {
    style = 'prose',
    size = CHUNK_SIZE,
    overlap = CHUNK_OVERLAP,
  }: { style?: ChunkStyle; size?: number; overlap?: number } = {},
): string[] {
  const blocks = blocksOf(text, style).flatMap((block) =>
    block.text.length <= size
      ? [block]
      : cut(block.text, size, overlap).map((piece, i) => ({
          ...block,
          text: piece,
          level: i === 0 ? block.level : 0,
        })),
  )
  const chunks: string[] = []
  let current: Block[] = []
  let length = 0
  const emit = () => {
    const first = current[0]
    if (!first) return
    const above = first.level > 0 ? first.path.slice(0, -1) : first.path
    const body = current.map((b) => b.text).join('\n\n')
    chunks.push(above.length ? `[${above.join(' > ')}]\n${body}` : body)
  }
  for (const block of blocks) {
    const section = style === 'markdown' && block.level > 0 && block.level <= 2
    if (
      current.length > 0 &&
      (length + block.text.length > size || (section && length >= size / 4))
    ) {
      emit()
      if (section) {
        current = []
        length = 0
      } else {
        // Carry the last blocks that fit in the overlap.
        const carried: Block[] = []
        let carriedLength = 0
        for (const b of current.toReversed()) {
          if (carriedLength + b.text.length > overlap) break
          carried.unshift(b)
          carriedLength += b.text.length + 2
        }
        current = carried
        length = carriedLength
      }
    }
    current.push(block)
    length += block.text.length + 2
  }
  emit()
  return chunks
}

function blocksOf(text: string, style: ChunkStyle): Block[] {
  if (style === 'markdown') return markdownBlocks(text)
  if (style === 'code') return codeBlocks(text)
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ text, path: [], level: 0 }))
}

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/

/** Paragraphs, headings and fenced code (kept whole, blank lines and all). */
function markdownBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const headings: { level: number; title: string }[] = []
  const path = () => headings.map((h) => h.title)
  let lines: string[] = []
  let at: string[] = []
  let fenced = false
  const flush = () => {
    if (lines.length > 0) {
      blocks.push({ text: strip(lines.join('\n')), path: at, level: 0 })
    }
    lines = []
  }
  for (const line of text.split('\n')) {
    const isFence = FENCE.test(line)
    const heading = fenced || isFence ? null : HEADING.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      while (headings.length > 0 && headings.at(-1)!.level >= level) {
        headings.pop()
      }
      headings.push({ level, title: heading[2]! })
      blocks.push({ text: line.trim(), path: path(), level })
      continue
    }
    if (!fenced && !isFence && line.trim() === '') {
      flush()
      continue
    }
    if (lines.length === 0) at = path()
    lines.push(line)
    if (isFence) fenced = !fenced
  }
  flush()
  return blocks
}

// A column-0 line that closes something rather than starts it.
const CLOSER = /^(?:[}\])]|end\b|else\b|elif\b|except\b|finally\b|catch\b)/

/**
 * Top-level units: a line at column 0 starts one when it follows a blank line
 * or a column-0 closing brace; everything indented under it, blank lines
 * included, belongs to it. Works without parsing any one language.
 */
function codeBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let lines: string[] = []
  const flush = () => {
    const unit = strip(lines.join('\n'))
    if (unit) blocks.push({ text: unit, path: [], level: 0 })
    lines = []
  }
  const all = text.split('\n')
  for (const [i, line] of all.entries()) {
    const previous = all[i - 1] ?? ''
    const starts =
      line !== '' &&
      !/^\s/.test(line) &&
      !CLOSER.test(line) &&
      (previous.trim() === '' || /^(?:[}\])]|end\b)/.test(previous))
    if (starts) flush()
    lines.push(line)
  }
  flush()
  return blocks
}

/** Without the blank lines around it, keeping the first line's indentation. */
const strip = (text: string) => text.replace(/^\s*\n/, '').trimEnd()

/**
 * Pieces of about `size` characters, `overlap` apart. Each ends at the best
 * seam in the later half of its window: a blank line, a line break, a
 * sentence end, a space; and the next starts at a line or sentence start.
 */
function cut(text: string, size: number, overlap: number): string[] {
  const pieces: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length) end = start + seam(text.slice(start, end), size / 2)
    pieces.push(strip(text.slice(start, end)))
    if (end >= text.length) break
    start = Math.max(overlapStart(text, end, overlap), start + 1)
  }
  return pieces.filter(Boolean)
}

/** Where to cut `window`, after `min` characters; its length if nowhere. */
function seam(window: string, min: number): number {
  for (const separator of ['\n\n', '\n']) {
    const at = window.lastIndexOf(separator)
    if (at > min) return at
  }
  // The last sentence is the one the window cuts short.
  const last = [...sentences.segment(window)].at(-1)
  if (last && last.index > min) return last.index
  const space = window.lastIndexOf(' ')
  return space > min ? space : window.length
}

/** The first paragraph, line or sentence start in the last `overlap` characters before `end`. */
function overlapStart(text: string, end: number, overlap: number): number {
  const from = Math.max(end - overlap, 0)
  for (const separator of ['\n\n', '\n']) {
    const at = text.indexOf(separator, from)
    if (at !== -1 && at < end) return at + separator.length
  }
  const next = [...sentences.segment(text.slice(from, end))][1]
  return next ? from + next.index : from
}
