import { createContext } from 'react'

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
