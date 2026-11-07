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
  onStart,
}: {
  temporary: boolean
  /** Puts the start of a message in the box. */
  onStart: (text: string) => void
}) {
  return (
    <div className="greeting">
      <h1>{temporary ? 'Temporary chat' : 'What’s on your mind?'}</h1>
      {temporary ? (
        <p>
          This chat won’t appear in your history or search, and it’s deleted
          when you leave it.
        </p>
      ) : (
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
      )}
    </div>
  )
}
