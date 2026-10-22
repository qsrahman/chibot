import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex, rehypeHighlight]

/** Renders model output. Raw HTML in the text is not rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
