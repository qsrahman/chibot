import { Link } from 'react-router'
import { citedNumbers } from './citations.ts'
import { type Answer, type Source, sourceHost, sourcesOf } from './turns.ts'
import { Summary } from '../ui/Summary.tsx'

/**
 * The pages the answer searched or read, as cards under "Sources". Collapsed,
 * unless the answer cites them with numbered chips: then the cards are the
 * list those numbers refer to.
 */
export function Sources({ answer }: { answer: Answer }) {
  const sources = sourcesOf(answer)
  if (sources.length === 0) return null
  return (
    <details
      className="sources"
      open={citedNumbers(answer.text, sources).length > 0 || undefined}
    >
      <Summary>Sources · {sources.length}</Summary>
      <ul className="source-list">
        {sources.map((source, i) => (
          <li key={source.url}>
            <span className="source-num" aria-hidden>
              {i + 1}
            </span>
            <SourceLink source={source} />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** A source: a chat in chibot, a project file or a web page (in a new tab). */
export function SourceLink({
  source: { url, title, kind },
}: {
  source: Source
}) {
  if (kind === 'chat') {
    return (
      <Link to={url}>
        <span className="source-title">{title}</span>
        <span className="source-host">Your chats</span>
      </Link>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <span className="source-title">{title}</span>
      <span className="source-host">{sourceHost({ url, title, kind })}</span>
    </a>
  )
}
