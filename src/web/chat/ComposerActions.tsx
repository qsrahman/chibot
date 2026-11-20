import { ArrowUp, LoaderCircle, Mic, Square } from 'lucide-react'
import type { Settings } from '../../shared/settings.ts'
import { DictationMeter } from './DictationMeter.tsx'
import { EffortSwitch } from './EffortSwitch.tsx'
import type { useVoiceInput } from './useVoiceInput.ts'

/** The buttons on the box's bottom row: effort, the mic, and Stop / Queue / Send. */
export function ComposerActions({
  voice,
  effort,
  onEffort,
  busy,
  canQueue,
  canSend,
  empty,
  uploadQueued,
  onStop,
}: {
  voice: ReturnType<typeof useVoiceInput>
  effort: Settings['reasoningEffort']
  onEffort: (effort: Settings['reasoningEffort']) => void
  busy: boolean
  /** Busy, with text that can wait for the answer. */
  canQueue: boolean
  canSend: boolean
  /** Nothing is written and nothing is attached. */
  empty: boolean
  /** Sent while files were uploading: goes once they are up. */
  uploadQueued: boolean
  onStop: () => void
}) {
  const sendLabel = uploadQueued
    ? 'Sending when the files are uploaded'
    : 'Send'
  const stop = (primary: boolean) => (
    <button
      type="button"
      className={primary ? 'icon-button primary' : 'icon-button'}
      aria-label="Stop"
      title="Stop"
      onClick={onStop}
    >
      <Square size={14} fill="currentColor" />
    </button>
  )
  // With nothing to send, the main button is the mic (as ChatGPT's is voice):
  // a dimmed send arrow does nothing, and the mic is what an empty box wants.
  // Typing (or attaching) turns it into Send, and the mic stays beside it.
  const micIsMain = voice.supported && !busy && empty && !uploadQueued
  const mic = (main: boolean) => (
    <button
      type="button"
      className={[
        'icon-button',
        main && 'primary',
        voice.recording && 'recording',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={voice.micLabel}
      title={voice.micLabel}
      // aria-disabled rather than disabled, so the tooltip still shows.
      aria-disabled={voice.disabled}
      aria-pressed={voice.recording}
      onClick={voice.toggle}
    >
      {voice.state === 'transcribing' ? (
        <LoaderCircle className="spin" size={20} strokeWidth={1.5} />
      ) : voice.recording ? (
        <Square size={14} fill="currentColor" />
      ) : (
        <Mic size={20} strokeWidth={main ? 2 : 1.5} />
      )}
    </button>
  )
  return (
    <div className="composer-actions">
      <EffortSwitch effort={effort} onChange={onEffort} />
      {voice.stream && <DictationMeter stream={voice.stream} />}
      {!micIsMain && mic(false)}
      {busy && canQueue && stop(false)}
      {micIsMain ? (
        mic(true)
      ) : busy ? (
        canQueue ? (
          <button
            type="submit"
            className="icon-button primary"
            aria-label="Queue message"
            title="Send after this answer"
          >
            <ArrowUp size={20} strokeWidth={2} />
          </button>
        ) : (
          stop(true)
        )
      ) : (
        <button
          type="submit"
          className="icon-button primary"
          aria-label={sendLabel}
          title={sendLabel}
          disabled={!canSend}
        >
          {uploadQueued ? (
            <LoaderCircle className="spin" size={20} strokeWidth={2} />
          ) : (
            <ArrowUp size={20} strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  )
}
