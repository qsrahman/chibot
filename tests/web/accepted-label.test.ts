import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_LABEL,
  ACCEPTED_WITH_AUDIO,
  acceptedLabel,
  ATTACHMENT_ACCEPT,
  fileKind,
  isAudioFile,
} from '../../src/shared/documents.ts'

// The drop overlay names what chibot takes; each word must be true.
describe('ACCEPTED_LABEL', () => {
  it('names only kinds that are accepted', () => {
    expect(ACCEPTED_LABEL).toBe('Images, PDF, Word, text and code')
    for (const name of ['a.png', 'a.pdf', 'a.docx', 'a.txt', 'a.py']) {
      expect(fileKind(name), name).not.toBeNull()
    }
  })

  it('adds audio only when the server can transcribe', () => {
    expect(acceptedLabel(false)).toBe(ACCEPTED_LABEL)
    expect(acceptedLabel(true)).toBe(ACCEPTED_WITH_AUDIO)
    expect(ACCEPTED_WITH_AUDIO).toBe('Images, PDF, Word, text, code and audio')
  })
})

describe('isAudioFile', () => {
  it('knows a recording by its type or its extension', () => {
    expect(isAudioFile('voice-note.mp3')).toBe(true)
    expect(isAudioFile('Memo.M4A')).toBe(true)
    expect(isAudioFile('call.wav', 'audio/wav')).toBe(true)
    // A browser recording: the type says so, the name may be anything.
    expect(isAudioFile('recording.webm', 'audio/webm')).toBe(true)
    expect(isAudioFile('clip', 'audio/ogg')).toBe(true)
  })

  it('does not take video, images, documents or a bare .webm or .mp4', () => {
    expect(isAudioFile('clip.webm', 'video/webm')).toBe(false)
    expect(isAudioFile('clip.webm')).toBe(false)
    expect(isAudioFile('movie.mp4')).toBe(false)
    expect(isAudioFile('photo.png', 'image/png')).toBe(false)
    expect(isAudioFile('notes.txt')).toBe(false)
    expect(isAudioFile('mp3')).toBe(false)
  })

  it('is offered by the file picker, and is not an attachment kind', () => {
    expect(ATTACHMENT_ACCEPT).toContain('.mp3')
    expect(ATTACHMENT_ACCEPT).toContain('audio/*')
    expect(fileKind('voice-note.mp3')).toBeNull()
  })
})
