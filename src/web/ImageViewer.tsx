import type { MouseEvent } from 'react'
import { Download, X } from 'lucide-react'
import { Dialog } from './Dialog.tsx'

/** An image shown full size: a stored file and what it is. */
export interface ViewedImage {
  fileId: string
  /** e.g. "Generated image"; the dialog's title and the image's alt text. */
  label: string
}

/** Shows an image over the chat, so viewing it doesn't leave chibot. */
export function ImageViewer({
  image,
  onClose,
}: {
  image: ViewedImage | null
  onClose: () => void
}) {
  const url = image && `/api/files/${image.fileId}`
  return (
    <Dialog
      open={image !== null}
      onClose={onClose}
      title={image?.label ?? ''}
      className="image-viewer"
    >
      {url && (
        <>
          <div className="image-viewer-actions">
            <a
              className="icon-button"
              href={url}
              download
              aria-label="Download image"
              title="Download"
            >
              <Download size={20} strokeWidth={1.5} />
            </a>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          </div>
          <img src={url} alt={image.label} />
        </>
      )}
    </Dialog>
  )
}

/**
 * For an image's link: a plain click opens the viewer; ⌘ / Ctrl / Shift /
 * middle clicks keep the browser's own new tab or window.
 */
export const opensViewer =
  (open: () => void) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    open()
  }
