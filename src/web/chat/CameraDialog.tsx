import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Dialog } from '../ui/Dialog.tsx'

/**
 * A live camera preview and a shutter button. The photo goes to `onCapture` as
 * a file, to be attached like any other. The camera runs only while the
 * dialog is open and only the user's click takes a picture.
 */
export function CameraDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean
  onClose: () => void
  onCapture: (photo: File) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | undefined
    let cancelled = false
    setReady(false)
    setError(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then((media) => {
        if (cancelled) return media.getTracks().forEach((t) => t.stop())
        stream = media
        video.current!.srcObject = media
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera access was denied'
            : `Can’t use the camera: ${err.message}`,
        )
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [open])

  function capture() {
    const { videoWidth: width, videoHeight: height } = video.current!
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(video.current!, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError('The photo could not be taken')
        onCapture(
          new File(
            [blob],
            `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`,
            {
              type: 'image/jpeg',
            },
          ),
        )
        onClose()
      },
      'image/jpeg',
      0.9,
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take a photo"
      className="camera"
    >
      {error && (
        <p className="dialog-body" role="alert">
          {error}
        </p>
      )}
      <video
        ref={video}
        className="camera-preview"
        autoPlay
        playsInline
        muted
        // The first frame, before which the picture would be empty.
        onLoadedData={() => setReady(true)}
        hidden={!!error}
      />
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!ready}
          onClick={capture}
        >
          <Camera size={16} strokeWidth={1.5} aria-hidden /> Take photo
        </button>
      </div>
    </Dialog>
  )
}
