import { type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

/** Answers a failed validation with a `{ error }` 400. */
export const invalid = (
  result: { success: true } | { success: false; error: z.core.$ZodError },
  c: Context,
) => {
  if (!result.success) {
    return c.json({ error: z.prettifyError(result.error) }, 400)
  }
}

/** Validates a JSON body against `schema`. */
export const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, invalid)

/** Validates a multipart form body against `schema`. */
export const form = <T extends z.ZodType>(schema: T) =>
  zValidator('form', schema, invalid)

/** RFC 6266: `filename*` carries non-ASCII names. */
export const disposition = (type: 'inline' | 'attachment', name: string) =>
  `${type}; filename*=UTF-8''${encodeURIComponent(name)}`

export const notFound = (c: Context, what = 'Conversation') =>
  c.json({ error: `${what} not found` }, 404)
