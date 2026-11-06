// Images, audio and video that an answer links to. chibot loads one by itself
// only when its address is one nobody could have added data to (see
// `knownUrls`), and otherwise waits for a click; both go through the server's
// /api/media, which checks the same thing. Shared by the server and the web.

export type MediaKind = 'image' | 'audio' | 'video'

const EXTENSIONS: Record<string, MediaKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  mp3: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  oga: 'audio',
  wav: 'audio',
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
}

/** What the address's file extension says it is, or `null` (also for an image without one). */
export function mediaKind(url: string): MediaKind | null {
  const path = URL.parse(url)?.pathname ?? ''
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return (extension && EXTENSIONS[extension]) || null
}

/** The address as the server compares it: http(s) only, without a fragment. */
export function normalizedUrl(raw: string): string | null {
  const url = URL.parse(raw)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return null
  }
  url.hash = ''
  return url.href
}

/**
 * The addresses in `texts` (what the user wrote, and what tools returned):
 * ones the model did not make up. An address with anything added to one of
 * them is another address, so data can't ride along, which is why these may
 * load without a click. The model's own words are not among the `texts`.
 */
export function knownUrls(texts: Iterable<string>): Set<string> {
  const known = new Set<string>()
  const add = (raw: string) => {
    const url = normalizedUrl(raw)
    if (url) known.add(url)
  }
  for (const text of texts) {
    for (const [found] of text.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
      add(found)
      // "(see https://a.example/x.png)." ends with punctuation that isn't the address.
      add(found.replace(/[.,;:!?)\]}>]+$/, ''))
    }
  }
  return known
}
