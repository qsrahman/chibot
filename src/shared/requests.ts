// Request bodies the server validates. The web imports the inferred types
// (via types.ts) only, so zod stays out of the browser bundle.
import { z } from 'zod'

/** `POST /api/conversations`; the body may be empty. */
export const createConversationSchema = z.object({
  temporary: z.boolean().optional(),
})

/** `PATCH /api/conversations/:id`: rename, pin or archive. */
export const conversationPatchSchema = z.object({
  // Long titles are cut rather than rejected: they come from a rename box.
  title: z
    .string()
    .trim()
    .min(1)
    .transform((title) => title.slice(0, 200))
    .optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
})

/**
 * `POST /api/conversations/:id/turns`:
 * - `{ text }` sends a message after the current leaf;
 * - `{ text, parentId }` sends it under `parentId` (`null` = the root), i.e.
 *   an edit of the message currently there;
 * - `{ parentId }` regenerates the answer to the user message `parentId`;
 * - `{ approvals }` answers the tool calls waiting for approval (call id →
 *   approved) and continues the answer.
 *
 * `tool` (with `text`) makes the model call that tool first, e.g. "Search
 * the web" chosen in the composer.
 */
export const turnRequestSchema = z
  .object({
    text: z
      .string()
      .refine((text) => text.trim() !== '', 'must not be blank')
      .optional(),
    parentId: z.number().int().nullable().optional(),
    approvals: z.record(z.string(), z.boolean()).optional(),
    tool: z.string().max(100).optional(),
  })
  .refine(
    ({ text, parentId, approvals }) =>
      approvals !== undefined
        ? text === undefined && parentId === undefined
        : text !== undefined || typeof parentId === 'number',
    'Send `text`, `parentId`, or both; or `approvals` alone',
  )

/** `PUT /api/conversations/:id/leaf`: show another version. */
export const switchVersionSchema = z.object({ itemId: z.number().int() })
