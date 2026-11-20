import { SetupCard } from './SetupCard.tsx'
import { greetingText } from './greeting.ts'
import type { EmptyState } from './recents.ts'
import { Link } from 'react-router'
import { Folder } from 'lucide-react'
import type { ConversationListItem, Project } from '../../shared/types.ts'
import { relativeTime } from '../conversations/dates.ts'
import { UNTITLED } from '../conversations/useConversations.ts'

/** Ways to start, for an empty chat: each puts the start of a message in the box. */
const STARTERS = [
  { label: 'Summarize a page', text: 'Summarize this page for me: ' },
  { label: 'Explain a topic', text: 'Explain step by step how ' },
  { label: 'Draft an email', text: 'Help me write an email to ' },
  {
    label: 'Review code',
    text: 'Review this code for bugs and ways to simplify it:\n\n',
  },
] as const

/** An empty chat's greeting, centred above the composer as ChatGPT does. */
export function Greeting({
  temporary,
  userName,
  state,
  onStart,
}: {
  temporary: boolean
  /** From Settings → Personalization; `''` when not given. */
  userName: string
  /** What to show under the heading; see `emptyState`. */
  state: EmptyState | null
  /** Puts the start of a message in the box. */
  onStart: (text: string) => void
}) {
  return (
    <div className="greeting">
      <h1 dir="auto">
        {temporary
          ? 'Temporary chat'
          : greetingText(userName, new Date().getHours())}
      </h1>
      {temporary ? (
        <p>
          This chat won’t appear in your history or search, and it’s deleted
          when you leave it.
        </p>
      ) : state === 'setup' ? (
        <SetupCard problem="missing" />
      ) : state === 'starters' ? (
        <div className="suggestions">
          {STARTERS.map(({ label, text }) => (
            <button
              key={label}
              type="button"
              className="suggestion"
              onClick={() => onStart(text)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Below the composer of a new chat: where to carry on. */
export function Recents({
  chats,
  projects,
}: {
  chats: ConversationListItem[]
  projects: Project[]
}) {
  return (
    <nav className="recents" aria-label="Pick up where you left off">
      <h2>Pick up where you left off</h2>
      {chats.map((chat) => (
        <Link key={chat.id} to={`/c/${chat.id}`} className="recent-row">
          <span className="recent-label" dir="auto">
            {chat.title ?? UNTITLED}
          </span>
          <time dateTime={new Date(chat.updatedAt).toISOString()}>
            {relativeTime(chat.updatedAt)}
          </time>
        </Link>
      ))}
      {projects.map((project) => (
        <Link
          key={project.id}
          to={`/projects/${project.id}`}
          className="recent-row"
        >
          <Folder size={18} strokeWidth={1.5} aria-hidden />
          <span className="recent-label" dir="auto">
            {project.name}
          </span>
        </Link>
      ))}
    </nav>
  )
}
