import { lazy, memo, Suspense } from 'react'
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx'

// The renderer (markdown, math, code highlighting) is most of the app's size,
// so it is a chunk of its own. It starts loading as soon as this module does,
// beside the rest of the app, and until it arrives the text shows as it is.
const loading = import('./MarkdownView.tsx')
const MarkdownView = lazy(async () => ({
  default: (await loading).MarkdownView,
}))

/** Renders model output as Markdown. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const plain = <div className="markdown plain">{text}</div>
  // Until the renderer arrives, and if it never does or can't read the text,
  // the message still shows as it is.
  return (
    <ErrorBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <MarkdownView text={text} />
      </Suspense>
    </ErrorBoundary>
  )
})
