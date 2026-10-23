// The JSON export format. Validated on import; the web uses the type only.
import { z } from 'zod'
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'

const exportedItemSchema = z.object({
  /** Only meaningful within the file: import assigns new ids. */
  id: z.number().int(),
  parentId: z.number().int().nullable(),
  // Items are the SDK's own shapes; only check they look like one.
  data: z
    .looseObject({})
    .refine((d) => 'type' in d || 'role' in d, 'not a Responses API item')
    .transform((d) => d as unknown as ResponseInputItem),
  usage: z
    .looseObject({})
    .nullable()
    .transform((u) => u as ResponseUsage | null),
  model: z.string().nullable(),
  createdAt: z.number(),
})

const exportedFileSchema = z.object({
  /** Import gives the file a new id, wherever the items mention it. */
  id: z.uuid(),
  name: z.string().min(1),
  data: z.base64(),
})

export const conversationExportSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    exportedAt: z.number().optional(),
    conversation: z.object({
      title: z.string().nullable(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
    /** The version on screen when exported. */
    currentLeafId: z.number().int().nullable(),
    /** The whole tree, every version included, parents before children. */
    items: z.array(exportedItemSchema),
    /** Version 2: the chat's attachments and generated images. */
    files: z.array(exportedFileSchema).default([]),
  })
  .superRefine(({ items, currentLeafId }, ctx) => {
    const seen = new Set<number>()
    for (const [i, item] of items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate id ${item.id}`,
          path: ['items', i],
        })
      }
      // Parents come first, so the tree can't contain a cycle.
      if (item.parentId !== null && !seen.has(item.parentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `parent ${item.parentId} must come before item ${item.id}`,
          path: ['items', i, 'parentId'],
        })
      }
      seen.add(item.id)
    }
    if (currentLeafId !== null && !seen.has(currentLeafId)) {
      ctx.addIssue({
        code: 'custom',
        message: `currentLeafId ${currentLeafId} is not an item`,
        path: ['currentLeafId'],
      })
    }
  })

export type ConversationExport = z.output<typeof conversationExportSchema>
