import { createContext, useMemo } from 'react'
import { knownUrls } from '../../shared/media.ts'
import type { Turn } from './turns.ts'

/**
 * What the answers in the open chat may show by themselves: `known` are the
 * addresses the user wrote or tools returned (see `knownUrls`), the only
 * ones that load without a click. `null` without a saved chat to ask the
 * server about.
 */
export interface MediaAccess {
  conversationId: string
  known: ReadonlySet<string>
}

export const MediaContext = createContext<MediaAccess | null>(null)

/**
 * The addresses in answers that may load by themselves: those the user wrote
 * and tools returned (the server checks the same, and which it knows).
 */
export function useChatMedia(
  conversationId: string | undefined,
  turns: Turn[],
  pending: { turn: Turn } | null,
): MediaAccess | null {
  return useMemo(() => {
    if (!conversationId) return null
    const shown = pending ? [...turns, pending.turn] : turns
    const texts = shown.flatMap(({ question, answer }) => [
      question.text,
      ...(answer?.tools.map((tool) => tool.output ?? '') ?? []),
    ])
    return { conversationId, known: knownUrls(texts) }
  }, [conversationId, turns, pending])
}
