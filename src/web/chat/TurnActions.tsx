// The rows of buttons around a turn: under the question, under the answer,
// and the notice when an answer was cut short.
import {
  CircleAlert,
  GitBranch,
  Pencil,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { messageTime } from '../conversations/dates.ts'
import { CompactNow } from './CompactNote.tsx'
import { CopyButton, IconAction, VersionSwitcher } from './MessageActions.tsx'
import { canSpeak, toggleReading, useReading } from './readAloud.ts'
import type { Answer, Question } from './turns.ts'
import { describeContext, describeUsage } from './usage.ts'

/** Under a question: copy, edit and its versions. */
export function UserActions({
  question,
  busy,
  onEdit,
  onSwitch,
}: {
  question: Question
  busy?: boolean
  onEdit: () => void
  onSwitch?: (itemId: number) => void
}) {
  return (
    <div className="actions user-actions">
      {question.text && <CopyButton text={question.text} />}
      {/* Shown after a Stop before the server's ids are known: no edit. */}
      {question.itemId !== null && (
        <IconAction label="Edit message" disabled={busy} onClick={onEdit}>
          <Pencil />
        </IconAction>
      )}
      {question.versions && onSwitch && (
        <VersionSwitcher
          versions={question.versions}
          disabled={busy}
          onSwitch={onSwitch}
        />
      )}
    </div>
  )
}

/** Under an answer: copy, read aloud, regenerate, branch, versions, model and context. */
export function AnswerActions({
  answer,
  itemId,
  text,
  saved,
  busy,
  latest,
  context,
  onRegenerate,
  onBranch,
  onSwitch,
  onCompact,
}: {
  answer: Answer | null
  /** Identifies what is read aloud: the answer's item, or the question's without one. */
  itemId: number | null
  /** The answer as shown (without a card the model wrote as text). */
  text: string
  saved: boolean
  busy?: boolean
  latest?: boolean
  /** The context window and where chibot compacts (`null`: never). */
  context: { window: number; trigger: number | null }
  onRegenerate?: () => void
  onBranch?: () => void
  onSwitch?: (itemId: number) => void
  onCompact?: (focus: string) => void
}) {
  const readingKey = String(itemId)
  const reading = useReading() === readingKey
  const answerUsage = describeUsage(answer?.usage)
  const contextUsage = describeContext(
    answer?.lastUsage,
    context.window,
    context.trigger,
  )
  return (
    <div className="actions answer-actions">
      {answer && <CopyButton text={text} />}
      {answer && canSpeak() && (
        <IconAction
          label={reading ? 'Stop reading' : 'Read aloud'}
          pressed={reading}
          onClick={() => toggleReading(readingKey, text)}
        >
          {reading ? <VolumeX /> : <Volume2 />}
        </IconAction>
      )}
      {saved && (
        <IconAction
          label={answer ? 'Regenerate' : 'Retry'}
          disabled={busy}
          onClick={() => onRegenerate?.()}
        >
          <RefreshCw />
        </IconAction>
      )}
      {answer && onBranch && (
        <IconAction
          label="Branch in new chat"
          disabled={busy}
          onClick={onBranch}
        >
          <GitBranch />
        </IconAction>
      )}
      {answer?.versions && onSwitch && (
        <VersionSwitcher
          versions={answer.versions}
          disabled={busy}
          onSwitch={onSwitch}
        />
      )}
      {answer?.model && (
        <span
          className="usage model-name"
          title={
            answer.createdAt
              ? `Written by ${answer.model}, ${messageTime(answer.createdAt)}`
              : 'Model that wrote this answer'
          }
        >
          {answer.model}
        </span>
      )}
      {contextUsage && (
        <span
          className={contextUsage.nearLimit ? 'usage near-limit' : 'usage'}
          title={[contextUsage.detail, answerUsage?.detail]
            .filter(Boolean)
            .join(' · ')}
        >
          {contextUsage.short}
        </span>
      )}
      {latest && onCompact && (
        <CompactNow busy={!!busy} onCompact={onCompact} />
      )}
    </div>
  )
}

/** The latest turn's answer stopped short: why (if it failed), and how to go on. */
export function Interrupted({
  hasAnswer,
  saved,
  failure,
  busy,
  onRetry,
  onContinue,
  onRegenerate,
}: {
  hasAnswer: boolean
  saved: boolean
  failure?: string | null
  busy?: boolean
  onRetry?: () => void
  onContinue?: () => void
  onRegenerate?: () => void
}) {
  if (failure) {
    return (
      <div className="recovery failed" role="alert">
        <CircleAlert size={16} aria-hidden />
        <div>
          <p>The answer stopped unexpectedly.</p>
          <p className="reason">{failure}</p>
        </div>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onRetry?.()}
        >
          Retry
        </button>
      </div>
    )
  }
  return (
    <div className="recovery" role="group" aria-label="Answer interrupted">
      <span>
        {hasAnswer
          ? 'The answer stopped before it was finished.'
          : 'There is no answer to this message.'}
      </span>
      {hasAnswer && (
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onContinue?.()}
        >
          Continue
        </button>
      )}
      {/* Regenerating needs the saved ids, which a just-stopped answer lacks until the chat reloads. */}
      {saved && (
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onRegenerate?.()}
        >
          {hasAnswer ? 'Regenerate' : 'Try again'}
        </button>
      )}
    </div>
  )
}
