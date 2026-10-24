import { memo, type ComponentProps } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import { toText } from 'hast-util-to-text'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { dollarMath } from './math.ts'
import { CopyButton } from './MessageActions.tsx'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex, rehypeHighlight]
const components: Components = { pre: CodeBlock, a: Link }

/**
 * Renders model output. Raw HTML in the text is not rendered. Memoized: a
 * streamed answer re-renders the whole chat for every chunk, and parsing,
 * highlighting and typesetting every earlier answer again made long chats
 * stall; only a changed `text` renders again.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {dollarMath(text)}
      </ReactMarkdown>
    </div>
  )
})

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
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-label">{language}</span>
        {node && <CopyButton text={toText(node)} label="Copy code" />}
      </div>
      <pre {...props} />
    </div>
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
