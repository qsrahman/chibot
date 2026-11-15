import type { UsedMemory } from '../../shared/types.ts'

/**
 * The chip over an answer written with saved memories in its instructions, or
 * `null` when there were none. It says what was provided, not what the model
 * drew on: every saved memory is in the instructions of every turn.
 */
export function describeUsedMemory(memories: UsedMemory[]) {
  if (memories.length === 0) return null
  const n = memories.length
  return {
    short: `Memory · ${n}`,
    label: `${n} saved ${n === 1 ? 'memory was' : 'memories were'} in context for this answer. Open memories`,
  }
}
