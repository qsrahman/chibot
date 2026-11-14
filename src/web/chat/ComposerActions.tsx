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
  return (
    <div className="composer-actions">
      <EffortSwitch effort={effort} onChange={onEffort} />
      {voice.stream && <DictationMeter stream={voice.stream} />}
      <button
        type="button"
        className={voice.recording ? 'icon-button recording' : 'icon-button'}
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
          <Mic size={20} strokeWidth={1.5} />
        )}
      </button>
      {busy && canQueue && stop(false)}
      {busy ? (
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
