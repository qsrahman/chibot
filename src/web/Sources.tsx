import { Link } from 'react-router'
import { type Answer, type Source, sourcesOf } from './turns.ts'
import { Summary } from './Summary.tsx'

/** The pages the answer searched or read, collapsed under "Sources". */
export function Sources({ answer }: { answer: Answer }) {
  const sources = sourcesOf(answer)
  if (sources.length === 0) return null
  return (
    <details className="sources">
      <Summary>Sources · {sources.length}</Summary>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.url}>
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
      <span className="source-host">
        {kind === 'file' ? 'Project file' : new URL(url).hostname}
      </span>
    </a>
  )
}
