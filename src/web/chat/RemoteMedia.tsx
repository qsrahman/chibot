import { useContext, useState } from 'react'
import { Image as ImageIcon, Music, Play } from 'lucide-react'
import { mediaKind, normalizedUrl, type MediaKind } from '../../shared/media.ts'
import { MediaContext } from './mediaContext.ts'

const NOUN: Record<MediaKind, string> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
}

/** The server fetches it (`/api/media`), so this page never connects to another site. */
const mediaUrl = (conversationId: string, src: string, confirmed: boolean) =>
  `/api/media?c=${encodeURIComponent(conversationId)}&u=${encodeURIComponent(src)}${
    confirmed ? '&confirm=1' : ''
  }`

/**
 * An image, sound or video from another site, in an answer. One whose address
 * the user wrote or a tool returned shows at once; any other waits for a click
 * (the model could have added the user's data to it). `kind` is what it is
 * said to be (`![…](…)` is an image unless the address says otherwise).
 */
export function RemoteMedia({
  src,
  alt,
  kind,
}: {
  src: string
  alt?: string | undefined
  kind: MediaKind
}) {
  const access = useContext(MediaContext)
  const address = normalizedUrl(src)
  const automatic = Boolean(access && address && access.known.has(address))
  const [clicked, setClicked] = useState(false)
  const [failed, setFailed] = useState<'automatic' | 'clicked' | null>(null)

  const host = URL.parse(src)?.hostname ?? src
  // Without a saved chat, or an address that is no address: a link, as before.
  if (!access || !address) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || host}
      </a>
    )
  }

  // Shown by itself, or after a click; a failure of either goes back to the
  // placeholder, which says so (a click is the second and last try).
  const shown = clicked
    ? failed !== 'clicked'
    : automatic && failed !== 'automatic'
  if (shown) {
    const url = mediaUrl(access.conversationId, address, clicked)
    const onError = () => setFailed(clicked ? 'clicked' : 'automatic')
    if (kind === 'video') {
      return (
        <video
          className="remote-media-player"
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={alt || undefined}
          onError={onError}
        />
      )
    }
    if (kind === 'audio') {
      return (
        <audio
          className="remote-media-player"
          src={url}
          controls
          preload="metadata"
          aria-label={alt || undefined}
          onError={onError}
        />
      )
    }
    return (
      <img
        className="remote-media-image"
        src={url}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        onError={onError}
      />
    )
  }

  const Icon = kind === 'audio' ? Music : kind === 'video' ? Play : ImageIcon
  return (
    <span
      className="remote-media"
      role="group"
      aria-label={`${NOUN[kind]} from ${host}`}
    >
      <Icon size={18} strokeWidth={1.5} aria-hidden />
      <span className="remote-media-text">
        {failed === 'clicked'
          ? `Couldn’t load the ${NOUN[kind]} from ${host}.`
          : failed === 'automatic'
            ? `Couldn’t load the ${NOUN[kind]} from ${host} by itself.`
            : alt
              ? `${alt} (${NOUN[kind]} from ${host})`
              : `${NOUN[kind]} from ${host}`}
      </span>
      {failed !== 'clicked' && (
        <button
          type="button"
          className="button"
          onClick={() => {
            setFailed(null)
            setClicked(true)
          }}
        >
          Load
        </button>
      )}
      <a href={src} target="_blank" rel="noopener noreferrer">
        Open
      </a>
    </span>
  )
}

/** Whether `href` is a link to a sound or video (an image link stays a link). */
export const playableKind = (href: string): MediaKind | null => {
  const kind = mediaKind(href)
  return kind === 'audio' || kind === 'video' ? kind : null
}
