// The JSON export format. Validated on import; the web uses the type only.
import { z } from 'zod'
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import { fileParts } from './messages.ts'

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
  .superRefine(({ items, currentLeafId, files }, ctx) => {
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
    const fileIds = new Set<string>()
    for (const [i, file] of files.entries()) {
      if (fileIds.has(file.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate file id ${file.id}`,
          path: ['files', i, 'id'],
        })
      }
      fileIds.add(file.id)
    }
    // Attachments travel with the export (version 2). Other ids in tool
    // output (generated images in version 1, project files) may not.
    for (const [i, item] of items.entries()) {
      for (const { file_id: id } of fileParts(item.data)) {
        if (id && !fileIds.has(id)) {
          ctx.addIssue({
            code: 'custom',
            message: `file ${id} is not in files`,
            path: ['items', i, 'data'],
          })
        }
      }
    }
  })

export type ConversationExport = z.output<typeof conversationExportSchema>

/**
 * Gives every file id in `value` its replacement from `ids`, changing only
 * file references: message text that happens to contain an id is left alone.
 */
export function replaceFileIds<T>(value: T, ids: Map<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceFileIds(entry, ids)) as T
  }
  if (!value || typeof value !== 'object') return value
  const replaced: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === 'file_id' || key === 'image_id') &&
      typeof entry === 'string' &&
      ids.has(entry)
    ) {
      replaced[key] = ids.get(entry)
    } else if (
      (key === 'output' || key === 'arguments') &&
      typeof entry === 'string'
    ) {
      // Tool output and call arguments can be JSON with ids inside
      // (image_id). Anything else, e.g. a calculator's "0.10", stays as is.
      replaced[key] = entry
      try {
        const parsed: unknown = JSON.parse(entry)
        if (parsed && typeof parsed === 'object') {
          replaced[key] = JSON.stringify(replaceFileIds(parsed, ids))
        }
      } catch {
        // Not JSON.
      }
    } else {
      replaced[key] = replaceFileIds(entry, ids)
    }
  }
  return replaced as T
}
