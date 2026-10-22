import type { ComponentProps } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex, rehypeHighlight]
const components: Components = { pre: CodeBlock }

/** Renders model output. Raw HTML in the text is not rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

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
      {language && <div className="code-label">{language}</div>}
      <pre {...props} />
    </div>
  )
}
