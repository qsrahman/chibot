import { Download } from 'lucide-react'
import { opensViewer } from './ImageViewer.tsx'
import { type Answer, imagesOf } from './turns.ts'

/** Images the answer's tools made, or placeholders while they're made. */
export function AnswerImages({
  answer,
  onLoad,
  onView,
}: {
  answer: Answer
  onLoad?: () => void
  onView: (fileId: string) => void
}) {
  const images = answer.tools.flatMap((tool) => {
    return imagesOf(tool).map((image, i) => ({
      key: `${tool.callId}-${i}`,
      image,
    }))
  })
  if (images.length === 0) return null
  return (
    <div className="images">
      {images.map(({ key, image }) =>
        image === 'pending' ? (
          <div
            key={key}
            className="image-placeholder"
            aria-label="Creating image"
          />
        ) : (
          <figure key={key} className="image">
            <a
              href={`/api/files/${image}`}
              target="_blank"
              rel="noreferrer"
              onClick={opensViewer(() => onView(image))}
            >
              <img
                src={`/api/files/${image}`}
                alt="Generated image"
                onLoad={onLoad}
              />
            </a>
            <a
              className="icon-button image-download"
              href={`/api/files/${image}`}
              download
              aria-label="Download image"
              title="Download"
            >
              <Download size={18} strokeWidth={1.5} />
            </a>
          </figure>
        ),
      )}
    </div>
  )
}
