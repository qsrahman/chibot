import { LoaderCircle, X } from 'lucide-react'
import { FileCard } from '../ui/FileCard.tsx'
import type { Draft } from './useAttachments.ts'

/** The composer's attachments: a thumbnail or file card each, with ×. */
export function DraftAttachments({
  drafts,
  onRemove,
}: {
  drafts: Draft[]
  onRemove: (key: Draft['key']) => void
}) {
  return (
    <ul className="composer-attachments" aria-label="Attachments">
      {drafts.map((draft) => (
        <DraftChip
          key={draft.key}
          draft={draft}
          onRemove={() => onRemove(draft.key)}
        />
      ))}
    </ul>
  )
}

function DraftChip({
  draft,
  onRemove,
}: {
  draft: Draft
  onRemove: () => void
}) {
  const state = draft.error
    ? 'failed'
    : draft.attachment
      ? 'ready'
      : 'uploading'
  return (
    <li
      className={`attachment ${draft.preview ? 'image' : 'file'} ${state}`}
      title={draft.error ?? draft.name}
    >
      {draft.preview ? (
        <img src={draft.preview} alt={draft.name} />
      ) : (
        <FileCard name={draft.name} detail={draft.error ?? undefined} />
      )}
      {state === 'uploading' && (
        <LoaderCircle
          className="attachment-spinner"
          size={20}
          aria-label="Uploading"
        />
      )}
      <button
        type="button"
        className="attachment-remove"
        aria-label={`Remove ${draft.name}`}
        onClick={onRemove}
      >
        <X size={12} strokeWidth={2.5} aria-hidden />
      </button>
    </li>
  )
}
