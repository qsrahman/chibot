import { describe, expect, it } from 'vitest'
import { knownUrls, mediaKind, normalizedUrl } from '../../src/shared/media.ts'

describe('mediaKind', () => {
  it('reads the extension, ignoring the query and case', () => {
    expect(mediaKind('https://a.test/x/photo.PNG?size=2')).toBe('image')
    expect(mediaKind('https://a.test/clip.mp4')).toBe('video')
    expect(mediaKind('https://a.test/song.m4a#t=5')).toBe('audio')
    // An image without an extension is not known by its address; svg is never shown.
    expect(mediaKind('https://a.test/photo')).toBeNull()
    expect(mediaKind('https://a.test/logo.svg')).toBeNull()
    expect(mediaKind('not a url')).toBeNull()
  })
})

describe('normalizedUrl', () => {
  it('keeps http(s) addresses without their fragment, and nothing else', () => {
    expect(normalizedUrl('https://a.test/x.png#top')).toBe(
      'https://a.test/x.png',
    )
    expect(normalizedUrl('HTTP://A.test')).toBe('http://a.test/')
    expect(normalizedUrl('javascript:alert(1)')).toBeNull()
    expect(normalizedUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(normalizedUrl('/relative.png')).toBeNull()
  })
})

describe('knownUrls', () => {
  it('finds every address in the texts, also at the end of a sentence or in brackets', () => {
    const known = knownUrls([
      'See https://a.test/one.png, and (https://a.test/two.png).',
      '{"image":"https://b.test/three.webp?x=1","other":"ftp://no.test/"}',
    ])
    // (A trailing "." or "," may be part of the address or not: both are known.)
    expect([...known]).toEqual(
      expect.arrayContaining([
        'https://a.test/one.png',
        'https://a.test/two.png',
        'https://b.test/three.webp?x=1',
      ]),
    )
    expect([...known].some((url) => url.startsWith('ftp'))).toBe(false)
  })

  it('does not count an address with something added as the same address', () => {
    const known = knownUrls(['https://a.test/pixel.png'])
    expect(known.has('https://a.test/pixel.png')).toBe(true)
    // The model adding the user's data to a known address makes another one.
    expect(known.has('https://a.test/pixel.png?d=secret')).toBe(false)
    expect(known.has('https://evil.test/pixel.png')).toBe(false)
  })

  it('treats a fragment as the same address (it is never sent)', () => {
    expect(
      knownUrls(['https://a.test/x.png#a']).has('https://a.test/x.png'),
    ).toBe(true)
  })
})
