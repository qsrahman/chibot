import { CornerDownRight } from 'lucide-react'

/** Prompts that could come next, above the composer: a click sends one. */
export function FollowUps({
  suggestions,
  onPick,
}: {
  suggestions: string[]
  onPick: (text: string) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="follow-ups" role="group" aria-labelledby="follow-ups-label">
      <span id="follow-ups-label" className="follow-ups-label">
        Ask next
      </span>
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          className="follow-up"
          onClick={() => onPick(text)}
        >
          <CornerDownRight size={15} strokeWidth={1.75} aria-hidden />
          <span dir="auto">{text}</span>
        </button>
      ))}
    </div>
  )
}
