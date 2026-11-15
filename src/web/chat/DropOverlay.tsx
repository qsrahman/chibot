import { Upload } from 'lucide-react'
import { ACCEPTED_LABEL } from '../../shared/documents.ts'

/** Shown over the chat while files are dragged onto it (decoration only). */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden>
      <div className="drop-card">
        <Upload size={24} />
        <strong>Add anything</strong>
        <span>{ACCEPTED_LABEL}</span>
      </div>
    </div>
  )
}
