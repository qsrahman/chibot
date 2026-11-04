import { FileText } from 'lucide-react'

/** A document's icon, name and type ("PDF"); `detail` replaces the type. */
export function FileCard({ name, detail }: { name: string; detail?: string }) {
  const type = /\.([^.]+)$/.exec(name)?.[1]?.toUpperCase() ?? 'File'
  return (
    <span className="file-card">
      <span className="file-card-icon">
        <FileText size={20} strokeWidth={1.5} aria-hidden />
      </span>
      <span className="file-card-text">
        <span className="file-card-name">{name}</span>
        <span className="file-card-type">{detail ?? type}</span>
      </span>
    </span>
  )
}
