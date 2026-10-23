import { z } from 'zod'
import {
  MAX_MEMORIES,
  MAX_MEMORY_LENGTH,
  type MemoryStore,
} from '../memory-store.ts'
import { Tool } from '../tool.ts'

/** Saves, updates and deletes what chibot remembers about the user. */
export class MemoryTool extends Tool {
  readonly name = 'memory'
  readonly label = 'Memory'
  readonly description =
    'Saves, updates or deletes a memory about the user, kept across chats.'
  readonly parameters = z.object({
    action: z.enum(['save', 'update', 'delete']),
    id: z
      .number()
      .int()
      .nullable()
      .describe('The memory to update or delete; null to save'),
    text: z
      .string()
      .nullable()
      .describe(
        'The memory, as a short sentence about the user; null to delete',
      ),
  })
  override readonly inTemporaryChats = false
  readonly #memories: MemoryStore

  constructor(memories: MemoryStore) {
    super()
    this.#memories = memories
  }

  override instructions() {
    const memories = this.#memories.list()
    return [
      'You remember things about the user across chats. What you remember (id: memory):',
      memories.length
        ? memories.map(({ id, text }) => `${id}: ${text}`).join('\n')
        : '(nothing yet)',
      '',
      'Use the memory tool to save lasting facts and preferences the user ' +
        'shares about themselves or asks you to remember, to update a memory ' +
        'that changed, and to delete one the user asks you to forget. Don’t ' +
        'save one-off details, secrets (passwords, keys, card numbers) or what ' +
        'is already remembered. Save it and also answer the message.',
    ].join('\n')
  }

  async run({ action, id, text }: z.output<typeof this.parameters>) {
    const memories = this.#memories
    const clean = () => {
      const value = text?.trim()
      if (!value) throw new Error(`${action} needs the memory's text`)
      if (value.length > MAX_MEMORY_LENGTH) {
        throw new Error(
          `a memory can be at most ${MAX_MEMORY_LENGTH} characters`,
        )
      }
      return value
    }
    const existing = () => {
      const memory = id === null ? null : memories.get(id)
      if (!memory) throw new Error(`there is no memory ${id}`)
      return memory
    }

    switch (action) {
      case 'save': {
        const value = clean()
        if (memories.count >= MAX_MEMORIES) {
          throw new Error(
            `memory is full (${MAX_MEMORIES} memories): update or delete one instead`,
          )
        }
        const memory = memories.save(value)
        return `Saved memory ${memory.id}: "${memory.text}"`
      }
      case 'update': {
        const { id: memoryId } = existing()
        const memory = memories.update(memoryId, clean())!
        return `Updated memory ${memory.id}: "${memory.text}"`
      }
      case 'delete': {
        const memory = existing()
        memories.delete(memory.id)
        return `Deleted memory ${memory.id}: "${memory.text}"`
      }
    }
  }
}
