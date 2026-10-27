import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { fileKind } from '../../shared/documents.ts'
import type { AppDeps } from '../app.ts'
import { disposition, form, notFound } from './helpers.ts'

export function fileRoutes({ files, transcription }: AppDeps) {
  const app = new Hono()

  app.post(
    '/api/files',
    bodyLimit({
      maxSize: FILE_LIMIT,
      onError: (c) => c.json({ error: 'The file is larger than 50 MB' }, 413),
    }),
    form(
      z.object({
        file: z.instanceof(File, { error: 'send the file as `file`' }),
      }),
    ),
    async (c) => {
      const { file } = c.req.valid('form')
      const kind = fileKind(file.name)
      if (!kind) {
        return c.json(
          { error: `${file.name}: only images, PDF, Word and text files` },
          415,
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return c.json(files.save(null, file.name, kind.mime, bytes), 201)
    },
  )

  app.post(
    '/api/transcriptions',
    bodyLimit({
      maxSize: AUDIO_LIMIT,
      onError: (c) =>
        c.json({ error: 'The recording is larger than 25 MB' }, 413),
    }),
    form(
      z.object({
        file: z.instanceof(File, { error: 'send the recording as `file`' }),
      }),
    ),
    async (c) => {
      if (!transcription) {
        return c.json({ error: 'No transcription endpoint is set up' }, 501)
      }
      const { file } = c.req.valid('form')
      try {
        const text = await transcription.transcribe(file, c.req.raw.signal)
        return c.json({ text })
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    },
  )

  app.get('/api/files/:id', (c) => {
    const file = files.get(c.req.param('id'))
    if (!file) return notFound(c, 'File')
    return c.body(files.read(file.id), 200, {
      'Content-Type': file.mime,
      'X-Content-Type-Options': 'nosniff',
      // Uploads are served from chibot's origin: an HTML file opened here must
      // not run scripts that could use the API. (PDFs are left alone: the
      // browser's viewer doesn't render them in a sandbox.)
      ...(file.mime !== 'application/pdf' && {
        'Content-Security-Policy': 'sandbox',
      }),
      // A file never changes under its id.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': disposition('inline', file.name),
    })
  })

  return app
}

const FILE_LIMIT = 50 * 1024 * 1024
const AUDIO_LIMIT = 25 * 1024 * 1024
