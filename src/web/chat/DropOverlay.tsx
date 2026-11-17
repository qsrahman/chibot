import { Upload } from 'lucide-react'
import { acceptedLabel } from '../../shared/documents.ts'

/** Shown over the chat while files are dragged onto it (decoration only). */
export function DropOverlay({ transcription }: { transcription: boolean }) {
  return (
    <div className="drop-overlay" aria-hidden>
      <div className="drop-card">
        <Upload size={24} />
        <strong>Add anything</strong>
        <span>{acceptedLabel(transcription)}</span>
      </div>
    </div>
  )
}
