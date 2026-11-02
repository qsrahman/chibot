import { lazy, memo, Suspense } from 'react'

// The renderer (markdown, math, code highlighting) is most of the app's size,
// so it is a chunk of its own. It starts loading as soon as this module does,
// beside the rest of the app, and until it arrives the text shows as it is.
const loading = import('./MarkdownView.tsx')
const MarkdownView = lazy(async () => ({
  default: (await loading).MarkdownView,
}))

/** Renders model output as Markdown. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="markdown plain">{text}</div>}>
      <MarkdownView text={text} />
    </Suspense>
  )
})
